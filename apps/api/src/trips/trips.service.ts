import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  CreateTripInput,
  MyTripsDto,
  SearchTripsInput,
  TripDetailDto,
  TripSummaryDto,
  TripVisibility,
} from '@fcs/shared';
import { AppException, Forbidden } from '../common/errors.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../common/prisma.service.js';
import { addDays, dateOnly, romeToUtc, todayInRome } from '../common/time.js';
import type { Prisma } from '../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { StatsService } from '../stats/stats.service.js';
import { ChatMembershipEvents } from './chat-membership.events.js';
import { TripAccessPolicy } from './trip-access.policy.js';
import { tripInclude } from './trip-loader.js';
import { TripMapper } from './trip-mapper.js';

/** Visibilità effettiva PUBBLICA, espressa come filtro Prisma. */
export const PUBLIC_TRIP_FILTER: Prisma.TripWhereInput = {
  OR: [{ visibilityOverride: 'PUBLIC' }, { visibilityOverride: null, series: { visibility: 'PUBLIC' } }],
};

@Injectable()
export class TripsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: TripAccessPolicy,
    private readonly mapper: TripMapper,
    private readonly clock: Clock,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly chatEvents: ChatMembershipEvents,
    private readonly stats: StatsService,
  ) {}

  async create(userId: string, input: CreateTripInput): Promise<TripDetailDto> {
    const now = this.clock.now();
    const { maxDaysAhead } = await this.settings.get();
    const today = todayInRome(now);
    if (input.date < today || input.date > addDays(today, maxDaysAhead)) {
      throw new AppException('INVALID_DATE', `La data deve essere compresa tra oggi e i prossimi ${maxDaysAhead} giorni`);
    }
    const arrivalAt = romeToUtc(input.date, input.arrivalTime);
    if (arrivalAt <= now) throw new AppException('INVALID_DATE', 'L’orario di arrivo è già passato');

    const site = await this.prisma.site.findFirst({ where: { id: input.siteId, active: true }, select: { id: true } });
    if (!site) throw new AppException('INVALID_SITE', 'Sede non valida');
    const codes = [input.departureComune, ...input.viaComuni];
    const found = await this.prisma.comune.count({ where: { istat: { in: codes }, active: true } });
    if (found !== codes.length) throw new AppException('INVALID_COMUNE', 'Uno o più comuni non sono validi');

    const trip = await this.prisma.$transaction(async (tx) => {
      const series = await tx.tripSeries.create({
        data: {
          driverId: userId,
          siteId: input.siteId,
          visibility: input.visibility,
          startDate: dateOnly(input.date),
          endDate: dateOnly(input.date),
          arrivalTime: input.arrivalTime,
          returnTime: input.returnTime ?? null,
          seats: input.seats,
          meetingPoint: input.meetingPoint || null,
          notes: input.notes || null,
          stops: { create: codes.map((comuneIstat, order) => ({ order, comuneIstat })) },
        },
      });
      const created = await tx.trip.create({
        data: {
          seriesId: series.id,
          siteId: input.siteId,
          date: dateOnly(input.date),
          arrivalTime: input.arrivalTime,
          returnTime: input.returnTime ?? null,
          arrivalAt,
          seats: input.seats,
        },
      });
      await this.stats.syncFact(created.id, tx);
      return created;
    });
    return this.detail(trip.id, userId);
  }

  async detail(tripId: string, userId: string): Promise<TripDetailDto> {
    const ctx = await this.policy.loadVisible(tripId, userId);
    return this.mapper.detail(ctx);
  }

  /** Ricerca: SOLO viaggi pubblici, futuri, non annullati, con conducente attivo. */
  async search(userId: string, q: SearchTripsInput): Promise<TripSummaryDto[]> {
    const trips = await this.prisma.trip.findMany({
      where: {
        AND: [
          PUBLIC_TRIP_FILTER,
          {
            siteId: q.siteId,
            date: dateOnly(q.date),
            status: 'SCHEDULED',
            arrivalAt: { gt: this.clock.now() },
            series: {
              driver: { status: 'ACTIVE' },
              ...(q.comuneIstat ? { stops: { some: { comuneIstat: q.comuneIstat } } } : {}),
            },
          },
        ],
      },
      include: tripInclude,
      orderBy: { arrivalAt: 'asc' },
      take: 100,
    });
    return trips.map((t) => this.mapper.summary(t, userId));
  }

  async mine(userId: string): Promise<MyTripsDto> {
    const now = this.clock.now();
    const { closureWindowDays } = await this.settings.get();

    const asDriver = await this.prisma.trip.findMany({
      where: { series: { driverId: userId }, status: 'SCHEDULED', arrivalAt: { gt: now } },
      include: tripInclude,
      orderBy: { arrivalAt: 'asc' },
    });
    const asParticipant = await this.prisma.trip.findMany({
      where: {
        status: 'SCHEDULED',
        arrivalAt: { gt: now },
        participants: { some: { userId, status: { in: ['REQUESTED', 'ACCEPTED', 'WAITLISTED'] } } },
      },
      include: tripInclude,
      orderBy: { arrivalAt: 'asc' },
    });
    const awaitingClosure = await this.prisma.trip.findMany({
      where: {
        series: { driverId: userId },
        status: 'SCHEDULED',
        arrivalAt: { lte: now, gte: new Date(now.getTime() - closureWindowDays * 86_400_000) },
      },
      include: tripInclude,
      orderBy: { arrivalAt: 'desc' },
    });
    const invitations = await this.prisma.invitation.findMany({
      where: { inviteeId: userId, status: 'PENDING', expiresAt: { gt: now } },
      include: { trip: { include: tripInclude } },
      orderBy: { createdAt: 'desc' },
    });

    return {
      asDriver: asDriver.map((t) => this.mapper.summary(t, userId)),
      asParticipant: asParticipant.map((t) => this.mapper.summary(t, userId)),
      awaitingClosure: awaitingClosure.map((t) => this.mapper.summary(t, userId)),
      pendingRequests: asDriver
        .map((t) => ({ tripId: t.id, count: t.participants.filter((p) => p.status === 'REQUESTED').length }))
        .filter((r) => r.count > 0),
      pendingInvitations: invitations
        .filter((i) => i.trip && i.trip.status === 'SCHEDULED' && i.trip.arrivalAt > now)
        .map((i) => ({
          id: i.id,
          tripId: i.trip!.id,
          scope: i.scope,
          status: i.status,
          invitee: null,
          isLink: false,
          expiresAt: i.expiresAt.toISOString(),
          createdAt: i.createdAt.toISOString(),
          trip: this.mapper.summary(i.trip!, userId, { invited: true }),
        })),
    };
  }

  /**
   * Solo il conducente cambia la visibilità. Passando a PRIVATO le richieste
   * esterne in sospeso vengono rifiutate (un viaggio privato non le accetta);
   * i partecipanti già confermati restano.
   */
  async changeVisibility(tripId: string, userId: string, visibility: TripVisibility): Promise<TripDetailDto> {
    const ctx = await this.policy.loadVisible(tripId, userId);
    if (!ctx.isDriver) throw Forbidden('Solo il conducente può cambiare la visibilità');
    this.assertOpen(ctx.trip);

    const rejected: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      // Viaggio singolo: si aggiorna la serie. (Per le serie ricorrenti, override per data in Fase 3.)
      await tx.tripSeries.update({ where: { id: ctx.trip.seriesId }, data: { visibility } });
      await tx.trip.update({ where: { id: tripId }, data: { visibilityOverride: null } });
      if (visibility === 'PRIVATE') {
        const pending = ctx.trip.participants.filter((p) => p.status === 'REQUESTED' || p.status === 'WAITLISTED');
        if (pending.length) {
          await tx.tripParticipant.updateMany({
            where: { id: { in: pending.map((p) => p.id) } },
            data: { status: 'REJECTED', decidedAt: this.clock.now() },
          });
          rejected.push(...pending.map((p) => p.userId));
        }
      }
      await this.stats.syncFact(tripId, tx);
    });
    if (rejected.length) await this.notifications.notify(rejected, 'REQUEST_REJECTED', tripId);
    return this.detail(tripId, userId);
  }

  /** Annullamento del viaggio da parte del conducente, con notifica ai partecipanti. */
  async cancel(tripId: string, userId: string): Promise<void> {
    const ctx = await this.policy.loadVisible(tripId, userId);
    if (!ctx.isDriver) throw Forbidden('Solo il conducente può annullare il viaggio');
    this.assertOpen(ctx.trip);
    const toNotify = await this.cancelTripInternal(tripId);
    await this.notifications.notify(toNotify, 'TRIP_CANCELLED', tripId);
    for (const u of toNotify) await this.chatEvents.membershipChanged(ctx.trip.seriesId, u);
  }

  /** Annulla un viaggio e restituisce gli utenti da avvisare. Usato anche alla disattivazione di un utente. */
  async cancelTripInternal(tripId: string): Promise<string[]> {
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      const participants = await tx.tripParticipant.findMany({
        where: { tripId, status: { in: ['REQUESTED', 'ACCEPTED', 'WAITLISTED'] } },
        select: { userId: true },
      });
      await tx.trip.update({ where: { id: tripId }, data: { status: 'CANCELLED', cancelledAt: now } });
      await tx.invitation.updateMany({ where: { tripId, status: 'PENDING' }, data: { status: 'REVOKED', revokedAt: now } });
      await this.stats.syncFact(tripId, tx);
      return participants.map((p) => p.userId);
    });
  }

  assertOpen(trip: { status: string; arrivalAt: Date }): void {
    if (trip.status !== 'SCHEDULED' || trip.arrivalAt <= this.clock.now()) {
      throw new AppException('TRIP_NOT_OPEN', 'Il viaggio non è più modificabile', HttpStatus.CONFLICT);
    }
  }
}
