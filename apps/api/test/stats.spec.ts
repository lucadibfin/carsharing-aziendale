import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import type { PersonalStatsDto, TripDetailDto } from '@fcs/shared';
import { haversineKm, RoutingService } from '../src/stats/routing.service.js';
import { COMUNI, createTestApp, createTrip, onboardedUser, resetDb, resetSpies, type ApiClient, type TestContext } from './helpers.js';

type LatLon = { lat: number; lon: number };
// Coordinate lette dal DB di test: quelle di sviluppo del seed oppure quelle ISTAT, se presenti.
let MILANO: LatLon;
let MONZA: LatLon;
let SESTO: LatLon;
let BERGAMO: LatLon;
const LECCO = '097042'; // le coordinate vengono tolte nel test che le richiede assenti

async function loadCoords(ctx: TestContext): Promise<void> {
  const get = async (istat: string) => {
    const c = await ctx.prisma.comune.findUniqueOrThrow({ where: { istat } });
    return { lat: c.lat!, lon: c.lon! };
  };
  MILANO = await get(COMUNI.MILANO);
  MONZA = await get(COMUNI.MONZA);
  SESTO = await get(COMUNI.SESTO_SG);
  BERGAMO = await get(COMUNI.BERGAMO);
}

/** Km stimati comune → sede di Milano (coefficiente stradale 1,3; la sede usa le coordinate del suo comune). */
const est = (from: LatLon) => Math.round(haversineKm(from, MILANO) * 1.3 * 1000) / 1000;

describe('Statistiche: distanze, fatti anonimi e statistiche personali', () => {
  let ctx: TestContext;
  let driver: ApiClient;
  let laura: ApiClient;
  let giuseppe: ApiClient;

  beforeAll(async () => {
    ctx = await createTestApp();
    await loadCoords(ctx);
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    resetSpies(ctx);
    ctx.clock.set('2026-11-16T07:00:00.000Z');
    driver = await onboardedUser(ctx, 'mario.rossi');
    laura = await onboardedUser(ctx, 'laura.bianchi');
    giuseppe = await onboardedUser(ctx, 'giuseppe.verdi');
  });

  async function join(trip: TripDetailDto, who: ApiClient, boardingComune: string): Promise<string> {
    expect((await who.post(`/trips/${trip.id}/requests`, { boardingComune })).status).toBe(201);
    const pid = (await driver.get(`/trips/${trip.id}`)).body.participants.find(
      (p: { user: { id: string } }) => p.user.id === who.userId,
    ).id as string;
    expect((await driver.post(`/trips/${trip.id}/participants/${pid}/accept`)).status).toBe(200);
    return pid;
  }

  const fact = (tripId: string) => ctx.prisma.tripStatFact.findUniqueOrThrow({ where: { tripId } });

  it('il fatto anonimo segue il ciclo di vita del viaggio e sopravvive alla sua cancellazione', async () => {
    const trip = await createTrip(ctx, driver);
    expect(await fact(trip.id)).toMatchObject({ status: 'PROPOSED', visibility: 'PUBLIC', seats: 3, legs: 2 });
    await driver.patch(`/trips/${trip.id}/visibility`, { visibility: 'PRIVATE' });
    expect((await fact(trip.id)).visibility).toBe('PRIVATE');
    await driver.post(`/trips/${trip.id}/cancel`);
    const f = await fact(trip.id);
    expect(f.status).toBe('CANCELLED');
    // Nessun campo riconducibile a una persona.
    expect(Object.keys(f)).not.toEqual(expect.arrayContaining(['driverId', 'userId']));

    await ctx.prisma.tripSeries.delete({ where: { id: trip.seriesId } });
    const orphan = await ctx.prisma.tripStatFact.findUniqueOrThrow({ where: { id: f.id } });
    expect(orphan.tripId).toBeNull();
  });

  it('alla chiusura calcola km evitati, CO2, carburante ed euro (auto di default: benzina)', async () => {
    const trip = await createTrip(ctx, driver); // Bergamo → Monza → Sesto → sede di Milano, con ritorno
    const pLaura = await join(trip, laura, COMUNI.MONZA);
    await join(trip, giuseppe, COMUNI.SESTO_SG); // assente alla chiusura
    ctx.clock.set('2026-11-20T09:00:00.000Z');
    expect((await driver.post(`/trips/${trip.id}/close`, { presentParticipantIds: [pLaura] })).status).toBe(200);

    const km = est(MONZA) * 2;
    const litres = (km * 6.5) / 100;
    const f = await fact(trip.id);
    expect(f).toMatchObject({ status: 'COMPLETED', passengers: 1, legs: 2, estimated: true, complete: true, fuelUnit: 'L' });
    expect(f.kmAvoided).toBeCloseTo(km, 2);
    expect(f.driverKm).toBeCloseTo(est(BERGAMO) * 2, 2);
    expect(f.fuelSaved).toBeCloseTo(litres, 2);
    expect(f.co2SavedKg).toBeCloseTo(litres * 2.32, 2);
    expect(f.eurSaved).toBeCloseTo(litres * 1.8, 1);

    const sLaura = (await laura.get('/stats/me')).body as PersonalStatsDto;
    expect(sLaura.allTime).toMatchObject({ asDriver: 0, asPassenger: 1 });
    expect(sLaura.allTime.kmAvoided).toBeCloseTo(km, 0);
    expect(sLaura.thisYear.asPassenger).toBe(1);
    expect(sLaura.anyEstimated).toBe(true);

    const sDriver = (await driver.get('/stats/me')).body as PersonalStatsDto;
    expect(sDriver.allTime).toMatchObject({ asDriver: 1, asPassenger: 0 });
    expect(sDriver.allTime.sharedKm).toBeCloseTo(est(BERGAMO) * 2, 0);
    expect(sDriver.allTime.co2SavedKg).toBeCloseTo(litres * 2.32, 0);

    // L'assente non ha statistiche.
    expect(((await giuseppe.get('/stats/me')).body as PersonalStatsDto).allTime.asPassenger).toBe(0);
    // Una seconda chiusura non duplica nulla.
    expect((await driver.post(`/trips/${trip.id}/close`, { presentParticipantIds: [] })).status).toBe(409);
    expect(await ctx.prisma.userStatEntry.count()).toBe(2);
  });

  it('usa i dati dell’auto del conducente, se indicati', async () => {
    await driver.patch('/profile', { fuelType: 'DIESEL', consumptionPer100km: 5 });
    const trip = await createTrip(ctx, driver, { returnTime: null });
    const p = await join(trip, laura, COMUNI.SESTO_SG);
    ctx.clock.set('2026-11-20T09:00:00.000Z');
    await driver.post(`/trips/${trip.id}/close`, { presentParticipantIds: [p] });
    const litres = (est(SESTO) * 5) / 100;
    const f = await fact(trip.id);
    expect(f.legs).toBe(1);
    expect(f.fuelSaved).toBeCloseTo(litres, 2);
    expect(f.co2SavedKg).toBeCloseTo(litres * 2.65, 2);
  });

  it('senza coordinate il viaggio conta ma le metriche aggregate restano vuote', async () => {
    const saved = await ctx.prisma.comune.findUniqueOrThrow({ where: { istat: LECCO } });
    await ctx.prisma.comune.update({ where: { istat: LECCO }, data: { lat: null, lon: null } });
    onTestFinished(() => ctx.prisma.comune.update({ where: { istat: LECCO }, data: { lat: saved.lat, lon: saved.lon } }).then(() => undefined));
    const trip = await createTrip(ctx, driver, { departureComune: COMUNI.BERGAMO, viaComuni: [LECCO] });
    const p = await join(trip, laura, LECCO);
    ctx.clock.set('2026-11-20T09:00:00.000Z');
    await driver.post(`/trips/${trip.id}/close`, { presentParticipantIds: [p] });
    const f = await fact(trip.id);
    expect(f).toMatchObject({ complete: false, passengers: 1, kmAvoided: null, co2SavedKg: null });
    expect(((await laura.get('/stats/me')).body as PersonalStatsDto).allTime).toMatchObject({ asPassenger: 1, kmAvoided: 0 });
  });

  it('la cancellazione di un utente non tocca le statistiche personali degli altri', async () => {
    const trip = await createTrip(ctx, driver);
    const p = await join(trip, laura, COMUNI.MONZA);
    ctx.clock.set('2026-11-20T09:00:00.000Z');
    await driver.post(`/trips/${trip.id}/close`, { presentParticipantIds: [p] });
    await ctx.prisma.tripSeries.deleteMany({ where: { driverId: driver.userId } });
    await ctx.prisma.user.delete({ where: { id: driver.userId } });
    expect(((await laura.get('/stats/me')).body as PersonalStatsDto).allTime.asPassenger).toBe(1);
    expect(await ctx.prisma.tripStatFact.count({ where: { status: 'COMPLETED' } })).toBe(1);
  });
});

