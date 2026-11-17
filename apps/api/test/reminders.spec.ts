import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RemindersService } from '../src/trips/reminders.service.js';
import { COMUNI, createTestApp, createTrip, onboardedUser, pushSpy, resetDb, resetSpies, type ApiClient, type TestContext } from './helpers.js';

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

  it('prima della partenza: in anticipo sulla partenza stimata dal tempo di guida', async () => {
    const trip = await tripTomorrow();
    const drive = await reminders.driveMinutes(COMUNI.BERGAMO, ctx.sites[0]!.id);
    expect(drive).toBeGreaterThanOrEqual(5);
    const arrival = new Date('2026-11-17T07:30:00.000Z').getTime(); // 08:30 a Roma
    const remindAt = arrival - (drive + 60) * 60_000;
    ctx.clock.set(new Date(remindAt - 60_000).toISOString());
    expect((await reminders.run()).departure).toBe(0);
    ctx.clock.set(new Date(remindAt).toISOString());
    expect((await reminders.run()).departure).toBe(3);
    expect(calls('TRIP_REMINDER').map((c: unknown[]) => c[2])).toEqual([trip.id]);
    ctx.clock.set(new Date(remindAt + 10 * 60_000).toISOString());
    expect((await reminders.run()).departure).toBe(0);
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

  it('senza coordinate si ipotizza un tempo di guida standard', async () => {
    expect(await reminders.driveMinutes(undefined, ctx.sites[0]!.id)).toBe(45);
  });
});
