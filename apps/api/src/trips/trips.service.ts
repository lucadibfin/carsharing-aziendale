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
import { MAX_SERIES_DAYS, type RouteEstimateDto, type RouteEstimateInput } from '@fcs/shared';
import { addDays, dateOnly, romeToUtc, todayInRome } from '../common/time.js';
import { FavoritesService } from '../favorites/favorites.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { StatsService } from '../stats/stats.service.js';
import { ChatMembershipEvents } from './chat-membership.events.js';
import { firstOccurrence } from './series-dates.js';
import { SeriesMaterializer } from './series-materializer.js';
import { TravelTimeService } from './travel-time.service.js';
import { TripAccessPolicy } from './trip-access.policy.js';
import { type LoadedTrip, tripInclude } from './trip-loader.js';
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
    private readonly favorites: FavoritesService,
    private readonly materializer: SeriesMaterializer,
    private readonly travel: TravelTimeService,
  ) {}

  /** Partenza proposta e tempi di guida per l'anteprima del modulo di proposta. */
  async estimate(input: RouteEstimateInput): Promise<RouteEstimateDto> {
    const site = await this.prisma.site.findFirst({ where: { id: input.siteId, active: true }, select: { id: true } });
    if (!site) throw new AppException('INVALID_SITE', 'Sede non valida');
    return this.travel.estimate(input.siteId, input.arrivalTime, [input.departureComune, ...input.viaComuni]);
  }

  async create(userId: string, input: CreateTripInput): Promise<TripDetailDto> {
    const now = this.clock.now();
    const { maxDaysAhead } = await this.settings.get();
    const today = todayInRome(now);
    if (input.date < today || input.date > addDays(today, maxDaysAhead)) {
      throw new AppException('INVALID_DATE', `La data deve essere compresa tra oggi e i prossimi ${maxDaysAhead} giorni`);
    }
    const recurring = input.weekdays.length > 0;
    if (recurring) {
      if (input.endDate && input.endDate > addDays(input.date, MAX_SERIES_DAYS)) {
        throw new AppException('INVALID_DATE', 'Una serie ricorrente può durare al massimo un anno');
      }
      const first = firstOccurrence(input.weekdays, input.date);
      if (!first || (input.endDate && first > input.endDate)) {
        throw new AppException('INVALID_DATE', 'Nel periodo indicato non c’è nessuno dei giorni scelti');
      }
    } else if (romeToUtc(input.date, input.arrivalTime) <= now) {
      throw new AppException('INVALID_DATE', 'L’orario di arrivo è già passato');
    }

    const site = await this.prisma.site.findFirst({ where: { id: input.siteId, active: true }, select: { id: true } });
    if (!site) throw new AppException('INVALID_SITE', 'Sede non valida');
    const codes = [input.departureComune, ...input.viaComuni];
    const found = await this.prisma.comune.count({ where: { istat: { in: codes }, active: true } });
    if (found !== codes.length) throw new AppException('INVALID_COMUNE', 'Uno o più comuni non sono validi');
    // Partenza (scelta dal conducente o proposta) e orari stimati di passaggio, prima della transazione.
    const plan = await this.travel.plan(input.siteId, input.arrivalTime, codes, input.departureTime);

    const tripId = await this.prisma.$transaction(async (tx) => {
      const series = await tx.tripSeries.create({
        data: {
          driverId: userId,
          siteId: input.siteId,
          visibility: input.visibility,
          weekdays: [...input.weekdays].sort(),
          startDate: dateOnly(input.date),
          endDate: recurring ? (input.endDate ? dateOnly(input.endDate) : null) : dateOnly(input.date),
          arrivalTime: input.arrivalTime,
          returnTime: input.returnTime ?? null,
          departureTime: plan.departureTime,
          seats: input.seats,
          meetingPoint: input.meetingPoint || null,
          notes: input.notes || null,
          stops: { create: codes.map((comuneIstat, order) => ({ order, comuneIstat, passTime: plan.passTimes[order] ?? null })) },
        },
      });
      if (recurring) {
        const ids = await this.materializer.materialize(series.id, tx);
        if (!ids[0]) throw new AppException('INVALID_DATE', 'Nel periodo indicato non ci sono date future');
        return ids[0];
      }
      const created = await tx.trip.create({
        data: {
          seriesId: series.id,
          siteId: input.siteId,
          date: dateOnly(input.date),
          arrivalTime: input.arrivalTime,
          returnTime: input.returnTime ?? null,
          arrivalAt: romeToUtc(input.date, input.arrivalTime),
          seats: input.seats,
          createdAt: now,
        },
      });
      await this.stats.syncFact(created.id, tx);
      return created.id;
    });
    // Per una serie si avvisano i preferiti una sola volta, sulla prima data.
    await this.favorites.notifyNewTrip(tripId);
    return this.detail(tripId, userId);
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
        OR: [
          { participants: { some: { userId, status: { in: ['REQUESTED', 'ACCEPTED', 'WAITLISTED'] } } } },
          // Membro fisso: compare anche nelle date in cui ha detto "non ci sono".
          { series: { members: { some: { userId } } } },
        ],
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
    const windowStart = new Date(now.getTime() - closureWindowDays * 86_400_000);
    const recent = await this.prisma.trip.findMany({
      where: {
        arrivalAt: { lte: now, gte: windowStart },
        OR: [
          { series: { driverId: userId }, status: { not: 'SCHEDULED' } }, // quelli da chiudere sono già sopra
          { participants: { some: { userId, status: 'ACCEPTED' } } },
        ],
      },
      include: tripInclude,
      orderBy: { arrivalAt: 'desc' },
      take: 20,
    });
    const invitations = await this.prisma.invitation.findMany({
      where: { inviteeId: userId, status: 'PENDING', expiresAt: { gt: now } },
      include: { trip: { include: tripInclude } },
      orderBy: { createdAt: 'desc' },
    });

    // Serie ricorrenti: in elenco solo la prossima data (le altre sono nel dettaglio).
    const seen = new Set<string>();
    const firstOfSeries = (t: (typeof asDriver)[number], collapse: boolean) => {
      if (!collapse || !t.series.weekdays.length) return true;
      if (seen.has(t.seriesId)) return false;
      seen.add(t.seriesId);
      return true;
    };
    const isMember = (t: (typeof asDriver)[number]) => t.series.members.some((m) => m.userId === userId);

    return {
      asDriver: asDriver.filter((t) => firstOfSeries(t, true)).map((t) => this.mapper.summary(t, userId)),
      asParticipant: asParticipant.filter((t) => firstOfSeries(t, isMember(t))).map((t) => this.mapper.summary(t, userId)),
      awaitingClosure: awaitingClosure.map((t) => this.mapper.summary(t, userId)),
      recent: recent.map((t) => this.mapper.summary(t, userId)),
      pendingRequests: asDriver
        .map((t) => ({ tripId: t.id, count: t.participants.filter((p) => p.status === 'REQUESTED').length }))
        .filter((r) => r.count > 0),
      pendingInvitations: (await Promise.all(invitations.map((i) => this.invitationTrip(i, now))))
        .filter((x) => x !== null)
        .map(({ inv: i, trip }) => ({
          id: i.id,
          tripId: trip.id,
          scope: i.scope,
          status: i.status,
          invitee: null,
          isLink: false,
          expiresAt: i.expiresAt.toISOString(),
          createdAt: i.createdAt.toISOString(),
          trip: this.mapper.summary(trip, userId, { invited: true }),
        })),
    };
  }

  /** Data da mostrare per un invito: quella dell'invito o, per il gruppo fisso, la prossima della serie. */
  private async invitationTrip<I extends { scope: string; seriesId: string; trip: LoadedTrip | null }>(
    inv: I,
    now: Date,
  ): Promise<{ inv: I; trip: LoadedTrip } | null> {
    const open = (t: LoadedTrip | null) => t !== null && t.status === 'SCHEDULED' && t.arrivalAt > now;
    if (open(inv.trip)) return { inv, trip: inv.trip! };
    if (inv.scope !== 'SERIES') return null;
    const next = await this.prisma.trip.findFirst({
      where: { seriesId: inv.seriesId, status: 'SCHEDULED', arrivalAt: { gt: now } },
      orderBy: { date: 'asc' },
      include: tripInclude,
    });
    return next ? { inv, trip: next } : null;
  }

  /**
   * Solo il conducente cambia la visibilità. Passando a PRIVATO le richieste
   * esterne in sospeso (e la lista d'attesa esterna) vengono rifiutate: un viaggio
   * privato non le accetta. I partecipanti confermati e i membri fissi restano.
   * Serie ricorrente: scope TRIP cambia solo questa data (es. un membro non c'è e
   * il conducente offre il posto a tutti), scope SERIES tutte le date future.
   */
  async changeVisibility(tripId: string, userId: string, visibility: TripVisibility, scope: 'TRIP' | 'SERIES' = 'SERIES'): Promise<TripDetailDto> {
    const ctx = await this.policy.loadVisible(tripId, userId);
    if (!ctx.isDriver) throw Forbidden('Solo il conducente può cambiare la visibilità');
    this.assertOpen(ctx.trip);
    const series = ctx.trip.series;
    const onlyThisDate = series.weekdays.length > 0 && scope === 'TRIP';
    const now = this.clock.now();
    const members = new Set(series.members.map((m) => m.userId));

    const targets = onlyThisDate
      ? [tripId]
      : (
          await this.prisma.trip.findMany({
            where: { seriesId: series.id, status: 'SCHEDULED', arrivalAt: { gt: now } },
            select: { id: true },
          })
        ).map((t) => t.id);

    const rejected = new Map<string, string[]>();
    await this.prisma.$transaction(async (tx) => {
      if (onlyThisDate) {
        await tx.trip.update({ where: { id: tripId }, data: { visibilityOverride: visibility === series.visibility ? null : visibility } });
      } else {
        await tx.tripSeries.update({ where: { id: series.id }, data: { visibility } });
        await tx.trip.updateMany({ where: { id: { in: targets } }, data: { visibilityOverride: null } });
      }
      for (const id of targets) {
        if (visibility === 'PRIVATE') {
          const pending = await tx.tripParticipant.findMany({
            where: { tripId: id, status: { in: ['REQUESTED', 'WAITLISTED'] }, userId: { notIn: [...members] } },
            select: { id: true, userId: true },
          });
          if (pending.length) {
            await tx.tripParticipant.updateMany({ where: { id: { in: pending.map((p) => p.id) } }, data: { status: 'REJECTED', decidedAt: now } });
            rejected.set(id, pending.map((p) => p.userId));
          }
        }
        await this.stats.syncFact(id, tx);
      }
    });
    for (const [id, users] of rejected) await this.notifications.notify(users, 'REQUEST_REJECTED', id);
    if (visibility === 'PUBLIC') await this.favorites.notifyNewTrip(tripId);
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
      // Gli inviti al gruppo fisso valgono per la serie: restano anche se una data viene annullata.
      await tx.invitation.updateMany({ where: { tripId, scope: 'TRIP', status: 'PENDING' }, data: { status: 'REVOKED', revokedAt: now } });
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
