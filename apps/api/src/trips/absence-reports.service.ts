import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { AbsenceReportOptionsDto, AdminAbsenceReportDto, DecideAbsenceReportInput } from '@fcs/shared';
import { AuditService } from '../audit/audit.service.js';
import { AppException, Conflict, NotFound } from '../common/errors.js';
import { Clock } from '../common/clock.js';
import { CryptoService } from '../common/crypto.service.js';
import { PrismaService } from '../common/prisma.service.js';
import { toIsoDate } from '../common/time.js';
import type { Prisma } from '../generated/prisma/client.js';
import { JobQueue } from '../jobs/job-queue.js';
import { SettingsService } from '../settings/settings.service.js';
import { type TripContext, TripAccessPolicy } from './trip-access.policy.js';

type Candidate = AbsenceReportOptionsDto['candidates'][number];

/** Siti visibili a un admin: null = tutti (admin globale). */
export type SiteScope = string[] | null;

const userSummary = { select: { id: true, firstName: true, lastName: true } } as const;

/**
 * Segnalazioni di assenza.
 * - Le invia un membro di un viaggio passato (entro closureWindowDays) su chi non si
 *   è presentato o ha annullato oltre la scadenza. Motivazione obbligatoria, cifrata.
 * - Non sono visibili agli altri utenti né alla persona segnalata (che le ritrova
 *   nell'esportazione dei propri dati). Le gestisce un admin: nessuna conseguenza automatica.
 * - Cancellazione automatica dopo absenceReportRetentionMonths.
 */
