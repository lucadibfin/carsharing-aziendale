import { HttpStatus, Injectable } from '@nestjs/common';
import type { TripDetailDto } from '@fcs/shared';
import { AppException, Conflict, Forbidden, NotFound } from '../common/errors.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../common/prisma.service.js';
import { todayInRome, dateOnly } from '../common/time.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { ChatMembershipEvents } from './chat-membership.events.js';
import { lockSeats } from './seats.js';
import { TripAccessPolicy, type TripContext } from './trip-access.policy.js';
import { TripsService } from './trips.service.js';
import { WaitlistService } from './waitlist.service.js';

const NOT_RECURRING = () => new AppException('NOT_RECURRING', 'Il viaggio non è ricorrente', HttpStatus.CONFLICT);
const NOT_MEMBER = () => NotFound('Membro del gruppo');

/**
 * Viaggi ricorrenti con gruppo fisso:
 * - si entra nel gruppo accettando un invito alla serie (personale o con link);
 * - il membro è confermato in tutte le date future finché c'è posto, altrimenti è
 *   in lista d'attesa per quella data;
 * - per una singola data può dire "non ci sono": il posto si libera (lista d'attesa,
 *   avviso al conducente, che può rendere pubblica solo quella data);
 * - può tornare disponibile per quella data, se il posto è ancora libero.
 */
