import { Injectable } from '@nestjs/common';
import { FUEL_UNITS, type FuelType, type PersonalStatsDto, type StatsPeriodDto } from '@fcs/shared';
import { Clock } from '../common/clock.js';
import { PrismaService, type Tx } from '../common/prisma.service.js';
import { dateOnly, todayInRome } from '../common/time.js';
import type { Prisma } from '../generated/prisma/client.js';
import { SettingsService } from '../settings/settings.service.js';
import { RoutingService } from './routing.service.js';

interface Savings {
  co2SavedKg: number;
  fuelSaved: number;
  eurSaved: number;
}

/** Calcoli per la chiusura di un viaggio, preparati PRIMA della transazione (chiamate di routing). */
export interface ClosurePlan {
  tripId: string;
  date: Date;
  driverId: string;
  fuelUnit: string;
  legs: number;
  driverKm: number | null;
  passengers: { userId: string; km: number | null; savings: Savings | null; estimated: boolean }[];
  estimated: boolean;
  complete: boolean;
}

const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

/**
 * Statistiche:
 * - TripStatFact: una riga ANONIMA per viaggio (report aggregati per il PSCL);
 * - UserStatEntry: righe personali create alla chiusura (statistiche del profilo).
 *
 * Regole di calcolo (documentate in docs/dpo/documento-tecnico.md):
 * - km del passeggero = distanza stradale comune di salita → sede, × 2 se è
 *   previsto il ritorno. Sono i km che avrebbe percorso da solo in auto (evitati).
 * - km del conducente = distanza comune di partenza → sede (× 2 col ritorno).
 * - Consumo, CO2 e costo: auto del conducente se ha indicato i dati, altrimenti
 *   l'alimentazione e i valori medi configurati dagli admin.
 */
