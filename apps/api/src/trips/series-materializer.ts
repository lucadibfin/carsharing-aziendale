import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Clock } from '../common/clock.js';
import { PrismaService, type Tx } from '../common/prisma.service.js';
import { addDays, dateOnly, romeToUtc, todayInRome, toIsoDate } from '../common/time.js';
import { JobQueue } from '../jobs/job-queue.js';
import { SettingsService } from '../settings/settings.service.js';
import { StatsService } from '../stats/stats.service.js';
import { firstOccurrence, seriesDates } from './series-dates.js';

/**
 * Genera le date (righe Trip) delle serie ricorrenti. Le date esistono solo fino a
 * recurringHorizonDays in avanti; ogni notte il job "series-extend" aggiunge le
 * successive. A ogni nuova data i membri fissi entrano già confermati, nell'ordine
 * in cui sono entrati nel gruppo, finché ci sono posti; gli altri in lista d'attesa.
 * Una data annullata resta come riga annullata e non viene rigenerata.
 */
@Injectable()
export class SeriesMaterializer implements OnModuleInit {
  private readonly logger = new Logger('Series');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly settings: SettingsService,
    private readonly stats: StatsService,
    private readonly queue: JobQueue,
  ) {}

  onModuleInit(): void {
    this.queue.register('series-extend', () => this.extendAll().then(() => undefined));
    this.queue.schedule('series-extend', '10 0 * * *');
  }

  /** Estende tutte le serie attive (conducente attivo, non terminate). Restituisce le date create. */
  async extendAll(): Promise<number> {
    const today = todayInRome(this.clock.now());
    const series = await this.prisma.tripSeries.findMany({
      where: {
        weekdays: { isEmpty: false },
        driver: { status: 'ACTIVE' },
        OR: [{ endDate: null }, { endDate: { gte: dateOnly(today) } }],
      },
      select: { id: true },
    });
    let created = 0;
    for (const s of series) {
      try {
        created += (await this.materialize(s.id)).length;
      } catch (e) {
        this.logger.error({ seriesId: s.id, errName: e instanceof Error ? e.name : 'unknown' }, 'estensione della serie non riuscita');
      }
    }
    if (created) this.logger.log(`serie ricorrenti: ${created} nuove date`);
    return created;
  }

  /** Crea le date mancanti di una serie e restituisce gli id dei viaggi creati, in ordine di data. */
  async materialize(seriesId: string, tx?: Tx): Promise<string[]> {
    const run = async (t: Tx): Promise<string[]> => {
      // Un solo processo alla volta per serie (job notturno e creazione concorrenti).
      await t.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${seriesId}))`;
      const s = await t.tripSeries.findUnique({
        where: { id: seriesId },
        include: { members: { orderBy: { joinedAt: 'asc' }, include: { user: { select: { status: true } } } } },
      });
      if (!s || s.weekdays.length === 0) return [];
      const now = this.clock.now();
      const today = todayInRome(now);
      const { recurringHorizonDays } = await this.settings.get();
      const start = toIsoDate(s.startDate);
      const from = start > today ? start : today;
      const end = s.endDate ? toIsoDate(s.endDate) : null;
      // La prima data esiste sempre, anche se oltre l'orizzonte (serie che parte più avanti).
      const first = firstOccurrence(s.weekdays, from);
      let to = addDays(today, recurringHorizonDays);
      if (first && first > to) to = first;
      if (end && end < to) to = end;
      if (from > to) return [];

      const dates = seriesDates(s.weekdays, from, to);
      const existing = new Set(
        (await t.trip.findMany({ where: { seriesId, date: { in: dates.map(dateOnly) } }, select: { date: true } })).map((x) =>
          toIsoDate(x.date),
        ),
      );
      const members = s.members.filter((m) => m.user.status === 'ACTIVE');
      const created: string[] = [];
      for (const date of dates) {
        if (existing.has(date)) continue;
        const arrivalAt = romeToUtc(date, s.arrivalTime);
        if (arrivalAt <= now) continue;
        const trip = await t.trip.create({
          data: {
            seriesId,
            siteId: s.siteId,
            date: dateOnly(date),
            arrivalTime: s.arrivalTime,
            returnTime: s.returnTime,
            arrivalAt,
            seats: s.seats,
            createdAt: now,
          },
        });
        if (members.length) {
          await t.tripParticipant.createMany({
            data: members.map((m, i) => ({
              tripId: trip.id,
              userId: m.userId,
              boardingComune: m.boardingComune,
              status: i < s.seats ? ('ACCEPTED' as const) : ('WAITLISTED' as const),
              requestedAt: now,
              decidedAt: now,
            })),
          });
        }
        await this.stats.syncFact(trip.id, t);
        created.push(trip.id);
      }
      return created;
    };
    return tx ? run(tx) : this.prisma.$transaction(run);
  }
}