@Injectable()
export class SeriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: TripAccessPolicy,
    private readonly trips: TripsService,
    private readonly clock: Clock,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly chatEvents: ChatMembershipEvents,
    private readonly waitlist: WaitlistService,
  ) {}

  /**
   * Ingresso nel gruppo fisso (da invito alla serie). Restituisce la prossima data
   * della serie. Se l'invito è personale, viene chiuso nella stessa transazione.
   */
  async join(seriesId: string, userId: string, boardingComune: string, personalInvitationId?: string): Promise<string> {
    const series = await this.prisma.tripSeries.findUnique({
      where: { id: seriesId },
      include: { stops: true, members: { where: { userId } } },
    });
    if (!series || series.weekdays.length === 0) throw NOT_RECURRING();
    if (series.driverId === userId) throw new AppException('OWN_TRIP', 'Sei il conducente di questo viaggio');
    if (series.members.length) throw Conflict('ALREADY_MEMBER', 'Fai già parte del gruppo fisso di questo viaggio');
    if (!series.stops.some((s) => s.comuneIstat === boardingComune)) {
      throw new AppException('INVALID_BOARDING', 'Il comune di salita deve essere uno dei comuni del percorso');
    }
    const now = this.clock.now();
    const trips = await this.prisma.trip.findMany({
      where: { seriesId, status: 'SCHEDULED', arrivalAt: { gt: now } },
      orderBy: { date: 'asc' },
      select: { id: true },
    });
    if (!trips.length) throw new AppException('TRIP_NOT_OPEN', 'Il viaggio ricorrente non ha più date future', HttpStatus.CONFLICT);

    await this.prisma.$transaction(async (tx) => {
      await tx.seriesMember.create({ data: { seriesId, userId, boardingComune, joinedAt: now } });
      for (const t of trips) {
        const free = await lockSeats(tx, t.id);
        const existing = await tx.tripParticipant.findUnique({ where: { tripId_userId: { tripId: t.id, userId } } });
        if (existing?.status === 'ACCEPTED') {
          await tx.tripParticipant.update({ where: { id: existing.id }, data: { boardingComune } });
          continue;
        }
        const status = free > 0 ? ('ACCEPTED' as const) : ('WAITLISTED' as const);
        await tx.tripParticipant.upsert({
          where: { tripId_userId: { tripId: t.id, userId } },
          create: { tripId: t.id, userId, status, boardingComune, requestedAt: now, decidedAt: now },
          update: { status, boardingComune, requestedAt: now, decidedAt: now, cancelledAt: null, lateCancel: false, attended: null },
        });
      }
      if (personalInvitationId) {
        await tx.invitation.update({ where: { id: personalInvitationId }, data: { status: 'ACCEPTED', respondedAt: now } });
      }
    });
    await this.notifications.notify([series.driverId], 'INVITATION_ACCEPTED', trips[0]!.id);
    await this.chatEvents.membershipChanged(seriesId, userId);
    return trips[0]!.id;
  }

  /** "Non ci sono" per una data: il posto si libera. Oltre la scadenza resta segnato come tardivo. */
  async notThere(tripId: string, userId: string): Promise<TripDetailDto> {
    const ctx = await this.memberCtx(tripId, userId);
    const p = ctx.participant;
    if (!p || !['ACCEPTED', 'WAITLISTED', 'REQUESTED'].includes(p.status)) throw Conflict('NOT_PARTICIPATING', 'Per questa data risulti già assente');
    const now = this.clock.now();
    const { cancellationDeadlineHours } = await this.settings.get();
    const lateCancel = p.status === 'ACCEPTED' && now > new Date(ctx.trip.arrivalAt.getTime() - cancellationDeadlineHours * 3600_000);
    await this.prisma.tripParticipant.update({ where: { id: p.id }, data: { status: 'NOT_THERE', cancelledAt: now, lateCancel } });
    if (p.status === 'ACCEPTED') {
      await this.notifications.notify([ctx.trip.series.driverId], 'MEMBER_NOT_THERE', tripId);
      await this.waitlist.seatFreed(tripId);
    }
    return this.trips.detail(tripId, userId);
  }

  /** Il membro torna disponibile per una data: confermato se c'è ancora posto, altrimenti in lista d'attesa. */
  async backThere(tripId: string, userId: string): Promise<TripDetailDto> {
    const ctx = await this.memberCtx(tripId, userId);
    const p = ctx.participant;
    if (p && ['ACCEPTED', 'WAITLISTED'].includes(p.status)) throw Conflict('ALREADY_PARTICIPANT', 'Per questa data risulti già presente');
    const now = this.clock.now();
    const member = ctx.trip.series.members.find((m) => m.userId === userId)!;
    await this.prisma.$transaction(async (tx) => {
      const free = await lockSeats(tx, tripId);
      const status = free > 0 ? ('ACCEPTED' as const) : ('WAITLISTED' as const);
      await tx.tripParticipant.upsert({
        where: { tripId_userId: { tripId, userId } },
        create: { tripId, userId, status, boardingComune: member.boardingComune, requestedAt: now, decidedAt: now },
        update: { status, decidedAt: now, cancelledAt: null, lateCancel: false },
      });
    });
    return this.trips.detail(tripId, userId);
  }

  /** Il membro esce dal gruppo fisso: le sue partecipazioni future si annullano. */
  async leave(tripId: string, userId: string): Promise<void> {
    const ctx = await this.policy.loadVisible(tripId, userId);
    if (!ctx.isSeriesMember) throw NOT_MEMBER();
    await this.removeMembership(ctx.trip.seriesId, userId);
    await this.notifications.notify([ctx.trip.series.driverId], 'MEMBER_LEFT_SERIES', tripId);
  }

  /** Il conducente toglie un membro dal gruppo fisso. */
  async removeMember(tripId: string, driverId: string, memberId: string): Promise<TripDetailDto> {
    const ctx = await this.driverCtx(tripId, driverId);
    if (!ctx.trip.series.members.some((m) => m.userId === memberId)) throw NOT_MEMBER();
    await this.removeMembership(ctx.trip.seriesId, memberId);
    await this.notifications.notify([memberId], 'REMOVED_FROM_SERIES', tripId);
    return this.trips.detail(tripId, driverId);
  }

  /** Il conducente termina la serie: tutte le date future vengono annullate. */
  async end(tripId: string, driverId: string): Promise<void> {
    const ctx = await this.driverCtx(tripId, driverId);
    const now = this.clock.now();
    const future = await this.prisma.trip.findMany({
      where: { seriesId: ctx.trip.seriesId, status: 'SCHEDULED', arrivalAt: { gt: now } },
      select: { id: true },
    });
    await this.prisma.tripSeries.update({ where: { id: ctx.trip.seriesId }, data: { endDate: dateOnly(todayInRome(now)) } });
    const affected = new Set<string>();
    for (const t of future) for (const u of await this.trips.cancelTripInternal(t.id)) affected.add(u);
    await this.prisma.invitation.updateMany({
      where: { seriesId: ctx.trip.seriesId, status: 'PENDING' },
      data: { status: 'REVOKED', revokedAt: now },
    });
    if (affected.size) await this.notifications.notify([...affected], 'SERIES_CANCELLED', tripId);
    for (const u of affected) await this.chatEvents.membershipChanged(ctx.trip.seriesId, u);
  }

  private async removeMembership(seriesId: string, userId: string): Promise<void> {
    const now = this.clock.now();
    const { cancellationDeadlineHours } = await this.settings.get();
    const parts = await this.prisma.tripParticipant.findMany({
      where: {
        userId,
        status: { in: ['REQUESTED', 'ACCEPTED', 'WAITLISTED', 'NOT_THERE'] },
        trip: { seriesId, status: 'SCHEDULED', arrivalAt: { gt: now } },
      },
      include: { trip: { select: { arrivalAt: true } } },
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.seriesMember.deleteMany({ where: { seriesId, userId } });
      for (const p of parts) {
        const late = p.status === 'ACCEPTED' && now > new Date(p.trip.arrivalAt.getTime() - cancellationDeadlineHours * 3600_000);
        // Le date in cui aveva già detto "non ci sono" restano tali (con l'eventuale ritardo).
        if (p.status === 'NOT_THERE') continue;
        await tx.tripParticipant.update({ where: { id: p.id }, data: { status: 'CANCELLED', cancelledAt: now, lateCancel: late } });
      }
    });
    for (const p of parts) if (p.status === 'ACCEPTED') await this.waitlist.seatFreed(p.tripId);
    await this.chatEvents.membershipChanged(seriesId, userId);
  }

  private async memberCtx(tripId: string, userId: string): Promise<TripContext> {
    const ctx = await this.policy.loadVisible(tripId, userId);
    if (!ctx.isSeriesMember) throw NOT_MEMBER();
    this.trips.assertOpen(ctx.trip);
    return ctx;
  }

  private async driverCtx(tripId: string, driverId: string): Promise<TripContext> {
    const ctx = await this.policy.loadVisible(tripId, driverId);
    if (!ctx.isDriver) throw Forbidden('Solo il conducente può gestire il gruppo fisso');
    if (!ctx.trip.series.weekdays.length) throw NOT_RECURRING();
    return ctx;
  }
}
