import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TripDetailDto } from '@fcs/shared';
import { romeToUtc } from '../src/common/time.js';
import { RemindersService } from '../src/trips/reminders.service.js';
import { TravelTimeService } from '../src/trips/travel-time.service.js';
import { COMUNI, createTestApp, createTrip, onboardedUser, pushSpy, resetDb, resetSpies, tripInput, type ApiClient, type TestContext } from './helpers.js';

describe('Promemoria facoltativi', () => {
  let ctx: TestContext;
  let reminders: RemindersService;
  let driver: ApiClient;
  let laura: ApiClient; // con consenso alle notifiche facoltative
  let giuseppe: ApiClient; // senza consenso

  beforeAll(async () => {
    ctx = await createTestApp();
    reminders = ctx.app.get(RemindersService);
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    resetSpies(ctx);
    ctx.clock.set('2026-11-16T07:00:00.000Z');
    driver = await onboardedUser(ctx, 'mario.rossi', { optionalNotifications: true });
    laura = await onboardedUser(ctx, 'laura.bianchi', { optionalNotifications: true });
    giuseppe = await onboardedUser(ctx, 'giuseppe.verdi');
  });

  /** Viaggio di martedì 17/11 alle 08:30 con Laura e Giuseppe confermati. */
  async function tripTomorrow() {
    const trip = await createTrip(ctx, driver, { date: '2026-11-17', seats: 3 });
    for (const who of [laura, giuseppe]) {
      await who.post(`/trips/${trip.id}/requests`, { boardingComune: COMUNI.MONZA });
      const pid = (await driver.get(`/trips/${trip.id}`)).body.participants.find((p: { user: { id: string } }) => p.user.id === who.userId).id;
      await driver.post(`/trips/${trip.id}/participants/${pid}/accept`);
    }
    resetSpies(ctx);
    return trip;
  }
  const calls = (type: string) => ctx.notify.mock.calls.filter((c: unknown[]) => c[1] === type);

  it('la sera prima: dall’ora configurata, una sola volta, a conducente e confermati', async () => {
    const trip = await tripTomorrow();
    ctx.clock.set('2026-11-16T18:55:00.000Z'); // 19:55
    expect((await reminders.run()).evening).toBe(0);
    ctx.clock.set('2026-11-16T19:00:00.000Z'); // 20:00
    expect((await reminders.run()).evening).toBe(3);
    const sent = calls('TRIP_REMINDER_EVENING');
    expect(sent).toHaveLength(1);
    expect([...(sent[0]![0] as string[])].sort()).toEqual([driver.userId, laura.userId, giuseppe.userId].sort());
    expect(sent[0]![2]).toBe(trip.id);
    expect((await reminders.run()).evening).toBe(0);
  });

  it('solo chi ha dato il consenso riceve davvero il promemoria', async () => {
    await tripTomorrow();
    const push = pushSpy(ctx);
    ctx.clock.set('2026-11-16T19:00:00.000Z');
    await reminders.run();
    expect(push.mock.calls.map((c: unknown[]) => c[0]).sort()).toEqual([driver.userId, laura.userId].sort());
  });

  it('prima della salita: il conducente un’ora prima della partenza, i passeggeri un’ora prima del passaggio dal loro comune', async () => {
    const trip = await tripTomorrow(); // partenza proposta dall'app
    const t = (await driver.get(`/trips/${trip.id}`)).body as TripDetailDto;
    const dep = t.departureTime!;
    const monza = t.stops.find((s) => s.comuneIstat === COMUNI.MONZA)!.passTime!;
    expect(monza > dep).toBe(true);
    const at = (hhmm: string, minus: number) => new Date(romeToUtc('2026-11-17', hhmm).getTime() - minus * 60_000).toISOString();

    ctx.clock.set(at(dep, 61));
    expect((await reminders.run()).departure).toBe(0);
    ctx.clock.set(at(dep, 60));
    expect((await reminders.run()).departure).toBe(1);
    expect(calls('TRIP_REMINDER').map((c: unknown[]) => c[0])).toEqual([[driver.userId]]);
    ctx.clock.set(at(monza, 61));
    expect((await reminders.run()).departure).toBe(0);
    ctx.clock.set(at(monza, 60));
    expect((await reminders.run()).departure).toBe(2);
    expect(new Set(calls('TRIP_REMINDER').slice(1).map((c: unknown[]) => (c[0] as string[])[0]))).toEqual(new Set([laura.userId, giuseppe.userId]));
    ctx.clock.set(at(monza, 30));
    expect((await reminders.run()).departure).toBe(0);
  });

  it('viaggi senza orario di partenza: partenza stimata dal tempo di guida', async () => {
    const trip = await tripTomorrow();
    await ctx.prisma.tripSeries.update({ where: { id: trip.seriesId }, data: { departureTime: null } });
    await ctx.prisma.tripStop.updateMany({ where: { seriesId: trip.seriesId }, data: { passTime: null } });
    const drive = (await ctx.app.get(TravelTimeService).driveMinutes(COMUNI.BERGAMO, ctx.sites[0]!.id))!;
    const remindAt = romeToUtc('2026-11-17', '08:30').getTime() - (drive + 60) * 60_000;
    ctx.clock.set(new Date(remindAt - 60_000).toISOString());
    expect((await reminders.run()).departure).toBe(0);
    ctx.clock.set(new Date(remindAt).toISOString());
    expect((await reminders.run()).departure).toBe(3);
  });

  it('niente promemoria per un viaggio creato dopo il momento previsto, né per quelli annullati', async () => {
    ctx.clock.set('2026-11-16T20:30:00.000Z'); // 21:30
    const late = await createTrip(ctx, driver, { date: '2026-11-17' });
    const cancelled = await createTrip(ctx, driver, { date: '2026-11-17', arrivalTime: '09:00' });
    await driver.post(`/trips/${cancelled.id}/cancel`);
    resetSpies(ctx);
    expect((await reminders.run()).evening).toBe(0);
    expect(calls('TRIP_REMINDER_EVENING')).toEqual([]);
    expect((await ctx.prisma.trip.findUniqueOrThrow({ where: { id: late.id } })).eveningReminderAt).not.toBeNull();
  });

  it('dopo una pausa dell’app: niente promemoria serali del giorno prima né promemoria di salite già passate', async () => {
    const trip = await tripTomorrow();
    const t = (await driver.get(`/trips/${trip.id}`)).body as TripDetailDto;
    const monza = t.stops.find((s) => s.comuneIstat === COMUNI.MONZA)!.passTime!;
    // L'app riparte la mattina del viaggio, dopo la salita a Monza ma prima dell'arrivo.
    ctx.clock.set(new Date(romeToUtc('2026-11-17', monza).getTime() + 60_000).toISOString());
    const r = await reminders.run();
    expect(r).toEqual({ evening: 0, departure: 0 });
    expect(calls('TRIP_REMINDER')).toEqual([]);
    expect(calls('TRIP_REMINDER_EVENING')).toEqual([]);
    // Segnati come gestiti: non partono nemmeno ai giri successivi.
    const parts = await ctx.prisma.tripParticipant.findMany({ where: { tripId: trip.id, status: 'ACCEPTED' } });
    expect(parts.every((p) => p.reminderSentAt !== null)).toBe(true);
    expect((await ctx.prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).departureReminderAt).not.toBeNull();
  });
});