describe('Routing con OSRM self-hosted', () => {
  let ctx: TestContext;
  let osrm: Server;
  let up = true;
  const requested: string[] = [];

  beforeAll(async () => {
    osrm = createServer((req, res) => {
      requested.push(req.url ?? '');
      if (!up) return void res.writeHead(503).end();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 'Ok', routes: [{ distance: 21_345.6 }] }));
    });
    await new Promise<void>((r) => osrm.listen(0, '127.0.0.1', r));
    const port = (osrm.address() as AddressInfo).port;
    ctx = await createTestApp({ ROUTING_PROVIDER: 'osrm', OSRM_URL: `http://127.0.0.1:${port}` });
    await loadCoords(ctx);
  });
  afterAll(async () => {
    await ctx.app.close();
    osrm.close();
  });

  it('usa OSRM, salva in cache e ricade sulla stima se il servizio non risponde', async () => {
    await resetDb(ctx.prisma);
    const routing = ctx.app.get(RoutingService);
    const siteId = ctx.sites[0]!.id;

    expect(await routing.comuneToSite(COMUNI.MONZA, siteId)).toEqual({ km: 21.346, estimated: false });
    expect(requested).toHaveLength(1);
    // Solo coordinate di comune e sede (lon,lat), nessun altro dato.
    const f6 = (x: number) => x.toFixed(6);
    expect(requested[0]).toBe(
      `/route/v1/driving/${f6(MONZA.lon)},${f6(MONZA.lat)};${f6(MILANO.lon)},${f6(MILANO.lat)}?overview=false&alternatives=false&steps=false`,
    );
    await routing.comuneToSite(COMUNI.MONZA, siteId);
    expect(requested).toHaveLength(1); // dalla cache

    up = false;
    const d = await routing.comuneToSite(COMUNI.SESTO_SG, siteId);
    expect(d?.estimated).toBe(true);
    expect(d?.km).toBeCloseTo(est(SESTO), 2);
    const cached = await ctx.prisma.distanceCache.findMany({ orderBy: { comuneIstat: 'asc' } });
    expect(cached.map((c) => c.source)).toEqual(['ESTIMATED', 'ROUTED']);

    // Dopo un giorno la stima viene ricalcolata con OSRM tornato disponibile.
    up = true;
    ctx.clock.set('2026-11-17T08:00:00.000Z');
    expect(await routing.comuneToSite(COMUNI.SESTO_SG, siteId)).toEqual({ km: 21.346, estimated: false });
  });
});
