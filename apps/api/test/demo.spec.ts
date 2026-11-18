import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiClient, createTestApp, mailSpy, resetDb, type TestContext } from './helpers.js';

const INDEX = '<!doctype html><html lang="it"><head><title>App</title></head><body><app-root></app-root></body></html>';

function fakeWebBuild(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fcs-web-'));
  writeFileSync(join(dir, 'index.html'), INDEX);
  writeFileSync(join(dir, 'main-ABCDEFGH.js'), 'console.log(1)');
  writeFileSync(join(dir, 'ngsw-worker.js'), '// sw');
  mkdirSync(join(dir, 'icons'));
  writeFileSync(join(dir, 'icons', 'icon-192.png'), 'png');
  return dir;
}

describe('Modalità demo', () => {
  let ctx: TestContext;
  let web: string;

  beforeAll(async () => {
    web = fakeWebBuild();
    // Database senza utenti, come al primo avvio della demo.
    const plain = await createTestApp();
    await resetDb(plain.prisma);
    await plain.app.close();
    ctx = await createTestApp({ DEMO_MODE: 'true', WEB_DIST_DIR: web });
  });
  afterAll(async () => {
    await resetDb(ctx.prisma);
    await ctx.app.close();
    rmSync(web, { recursive: true, force: true });
  });

  it('al primo avvio (DB senza utenti) carica i dati di esempio', async () => {
    const users = await ctx.prisma.user.findMany({ select: { username: true } });
    expect(users.map((u) => u.username).sort()).toEqual(['admin', 'anna.neri', 'giuseppe.verdi', 'laura.bianchi', 'mario.rossi']);
    const future = await ctx.prisma.trip.count({ where: { arrivalAt: { gt: new Date() }, status: 'SCHEDULED' } });
    const closed = await ctx.prisma.trip.count({ where: { status: 'CLOSED' } });
    expect(future).toBeGreaterThan(0);
    expect(closed).toBeGreaterThan(0);
  });

  it('configurazione pubblica: demo, utenze di prova e password', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body.demo).toBe(true);
    expect(res.body.demoPassword).toBe('demo');
    expect(res.body.demoAccounts.map((a: { username: string }) => a.username)).toContain('paolo.gialli');
  });

  it('health check pubblico', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('esclusa dai motori di ricerca: robots.txt, header e meta noindex', async () => {
    const http = request(ctx.app.getHttpServer());
    const robots = await http.get('/robots.txt');
    expect(robots.text).toContain('Disallow: /');
    const api = await http.get('/api/config');
    expect(api.headers['x-robots-tag']).toBe('noindex, nofollow');
    const page = await http.get('/viaggi/123');
    expect(page.status).toBe(200);
    expect(page.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(page.text).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it('serve la PWA dalla stessa origine: fallback SPA, cache e CSP per le pagine', async () => {
    const http = request(ctx.app.getHttpServer());
    const page = await http.get('/profilo');
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.headers['cache-control']).toBe('no-cache');
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");
    const hashed = await http.get('/main-ABCDEFGH.js');
    expect(hashed.headers['cache-control']).toContain('immutable');
    const sw = await http.get('/ngsw-worker.js');
    expect(sw.headers['cache-control']).toBe('no-cache');
    const icon = await http.get('/icons/icon-192.png');
    expect(icon.status).toBe(200);
    expect((await http.get('/manca.js')).status).toBe(404);
    // Le API restano JSON con la loro CSP restrittiva, anche per percorsi inesistenti.
    const missing = await http.get('/api/non-esiste');
    expect(missing.status).toBe(404);
    expect(missing.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('i codici di verifica email compaiono nella risposta e nessuna email viene inviata', async () => {
    const mail = mailSpy(ctx);
    const c = await new ApiClient(ctx.app).init();
    expect((await c.login('paolo.gialli')).status).toBe(204);
    const req = await c.post('/profile/email/code', { email: 'paolo@example.test' });
    expect(req.status).toBe(200);
    expect(req.body.demoCode).toMatch(/^\d{6}$/);
    expect(mail).not.toHaveBeenCalled();
    const ok = await c.post('/profile/email/confirm', { code: req.body.demoCode });
    expect(ok.status).toBe(200);
    expect(ok.body.email).toBe('paolo@example.test');
  });

  it('ripristino: solo admin globali; riporta lo stato iniziale e chiude le sessioni', async () => {
    const mario = await new ApiClient(ctx.app).init();
    await mario.login('mario.rossi');
    expect((await mario.post('/admin/demo/reset')).status).toBe(403);

    const admin = await new ApiClient(ctx.app).init();
    await admin.login('admin');
    await ctx.prisma.site.create({ data: { name: 'Sede aggiunta', address: 'Via X', comuneIstat: '015146' } });
    await ctx.prisma.setting.create({ data: { key: 'reminderEveningHour', value: 18 } });

    const res = await admin.post('/admin/demo/reset');
    expect(res.status).toBe(204);
    expect(await ctx.prisma.user.findUnique({ where: { username: 'paolo.gialli' } })).toBeNull();
    expect(await ctx.prisma.site.findUnique({ where: { name: 'Sede aggiunta' } })).toBeNull();
    expect(await ctx.prisma.setting.count()).toBe(0);
    expect((await admin.get('/me')).status).toBe(401);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'DEMO_RESET' } })).toBe(1);
  });
});

describe('Fuori dalla modalità demo', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('niente codice nella risposta, niente ripristino, configurazione senza utenze di prova', async () => {
    await resetDb(ctx.prisma);
    const cfg = await request(ctx.app.getHttpServer()).get('/api/config');
    expect(cfg.body).toEqual({ demo: false, demoAccounts: [], demoPassword: null });
    expect(cfg.headers['x-robots-tag']).toBeUndefined();

    const c = await new ApiClient(ctx.app).init();
    await c.login('admin');
    const req = await c.post('/profile/email/code', { email: 'admin@example.test' });
    expect(req.status).toBe(200);
    expect(req.body.demoCode).toBeUndefined();
    await resetDb(ctx.prisma);
  });
});
