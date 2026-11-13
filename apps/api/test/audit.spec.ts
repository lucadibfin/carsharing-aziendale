import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import { createTestApp, type TestContext } from './helpers.js';

describe('Audit log immutabile', () => {
  let ctx: TestContext;
  let audit: AuditService;

  beforeAll(async () => {
    ctx = await createTestApp();
    audit = ctx.app.get(AuditService);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('le righe formano una catena di hash verificabile', async () => {
    await audit.record({ actorId: null, action: 'EMPLOYEE_CHECK_RUN', meta: { checked: 3, b: [1, 2], a: { z: 1, y: 2 } } });
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        audit.record({ actorId: '00000000-0000-4000-8000-000000000001', action: 'ADMIN_TRIPS_LIST', meta: { i } }),
      ),
    );
    const rows = await ctx.prisma.auditLog.findMany({ orderBy: { id: 'asc' } });
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.prevHash).toBe(rows[i - 1]!.hash);
    const r = await audit.verify();
    expect(r).toMatchObject({ ok: true, brokenAtId: null });
    expect(r.checked).toBe(rows.length);
  });

  it('il database rifiuta UPDATE, DELETE e TRUNCATE', async () => {
    await expect(ctx.prisma.auditLog.updateMany({ data: { action: 'X' } })).rejects.toThrow(/append-only/);
    await expect(ctx.prisma.auditLog.deleteMany({})).rejects.toThrow(/append-only/);
    await expect(ctx.prisma.$executeRawUnsafe('TRUNCATE "AuditLog"')).rejects.toThrow(/append-only/);
    // Nemmeno un TRUNCATE a cascata di altre tabelle lo tocca.
    expect(await ctx.prisma.auditLog.count()).toBeGreaterThan(0);
  });

  it('una manomissione fatta scavalcando i trigger viene rilevata', async () => {
    const target = await ctx.prisma.auditLog.findFirstOrThrow({ orderBy: { id: 'asc' }, skip: 2 });
    // Simula un attacco con privilegi di superutente sul DB (trigger disattivati).
    await ctx.prisma.$executeRawUnsafe('ALTER TABLE "AuditLog" DISABLE TRIGGER audit_log_no_update_delete');
    try {
      await ctx.prisma.auditLog.update({ where: { id: target.id }, data: { action: 'ADMIN_DASHBOARD_VIEW' } });
      const r = await audit.verify();
      expect(r.ok).toBe(false);
      expect(r.brokenAtId).toBe(target.id.toString());
    } finally {
      await ctx.prisma.auditLog.update({ where: { id: target.id }, data: { action: target.action } });
      await ctx.prisma.$executeRawUnsafe('ALTER TABLE "AuditLog" ENABLE TRIGGER audit_log_no_update_delete');
    }
    expect((await audit.verify()).ok).toBe(true);
  });
});
