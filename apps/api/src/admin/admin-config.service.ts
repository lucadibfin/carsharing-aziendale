import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type AdminPolicyDto,
  type AdminRoleDto,
  type AdminSiteDto,
  type AdminUserDto,
  type AuditPageDto,
  type AuditQuery,
  type GrantRoleInput,
  type PublishPolicyInput,
  type Settings,
  type SiteInput,
  settingsSchema,
  type UpdateSiteInput,
} from '@fcs/shared';
import { AuditService } from '../audit/audit.service.js';
import { AppException, Conflict, NotFound } from '../common/errors.js';
import { PrismaService } from '../common/prisma.service.js';
import { addDays, dateOnly } from '../common/time.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PoliciesService } from '../policies/policies.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { RoutingService } from '../stats/routing.service.js';

const AUDIT_PAGE = 100;

/** Configurazione riservata agli admin globali. Ogni modifica finisce nell'audit log. */
@Injectable()
export class AdminConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly policies: PoliciesService,
    private readonly routing: RoutingService,
    private readonly audit: AuditService,
  ) {}

  // ---------- parametri ----------

  getSettings(): Promise<Settings> {
    return this.settings.get();
  }

  async updateSettings(actorId: string, input: Settings): Promise<Settings> {
    const before = await this.settings.get();
    const changed = (Object.keys(settingsSchema.shape) as (keyof Settings)[]).filter(
      (k) => JSON.stringify(before[k]) !== JSON.stringify(input[k]),
    );
    await this.prisma.$transaction(async (tx) => {
      for (const key of changed) {
        const value = input[key] as Prisma.InputJsonValue;
        await tx.setting.upsert({ where: { key }, create: { key, value, updatedBy: actorId }, update: { value, updatedBy: actorId } });
      }
      // Cambia il coefficiente delle stime: le distanze stimate vanno ricalcolate.
      if (changed.includes('estimatedRoadFactor')) await tx.distanceCache.deleteMany({ where: { source: 'ESTIMATED' } });
      if (changed.length) await this.audit.record({ actorId, action: 'ADMIN_SETTINGS_UPDATE', meta: { changed } }, tx);
    });
    this.settings.invalidate();
    return this.settings.get();
  }

  // ---------- ruoli ----------

  async roles(): Promise<AdminRoleDto[]> {
    const rows = await this.prisma.roleAssignment.findMany({
      include: { user: { select: { id: true, firstName: true, lastName: true } }, site: { select: { name: true } } },
      orderBy: [{ role: 'desc' }, { user: { lastName: 'asc' } }],
    });
    return rows.map((r) => ({
      id: r.id,
      role: r.role,
      siteId: r.siteId,
      siteName: r.site?.name ?? null,
      user: r.user,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Ricerca di qualunque utente attivo per assegnare un ruolo (non solo i "trovabili"). Il testo cercato non va nel log. */
  async searchUsers(actorId: string, q: string): Promise<AdminUserDto[]> {
    const words = q.split(/\s+/).filter(Boolean);
    const rows = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        onboardedAt: { not: null },
        AND: words.map((w) => ({
          OR: [{ firstName: { contains: w, mode: 'insensitive' as const } }, { lastName: { contains: w, mode: 'insensitive' as const } }],
        })),
      },
      select: { id: true, firstName: true, lastName: true, site: { select: { name: true } } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 20,
    });
    await this.audit.record({ actorId, action: 'ADMIN_USER_SEARCH', meta: { results: rows.length } });
    return rows.map((u) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName, siteName: u.site?.name ?? null }));
  }

  async grantRole(actorId: string, input: GrantRoleInput): Promise<AdminRoleDto[]> {
    const user = await this.prisma.user.findFirst({ where: { id: input.userId, status: 'ACTIVE' }, select: { id: true } });
    if (!user) throw NotFound('Utente');
    if (input.siteId && !(await this.prisma.site.findUnique({ where: { id: input.siteId } }))) throw NotFound('Sede');
    const siteId = input.role === 'SITE_ADMIN' ? input.siteId! : null;
    const exists = await this.prisma.roleAssignment.findFirst({ where: { userId: input.userId, role: input.role, siteId } });
    if (exists) throw Conflict('ROLE_EXISTS', 'Il ruolo è già assegnato');
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.roleAssignment.create({ data: { userId: input.userId, role: input.role, siteId, grantedBy: actorId } });
      await this.audit.record(
        { actorId, action: 'ADMIN_ROLE_GRANT', targetType: 'User', targetId: input.userId, meta: { roleId: r.id, role: input.role, siteId } },
        tx,
      );
    });
    return this.roles();
  }

  async revokeRole(actorId: string, roleId: string): Promise<AdminRoleDto[]> {
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.roleAssignment.findUnique({ where: { id: roleId } });
      if (!r) throw NotFound('Ruolo');
      if (r.role === 'GLOBAL_ADMIN') {
        // Serializza le revoche concorrenti: deve restare almeno un admin globale.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${0x524f4c45})`;
        const globals = await tx.roleAssignment.count({ where: { role: 'GLOBAL_ADMIN', user: { status: 'ACTIVE' } } });
        if (globals <= 1) {
          throw new AppException('LAST_GLOBAL_ADMIN', 'Deve restare almeno un amministratore globale', HttpStatus.CONFLICT);
        }
      }
      await tx.roleAssignment.delete({ where: { id: roleId } });
      await this.audit.record(
        { actorId, action: 'ADMIN_ROLE_REVOKE', targetType: 'User', targetId: r.userId, meta: { roleId, role: r.role, siteId: r.siteId } },
        tx,
      );
    });
    return this.roles();
  }

  // ---------- sedi ----------

  async sites(): Promise<AdminSiteDto[]> {
    const rows = await this.prisma.site.findMany({ orderBy: { name: 'asc' } });
    return rows.map((s) => ({ id: s.id, name: s.name, address: s.address, comuneIstat: s.comuneIstat, lat: s.lat, lon: s.lon, active: s.active }));
  }

  async createSite(actorId: string, input: SiteInput): Promise<AdminSiteDto[]> {
    await this.assertComune(input.comuneIstat);
    if (await this.prisma.site.findUnique({ where: { name: input.name } })) throw Conflict('SITE_EXISTS', 'Esiste già una sede con questo nome');
    await this.prisma.$transaction(async (tx) => {
      const s = await tx.site.create({ data: { ...input, lat: input.lat ?? null, lon: input.lon ?? null } });
      await this.audit.record({ actorId, action: 'ADMIN_SITE_CREATE', targetType: 'Site', targetId: s.id }, tx);
    });
    return this.sites();
  }

  async updateSite(actorId: string, id: string, input: UpdateSiteInput): Promise<AdminSiteDto[]> {
    const before = await this.prisma.site.findUnique({ where: { id } });
    if (!before) throw NotFound('Sede');
    if (input.comuneIstat) await this.assertComune(input.comuneIstat);
    if (input.name && input.name !== before.name && (await this.prisma.site.findUnique({ where: { name: input.name } }))) {
      throw Conflict('SITE_EXISTS', 'Esiste già una sede con questo nome');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.site.update({ where: { id }, data: input });
      await this.audit.record({ actorId, action: 'ADMIN_SITE_UPDATE', targetType: 'Site', targetId: id, meta: { changed: Object.keys(input) } }, tx);
    });
    const after = await this.prisma.site.findUniqueOrThrow({ where: { id } });
    if (after.lat !== before.lat || after.lon !== before.lon || after.comuneIstat !== before.comuneIstat) {
      await this.routing.invalidateSite(id);
    }
    return this.sites();
  }

  private async assertComune(istat: string): Promise<void> {
    if (!(await this.prisma.comune.findFirst({ where: { istat, active: true } }))) throw new AppException('INVALID_COMUNE', 'Comune non valido');
  }

  // ---------- testi legali ----------

  async policyVersions(): Promise<AdminPolicyDto[]> {
    const docs = await this.prisma.policyDocument.findMany({
      orderBy: [{ type: 'asc' }, { version: 'desc' }],
      include: { _count: { select: { acceptances: true } } },
    });
    return docs.map((d) => ({ ...this.policies.toDto(d), acceptances: d._count.acceptances }));
  }

  /**
   * Pubblica una nuova versione: le versioni precedenti non cambiano mai e
   * tutti gli utenti devono prendere visione della nuova al prossimo accesso.
   */
  async publishPolicy(actorId: string, input: PublishPolicyInput): Promise<AdminPolicyDto[]> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${0x504f4c49})`;
      const last = await tx.policyDocument.findFirst({ where: { type: input.type }, orderBy: { version: 'desc' }, select: { version: true } });
      const doc = await tx.policyDocument.create({
        data: { type: input.type, version: (last?.version ?? 0) + 1, title: input.title, content: input.content, createdBy: actorId },
      });
      await this.audit.record(
        { actorId, action: 'ADMIN_POLICY_PUBLISH', targetType: 'PolicyDocument', targetId: doc.id, meta: { type: input.type, version: doc.version } },
        tx,
      );
    });
    this.policies.invalidate();
    return this.policyVersions();
  }

  // ---------- audit log ----------

  async auditPage(actorId: string, q: AuditQuery): Promise<AuditPageDto> {
    const where: Prisma.AuditLogWhereInput = {
      ...(q.action ? { action: q.action } : {}),
      ...(q.before ? { id: { lt: BigInt(q.before) } } : {}),
      at: { ...(q.from ? { gte: dateOnly(q.from) } : {}), ...(q.to ? { lt: dateOnly(addDays(q.to, 1)) } : {}) },
    };
    const rows = await this.prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, take: AUDIT_PAGE + 1 });
    const page = rows.slice(0, AUDIT_PAGE);
    const actorIds = [...new Set(page.map((r) => r.actorId).filter((x): x is string => Boolean(x)))];
    const actors = new Map(
      (await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, firstName: true, lastName: true } })).map((u) => [u.id, u]),
    );
    // Solo la prima pagina conta come accesso (evita una riga per ogni scorrimento).
    if (!q.before) await this.audit.record({ actorId, action: 'ADMIN_AUDIT_VIEW', meta: { action: q.action ?? null, from: q.from ?? null, to: q.to ?? null } });
    return {
      entries: page.map((r) => ({
        id: r.id.toString(),
        at: r.at.toISOString(),
        action: r.action,
        actor: r.actorId ? (actors.get(r.actorId) ?? null) : null,
        actorId: r.actorId,
        targetType: r.targetType,
        targetId: r.targetId,
        meta: r.meta,
      })),
      nextBefore: rows.length > AUDIT_PAGE ? page.at(-1)!.id.toString() : null,
    };
  }

  async verifyAudit(actorId: string) {
    const r = await this.audit.verify();
    await this.audit.record({ actorId, action: 'ADMIN_AUDIT_VERIFY', meta: { ok: r.ok, checked: r.checked } });
    return r;
  }
}
