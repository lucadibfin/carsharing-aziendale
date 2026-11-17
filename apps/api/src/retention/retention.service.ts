import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../common/prisma.service.js';
import { dateOnly, todayInRome } from '../common/time.js';
import { JobQueue } from '../jobs/job-queue.js';
import { SettingsService } from '../settings/settings.service.js';

export interface RetentionResult {
  trips: number;
  series: number;
  invitations: number;
  sessions: number;
  loginThrottles: number;
  auditLog: number;
}

/** Contatori anti brute-force: si cancellano dopo questo tempo senza errori né blocchi attivi. */
const THROTTLE_KEEP_MS = 48 * 3600_000;

/**
 * Conservazione automatica (job notturno alle 03:45), con i tempi configurati dagli admin:
 * - viaggi con data più vecchia di tripRetentionMonths: si cancellano con partecipazioni
 *   e inviti; restano i fatti statistici anonimi (TripStatFact, tripId → null) e le
 *   statistiche personali (UserStatEntry, legate all'account). Le serie rimaste senza
 *   date e non più attive si cancellano con percorso, gruppo fisso e chat;
 * - inviti scaduti, revocati, rifiutati o usati da più di inviteRetentionDays;
 * - sessioni scadute e contatori anti brute-force inattivi;
 * - audit log oltre auditRetentionMonths (funzione dedicata del database).
 * Chat, segnalazioni e verifiche email hanno job propri (ChatService,
 * AbsenceReportsService, EmailVerificationService); i log tecnici dell'applicazione
 * escono su stdout e la loro conservazione è gestita dal sistema che li raccoglie.
 */
@Injectable()
export class RetentionService implements OnModuleInit {
  private readonly logger = new Logger('Retention');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly queue: JobQueue,
  ) {}

  onModuleInit(): void {
    this.queue.register('retention', () => this.run().then(() => undefined));
    this.queue.schedule('retention', '45 3 * * *');
  }

  async run(): Promise<RetentionResult> {
    const s = await this.settings.get();
    const now = this.clock.now();
    const today = todayInRome(now);

    // Viaggi conclusi (qualsiasi stato: chiusi, annullati, mai chiusi) oltre il periodo.
    const tripCutoff = monthsBefore(today, s.tripRetentionMonths);
    const trips = await this.prisma.trip.deleteMany({ where: { date: { lt: dateOnly(tripCutoff) } } });
    const series = await this.prisma.tripSeries.deleteMany({
      where: {
        trips: { none: {} },
        // Una serie ricorrente senza fine resta finché il conducente non la termina.
        endDate: { lt: dateOnly(today) },
      },
    });

    const inviteCutoff = new Date(now.getTime() - s.inviteRetentionDays * 86_400_000);
    const invitations = await this.prisma.invitation.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: inviteCutoff } },
          { status: 'REVOKED', revokedAt: { lt: inviteCutoff } },
          { status: { in: ['ACCEPTED', 'DECLINED'] }, respondedAt: { lt: inviteCutoff } },
        ],
      },
    });

    const sessions = await this.prisma.session.deleteMany({ where: { OR: [{ absoluteExpiresAt: { lt: now } }, { idleExpiresAt: { lt: now } }] } });
    const loginThrottles = await this.prisma.loginThrottle.deleteMany({
      where: {
        updatedAt: { lt: new Date(now.getTime() - THROTTLE_KEEP_MS) },
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
      },
    });

    const auditLog = await this.audit.purgeExpired(s.auditRetentionMonths);

    const result: RetentionResult = {
      trips: trips.count,
      series: series.count,
      invitations: invitations.count,
      sessions: sessions.count,
      loginThrottles: loginThrottles.count,
      auditLog,
    };
    await this.audit.record({ actorId: null, action: 'RETENTION_RUN', meta: { ...result } });
    this.logger.log({ ...result }, 'conservazione: cancellazioni eseguite');
    return result;
  }
}

/** Data AAAA-MM-GG di `months` mesi prima (giorno limitato alla fine del mese). */
export function monthsBefore(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) - months;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return `${ty}-${String(tm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