describe('Orario di partenza e orari di passaggio', () => {
  let ctx: TestContext;
  let driver: ApiClient;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.clock.set('2026-11-16T07:00:00.000Z');
    driver = await onboardedUser(ctx, 'mario.rossi');
  });

  it('l’app propone la partenza in base alla distanza; i comuni di passaggio hanno un orario stimato in ordine', async () => {
    const est = await driver.post('/trips/estimate', {
      siteId: ctx.sites[0]!.id,
      arrivalTime: '08:30',
      departureComune: COMUNI.BERGAMO,
      viaComuni: [COMUNI.MONZA, COMUNI.SESTO_SG],
    });
    expect(est.status).toBe(200);
    expect(est.body.driveMinutes).toHaveLength(3);
    expect(est.body.departureTime < '08:30').toBe(true);

    const trip = await createTrip(ctx, driver);
    expect(trip.departureTime).toBe(est.body.departureTime);
    const times = trip.stops.map((s) => s.passTime!);
    expect(times[0]).toBe(trip.departureTime);
    expect([...times].sort()).toEqual(times);
    expect(times.every((x) => x < '08:30')).toBe(true);
  });

  it('il conducente può scegliere un’altra partenza, purché prima dell’arrivo', async () => {
    const trip = await createTrip(ctx, driver, { departureTime: '06:45' });
    expect(trip.departureTime).toBe('06:45');
    expect(trip.stops[0]!.passTime).toBe('06:45');
    const bad = await driver.post('/trips', { ...tripInput(ctx), departureTime: '08:30' });
    expect(bad.status).toBe(400);
  });
});