@Injectable()
export class AbsenceReportsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: TripAccessPolicy,
    private readonly crypto: CryptoService,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly queue: JobQueue,
  ) {}

  onModuleInit(): void {
    this.queue.register('absence-report-retention', () => this.purgeExpired().then(() => undefined));
    this.queue.schedule('absence-report-retention', '30 3 * * *');
  }

  // ---------- lato utente ----------

  async options(tripId: string, userId: string): Promise<AbsenceReportOptionsDto> {
    const ctx = await this.policy.loadVisible(tripId, userId);
    const { candidates, deadline } = await this.candidates(ctx);
    const mine = await this.prisma.absenceReport.findMany({ where: { tripId, reporterId: userId }, select: { reportedId: true } });
    return { candidates, alreadyReported: mine.map((r) => r.reportedId), deadline: deadline.toISOString() };
  }

  async create(tripId: string, userId: string, reportedUserId: string, reason: string): Promise<AbsenceReportOptionsDto> {
    const ctx = await this.policy.loadVisible(tripId, userId);
    const { candidates } = await this.candidates(ctx);
    if (!candidates.some((c) => c.id === reportedUserId)) {
      throw new AppException('NOT_REPORTABLE', 'Questa persona non può essere segnalata per questo viaggio');
    }
    const existing = await this.prisma.absenceReport.findFirst({ where: { tripId, reporterId: userId, reportedId: reportedUserId } });
    if (existing) throw Conflict('ALREADY_REPORTED', 'Hai già inviato una segnalazione per questa persona');
    await this.prisma.absenceReport.create({
      data: {
        tripId,
        siteId: ctx.trip.siteId,
        tripDate: ctx.trip.date,
        reporterId: userId,
        reportedId: reportedUserId,
        reasonEnc: this.crypto.encrypt(reason),
        createdAt: this.clock.now(),
      },
    });
    return this.options(tripId, userId);
  }

  private async candidates(ctx: TripContext): Promise<{ candidates: Candidate[]; deadline: Date }> {
    return this.policy.absenceReportCandidates(ctx);
  }

  // ---------- lato admin ----------

  async adminList(
    actorId: string,
    scope: SiteScope,
    filters: { siteId?: string; status?: 'OPEN' | 'DISMISSED' | 'ACKNOWLEDGED' },
  ): Promise<AdminAbsenceReportDto[]> {
    const where: Prisma.AbsenceReportWhereInput = {
      ...(filters.status ? { status: filters.status } : {}),
      siteId: this.scopedSite(scope, filters.siteId),
    };
    const rows = await this.prisma.absenceReport.findMany({
      where,
      include: { reported: userSummary, reporter: userSummary },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    await this.audit.record({ actorId, action: 'ADMIN_REPORTS_LIST', meta: { ...filters, results: rows.length } });
    return this.withContext(rows, false);
  }

  async adminGet(actorId: string, scope: SiteScope, id: string): Promise<AdminAbsenceReportDto> {
    const row = await this.loadScoped(scope, id);
    await this.audit.record({ actorId, action: 'ADMIN_REPORT_VIEW', targetType: 'AbsenceReport', targetId: id });
    return (await this.withContext([row], true))[0]!;
  }

  async adminDecide(actorId: string, scope: SiteScope, id: string, input: DecideAbsenceReportInput): Promise<AdminAbsenceReportDto> {
    await this.loadScoped(scope, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.absenceReport.update({
        where: { id },
        data: {
          status: input.status,
          decisionNoteEnc: this.crypto.encryptNullable(input.note),
          handledById: actorId,
          handledAt: this.clock.now(),
        },
      });
      await this.audit.record(
        { actorId, action: 'ADMIN_REPORT_DECISION', targetType: 'AbsenceReport', targetId: id, meta: { status: input.status, withNote: Boolean(input.note) } },
        tx,
      );
    });
    const row = await this.loadScoped(scope, id);
    return (await this.withContext([row], true))[0]!;
  }

  async purgeExpired(): Promise<number> {
    const { absenceReportRetentionMonths } = await this.settings.get();
    const cutoff = new Date(this.clock.now());
    cutoff.setUTCMonth(cutoff.getUTCMonth() - absenceReportRetentionMonths);
    const r = await this.prisma.absenceReport.deleteMany({ where: { createdAt: { lt: cutoff } } });
    return r.count;
  }

  /** Un admin di sede non vede (404) le segnalazioni di altre sedi. */
  private scopedSite(scope: SiteScope, requested?: string): Prisma.StringFilter | string | undefined {
    if (scope === null) return requested;
    if (requested) return scope.includes(requested) ? requested : '00000000-0000-0000-0000-000000000000';
    return { in: scope };
  }

  private async loadScoped(scope: SiteScope, id: string) {
    const row = await this.prisma.absenceReport.findUnique({ where: { id }, include: { reported: userSummary, reporter: userSummary } });
    if (!row || (scope !== null && !scope.includes(row.siteId))) throw NotFound('Segnalazione');
    return row;
  }

  private async withContext(
    rows: Prisma.AbsenceReportGetPayload<{ include: { reported: typeof userSummary; reporter: typeof userSummary } }>[],
    detail: boolean,
  ): Promise<AdminAbsenceReportDto[]> {
    const sites = new Map((await this.prisma.site.findMany({ select: { id: true, name: true } })).map((s) => [s.id, s.name]));
    const counts = new Map<string, number>();
    const grouped = await this.prisma.absenceReport.groupBy({
      by: ['reportedId'],
      where: { reportedId: { in: [...new Set(rows.map((r) => r.reportedId))] } },
      _count: { _all: true },
    });
    for (const g of grouped) counts.set(g.reportedId, g._count._all);
    return rows.map((r) => ({
      id: r.id,
      tripId: r.tripId,
      siteId: r.siteId,
      siteName: sites.get(r.siteId) ?? '',
      tripDate: toIsoDate(r.tripDate),
      status: r.status,
      reported: r.reported,
      reporter: r.reporter,
      reportedTotal: counts.get(r.reportedId) ?? 1,
      createdAt: r.createdAt.toISOString(),
      handledAt: r.handledAt?.toISOString() ?? null,
      ...(detail ? { reason: this.crypto.decrypt(r.reasonEnc), decisionNote: this.crypto.decryptNullable(r.decisionNoteEnc) } : {}),
    }));
  }
}
