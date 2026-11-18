import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { TripDetailDto } from '@fcs/shared';
import { applyRecodings, COMUNE_COLUMNS } from '../prisma/comuni-recode.mjs';
import { COMUNI, createTestApp, createTrip, onboardedUser, resetDb, type TestContext } from './helpers.js';

const OLD = '999001';
const NEW = '999101';

describe('Ricodifica dei comuni nel database', () => {
  let ctx: TestContext;
  let client: pg.Client;

  beforeAll(async () => {
    ctx = await createTestApp();
    client = new pg.Client({ connectionString: inject('databaseUrl') });
    await client.connect();
  });
  afterAll(async () => {
    await resetDb(ctx.prisma);
    await ctx.prisma.site.deleteMany({ where: { name: 'Sede di prova ricodifica' } });
    await ctx.prisma.comune.deleteMany({ where: { istat: { in: [OLD, NEW] } } });
    await client.end();
    await ctx.app.close();
  });

  it('l’elenco delle colonne con un codice comune coincide con lo schema', async () => {
    const r = await client.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND data_type = 'character' AND character_maximum_length = 6`,
    );
    const inSchema = r.rows.map((x) => `${x.table_name}.${x.column_name}`).sort();
    const handled = ['Comune.istat', ...COMUNE_COLUMNS.map((c) => `${c.table}.${c.column}`)].sort();
    expect(inSchema).toEqual(handled);
  });

  it('profili, sedi, tappe e comuni di salita passano al nuovo codice; il vecchio sparisce', async () => {
    await resetDb(ctx.prisma);
    await ctx.prisma.comune.createMany({
      data: [
        { istat: OLD, name: 'Comune di prova', province: 'SS', region: 'Sardegna', lat: 40.7, lon: 8.5 },
        { istat: NEW, name: 'Comune di prova', province: 'SS', region: 'Sardegna' },
      ],
    });
    const site = await ctx.prisma.site.create({ data: { name: 'Sede di prova ricodifica', address: 'Via Prova 1', comuneIstat: OLD } });
    const driver = await onboardedUser(ctx, 'mario.rossi');
    const laura = await onboardedUser(ctx, 'laura.bianchi');
    await laura.patch('/profile', { comuneIstat: OLD });
    const trip = await createTrip(ctx, driver, { departureComune: OLD, viaComuni: [COMUNI.MONZA] });
    expect((await laura.post(`/trips/${trip.id}/requests`, { boardingComune: OLD })).status).toBe(201);
    // La proposta del viaggio ha già calcolato (e messo in cache) la distanza: si garantisce comunque la riga.
    const cacheKey = { comuneIstat: OLD, siteId: ctx.sites[0]!.id };
    await ctx.prisma.distanceCache.upsert({
      where: { comuneIstat_siteId: cacheKey },
      create: { ...cacheKey, meters: 1000, source: 'ESTIMATED', computedAt: new Date() },
      update: {},
    });

    await client.query('BEGIN');
    const done = await applyRecodings(client, [{ from: OLD, to: NEW, name: 'Comune di prova', since: '01/01/2026' }]);
    await client.query('COMMIT');

    expect(done).toEqual([
      expect.objectContaining({ from: OLD, to: NEW, moved: { User: 1, Site: 1, TripStop: 1, TripParticipant: 1 } }),
    ]);
    expect(await ctx.prisma.comune.findUnique({ where: { istat: OLD } })).toBeNull();
    // Stesso territorio: il nuovo codice eredita le coordinate finché non arrivano quelle nuove.
    expect(await ctx.prisma.comune.findUniqueOrThrow({ where: { istat: NEW } })).toMatchObject({ lat: 40.7, lon: 8.5 });
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: laura.userId } })).comuneIstat).toBe(NEW);
    expect((await ctx.prisma.site.findUniqueOrThrow({ where: { id: site.id } })).comuneIstat).toBe(NEW);
    expect(await ctx.prisma.distanceCache.count({ where: { comuneIstat: OLD } })).toBe(0);

    // Il viaggio resta consultabile e coerente con il nuovo codice.
    const detail = (await driver.get(`/trips/${trip.id}`)).body as TripDetailDto;
    expect(detail.stops[0]).toMatchObject({ comuneIstat: NEW, comuneName: 'Comune di prova' });
    expect(detail.participants[0]!.boardingComune).toBe(NEW);

    // Idempotente: rilanciare il seed non fa nulla.
    expect(await applyRecodings(client, [{ from: OLD, to: NEW, name: '', since: '' }])).toEqual([]);
  });

  it('un nuovo codice assente dall’elenco blocca il seed invece di lasciare dati orfani', async () => {
    await ctx.prisma.comune.create({ data: { istat: '999002', name: 'Altro', province: 'SS', region: 'Sardegna' } });
    await expect(applyRecodings(client, [{ from: '999002', to: '999202', name: 'Altro', since: '' }])).rejects.toThrow(/non è nell'elenco/);
    await ctx.prisma.comune.delete({ where: { istat: '999002' } });
  });
});
