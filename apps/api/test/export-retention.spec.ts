import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { AuditService } from '../src/audit/audit.service.js';
import { csvCell, EXPORT_COLUMNS } from '../src/admin/report-export.service.js';
import { monthsBefore, RetentionService } from '../src/retention/retention.service.js';
import { createTestApp, createTrip, onboardedUser, resetDb, resetSpies, type ApiClient, type TestContext } from './helpers.js';

/** Legge un archivio ZIP (anche con voci compresse) e restituisce i file come testo. */
function unzip(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + size);
    out.set(name, (method === 0 ? raw : inflateRawSync(raw)).toString('utf8'));
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

describe('Esportazione dei report e conservazione automatica', () => {
  let ctx: TestContext;
  let admin: ApiClient;
  let siteAdmin: ApiClient;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    resetSpies(ctx);
    ctx.clock.set('2026-11-16T07:00:00.000Z');
    admin = await onboardedUser(ctx, 'admin');
    siteAdmin = await onboardedUser(ctx, 'laura.bianchi');
    await admin.post('/admin/roles', { userId: siteAdmin.userId, role: 'SITE_ADMIN', siteId: ctx.sites[0]!.id });
  });

  describe('report CSV ed Excel per il PSCL', () => {
    /** Ottobre: 6 viaggi completati nella sede 0; novembre: 2 (sotto soglia); sede 1: 5 a ottobre. */
    async function facts() {
      const fact = (siteId: string, date: string, extra: Record<string, unknown> = {}) => ({
        siteId,
        date: new Date(`${date}T00:00:00Z`),
        visibility: 'PUBLIC' as const,
        status: 'COMPLETED' as const,
        seats: 3,
        passengers: 2,
        legs: 2,
        driverKm: 40,
        kmAvoided: 60.5,
        co2SavedKg: 9.25,
        fuelSaved: 3.9,
        fuelUnit: 'L',
        eurSaved: 7,
        ...extra,
      });
      const [a, b] = [ctx.sites[0]!.id, ctx.sites[1]!.id];
      await ctx.prisma.tripStatFact.createMany({
        data: [
          ...Array.from({ length: 5 }, (_, i) => fact(a, `2026-10-0${i + 1}`)),
          fact(a, '2026-10-20', { fuelUnit: 'kWh', fuelSaved: 10, visibility: 'PRIVATE', estimated: true }),
          fact(a, '2026-10-21', { status: 'CANCELLED', passengers: 0, kmAvoided: null, co2SavedKg: null, fuelSaved: null, eurSaved: null }),
          fact(a, '2026-11-02'),
          fact(a, '2026-11-03'),
          ...Array.from({ length: 5 }, (_, i) => fact(b, `2026-10-1${i}`)),
        ],
      });
    }
    const csvRows = (text: string) => text.replace(/^﻿/, '').split('\r\n');

    it('CSV: una riga per sede e mese, valori nascosti sotto la soglia, note e fonte ISTAT', async () => {
      await facts();
      const r = await admin.get('/admin/export').query({ format: 'csv', from: '2026-10-01', to: '2026-11-30' }).buffer(true);
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toMatch(/^text\/csv/);
      expect(r.headers['content-disposition']).toBe('attachment; filename="report-pscl_2026-10-01_2026-11-30.csv"');
      const text = r.text;
      expect(text.startsWith('﻿')).toBe(true);
      const lines = csvRows(text);
      expect(lines[0]).toBe(EXPORT_COLUMNS.join(';'));
      const [milanoOct, milanoNov, otherOct] = [lines[1]!, lines[2]!, lines[3]!].map((l) => l.split(';'));
      expect(milanoOct.slice(0, 9)).toEqual([ctx.sites[0]!.name, '2026-10', '6', '1', '6', '1', '18', '12', '66,7']);
      expect(milanoOct.slice(9, 15)).toEqual(['363', '55,5', '19,5', '0', '10', '42']);
      expect(milanoOct[15]).toBe('1'); // distanze stimate
      expect(milanoNov.slice(0, 6)).toEqual([ctx.sites[0]!.name, '2026-11', '2', '0', '2', '0']);
      expect(milanoNov.slice(6, 15).every((v) => v === '')).toBe(true);
      expect(milanoNov[17]).toBe('Meno di 5 viaggi completati: valori non pubblicati');
      expect(otherOct[0]).toBe(ctx.sites[1]!.name);
      expect(otherOct[7]).toBe('10');
      expect(lines.length).toBeGreaterThan(5);
      expect(text).toContain('Fonte: ISTAT, licenza CC BY 4.0');
      expect(text).toContain('Righe interessate: 1.');
      // Nessuna riga di totale.
      expect(text).not.toMatch(/^Totale/m);
      const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'ADMIN_REPORT_EXPORT' }, orderBy: { id: 'desc' } });
      expect(audit?.meta).toMatchObject({ format: 'csv', rows: 3, suppressed: 1 });
    });

    it('Excel: file .xlsx valido con il foglio dei dati e quello delle note', async () => {
      await facts();
      const r = await admin
        .get('/admin/export')
        .query({ format: 'xlsx', from: '2026-10-01', to: '2026-11-30' })
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      const files = unzip(r.body as Buffer);
      expect([...files.keys()].sort()).toEqual(
        ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml'].sort(),
      );
      expect(files.get('xl/workbook.xml')).toContain('<sheet name="Report" sheetId="1" r:id="rId1"/>');
      const sheet = files.get('xl/worksheets/sheet1.xml')!;
      expect(sheet).toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Sede</t></is></c>');
      expect(sheet).toContain('<c r="I2"><v>66.7</v></c>');
      expect(sheet).toContain('<c r="J2"><v>363</v></c>');
      expect(files.get('xl/worksheets/sheet2.xml')).toContain('Fonte: ISTAT');
    });

    it('l’admin di sede esporta solo la propria sede', async () => {
      await facts();
      const own = await siteAdmin.get('/admin/export').query({ format: 'csv', from: '2026-10-01', to: '2026-11-30' });
      const names = csvRows(own.text).slice(1).filter((l) => l && !l.startsWith('"') && l.includes(';')).map((l) => l.split(';')[0]);
      expect(new Set(names)).toEqual(new Set([ctx.sites[0]!.name]));
      const other = await siteAdmin.get('/admin/export').query({ format: 'csv', siteId: ctx.sites[1]!.id });
      expect(other.status).toBe(403);
      const user = await onboardedUser(ctx, 'giuseppe.verdi');
      expect((await user.get('/admin/export').query({ format: 'csv' })).status).toBe(403);
      expect((await admin.get('/admin/export').query({ format: 'pdf' })).status).toBe(400);
    });

    it('CSV: virgola decimale, virgolette e protezione dalle formule', () => {
      expect(csvCell(12.5)).toBe('12,5');
      expect(csvCell('Sede; Nord')).toBe('"Sede; Nord"');
      expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
      expect(csvCell('-1+2')).toBe("'-1+2");
      expect(csvCell(null)).toBe('');
    });
  });

  describe('conservazione', () => {
    it('cancella i viaggi conclusi oltre il periodo: restano i fatti anonimi e le statistiche personali', async () => {
      const driver = await onboardedUser(ctx, 'mario.rossi');
      ctx.clock.set('2025-09-01T07:00:00.000Z');
      const old = await createTrip(ctx, driver, { date: '2025-09-05' });
      ctx.clock.set('2025-09-05T16:00:00.000Z');
      expect((await driver.post(`/trips/${old.id}/close`, { presentParticipantIds: [] })).status).toBe(200);
      ctx.clock.set('2026-11-16T07:00:00.000Z');
      const recent = await createTrip(ctx, driver, { date: '2026-11-20' });

      const r = await ctx.app.get(RetentionService).run();
      expect(r.trips).toBe(1);
      expect(r.series).toBe(1);
      expect(await ctx.prisma.trip.findUnique({ where: { id: old.id } })).toBeNull();
      expect(await ctx.prisma.tripSeries.findUnique({ where: { id: old.seriesId } })).toBeNull();
      expect(await ctx.prisma.trip.findUnique({ where: { id: recent.id } })).not.toBeNull();
      const fact = await ctx.prisma.tripStatFact.findFirst({ where: { date: new Date('2025-09-05T00:00:00Z') } });
      expect(fact).toMatchObject({ status: 'COMPLETED', tripId: null });
      expect(await ctx.prisma.userStatEntry.count({ where: { userId: driver.userId } })).toBe(1);
    });

    it('una serie ricorrente senza fine resta anche quando le sue date vecchie vengono cancellate', async () => {
      const driver = await onboardedUser(ctx, 'mario.rossi');
      ctx.clock.set('2025-09-01T07:00:00.000Z');
      const series = await createTrip(ctx, driver, { date: '2025-09-01', weekdays: [1] });
      ctx.clock.set('2026-11-16T07:00:00.000Z');
      await ctx.app.get(RetentionService).run();
      expect(await ctx.prisma.trip.count({ where: { seriesId: series.seriesId } })).toBe(0);
      expect(await ctx.prisma.tripSeries.findUnique({ where: { id: series.seriesId } })).not.toBeNull();
    });

    it('cancella inviti scaduti da oltre 30 giorni, sessioni scadute e contatori inattivi', async () => {
      const driver = await onboardedUser(ctx, 'mario.rossi');
      ctx.clock.set('2026-09-01T07:00:00.000Z');
      const old = await createTrip(ctx, driver, { date: '2026-09-02' });
      await driver.post(`/trips/${old.id}/invitation-links`, { expiresInHours: 24 });
      ctx.clock.set('2026-11-16T07:00:00.000Z');
      const trip = await createTrip(ctx, driver, { date: '2026-11-20' });
      await driver.post(`/trips/${trip.id}/invitation-links`, { expiresInHours: 24 });
      await ctx.prisma.session.create({
        data: {
          tokenHash: 'x'.repeat(64),
          userId: driver.userId,
          absoluteExpiresAt: new Date('2026-11-01T00:00:00Z'),
          idleExpiresAt: new Date('2026-11-01T00:00:00Z'),
        },
      });
      await ctx.prisma.loginThrottle.create({ data: { key: 'u:vecchio', failures: 1, updatedAt: new Date('2026-11-01T00:00:00Z') } });

      const r = await ctx.app.get(RetentionService).run();
      expect(r.invitations).toBe(1);
      expect(await ctx.prisma.invitation.count({ where: { tripId: trip.id } })).toBe(1);
      expect(r.sessions).toBe(1);
      expect(r.loginThrottles).toBe(1);
      // La sessione in corso resta valida.
      expect((await driver.get('/me')).status).toBe(200);
    });

    it('audit log: cancellazione per scadenza solo tramite la funzione dedicata, catena ancora verificabile', async () => {
      const audit = ctx.app.get(AuditService);
      ctx.clock.set('2020-01-15T10:00:00.000Z');
      await audit.record({ actorId: null, action: 'EMPLOYEE_CHECK_RUN', meta: { vecchio: 1 } });
      await audit.record({ actorId: null, action: 'EMPLOYEE_CHECK_RUN', meta: { vecchio: 2 } });
      ctx.clock.set('2026-11-16T07:00:00.000Z');
      await audit.record({ actorId: null, action: 'EMPLOYEE_CHECK_RUN', meta: { recente: true } });

      const r = await ctx.app.get(RetentionService).run();
      expect(r.auditLog).toBeGreaterThanOrEqual(2);
      expect(await ctx.prisma.auditLog.count({ where: { at: { lt: new Date('2021-01-01') } } })).toBe(0);
      expect(await ctx.prisma.auditLog.count({ where: { action: 'AUDIT_LOG_PURGED' } })).toBeGreaterThanOrEqual(1);
      expect(await ctx.prisma.auditLog.findFirst({ where: { action: 'RETENTION_RUN' }, orderBy: { id: 'desc' } })).not.toBeNull();
      expect((await audit.verify()).ok).toBe(true);

      // L'app continua a non poter cancellare righe direttamente, né sotto i 6 mesi.
      await expect(ctx.prisma.auditLog.deleteMany({})).rejects.toThrow(/append-only/);
      await expect(ctx.prisma.$queryRawUnsafe('SELECT * FROM audit_log_purge(3)')).rejects.toThrow(/minimo 6 mesi/);
    });

    it('audit log: righe iniziali tolte senza la funzione dedicata vengono rilevate', async () => {
      const audit = ctx.app.get(AuditService);
      await audit.record({ actorId: null, action: 'EMPLOYEE_CHECK_RUN', meta: { a: 1 } });
      await audit.record({ actorId: null, action: 'EMPLOYEE_CHECK_RUN', meta: { a: 2 } });
      const first = await ctx.prisma.auditLog.findFirstOrThrow({ orderBy: { id: 'asc' } });
      const copy = { ...first };
      await ctx.prisma.$executeRawUnsafe('ALTER TABLE "AuditLog" DISABLE TRIGGER audit_log_no_update_delete');
      try {
        await ctx.prisma.auditLog.delete({ where: { id: first.id } });
        expect((await audit.verify()).ok).toBe(false);
      } finally {
        await ctx.prisma.auditLog.create({ data: { ...copy, meta: copy.meta ?? undefined } });
        await ctx.prisma.$executeRawUnsafe('ALTER TABLE "AuditLog" ENABLE TRIGGER audit_log_no_update_delete');
      }
      expect((await audit.verify()).ok).toBe(true);
    });

    it('data di N mesi prima, anche a fine mese', () => {
      expect(monthsBefore('2026-11-16', 12)).toBe('2025-11-16');
      expect(monthsBefore('2026-03-31', 1)).toBe('2026-02-28');
      expect(monthsBefore('2026-01-15', 1)).toBe('2025-12-15');
    });
  });
});
