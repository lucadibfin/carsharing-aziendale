import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { COMUNI, createTestApp, createTrip, onboardedUser, resetDb, resetSpies, type ApiClient, type TestContext } from './helpers.js';

describe('Chat in tempo reale (Socket.IO)', () => {
  let ctx: TestContext;
  let url: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.app.listen(0, '127.0.0.1');
    url = `http://127.0.0.1:${(ctx.app.getHttpServer().address() as AddressInfo).port}/chat`;
  });
  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    resetSpies(ctx);
  });

  function sessionCookie(c: ApiClient): string {
    // supertest agent: si legge il cookie di sessione dal jar
    const jar = (c.agent as unknown as { jar: { getCookies: (o: object) => { name: string; value: string }[] } }).jar;
    const sid = jar.getCookies({ path: '/', secure: false, script: false, domain: '127.0.0.1' }).find((x) => x.name === 'sid');
    return `sid=${sid?.value ?? ''}`;
  }

  function connect(opts: { cookie?: string; origin?: string }): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const s = io(url, {
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
        extraHeaders: { ...(opts.cookie ? { cookie: opts.cookie } : {}), origin: opts.origin ?? 'http://localhost:4200' },
      });
      sockets.push(s);
      s.on('connect', () => resolve(s));
      s.on('connect_error', (e) => reject(e));
    });
  }

  it('rifiuta connessioni senza sessione o da un’origine diversa', async () => {
    const mario = await onboardedUser(ctx, 'mario.rossi');
    await expect(connect({})).rejects.toThrow(/unauthenticated/);
    await expect(connect({ cookie: sessionCookie(mario), origin: 'https://evil.example' })).rejects.toThrow(/forbidden/);
  });

  it('i messaggi arrivano solo ai membri della chat; un estraneo non può entrare nella stanza', async () => {
    const driver = await onboardedUser(ctx, 'mario.rossi');
    const laura = await onboardedUser(ctx, 'laura.bianchi');
    const anna = await onboardedUser(ctx, 'anna.neri');
    const trip = await createTrip(ctx, driver, { visibility: 'PRIVATE' });
    await driver.post(`/trips/${trip.id}/invitation-links`, { expiresInHours: 24 }).then(async (r) => {
      await laura.post('/invitation-links/accept', { token: r.body.token, boardingComune: COMUNI.MONZA });
    });

    const sDriver = await connect({ cookie: sessionCookie(driver) });
    const sLaura = await connect({ cookie: sessionCookie(laura) });
    const sAnna = await connect({ cookie: sessionCookie(anna) });

    expect(await sDriver.emitWithAck('join', { tripId: trip.id })).toMatchObject({ ok: true });
    expect(await sLaura.emitWithAck('join', { tripId: trip.id })).toMatchObject({ ok: true });
    expect(await sAnna.emitWithAck('join', { tripId: trip.id })).toEqual({ ok: false, code: 'NOT_FOUND' });

    const received: string[] = [];
    let annaGot = 0;
    sDriver.on('message', (m: { text: string }) => received.push(m.text));
    sAnna.on('message', () => annaGot++);

    const ack = await sLaura.emitWithAck('send', { tripId: trip.id, text: 'Arrivo tra 5 minuti' });
    expect(ack.ok).toBe(true);
    expect(await sAnna.emitWithAck('send', { tripId: trip.id, text: 'intrusione' })).toEqual({ ok: false, code: 'NOT_FOUND' });

    await new Promise((r) => setTimeout(r, 200));
    expect(received).toEqual(['Arrivo tra 5 minuti']);
    expect(annaGot).toBe(0);
  });
});
