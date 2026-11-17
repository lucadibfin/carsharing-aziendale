import { Injectable } from '@nestjs/common';
import type { AdminTripDto, AdminTripsQuery, DashboardDto, DashboardQuery, DashboardTotalsDto } from '@fcs/shared';
import { AuditService } from '../audit/audit.service.js';
import { AppException } from '../common/errors.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../common/prisma.service.js';
import { addDays, dateOnly, toIsoDate, todayInRome } from '../common/time.js';
import type { Prisma, TripStatFact } from '../generated/prisma/client.js';
import { scopedSiteFilter, type SiteScope } from './admin.guard.js';

const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

/**
 * Elenco viaggi e dashboard aggregata per l'area amministrativa.
 * Minimizzazione: l'elenco non mostra nomi né comuni; la dashboard usa solo i
 * fatti anonimi (TripStatFact) e conteggi di utenti.
 */
@Injectable()
export class AdminTripsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  /** Periodo richiesto, di default dall'inizio dell'anno a oggi (Europe/Rome). */
  period(q: { from?: string; to?: string }): { from: string; to: string } {
    const today = todayInRome(this.clock.now());
    const from = q.from ?? `${today.slice(0, 4)}-01-01`;
    const to = q.to ?? today;
    if (from > to) throw new AppException('INVALID_PERIOD', 'La data iniziale deve precedere quella finale');
    return { from, to };
  }

  async trips(actorId: string, scope: SiteScope, q: AdminTripsQuery): Promise<AdminTripDto[]> {
    const { from, to } = this.period(q);
    const now = this.clock.now();
    const state: Prisma.TripWhereInput =
      q.state === 'upcoming'
        ? { status: 'SCHEDULED', arrivalAt: { gt: now } }
        : q.state === 'awaiting'
          ? { status: 'SCHEDULED', arrivalAt: { lte: now } }
          : q.state === 'closed'
            ? { status: 'CLOSED' }
            : q.state === 'cancelled'
              ? { status: 'CANCELLED' }
              : {};
    const rows = await this.prisma.trip.findMany({
      where: { ...state, siteId: scopedSiteFilter(scope, q.siteId), date: { gte: dateOnly(from), lte: dateOnly(to) } },
      select: {
        id: true,
        siteId: true,
        date: true,
        arrivalTime: true,
        returnTime: true,
        arrivalAt: true,
        status: true,
        seats: true,
        visibilityOverride: true,
        series: { select: { visibility: true, site: { select: { name: true } }, _count: { select: { stops: true } } } },
        participants: { where: { status: 'ACCEPTED' }, select: { attended: true } },
      },
      orderBy: [{ date: 'desc' }, { arrivalTime: 'asc' }],
      take: 500,
    });
    await this.audit.record({ actorId, action: 'ADMIN_TRIPS_LIST', meta: { siteId: q.siteId ?? null, from, to, state: q.state ?? null, results: rows.length } });
    return rows.map((t) => ({
      id: t.id,
      siteId: t.siteId,
      siteName: t.series.site.name,
      date: toIsoDate(t.date),
      arrivalTime: t.arrivalTime,
      returnTime: t.returnTime,
      visibility: t.visibilityOverride ?? t.series.visibility,
      status: t.status === 'SCHEDULED' && t.arrivalAt <= now ? 'AWAITING_CLOSURE' : t.status,
      seats: t.seats,
      seatsTaken: t.participants.length,
      passengersPresent: t.status === 'CLOSED' ? t.participants.filter((p) => p.attended).length : null,
      stopsCount: t.series._count.stops,
    }));
  }

  async dashboard(actorId: string, scope: SiteScope, q: DashboardQuery): Promise<DashboardDto> {
    const { from, to } = this.period(q);
    const siteFilter = scopedSiteFilter(scope, q.siteId);
    const facts = await this.prisma.tripStatFact.findMany({
      where: { siteId: siteFilter, date: { gte: dateOnly(from), lte: dateOnly(to) } },
    });
    const users = await this.prisma.user.findMany({
      where: { status: 'ACTIVE', onboardedAt: { not: null }, siteId: siteFilter ?? { not: null } },
      select: { siteId: true, lastLoginAt: true },
    });
    const periodStart = dateOnly(from);
    const periodEnd = dateOnly(addDays(to, 1));
    const sites = await this.prisma.site.findMany({
      where: { id: siteFilter },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    const totals = (siteId?: string): DashboardTotalsDto => {
      const f = siteId ? facts.filter((x) => x.siteId === siteId) : facts;
      const u = siteId ? users.filter((x) => x.siteId === siteId) : users;
      return this.aggregate(f, {
        registeredUsers: u.length,
        activeUsers: u.filter((x) => x.lastLoginAt && x.lastLoginAt >= periodStart && x.lastLoginAt < periodEnd).length,
      });
    };

    await this.audit.record({ actorId, action: 'ADMIN_DASHBOARD_VIEW', meta: { siteId: q.siteId ?? null, from, to } });
    return {
      from,
      to,
      totals: totals(),
      bySite: q.siteId ? [] : sites.map((s) => ({ siteId: s.id, siteName: s.name, ...totals(s.id) })),
    };
  }

  private aggregate(facts: TripStatFact[], users: { registeredUsers: number; activeUsers: number }): DashboardTotalsDto {
    const completed = facts.filter((f) => f.status === 'COMPLETED');
    const count = (fs: TripStatFact[], v: 'PUBLIC' | 'PRIVATE') => fs.filter((f) => f.visibility === v).length;
    const sum = (fn: (f: TripStatFact) => number | null) => completed.reduce((a, f) => a + (fn(f) ?? 0), 0);
    const seats = sum((f) => f.seats);
    const passengers = sum((f) => f.passengers);
    const fuel = new Map<string, number>();
    for (const f of completed) if (f.fuelUnit && f.fuelSaved) fuel.set(f.fuelUnit, (fuel.get(f.fuelUnit) ?? 0) + f.fuelSaved);
    return {
      ...users,
      // "Proposti" comprende tutti i viaggi del periodo, anche quelli poi annullati o completati.
      proposed: { public: count(facts, 'PUBLIC'), private: count(facts, 'PRIVATE') },
      completed: { public: count(completed, 'PUBLIC'), private: count(completed, 'PRIVATE') },
      cancelled: facts.filter((f) => f.status === 'CANCELLED').length,
      fillRate: seats > 0 ? round(passengers / seats, 3) : null,
      passengers,
      kmAvoided: round(sum((f) => f.kmAvoided)),
      co2SavedKg: round(sum((f) => f.co2SavedKg)),
      fuelSaved: [...fuel].map(([unit, amount]) => ({ unit, amount: round(amount) })),
      eurSaved: round(sum((f) => f.eurSaved), 2),
      estimatedTrips: completed.filter((f) => f.estimated).length,
      incompleteTrips: completed.filter((f) => !f.complete).length,
    };
  }
}
