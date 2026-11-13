import { Writable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setLogDestination } from '../src/logging.js';
import { EmailVerificationService } from '../src/users/email-verification.service.js';
import { UserLifecycleService } from '../src/users/user-lifecycle.service.js';
import {
  ApiClient,
  COMUNI,
  createTestApp,
  createTrip,
  lastCodeFor,
  mailSpy,
  onboardedUser,
  resetDb,
  resetSpies,
  type TestContext,
} from './helpers.js';

const T0 = '2026-11-16T07:00:00.000Z';

describe('Email per le notifiche con verifica tramite codice', () => {
  let ctx: TestContext;
  const logs: string[] = [];

  beforeAll(async () => {
    setLogDestination(
      new Writable({
        write(chunk, _enc, cb) {
          logs.push(String(chunk));
          cb();
        },
      }),
    );
    ctx = await createTestApp({ LOG_LEVEL: 'trace' });
  });

  afterAll(async () => {
    setLogDestination(undefined);
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    resetSpies(ctx);
    ctx.clock.set(T0);
    logs.length = 0;
  });

  async function loggedIn(username = 'mario.rossi'): Promise<ApiClient> {
    const c = await new ApiClient(ctx.app).init();
    expect((await c.login(username)).status).toBe(204);
    return c;
  }

  async function onboard(c: ApiClient) {
    const policies = (await c.get('/policies/current')).body as { id: string }[];
    return c.post('/onboarding', {
      acceptedPolicyIds: policies.map((p) => p.id),
      consents: { phoneVisible: false, discoverable: false, emailNotifications: false },
      siteId: ctx.sites[0]!.id,
      comuneIstat: COMUNI.MONZA,
    });
  }

  it('il primo accesso non si completa senza un’email verificata', async () => {
    const c = await loggedIn();
    expect((await c.get('/me')).body).toMatchObject({ onboardingRequired: true, emailVerified: false });
    const r = await onboard(c);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('codice inviato all’indirizzo indicato (anche personale); dopo la conferma il primo accesso si completa', async () => {
    const mail = mailSpy(ctx);
    const c = await loggedIn();
    const req = await c.post('/profile/email/code', { email: '  Mario.Rossi@Gmail.example ' });
    expect(req.status).toBe(200);
    expect(req.body).toMatchObject({ email: null, pendingEmail: 'mario.rossi@gmail.example' });
    expect(mail).toHaveBeenCalledTimes(1);
    const code = lastCodeFor(mail, 'mario.rossi@gmail.example');

    // Nel DB né l'indirizzo né il codice sono in chiaro.
    const row = await ctx.prisma.emailVerification.findFirstOrThrow();
    expect(row.emailEnc).not.toContain('gmail');
    expect(row.codeHash).not.toContain(code);

    const conf = await c.post('/profile/email/confirm', { code });
    expect(conf.status).toBe(200);
    expect(conf.body).toMatchObject({ email: 'mario.rossi@gmail.example', pendingEmail: null });
    expect((await onboard(c)).status).toBe(201);
    expect((await c.get('/me')).body).toMatchObject({ onboardingRequired: false, emailVerified: true });
    const user = await ctx.prisma.user.findFirstOrThrow({ where: { username: 'mario.rossi' } });
    expect(user.emailEnc).not.toContain('gmail');
  });

  it('indirizzo non valido: rifiutato', async () => {
    const c = await loggedIn();
    const r = await c.post('/profile/email/code', { email: 'non-una-email' });
    expect(r.status).toBe(400);
  });

  it('codice errato: rifiutato; dopo 5 errori serve un nuovo codice anche con quello giusto', async () => {
    const mail = mailSpy(ctx);
    const c = await loggedIn();
    await c.post('/profile/email/code', { email: 'm@example.test' });
    const code = lastCodeFor(mail, 'm@example.test');
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const r = await c.post('/profile/email/confirm', { code: wrong });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('EMAIL_CODE_INVALID');
    }
    const r = await c.post('/profile/email/confirm', { code });
    expect(r.body.code).toBe('EMAIL_CODE_TOO_MANY_ATTEMPTS');
    expect((await c.get('/me')).body.emailVerified).toBe(false);
  });

  it('il codice scade dopo 15 minuti', async () => {
    const mail = mailSpy(ctx);
    const c = await loggedIn();
    await c.post('/profile/email/code', { email: 'm@example.test' });
    ctx.clock.set('2026-11-16T07:15:01.000Z');
    const r = await c.post('/profile/email/confirm', { code: lastCodeFor(mail, 'm@example.test') });
    expect(r.body.code).toBe('EMAIL_CODE_EXPIRED');
  });

  it('limiti di invio: un codice al minuto, al massimo 5 all’ora', async () => {
    const mail = mailSpy(ctx);
    const c = await loggedIn();
    expect((await c.post('/profile/email/code', { email: 'a@example.test' })).status).toBe(200);
    const again = await c.post('/profile/email/code', { email: 'a@example.test' });
    expect(again.status).toBe(429);
    expect(again.body.code).toBe('EMAIL_CODE_RATE_LIMIT');
    for (let i = 1; i <= 4; i++) {
      ctx.clock.set(new Date(Date.parse(T0) + i * 61_000).toISOString());
      expect((await c.post('/profile/email/code', { email: `a${i}@example.test` })).status).toBe(200);
    }
    ctx.clock.set(new Date(Date.parse(T0) + 10 * 61_000).toISOString());
    expect((await c.post('/profile/email/code', { email: 'z@example.test' })).status).toBe(429);
    expect(mail).toHaveBeenCalledTimes(5);
    ctx.clock.set(new Date(Date.parse(T0) + 3_601_000).toISOString());
    expect((await c.post('/profile/email/code', { email: 'z@example.test' })).status).toBe(200);
  });

  it('cambio dal profilo: l’indirizzo attuale resta in uso fino alla conferma del nuovo', async () => {
    const c = await onboardedUser(ctx, 'mario.rossi');
    const mail = mailSpy(ctx);
    ctx.clock.set('2026-11-16T07:05:00.000Z');
    const r = await c.post('/profile/email/code', { email: 'nuova@example.test' });
    expect(r.body).toMatchObject({ email: 'mario.rossi@example.test', pendingEmail: 'nuova@example.test' });
    expect((await c.get('/profile')).body.email.email).toBe('mario.rossi@example.test');

    // annullamento del cambio
    expect((await c.delete('/profile/email/pending')).body.pendingEmail).toBeNull();

    ctx.clock.set('2026-11-16T07:07:00.000Z');
    await c.post('/profile/email/code', { email: 'nuova@example.test' });
    const conf = await c.post('/profile/email/confirm', { code: lastCodeFor(mail, 'nuova@example.test') });
    expect(conf.body).toMatchObject({ email: 'nuova@example.test', pendingEmail: null });
  });

  it('le notifiche email vanno solo all’indirizzo verificato e solo con il consenso', async () => {
    const driver = await onboardedUser(ctx, 'mario.rossi', { emailNotifications: true });
    const passenger = await onboardedUser(ctx, 'laura.bianchi');
    const trip = await createTrip(ctx, driver);
    resetSpies(ctx); // notify reale (inline nei test)
    const mail = mailSpy(ctx);
    await passenger.post(`/trips/${trip.id}/requests`, { boardingComune: trip.stops[1]!.comuneIstat });
    const sent = mail.mock.calls.map((x) => x[0]);
    expect(sent.map((m) => m.to)).toEqual(['mario.rossi@example.test']);
    expect(sent[0]!.text).not.toContain('Laura'); // testo generico

    // Senza consenso (laura) nessuna email.
    mail.mockClear();
    const pid = (await driver.get(`/trips/${trip.id}`)).body.participants[0].id;
    await driver.post(`/trips/${trip.id}/participants/${pid}/accept`);
    expect(mail).not.toHaveBeenCalled();
  });

  it('alla disattivazione l’email e le verifiche in corso vengono cancellate', async () => {
    const c = await onboardedUser(ctx, 'mario.rossi');
    ctx.clock.set('2026-11-16T07:05:00.000Z');
    await c.post('/profile/email/code', { email: 'altra@example.test' });
    await ctx.app.get(UserLifecycleService).deactivate(c.userId);
    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { id: c.userId } });
    expect(u.emailEnc).toBeNull();
    expect(u.emailVerifiedAt).toBeNull();
    expect(await ctx.prisma.emailVerification.count()).toBe(0);
  });

  it('le verifiche non completate si cancellano dopo 24 ore', async () => {
    const c = await loggedIn();
    await c.post('/profile/email/code', { email: 'mai.confermata@example.test' });
    const svc = ctx.app.get(EmailVerificationService);
    ctx.clock.set('2026-11-17T06:59:00.000Z');
    expect(await svc.purgeStale()).toBe(0);
    ctx.clock.set('2026-11-17T07:00:01.000Z');
    expect(await svc.purgeStale()).toBe(1);
    expect(await ctx.prisma.emailVerification.count()).toBe(0);
  });

  it('indirizzi e codici non compaiono mai nei log', async () => {
    const mail = mailSpy(ctx);
    const c = await loggedIn();
    await c.post('/profile/email/code', { email: 'segreta.persona@example.test' });
    const code = lastCodeFor(mail, 'segreta.persona@example.test');
    await c.post('/profile/email/confirm', { code: code === '000000' ? '111111' : '000000' });
    await c.post('/profile/email/confirm', { code });
    const all = logs.join('\n');
    expect(logs.length).toBeGreaterThan(0);
    expect(all).not.toContain('segreta.persona');
    expect(all).not.toMatch(new RegExp(`(?<!\\d)${code}(?!\\d)`)); // (i timestamp contengono altre cifre)
  });
});
