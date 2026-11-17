import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { ComuneDto, TripDetailDto } from '@fcs/shared';
import { COMUNI, createTestApp, createTrip, onboardedUser, resetDb, type TestContext } from './helpers.js';

const apiDir = resolve(import.meta.dirname, '..');

/** Esegue il seed vero (come `npm run db:seed`) sul DB di test, con una cartella di dati a scelta. */
function runSeed(dataDir?: string): string {
  return execFileSync(process.execPath, ['prisma/seed.mjs'], {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: inject('databaseUrl'), NODE_ENV: 'test', ...(dataDir ? { SEED_DATA_DIR: dataDir } : {}) },
    encoding: 'utf8',
  });
}

/**
 * Situazione reale di novembre 2026: l'elenco del progetto ha i vecchi codici sardi;
 * il nuovo elenco (SITUAS) ha i codici nuovi, la fusione Castegnero + Nanto →
 * Castegnero Nanto e non ha più Lirio (incorporato).
 */
describe('Seed: aggiornamento dell’elenco dei comuni', () => {
  let ctx: TestContext;
  let dir: string;
  let seedOutput: string;
  let tripId: string;
  let lauraId: string;
  let mario: Awaited<ReturnType<typeof onboardedUser>>;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.prisma);
    // Prima dell'aggiornamento: Laura risiede ad Alghero (vecchio codice sardo), Mario ha un
    // viaggio che parte da Castegnero (poi fuso) con salita a Nanto.
    mario = await onboardedUser(ctx, 'mario.rossi');
    const laura = await onboardedUser(ctx, 'laura.bianchi');
    lauraId = laura.userId;
    await laura.patch('/profile', { comuneIstat: '090003' });
    const trip = await createTrip(ctx, mario, { departureComune: '024027', viaComuni: ['024071', COMUNI.MONZA] });
    tripId = trip.id;
    expect((await laura.post(`/trips/${trip.id}/requests`, { boardingComune: '024071' })).status).toBe(201);

    // Nuovi dati di riferimento, ricavati dall'elenco attuale del progetto.
    dir = mkdtempSync(join(tmpdir(), 'fcs-seed-'));
    const current = readFileSync(resolve(apiDir, 'prisma/data/comuni.csv'), 'utf8')
      .trim()
      .split(/\r?\n/)
      .filter((l) => !l.startsWith('#'))
      .slice(1)
      .filter((l) => !/^(090003|024027|024071|018082);/.test(l));
    writeFileSync(
      join(dir, 'comuni.csv'),
      ['# Fonte: ISTAT - SITUAS, elenco dei comuni al 17/11/2026. Licenza CC BY 4.0.', 'istat;name;province;region;catastale', ...current, '112001;Alghero;SS;Sardegna;A192', '024129;Castegnero Nanto;VI;Veneto;M439', ''].join('\n'),
    );
    writeFileSync(join(dir, 'comuni-ricodifiche.csv'), 'vecchio;nuovo;nome;dal\n090003;112001;Alghero;17/11/2026\n');
    writeFileSync(join(dir, 'comuni-coordinate.csv'), '# Fonte: ISTAT\nistat;lat;lon\n112001;40.558;8.319\n024129;45.4367;11.5904\n024027;45.437;11.6\n');
    seedOutput = runSeed(dir);
  });

  afterAll(async () => {
    // Ripristino dei dati di riferimento del progetto per gli altri test.
    await resetDb(ctx.prisma);
    runSeed();
    await ctx.prisma.comune.deleteMany({ where: { istat: { in: ['112001', '024129'] } } });
    rmSync(dir, { recursive: true, force: true });
    await ctx.app.close();
  });

  it('ricodifica: il profilo passa al nuovo codice e il vecchio sparisce', async () => {
    expect(seedOutput).toMatch(/Ricodifiche applicate: 1 comuni; righe aggiornate: \{"User":1\}/);
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: lauraId } })).comuneIstat).toBe('112001');
    expect(await ctx.prisma.comune.findUnique({ where: { istat: '090003' } })).toBeNull();
    expect(await ctx.prisma.comune.findUniqueOrThrow({ where: { istat: '112001' } })).toMatchObject({ active: true, lat: 40.558 });
  });

  it('fusione: il nuovo comune è selezionabile con le coordinate calcolate; i comuni d’origine restano per i viaggi esistenti', async () => {
    expect(await ctx.prisma.comune.findUniqueOrThrow({ where: { istat: '024129' } })).toMatchObject({ active: true, lat: 45.4367 });
    expect(await ctx.prisma.comune.findUniqueOrThrow({ where: { istat: '024027' } })).toMatchObject({ active: false });
    const found = (await mario.get('/comuni').query({ q: 'Castegnero' })).body as ComuneDto[];
    expect(found.map((c) => c.istat)).toEqual(['024129']);
    const trip = (await mario.get(`/trips/${tripId}`)).body as TripDetailDto;
    expect(trip.stops.map((s) => s.comuneName)).toEqual(['Castegnero', 'Nanto', 'Monza']);
  });

  it('incorporazione (Lirio): il comune resta nel DB ma non è più selezionabile', async () => {
    expect(await ctx.prisma.comune.findUniqueOrThrow({ where: { istat: '018082' } })).toMatchObject({ active: false });
  });

  it('il seed rilanciato con gli stessi dati non cambia nulla', () => {
    const again = runSeed(dir);
    expect(again).not.toContain('Ricodifiche applicate');
    expect(again).toMatch(/0 aggiornati; comuni attivi senza coordinate: \d+/);
  });
});
