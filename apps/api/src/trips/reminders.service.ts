import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../common/prisma.service.js';
import { addDays, dateOnly, romeToUtc, todayInRome } from '../common/time.js';
import { JobQueue } from '../jobs/job-queue.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { RoutingService } from '../stats/routing.service.js';

/** Velocità media ipotizzata per stimare il tempo di guida dal comune di partenza alla sede. */
export const REMINDER_AVG_SPEED_KMH = 45;
/** Tempo di guida ipotizzato quando mancano le coordinate (minuti). */
export const REMINDER_DEFAULT_DRIVE_MINUTES = 45;
/** Oltre questo tempo di guida stimato non si cercano candidati (minuti). */
const MAX_DRIVE_MINUTES = 240;

/**
 * Promemoria FACOLTATIVI (solo con il consenso alle notifiche facoltative),
 * per conducente e partecipanti confermati:
 * - la sera prima, dall'ora reminderEveningHour;
 * - prima della partenza: reminderBeforeDepartureMinutes prima della partenza
 *   stimata = orario di arrivo − tempo di guida dal comune di partenza alla sede
 *   (distanza tra comune e sede a REMINDER_AVG_SPEED_KMH, arrotondata ai 5 minuti).
 * Il job gira ogni 5 minuti; ogni promemoria si invia una sola volta per data.
 * Non si invia un promemoria per un viaggio creato dopo il momento previsto.
 */
@Injectable()
export class RemindersService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly settings: SettingsService,
    private readonly routing: RoutingService,
    private readonly notifications: NotificationsService,
    private readonly queue: JobQueue,
  ) {}

  onModuleInit(): void {
    this.queue.register('trip-reminders', () => this.run().then(() => undefined));
    this.queue.schedule('trip-reminders', '*/5 * * * *');
  }

  async run(): Promise<{ evening: number; departure: number }> {
    return { evening: await this.evening(), departure: await this.beforeDeparture() };
  }

  /** Minuti di guida stimati dal comune di partenza alla sede. */
  async driveMinutes(departureComune: string | undefined, siteId: string): Promise<number> {
    const d = departureComune ? await this.routing.comuneToSite(departureComune, siteId) : null;
    if (!d) return REMINDER_DEFAULT_DRIVE_MINUTES;
    return Math.max(5, Math.ceil(((d.km / REMINDER_AVG_SPEED_KMH) * 60) / 5) * 5);
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
      if (!(await this.claim(t.id, 'eveningReminderAt', now))) continue;
      if (t.createdAt >= sendFrom) continue;
      sent += await this.send(t.id, 'TRIP_REMINDER_EVENING');
    }
    return sent;
  }

  private async beforeDeparture(): Promise<number> {
    const now = this.clock.now();
    const { reminderBeforeDepartureMinutes } = await this.settings.get();
    const horizon = new Date(now.getTime() + (reminderBeforeDepartureMinutes + MAX_DRIVE_MINUTES) * 60_000);
    const trips = await this.prisma.trip.findMany({
      where: { status: 'SCHEDULED', departureReminderAt: null, arrivalAt: { gt: now, lte: horizon } },
      select: {
        id: true,
        siteId: true,
        arrivalAt: true,
        createdAt: true,
        series: { select: { stops: { orderBy: { order: 'asc' }, take: 1, select: { comuneIstat: true } } } },
      },
    });
    let sent = 0;
    for (const t of trips) {
      const drive = await this.driveMinutes(t.series.stops[0]?.comuneIstat, t.siteId);
      const remindAt = new Date(t.arrivalAt.getTime() - (drive + reminderBeforeDepartureMinutes) * 60_000);
      if (now < remindAt) continue;
      if (!(await this.claim(t.id, 'departureReminderAt', now))) continue;
      if (t.createdAt >= remindAt) continue;
      sent += await this.send(t.id, 'TRIP_REMINDER');
    }
    return sent;
  }

  /** Segna il promemoria come inviato; false se un'altra esecuzione l'ha già fatto. */
  private async claim(tripId: string, field: 'eveningReminderAt' | 'departureReminderAt', now: Date): Promise<boolean> {
    const r = await this.prisma.trip.updateMany({ where: { id: tripId, [field]: null }, data: { [field]: now } });
    return r.count === 1;
  }

  private async send(tripId: string, type: 'TRIP_REMINDER_EVENING' | 'TRIP_REMINDER'): Promise<number> {
    const trip = await this.prisma.trip.findUniqueOrThrow({
      where: { id: tripId },
      select: { series: { select: { driverId: true } }, participants: { where: { status: 'ACCEPTED' }, select: { userId: true } } },
    });
    const recipients = [trip.series.driverId, ...trip.participants.map((p) => p.userId)];
    await this.notifications.notify(recipients, type, tripId);
    return recipients.length;
  }
}
