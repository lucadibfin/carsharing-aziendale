import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../common/prisma.service.js';
import { addDays, dateOnly, romeToUtc, todayInRome, toIsoDate } from '../common/time.js';
import { JobQueue } from '../jobs/job-queue.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { DEFAULT_DRIVE_MINUTES, TravelTimeService } from './travel-time.service.js';

/** Oltre questo anticipo rispetto all'arrivo non si cercano candidati (minuti). */
const MAX_LEAD_MINUTES = 240;

/**
 * Promemoria FACOLTATIVI (solo con il consenso alle notifiche facoltative):
 * - la sera prima, dall'ora reminderEveningHour, a conducente e confermati;
 * - prima della salita: reminderBeforeDepartureMinutes prima
 *   - della partenza, per il conducente;
 *   - dell'orario stimato di passaggio dal proprio comune di salita, per ogni
 *     partecipante confermato.
 *   Per i viaggi creati prima dell'orario di partenza, la partenza si stima con
 *   il tempo di guida dal comune di partenza alla sede.
 * Il job gira ogni 5 minuti; ogni promemoria si invia una sola volta per persona e
 * data. Non si invia a chi si è unito (o per un viaggio creato) dopo il momento previsto,
 * né quando la partenza o la salita è già passata (es. job recuperato dopo una pausa
 * dell'app): in quel caso il promemoria si considera gestito e non parte più.
 */
@Injectable()
export class RemindersService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly settings: SettingsService,
    private readonly travel: TravelTimeService,
    private readonly notifications: NotificationsService,
    private readonly queue: JobQueue,
  ) {}

  onModuleInit(): void {
    this.queue.register('trip-reminders', () => this.run().then(() => undefined));
    this.queue.schedule('trip-reminders', '*/5 * * * *');
  }

  async run(): Promise<{ evening: number; departure: number }> {
    return { evening: await this.evening(), departure: await this.beforeBoarding() };
  }

  private async evening(): Promise<number> {
    const now = this.clock.now();
    const { reminderEveningHour } = await this.settings.get();
    const today = todayInRome(now);
    const sendFrom = romeToUtc(today, `${String(reminderEveningHour).padStart(2, '0')}:00`);
    if (now < sendFrom) return 0;
    const trips = await this.prisma.trip.findMany({
      where: { status: 'SCHEDULED', date: dateOnly(addDays(today, 1)), eveningReminderAt: null },
      select: { id: true, createdAt: true },
    });
    let sent = 0;
    for (const t of trips) {
      const r = await this.prisma.trip.updateMany({ where: { id: t.id, eveningReminderAt: null }, data: { eveningReminderAt: now } });
      if (r.count !== 1 || t.createdAt >= sendFrom) continue;
      const trip = await this.prisma.trip.findUniqueOrThrow({
        where: { id: t.id },
        select: { series: { select: { driverId: true } }, participants: { where: { status: 'ACCEPTED' }, select: { userId: true } } },
      });
      const recipients = [trip.series.driverId, ...trip.participants.map((p) => p.userId)];
      await this.notifications.notify(recipients, 'TRIP_REMINDER_EVENING', t.id);
      sent += recipients.length;
    }
    return sent;
  }

  private async beforeBoarding(): Promise<number> {
    const now = this.clock.now();
    const { reminderBeforeDepartureMinutes: before } = await this.settings.get();
    const horizon = new Date(now.getTime() + (before + MAX_LEAD_MINUTES) * 60_000);
    const trips = await this.prisma.trip.findMany({
      where: {
        status: 'SCHEDULED',
        arrivalAt: { gt: now, lte: horizon },
        OR: [{ departureReminderAt: null }, { participants: { some: { status: 'ACCEPTED', reminderSentAt: null } } }],
      },
      select: {
        id: true,
        siteId: true,
        date: true,
        arrivalAt: true,
        createdAt: true,
        departureReminderAt: true,
        series: {
          select: {
            driverId: true,
            departureTime: true,
            stops: { orderBy: { order: 'asc' }, select: { comuneIstat: true, passTime: true } },
          },
        },
        participants: {
          where: { status: 'ACCEPTED', reminderSentAt: null },
          select: { id: true, userId: true, boardingComune: true, decidedAt: true, requestedAt: true },
        },
      },
    });
    let sent = 0;
    for (const t of trips) {
      const date = toIsoDate(t.date);
      const departureAt = t.series.departureTime
        ? romeToUtc(date, t.series.departureTime)
        : new Date(t.arrivalAt.getTime() - ((await this.legacyDrive(t.series.stops[0]?.comuneIstat, t.siteId)) * 60_000));
      const due = (at: Date) => new Date(at.getTime() - before * 60_000);

      // Conducente: prima della partenza.
      if (!t.departureReminderAt && now >= due(departureAt)) {
        const r = await this.prisma.trip.updateMany({ where: { id: t.id, departureReminderAt: null }, data: { departureReminderAt: now } });
        if (r.count === 1 && t.createdAt < due(departureAt) && now <= departureAt) {
          await this.notifications.notify([t.series.driverId], 'TRIP_REMINDER', t.id);
          sent++;
        }
      }
      // Partecipanti: prima del passaggio dal proprio comune di salita.
      for (const p of t.participants) {
        const pass = t.series.stops.find((s) => s.comuneIstat === p.boardingComune)?.passTime;
        const boardAt = pass ? romeToUtc(date, pass) : departureAt;
        if (now < due(boardAt)) continue;
        const r = await this.prisma.tripParticipant.updateMany({ where: { id: p.id, reminderSentAt: null }, data: { reminderSentAt: now } });
        if (r.count !== 1 || (p.decidedAt ?? p.requestedAt) >= due(boardAt) || now > boardAt) continue;
        await this.notifications.notify([p.userId], 'TRIP_REMINDER', t.id);
        sent++;
      }
    }
    return sent;
  }

  private async legacyDrive(departureComune: string | undefined, siteId: string): Promise<number> {
    return (departureComune ? await this.travel.driveMinutes(departureComune, siteId) : null) ?? DEFAULT_DRIVE_MINUTES;
  }
}
