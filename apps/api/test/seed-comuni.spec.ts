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

/** Comuni dell'elenco "vecchio" (prima dell'aggiornamento), qualunque sia l'elenco attuale del progetto. */
const OLD_COMUNI = [
  { istat: '090003', name: 'Alghero', province: 'SS', region: 'Sardegna' },
  { istat: '024027', name: 'Castegnero', province: 'VI', region: 'Veneto' },
  { istat: '024071', name: 'Nanto', province: 'VI', region: 'Veneto' },
  { istat: '018082', name: 'Lirio', province: 'PV', region: 'Lombardia' },
  { istat: '018094', name: 'Montalto Pavese', province: 'PV', region: 'Lombardia' },
];
/** Codici dello scenario: tolti dall'elenco del progetto e riscritti nei dati di prova. */
const SCENARIO_CODES = ['090003', '024027', '024071', '018082', '018094', '112001', '024129'];

/**
 * Situazione reale di novembre 2026: l'elenco precedente ha i vecchi codici sardi;
 * il nuovo elenco (SITUAS) ha i codici nuovi, la fusione Castegnero + Nanto →
 * Castegnero Nanto e non ha più Lirio, incorporato in Montalto Pavese.
 */
describe('Seed: aggiornamento dell’elenco dei comuni', () => {
  let ctx: TestContext;
  let dir: string;
  let seedOutput: string;
  let tripId: string;
  let lirioTripId: string;
  let lauraId: string;
  let annaId: string;
  let anna: Awaited<ReturnType<typeof onboardedUser>>;
  let mario: Awaited<ReturnType<typeof onboardedUser>>;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.prisma);
    for (const c of OLD_COMUNI) {
      await ctx.prisma.comune.upsert({ where: { istat: c.istat }, create: { ...c, active: true }, update: { ...c, active: true } });
    }
    // Prima dell'aggiornamento: Laura risiede ad Alghero (vecchio codice sardo), Mario ha un
    // viaggio che parte da Castegnero (poi fuso) con salita a Nanto, Anna risiede a Lirio
    // (poi incorporato) e ha un viaggio che parte da lì.
    mario = await onboardedUser(ctx, 'mario.rossi');
    const laura = await onboardedUser(ctx, 'laura.bianchi');
    lauraId = laura.userId;
    await laura.patch('/profile', { comuneIstat: '090003' });
    const trip = await createTrip(ctx, mario, { departureComune: '024027', viaComuni: ['024071', COMUNI.MONZA] });
    tripId = trip.id;
    expect((await laura.post(`/trips/${trip.id}/requests`, { boardingComune: '024071' })).status).toBe(201);
    anna = await onboardedUser(ctx, 'anna.neri');
    annaId = anna.userId;
    await anna.patch('/profile', { comuneIstat: '018082' });
    lirioTripId = (await createTrip(ctx, anna, { departureComune: '018082', viaComuni: [COMUNI.MONZA] })).id;

    // Nuovi dati di riferimento: elenco del progetto senza i codici dello scenario, più i comuni nuovi.
    dir = mkdtempSync(join(tmpdir(), 'fcs-seed-'));
    const codes = new RegExp(`^(${SCENARIO_CODES.join('|')});`);
    const current = readFileSync(resolve(apiDir, 'prisma/data/comuni.csv'), 'utf8')
      .trim()
      .split(/\r?\n/)
      .filter((l) => !l.startsWith('#'))
      .slice(1)
      .filter((l) => !codes.test(l));
    writeFileSync(
      join(dir, 'comuni.csv'),
      [
        '# Fonte: ISTAT - SITUAS, elenco dei comuni al 17/11/2026. Licenza CC BY 4.0.',
        'istat;name;province;region;catastale',
        ...current,
        '112001;Alghero;SS;Sardegna;A192',
        '024129;Castegnero Nanto;VI;Veneto;M439',
        '018094;Montalto Pavese;PV;Lombardia;F417',
        '',
      ].join('\n'),
    );
    writeFileSync(join(dir, 'comuni-ricodifiche.csv'), 'vecchio;nuovo;nome;dal\n090003;112001;Alghero;17/11/2026\n');
    writeFileSync(
      join(dir, 'comuni-variazioni.csv'),
      [
        'codice;nome;tipo;origini;rilevato_al;nota',
        '024129;Castegnero Nanto;FUSIONE;024027+024071;17/11/2026;fusione di Castegnero e Nanto',
        '018094;Montalto Pavese;INCORPORAZIONE;018082+018094;17/11/2026;incorporazione di Lirio',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(dir, 'comuni-coordinate.csv'),
      '# Fonte: ISTAT\nistat;lat;lon\n112001;40.558;8.319\n024129;45.4367;11.5904\n024027;45.437;11.6\n018082;44.98;9.2\n018094;44.975;9.215\n',
    );
    seedOutput = runSeed(dir);
  });

  afterAll(async () => {
    // Ripristino dei dati di riferimento del progetto per gli altri test.
    await resetDb(ctx.prisma);
    await ctx.prisma.comune.deleteMany({ where: { istat: { in: SCENARIO_CODES } } });
    runSeed();
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

  it('incorporazione (Lirio → Montalto Pavese): profilo e viaggio spostati; Lirio resta, non selezionabile', async () => {
    expect(seedOutput).toMatch(/Incorporazione applicata: 018082 → 018094 Montalto Pavese; righe aggiornate: \{"User":1,"TripStop":1\}/);
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: annaId } })).comuneIstat).toBe('018094');
    const trip = (await anna.get(`/trips/${lirioTripId}`)).body as TripDetailDto;
    expect(trip.stops.map((s) => s.comuneName)).toEqual(['Montalto Pavese', 'Monza']);
    expect(await ctx.prisma.comune.findUniqueOrThrow({ where: { istat: '018082' } })).toMatchObject({ active: false, lat: 44.98 });
    expect(await ctx.prisma.comune.findUniqueOrThrow({ where: { istat: '018094' } })).toMatchObject({ active: true, lat: 44.975 });
    expect((await mario.get('/comuni').query({ q: 'Lirio' })).body as ComuneDto[]).toEqual([]);
  });

  it('il seed rilanciato con gli stessi dati non cambia nulla', () => {
    const again = runSeed(dir);
    expect(again).not.toContain('Ricodifiche applicate');
    expect(again).not.toContain('Incorporazione applicata');
    expect(again).toMatch(/0 aggiornati; comuni attivi senza coordinate: \d+/);
  });
});
