import { Writable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_PROVIDER, IdentityProviderUnavailableError, type IdentityProvider } from '../src/auth/identity-provider.js';
import { setLogDestination } from '../src/logging.js';
import { ApiClient, createTestApp, createTrip, onboardedUser, resetDb, resetSpies, type TestContext } from './helpers.js';

/** Password "riconoscibile" da cercare in log e risposte. */
const SECRET = 'S3gr3t0-Unico-Da-Non-Loggare!';

describe('Autenticazione e gestione delle credenziali', () => {
  let ctx: TestContext;
  let idp: IdentityProvider;
  const logs: string[] = [];

  beforeAll(async () => {
    // Si catturano TUTTI i log (livello trace) per verificare che la password non compaia mai.
    setLogDestination(
      new Writable({
        write(chunk, _enc, cb) {
          logs.push(String(chunk));
          cb();
        },
      }),
    );
    ctx = await createTestApp({ LOG_LEVEL: 'trace' });
    idp = ctx.app.get(IDENTITY_PROVIDER);
  });

  afterAll(async () => {
    setLogDestination(undefined);
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    resetSpies(ctx);
    logs.length = 0;
  });

  it('login valido: cookie di sessione httpOnly + SameSite, nessun dato nel corpo', async () => {
    const c = await new ApiClient(ctx.app).init();
    const res = await c.login('mario.rossi');
    expect(res.status).toBe(204);
    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((x) => x.startsWith('sid='));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect((await c.get('/me')).body.firstName).toBe('Mario');
  });

  it('login senza token CSRF viene rifiutato', async () => {
    const c = await new ApiClient(ctx.app).init();
    const res = await c.agent.post('/api/auth/login').send({ username: 'mario.rossi', password: 'demo' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF');
  });

  it('credenziali errate: messaggio generico, nessuna distinzione utente inesistente/password errata', async () => {
    const c = await new ApiClient(ctx.app).init();
    const a = await c.login('mario.rossi', 'sbagliata');
    const b = await c.login('utente.inesistente', 'sbagliata');
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body).toEqual(b.body);
  });

  it('dopo 3 errori sullo username il login è bloccato PRIMA di contattare AD (anche con password giusta)', async () => {
    const spy = vi.spyOn(idp, 'authenticate');
    const c = await new ApiClient(ctx.app).init();
    for (let i = 0; i < 3; i++) expect((await c.login('laura.bianchi', 'x')).status).toBe(401);
    expect(spy).toHaveBeenCalledTimes(3);

    const blocked = await c.login('laura.bianchi', 'demo');
    expect(blocked.status).toBe(429);
    expect(spy).toHaveBeenCalledTimes(3); // la richiesta non è arrivata al sistema di identità

    // Un altro utente dallo stesso IP non è bloccato.
    expect((await c.login('mario.rossi')).status).toBe(204);
  });

  it('il blocco per username vale anche da IP diversi', async () => {
    const c = await new ApiClient(ctx.app).init();
    for (let i = 0; i < 3; i++) await c.login('anna.neri', 'x');
    const other = await new ApiClient(ctx.app).init();
    // stesso processo di test → stesso IP; si verifica comunque che la chiave sia per username
    const rows = await ctx.prisma.loginThrottle.findMany();
    expect(rows.some((r) => r.key.startsWith('u:') && r.lockedUntil)).toBe(true);
    expect(rows.every((r) => !r.key.includes('anna'))).toBe(true); // chiavi pseudonimizzate
    expect((await other.login('anna.neri')).status).toBe(429);
  });

  it('blocco per IP dopo troppi errori su username diversi', async () => {
    await ctx.app.close();
    ctx = await createTestApp({ LOGIN_MAX_FAILURES_PER_IP: '4', LOG_LEVEL: 'trace' });
    idp = ctx.app.get(IDENTITY_PROVIDER);
    const c = await new ApiClient(ctx.app).init();
    for (const u of ['a1', 'a2', 'a3', 'a4']) expect((await c.login(u, 'x')).status).toBe(401);
    expect((await c.login('mario.rossi')).status).toBe(429);
    await ctx.app.close();
    ctx = await createTestApp({ LOG_LEVEL: 'trace' });
    idp = ctx.app.get(IDENTITY_PROVIDER);
  });

  it('la password non compare MAI in log, risposte o errori (successo, errore, sistema giù, eccezione imprevista)', async () => {
    const c = await new ApiClient(ctx.app).init();
    const responses: string[] = [];

    // 1. credenziali errate
    responses.push(JSON.stringify((await c.login('mario.rossi', SECRET)).body));
    // 2. sistema di identità non raggiungibile
    vi.spyOn(idp, 'authenticate').mockRejectedValueOnce(new IdentityProviderUnavailableError('timeout'));
    responses.push(JSON.stringify((await c.login('giuseppe.verdi', SECRET)).body));
    // 3. adapter difettoso che include la password nel messaggio d'errore
    vi.spyOn(idp, 'authenticate').mockRejectedValueOnce(new Error(`errore con ${SECRET}`));
    const r3 = await c.login('paolo.gialli', SECRET);
    responses.push(JSON.stringify(r3.body));
    expect(r3.status).toBe(503);
    // 4. validazione fallita (username non valido)
    responses.push(JSON.stringify((await c.post('/auth/login', { username: 'x*', password: SECRET })).body));

    const all = logs.join('\n') + responses.join('\n');
    expect(logs.length).toBeGreaterThan(0);
    expect(all).not.toContain(SECRET);
    // Nei log non compaiono nemmeno gli username in chiaro.
    expect(logs.join('\n')).not.toContain('giuseppe.verdi');
  });

  it('dipendente non più attivo: accesso negato, disattivazione, viaggi futuri annullati con notifica', async () => {
    const driver = await onboardedUser(ctx, 'mario.rossi');
    const passenger = await onboardedUser(ctx, 'laura.bianchi');
    const trip = await createTrip(ctx, driver);
    await passenger.post(`/trips/${trip.id}/requests`, { boardingComune: trip.stops[1]!.comuneIstat });
    const pid = (await driver.get(`/trips/${trip.id}`)).body.participants[0].id;
    await driver.post(`/trips/${trip.id}/participants/${pid}/accept`);

    // L'API aziendale ora dice che mario.rossi non è più attivo.
    vi.spyOn(idp, 'authenticate').mockResolvedValueOnce({ active: false, firstName: 'Mario', lastName: 'Rossi' });
    const relog = await new ApiClient(ctx.app).init();
    expect((await relog.login('mario.rossi')).status).toBe(401);

    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { username: 'mario.rossi' } });
    expect(user.status).toBe('PENDING_DELETION');
    expect(await ctx.prisma.session.count({ where: { userId: user.id } })).toBe(0);
    expect((await driver.get('/me')).status).toBe(401); // sessione precedente revocata
    const t = await ctx.prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });
    expect(t.status).toBe('CANCELLED');
    expect(ctx.notify).toHaveBeenCalledWith([passenger.userId], 'TRIP_CANCELLED', trip.id);
  });

  it('sessione scaduta (durata massima) richiede un nuovo login', async () => {
    const c = await onboardedUser(ctx, 'mario.rossi');
    await ctx.prisma.session.updateMany({ data: { absoluteExpiresAt: new Date(Date.now() - 1000) } });
    expect((await c.get('/me')).status).toBe(401);
  });

  it('il primo admin globale è assegnato da variabile d’ambiente', async () => {
    const c = await new ApiClient(ctx.app).init();
    await c.login('admin');
    expect((await c.get('/me')).body.roles).toEqual([{ role: 'GLOBAL_ADMIN', siteId: null }]);
  });

  it('prima dell’onboarding ogni trattamento oltre al login è bloccato', async () => {
    const c = await new ApiClient(ctx.app).init();
    await c.login('mario.rossi');
    const r = await c.get('/trips/mine');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('ONBOARDING_REQUIRED');
  });

  it('una nuova versione dell’informativa richiede una nuova presa visione', async () => {
    const c = await onboardedUser(ctx, 'mario.rossi');
    expect((await c.get('/trips/mine')).status).toBe(200);
    const doc = await ctx.prisma.policyDocument.create({
      data: { type: 'PRIVACY_NOTICE', version: 99, title: 'Informativa v99', content: 'testo' },
    });
    try {
      ctx.app.get((await import('../src/policies/policies.service.js')).PoliciesService).invalidate();
      expect((await c.get('/trips/mine')).status).toBe(403);
      expect((await c.get('/me')).body.pendingPolicyIds).toEqual([doc.id]);
      await c.post('/policies/accept', { policyIds: [doc.id] });
      expect((await c.get('/trips/mine')).status).toBe(200);
      const acc = await ctx.prisma.policyAcceptance.findFirstOrThrow({ where: { documentId: doc.id } });
      expect(acc.acceptedAt).toBeInstanceOf(Date);
    } finally {
      await ctx.prisma.policyAcceptance.deleteMany({ where: { documentId: doc.id } });
      await ctx.prisma.policyDocument.delete({ where: { id: doc.id } });
      ctx.app.get((await import('../src/policies/policies.service.js')).PoliciesService).invalidate();
    }
  });
});
