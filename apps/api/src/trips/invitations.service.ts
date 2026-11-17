import { Injectable } from '@nestjs/common';
import type { InvitationDto, InviteLinkDto, TripDetailDto, TripSummaryDto, UserSummaryDto } from '@fcs/shared';
import { AppException, Conflict, Forbidden, NotFound } from '../common/errors.js';
import { Clock } from '../common/clock.js';
import { CryptoService } from '../common/crypto.service.js';
import { PrismaService } from '../common/prisma.service.js';
import { romeToUtc, toIsoDate } from '../common/time.js';
import type { Invitation, InvitationScope } from '../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ParticipationService } from './participation.service.js';
import { lockFreeSeat } from './seats.js';
import { SeriesService } from './series.service.js';

/** Durata di un invito personale al gruppo fisso (ore). */
const SERIES_INVITE_HOURS = 7 * 24;
import { TripAccessPolicy } from './trip-access.policy.js';
import { tripInclude } from './trip-loader.js';
import { TripMapper } from './trip-mapper.js';
import { TripsService } from './trips.service.js';

const INVALID_LINK = () => new AppException('INVALID_INVITATION', 'Invito non valido, scaduto o revocato', 404);

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: TripAccessPolicy,
    private readonly trips: TripsService,
    private readonly participation: ParticipationService,
    private readonly mapper: TripMapper,
    private readonly crypto: CryptoService,
    private readonly clock: Clock,
    private readonly notifications: NotificationsService,
    private readonly series: SeriesService,
  ) {}

  /** Ricerca colleghi per gli inviti: SOLO chi ha attivato la trovabilità. */
  async searchUsers(userId: string, q: string): Promise<(UserSummaryDto & { siteName: string | null })[]> {
    const terms = q.split(/\s+/).filter(Boolean).slice(0, 3);
    const users = await this.prisma.user.findMany({
      where: {
        id: { not: userId },
        status: 'ACTIVE',
        onboardedAt: { not: null },
        consent: { discoverable: true },
        AND: terms.map((t) => ({
          OR: [
            { firstName: { startsWith: t, mode: 'insensitive' as const } },
            { lastName: { startsWith: t, mode: 'insensitive' as const } },
          ],
        })),
      },
      select: { id: true, firstName: true, lastName: true, site: { select: { name: true } } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 10,
    });
    return users.map((u) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName, siteName: u.site?.name ?? null }));
  }

  async inviteUser(tripId: string, driverId: string, inviteeId: string, scope: InvitationScope = 'TRIP'): Promise<InvitationDto> {
    const ctx = await this.driverCtx(tripId, driverId, scope);
    if (inviteeId === driverId) throw new AppException('OWN_TRIP', 'Non puoi invitare te stesso');
    // Verifica della trovabilità anche qui: non basta nasconderli nella ricerca.
    const invitee = await this.prisma.user.findFirst({
      where: { id: inviteeId, status: 'ACTIVE', onboardedAt: { not: null }, consent: { discoverable: true } },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!invitee) throw NotFound('Collega');
    if (ctx.trip.series.members.some((m) => m.userId === inviteeId)) {
      throw Conflict('ALREADY_MEMBER', 'Il collega fa già parte del gruppo fisso');
    }
    const part = ctx.trip.participants.find((p) => p.userId === inviteeId);
    if (scope === 'TRIP' && part && ['REQUESTED', 'ACCEPTED', 'WAITLISTED'].includes(part.status)) {
      throw Conflict('ALREADY_PARTICIPANT', 'Il collega partecipa già o ha già chiesto di partecipare');
    }
    const now = this.clock.now();
    const pending = await this.prisma.invitation.findFirst({
      where: {
        inviteeId,
        status: 'PENDING',
        expiresAt: { gt: now },
        ...(scope === 'SERIES' ? { seriesId: ctx.trip.seriesId, scope } : { tripId, scope }),
      },
    });
    if (pending) throw Conflict('ALREADY_INVITED', 'Il collega è già stato invitato');

    const inv = await this.prisma.invitation.create({
      data: {
        seriesId: ctx.trip.seriesId,
        tripId,
        scope,
        createdById: driverId,
        inviteeId,
        expiresAt: scope === 'SERIES' ? await this.seriesInviteExpiry(ctx.trip.seriesId, SERIES_INVITE_HOURS) : ctx.trip.arrivalAt,
      },
    });
    await this.notifications.notify([inviteeId], 'INVITATION', tripId);
    return this.toDto(inv, tripId, invitee);
  }

  /** Link d'invito per colleghi non ancora registrati: riutilizzabile fino a scadenza o revoca. */
  async createLink(tripId: string, driverId: string, expiresInHours: number, scope: InvitationScope = 'TRIP'): Promise<InviteLinkDto> {
    const ctx = await this.driverCtx(tripId, driverId, scope);
    const token = this.crypto.randomToken();
    const now = this.clock.now();
    const expiresAt =
      scope === 'SERIES'
        ? await this.seriesInviteExpiry(ctx.trip.seriesId, expiresInHours)
        : new Date(Math.min(now.getTime() + expiresInHours * 3600_000, ctx.trip.arrivalAt.getTime()));
    const inv = await this.prisma.invitation.create({
      data: {
        seriesId: ctx.trip.seriesId,
        tripId,
        scope,
        createdById: driverId,
        tokenHash: this.crypto.sha256(token),
        expiresAt,
      },
    });
    return { invitation: this.toDto(inv, tripId, null), token };
  }

  async revoke(invitationId: string, driverId: string): Promise<void> {
    const inv = await this.prisma.invitation.findUnique({ where: { id: invitationId }, include: { series: true } });
    if (!inv || inv.series.driverId !== driverId) throw NotFound('Invito');
    if (inv.status !== 'PENDING') throw Conflict('NOT_PENDING', 'L’invito non è più attivo');
    await this.prisma.invitation.update({
      where: { id: invitationId },
      data: { status: 'REVOKED', revokedAt: this.clock.now() },
    });
  }

  /**
   * Anteprima del viaggio raggiunto tramite link (anche se privato). Per un invito
   * al gruppo fisso si mostra la prossima data della serie.
   */
  async previewLink(token: string, userId: string): Promise<TripSummaryDto & { invitationScope: InvitationScope }> {
    const inv = await this.findValidLink(token);
    const tripId = await this.targetTripId(inv);
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId }, include: tripInclude });
    if (!trip || trip.status !== 'SCHEDULED' || trip.arrivalAt <= this.clock.now()) throw INVALID_LINK();
    return { ...this.mapper.summary(trip, userId, { invited: true }), invitationScope: inv.scope };
  }

  async acceptLink(token: string, userId: string, boardingComune: string): Promise<TripDetailDto> {
    const inv = await this.findValidLink(token);
    const tripId = inv.scope === 'SERIES' ? await this.series.join(inv.seriesId, userId, boardingComune) : await this.join(inv, userId, boardingComune);
    return this.trips.detail(tripId, userId);
  }

  async accept(invitationId: string, userId: string, boardingComune: string): Promise<TripDetailDto> {
    const inv = await this.prisma.invitation.findUnique({ where: { id: invitationId } });
    if (!inv || inv.inviteeId !== userId || inv.status !== 'PENDING' || inv.expiresAt <= this.clock.now()) {
      throw INVALID_LINK();
    }
    const tripId =
      inv.scope === 'SERIES' ? await this.series.join(inv.seriesId, userId, boardingComune, inv.id) : await this.join(inv, userId, boardingComune);
    return this.trips.detail(tripId, userId);
  }

  /** Data a cui porta un invito: per il gruppo fisso, la prossima data aperta della serie. */
  async targetTripId(inv: Pick<Invitation, 'scope' | 'seriesId' | 'tripId'>): Promise<string> {
    if (inv.scope !== 'SERIES') return inv.tripId!;
    const next = await this.prisma.trip.findFirst({
      where: { seriesId: inv.seriesId, status: 'SCHEDULED', arrivalAt: { gt: this.clock.now() } },
      orderBy: { date: 'asc' },
      select: { id: true },
    });
    if (!next) throw INVALID_LINK();
    return next.id;
  }

  /** Scadenza di un invito alla serie: entro la durata richiesta e non oltre l'ultima data. */
  private async seriesInviteExpiry(seriesId: string, hours: number): Promise<Date> {
    const series = await this.prisma.tripSeries.findUniqueOrThrow({ where: { id: seriesId }, select: { endDate: true, arrivalTime: true } });
    const max = this.clock.now().getTime() + hours * 3600_000;
    if (!series.endDate) return new Date(max);
    return new Date(Math.min(max, romeToUtc(toIsoDate(series.endDate), series.arrivalTime).getTime()));
  }

  async decline(invitationId: string, userId: string): Promise<void> {
    const inv = await this.prisma.invitation.findUnique({ where: { id: invitationId }, include: { series: true } });
    if (!inv || inv.inviteeId !== userId || inv.status !== 'PENDING') throw NotFound('Invito');
    await this.prisma.invitation.update({
      where: { id: invitationId },
      data: { status: 'DECLINED', respondedAt: this.clock.now() },
    });
    await this.notifications.notify([inv.series.driverId], 'INVITATION_DECLINED', inv.tripId ?? undefined);
  }

  /** L'invitato accetta: occupa direttamente un posto (con lock, niente overbooking). */
  private async join(inv: Invitation, userId: string, boardingComune: string): Promise<string> {
    const trip = await this.prisma.trip.findUnique({ where: { id: inv.tripId! }, include: tripInclude });
    if (!trip) throw INVALID_LINK();
    if (trip.series.driverId === userId) throw new AppException('OWN_TRIP', 'Sei il conducente di questo viaggio');
    this.trips.assertOpen(trip);
    this.participation.assertStop(trip.series.stops, boardingComune);
    const existing = trip.participants.find((p) => p.userId === userId);
    if (existing?.status === 'ACCEPTED') throw Conflict('ALREADY_PARTICIPANT', 'Partecipi già a questo viaggio');

    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      await lockFreeSeat(tx, trip.id);
      await tx.tripParticipant.upsert({
        where: { tripId_userId: { tripId: trip.id, userId } },
        create: { tripId: trip.id, userId, status: 'ACCEPTED', boardingComune, requestedAt: now, decidedAt: now },
        update: { status: 'ACCEPTED', boardingComune, decidedAt: now, cancelledAt: null, lateCancel: false },
      });
      // Gli inviti personali si chiudono; i link restano validi per altri colleghi.
      if (inv.inviteeId) {
        await tx.invitation.update({ where: { id: inv.id }, data: { status: 'ACCEPTED', respondedAt: now } });
      }
    });
    await this.notifications.notify([trip.series.driverId], 'INVITATION_ACCEPTED', trip.id);
    return trip.id;
  }

  private async findValidLink(token: string): Promise<Invitation> {
    const inv = await this.prisma.invitation.findUnique({ where: { tokenHash: this.crypto.sha256(token) } });
    if (!inv || inv.status !== 'PENDING' || inv.expiresAt <= this.clock.now() || !inv.tripId) throw INVALID_LINK();
    return inv;
  }

  private async driverCtx(tripId: string, driverId: string, scope: InvitationScope = 'TRIP') {
    const ctx = await this.policy.loadVisible(tripId, driverId);
    if (!ctx.isDriver) throw Forbidden('Solo il conducente può invitare colleghi');
    this.trips.assertOpen(ctx.trip);
    if (scope === 'SERIES' && !ctx.trip.series.weekdays.length) {
      throw new AppException('NOT_RECURRING', 'Il gruppo fisso esiste solo per i viaggi ricorrenti', 409);
    }
    return ctx;
  }

  private toDto(inv: Invitation, tripId: string, invitee: UserSummaryDto | null): InvitationDto {
    return {
      id: inv.id,
      tripId,
      scope: inv.scope,
      status: inv.status,
      invitee,
      isLink: inv.tokenHash !== null,
      expiresAt: inv.expiresAt.toISOString(),
      createdAt: inv.createdAt.toISOString(),
    };
  }
}