@Injectable()
export class StatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly routing: RoutingService,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
  ) {}

  /** Allinea il fatto anonimo allo stato del viaggio (proposto, annullato, visibilità). */
  async syncFact(tripId: string, tx: Tx | PrismaService = this.prisma): Promise<void> {
    const t = await tx.trip.findUnique({
      where: { id: tripId },
      select: { siteId: true, date: true, seats: true, status: true, returnTime: true, visibilityOverride: true, series: { select: { visibility: true } } },
    });
    if (!t || t.status === 'CLOSED') return;
    const data = {
      siteId: t.siteId,
      date: t.date,
      seats: t.seats,
      visibility: t.visibilityOverride ?? t.series.visibility,
      status: t.status === 'CANCELLED' ? ('CANCELLED' as const) : ('PROPOSED' as const),
      legs: t.returnTime ? 2 : 1,
    };
    await tx.tripStatFact.upsert({ where: { tripId }, create: { tripId, ...data }, update: data });
  }

  async planClosure(tripId: string, presentUserIds: string[]): Promise<ClosurePlan> {
    const trip = await this.prisma.trip.findUniqueOrThrow({
      where: { id: tripId },
      select: {
        id: true,
        date: true,
        siteId: true,
        returnTime: true,
        participants: { where: { userId: { in: presentUserIds } }, select: { userId: true, boardingComune: true } },
        series: {
          select: {
            driverId: true,
            stops: { orderBy: { order: 'asc' }, take: 1, select: { comuneIstat: true } },
            driver: { select: { fuelType: true, consumptionPer100km: true } },
          },
        },
      },
    });
    const s = await this.settings.get();
    const fuel: FuelType = trip.series.driver.fuelType ?? s.defaultFuelType;
    const profile = s.fuelProfiles[fuel];
    const consumption = trip.series.driver.consumptionPer100km ?? profile.consumptionPer100km;
    const legs = trip.returnTime ? 2 : 1;
    const savingsFor = (km: number): Savings => {
      const fuelSaved = (km * consumption) / 100;
      return { fuelSaved, co2SavedKg: fuelSaved * profile.co2KgPerUnit, eurSaved: fuelSaved * profile.pricePerUnit };
    };

    const departure = trip.series.stops[0]?.comuneIstat;
    const dDriver = departure ? await this.routing.comuneToSite(departure, trip.siteId) : null;
    const passengers: ClosurePlan['passengers'] = [];
    for (const p of trip.participants) {
      const d = await this.routing.comuneToSite(p.boardingComune, trip.siteId);
      const km = d ? d.km * legs : null;
      passengers.push({ userId: p.userId, km, savings: km === null ? null : savingsFor(km), estimated: d?.estimated ?? false });
    }
    return {
      tripId,
      date: trip.date,
      driverId: trip.series.driverId,
      fuelUnit: FUEL_UNITS[fuel],
      legs,
      driverKm: dDriver ? dDriver.km * legs : null,
      passengers,
      estimated: Boolean(dDriver?.estimated) || passengers.some((p) => p.estimated),
      complete: dDriver !== null && passengers.every((p) => p.km !== null),
    };
  }

  /** Scrive fatto anonimo e statistiche personali (dentro la transazione di chiusura). */
  async writeClosure(tx: Tx, plan: ClosurePlan): Promise<void> {
    const known = plan.passengers.filter((p) => p.km !== null && p.savings !== null);
    const sum = (f: (p: (typeof known)[number]) => number) => known.reduce((acc, p) => acc + f(p), 0);
    const totals = {
      kmAvoided: sum((p) => p.km!),
      co2SavedKg: sum((p) => p.savings!.co2SavedKg),
      fuelSaved: sum((p) => p.savings!.fuelSaved),
      eurSaved: sum((p) => p.savings!.eurSaved),
    };

    const trip = await tx.trip.findUniqueOrThrow({
      where: { id: plan.tripId },
      select: { siteId: true, seats: true, visibilityOverride: true, series: { select: { visibility: true } } },
    });
    const fact = {
      siteId: trip.siteId,
      date: plan.date,
      seats: trip.seats,
      visibility: trip.visibilityOverride ?? trip.series.visibility,
      status: 'COMPLETED' as const,
      passengers: plan.passengers.length,
      legs: plan.legs,
      driverKm: plan.driverKm === null ? null : round(plan.driverKm),
      kmAvoided: plan.complete ? round(totals.kmAvoided) : null,
      co2SavedKg: plan.complete ? round(totals.co2SavedKg) : null,
      fuelSaved: plan.complete ? round(totals.fuelSaved) : null,
      fuelUnit: plan.fuelUnit,
      eurSaved: plan.complete ? round(totals.eurSaved, 2) : null,
      estimated: plan.estimated,
      complete: plan.complete,
    };
    await tx.tripStatFact.upsert({ where: { tripId: plan.tripId }, create: { tripId: plan.tripId, ...fact }, update: fact });

    // Senza coordinate (dati di riferimento incompleti) il viaggio conta comunque, con metriche a zero.
    const entries: Prisma.UserStatEntryCreateManyInput[] = plan.passengers.map((p) => ({
      userId: p.userId,
      date: plan.date,
      role: 'PASSENGER',
      sharedKm: round(p.km ?? 0),
      kmAvoided: round(p.km ?? 0),
      co2SavedKg: round(p.savings?.co2SavedKg ?? 0),
      fuelSaved: round(p.savings?.fuelSaved ?? 0),
      fuelUnit: plan.fuelUnit,
      eurSaved: round(p.savings?.eurSaved ?? 0, 2),
      estimated: p.estimated,
    }));
    entries.push({
      userId: plan.driverId,
      date: plan.date,
      role: 'DRIVER',
      // Km condivisi solo se c'era almeno un passeggero.
      sharedKm: known.length > 0 && plan.driverKm !== null ? round(plan.driverKm) : 0,
      kmAvoided: round(totals.kmAvoided),
      co2SavedKg: round(totals.co2SavedKg),
      fuelSaved: round(totals.fuelSaved),
      fuelUnit: plan.fuelUnit,
      eurSaved: round(totals.eurSaved, 2),
      estimated: plan.estimated,
    });
    await tx.userStatEntry.createMany({ data: entries });
  }

  async personal(userId: string): Promise<PersonalStatsDto> {
    const rows = await this.prisma.userStatEntry.findMany({ where: { userId }, orderBy: { date: 'asc' } });
    const year = todayInRome(this.clock.now()).slice(0, 4);
    const from = dateOnly(`${year}-01-01`);
    return {
      year: Number(year),
      allTime: this.totals(rows),
      thisYear: this.totals(rows.filter((r) => r.date >= from)),
      anyEstimated: rows.some((r) => r.estimated),
    };
  }

  private totals(rows: { role: string; sharedKm: number; kmAvoided: number; co2SavedKg: number; fuelSaved: number; fuelUnit: string; eurSaved: number }[]): StatsPeriodDto {
    const fuel = new Map<string, number>();
    for (const r of rows) fuel.set(r.fuelUnit, (fuel.get(r.fuelUnit) ?? 0) + r.fuelSaved);
    const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
    return {
      asDriver: rows.filter((r) => r.role === 'DRIVER').length,
      asPassenger: rows.filter((r) => r.role === 'PASSENGER').length,
      sharedKm: round(sum((r) => r.sharedKm), 1),
      kmAvoided: round(sum((r) => r.kmAvoided), 1),
      co2SavedKg: round(sum((r) => r.co2SavedKg), 1),
      fuelSaved: [...fuel].filter(([, v]) => v > 0).map(([unit, amount]) => ({ unit, amount: round(amount, 1) })),
      eurSaved: round(sum((r) => r.eurSaved), 2),
    };
  }
}
