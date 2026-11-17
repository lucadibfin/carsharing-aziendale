import { loadBrand } from '@fcs/brand';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AdminRoleDto, AdminTripDto, AuditPageDto, DashboardDto, Settings, TripDetailDto } from '@fcs/shared';
import { SettingsService } from '../src/settings/settings.service.js';
import { COMUNI, createTestApp, createTrip, onboardedUser, resetDb, resetSpies, type ApiClient, type TestContext } from './helpers.js';

describe('Area amministrativa', () => {
  let ctx: TestContext;
  let admin: ApiClient; // admin globale (INITIAL_GLOBAL_ADMIN)
  let mario: ApiClient;
  let laura: ApiClient;
  let anna: ApiClient;
  let site0: string;
  let site1: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    site0 = ctx.sites[0]!.id;
    site1 = ctx.sites[1]!.id;
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    resetSpies(ctx);
    ctx.app.get(SettingsService).invalidate();
    ctx.clock.set('2026-11-16T07:00:00.000Z');
    admin = await onboardedUser(ctx, 'admin');
    mario = await onboardedUser(ctx, 'mario.rossi');
    laura = await onboardedUser(ctx, 'laura.bianchi');
    anna = await onboardedUser(ctx, 'anna.neri');
  });

  async function makeSiteAdmin(who: ApiClient, siteId: string): Promise<AdminRoleDto[]> {
    const r = await admin.post('/admin/roles', { userId: who.userId, role: 'SITE_ADMIN', siteId });
    expect(r.status).toBe(201);
    return r.body;
  }

  async function join(trip: TripDetailDto, who: ApiClient): Promise<string> {
    await who.post(`/trips/${trip.id}/requests`, { boardingComune: COMUNI.MONZA });
    const pid = ((await mario.get(`/trips/${trip.id}`)).body as TripDetailDto).participants.find((p) => p.user.id === who.userId)!.id;
    await mario.post(`/trips/${trip.id}/participants/${pid}/accept`);
    return pid;
  }

  describe('permessi', () => {
    it('utente normale: 403 su tutta l’area; admin di sede: niente configurazione globale', async () => {
      for (const url of ['/admin/dashboard', '/admin/trips', '/admin/reports', '/admin/settings', '/admin/audit']) {
        expect((await laura.get(url)).status).toBe(403);
      }
      await makeSiteAdmin(laura, site0);
      expect((await laura.get('/admin/dashboard')).status).toBe(200);
      expect((await laura.get('/admin/trips')).status).toBe(200);
      for (const url of ['/admin/settings', '/admin/roles', '/admin/sites', '/admin/policies', '/admin/audit']) {
        expect((await laura.get(url)).status).toBe(403);
      }
      expect((await laura.post('/admin/roles', { userId: anna.userId, role: 'GLOBAL_ADMIN' })).status).toBe(403);
    });

    it('la revoca del ruolo ha effetto immediato', async () => {
      const roles = await makeSiteAdmin(laura, site0);
      const roleId = roles.find((r) => r.user.id === laura.userId)!.id;
      expect((await laura.get('/admin/dashboard')).status).toBe(200);
      expect((await admin.delete(`/admin/roles/${roleId}`)).status).toBe(200);
      expect((await laura.get('/admin/dashboard')).status).toBe(403);
    });

    it('resta sempre almeno un admin globale', async () => {
      const roles = (await admin.get('/admin/roles')).body as AdminRoleDto[];
      const mine = roles.find((r) => r.user.id === admin.userId && r.role === 'GLOBAL_ADMIN')!;
      expect((await admin.delete(`/admin/roles/${mine.id}`)).body.code).toBe('LAST_GLOBAL_ADMIN');
      expect((await admin.post('/admin/roles', { userId: anna.userId, role: 'GLOBAL_ADMIN' })).status).toBe(201);
      expect((await admin.post('/admin/roles', { userId: anna.userId, role: 'GLOBAL_ADMIN' })).status).toBe(409);
      expect((await admin.post('/admin/roles', { userId: anna.userId, role: 'SITE_ADMIN' })).status).toBe(400); // manca la sede
      expect((await admin.delete(`/admin/roles/${mine.id}`)).status).toBe(200);
      expect((await admin.get('/admin/roles')).status).toBe(403);
    });
  });

  describe('viaggi e dashboard', () => {
    beforeEach(async () => {
      const pub = await createTrip(ctx, mario);
      const p = await join(pub, laura);
      await join(pub, anna);
      await createTrip(ctx, mario, { visibility: 'PRIVATE', arrivalTime: '09:00' });
      const cancelled = await createTrip(ctx, mario, { date: '2026-11-21' });
      await mario.post(`/trips/${cancelled.id}/cancel`);
      await createTrip(ctx, mario, { siteId: site1, arrivalTime: '10:00' });
      ctx.clock.set('2026-11-20T09:00:00.000Z');
      await mario.post(`/trips/${pub.id}/close`, { presentParticipantIds: [p] }); // Laura presente, Anna no
    });

    it('elenco viaggi: filtri per stato e sede, nessun nome né comune', async () => {
      // Periodo di default: dall'inizio dell'anno a oggi (20/11), quindi senza il viaggio del 21/11.
      expect((await admin.get('/admin/trips')).body).toHaveLength(3);
      const all = (await admin.get('/admin/trips').query({ to: '2026-11-30' })).body as AdminTripDto[];
      expect(all).toHaveLength(4);
      const closed = (await admin.get('/admin/trips').query({ state: 'closed' })).body as AdminTripDto[];
      expect(closed).toHaveLength(1);
      expect(closed[0]).toMatchObject({ status: 'CLOSED', seatsTaken: 2, passengersPresent: 1, stopsCount: 3 });
      expect((await admin.get('/admin/trips').query({ state: 'awaiting' })).body).toHaveLength(2);
      expect((await admin.get('/admin/trips').query({ siteId: site1 })).body).toHaveLength(1);
      expect((await admin.get('/admin/trips').query({ from: '2026-11-21', to: '2026-11-21' })).body).toHaveLength(1);
      const json = JSON.stringify(all);
      expect(json).not.toMatch(/Rossi|Bianchi|Mario|Bergamo|Monza|Parcheggio/);
    });

    it('l’admin di sede vede solo la propria sede', async () => {
      await makeSiteAdmin(laura, site1);
      expect(((await laura.get('/admin/trips')).body as AdminTripDto[]).map((t) => t.siteId)).toEqual([site1]);
      expect((await laura.get('/admin/trips').query({ siteId: site0 })).status).toBe(403);
      expect((await laura.get('/admin/dashboard').query({ siteId: site0 })).status).toBe(403);
      const d = (await laura.get('/admin/dashboard')).body as DashboardDto;
      expect(d.bySite.map((s) => s.siteId)).toEqual([site1]);
    });

    it('dashboard aggregata: proposti, completati, annullati, riempimento, risparmi', async () => {
      const d = (await admin.get('/admin/dashboard').query({ from: '2026-11-01', to: '2026-11-30' })).body as DashboardDto;
      expect(d.totals).toMatchObject({
        registeredUsers: 4,
        activeUsers: 4,
        proposed: { public: 3, private: 1 },
        completed: { public: 1, private: 0 },
        cancelled: 1,
        passengers: 1,
        fillRate: 0.333,
        estimatedTrips: 1,
        incompleteTrips: 0,
      });
      expect(d.totals.co2SavedKg).toBeGreaterThan(0);
      expect(d.totals.fuelSaved[0]!.unit).toBe('L');
      const s0 = d.bySite.find((s) => s.siteId === site0)!;
      expect(s0.proposed).toEqual({ public: 2, private: 1 });
      // Periodo senza viaggi.
      const empty = (await admin.get('/admin/dashboard').query({ from: '2026-01-01', to: '2026-01-31' })).body as DashboardDto;
      expect(empty.totals).toMatchObject({ proposed: { public: 0, private: 0 }, fillRate: null, activeUsers: 0 });
      expect((await admin.get('/admin/dashboard').query({ from: '2026-12-01', to: '2026-11-01' })).status).toBe(400);
    });
  });

  describe('configurazione (admin globale)', () => {
    it('parametri: validazione, effetto immediato, audit con le sole chiavi modificate', async () => {
      const s = (await admin.get('/admin/settings')).body as Settings;
      expect(s.cancellationDeadlineHours).toBe(2);
      expect((await admin.put('/admin/settings', { ...s, cancellationDeadlineHours: 500 })).status).toBe(400);
      const updated = (await admin.put('/admin/settings', { ...s, cancellationDeadlineHours: 12 })).body as Settings;
      expect(updated.cancellationDeadlineHours).toBe(12);
      const trip = await createTrip(ctx, mario);
      await join(trip, laura);
      // Arrivo 20/11 alle 08:30: alle 23:00 del 19/11 mancano 9 ore e mezza, meno delle 12 di scadenza.
      ctx.clock.set('2026-11-19T22:00:00.000Z');
      expect(((await laura.get(`/trips/${trip.id}`)).body as TripDetailDto).canCancelWithoutPenalty).toBe(false);
      const row = await ctx.prisma.auditLog.findFirstOrThrow({ where: { action: 'ADMIN_SETTINGS_UPDATE' }, orderBy: { id: 'desc' } });
      expect(row).toMatchObject({ actorId: admin.userId, meta: { changed: ['cancellationDeadlineHours'] } });
    });

    it('sedi: creazione, nome univoco, coordinate che azzerano la cache delle distanze', async () => {
      const created = await admin.post('/admin/sites', { name: 'Sede di Bergamo', address: 'Via Prova 1', comuneIstat: COMUNI.BERGAMO });
      expect(created.status).toBe(201);
      expect((await admin.post('/admin/sites', { name: 'Sede di Bergamo', address: 'Via Prova 2', comuneIstat: COMUNI.BERGAMO })).status).toBe(409);
      await ctx.prisma.distanceCache.create({
        data: { comuneIstat: COMUNI.MONZA, siteId: site0, meters: 1, source: 'ROUTED', computedAt: new Date() },
      });
      expect((await admin.patch(`/admin/sites/${site0}`, { lat: 45.48, lon: 9.2 })).status).toBe(200);
      expect(await ctx.prisma.distanceCache.count({ where: { siteId: site0 } })).toBe(0);
      expect((await admin.patch(`/admin/sites/${site0}`, { lat: 60 })).status).toBe(400); // fuori dall'Italia
      // Ripristino: le sedi non vengono svuotate tra un test e l'altro.
      await admin.patch(`/admin/sites/${site0}`, { lat: null, lon: null });
      await ctx.prisma.site.delete({ where: { name: 'Sede di Bergamo' } });
    });

    it('testi legali: una nuova versione richiede una nuova presa visione a tutti', async () => {
      const content = 'Nuova informativa di prova di {{ragioneSociale}} per {{nomeApp}}. '.repeat(3);
      const r = await admin.post('/admin/policies', { type: 'PRIVACY_NOTICE', title: 'Informativa privacy', content });
      expect(r.status).toBe(201);
      const v = r.body.find((p: { type: string; version: number }) => p.type === 'PRIVACY_NOTICE' && p.version === 2);
      expect(v).toBeTruthy();
      // L'amministratore vede (e modifica) i segnaposto; gli utenti leggono i dati del marchio.
      expect(v.content).toContain('{{nomeApp}}');
      const shown = (await mario.get('/policies/current')).body.find((p: { id: string }) => p.id === v.id);
      expect(shown.content).toContain(loadBrand('default').config.appName);
      expect(shown.content).toContain('[DA COMPILARE: ragione sociale]');
      expect(shown.content).not.toContain('{{');
      expect((await mario.get('/me')).body.onboardingRequired).toBe(true);
      expect((await mario.get('/trips/mine')).status).toBe(403);
      await mario.post('/policies/accept', { policyIds: [v.id] });
      expect((await mario.get('/trips/mine')).status).toBe(200);
    });

    it('audit log: consultazione con autori, paginazione e verifica della catena', async () => {
      await admin.get('/admin/dashboard');
      await admin.get('/admin/users/search').query({ q: 'Bianchi' });
      const page = (await admin.get('/admin/audit')).body as AuditPageDto;
      const search = page.entries.find((e) => e.action === 'ADMIN_USER_SEARCH')!;
      expect(search.actor).toMatchObject({ id: admin.userId, lastName: 'Demo' });
      // Il testo cercato (un nome) non viene registrato.
      expect(JSON.stringify(page.entries)).not.toContain('Bianchi');
      const only = (await admin.get('/admin/audit').query({ action: 'ADMIN_DASHBOARD_VIEW' })).body as AuditPageDto;
      expect(only.entries.every((e) => e.action === 'ADMIN_DASHBOARD_VIEW')).toBe(true);
      const v = await admin.post('/admin/audit/verify');
      expect(v.body).toMatchObject({ ok: true, brokenAtId: null });
    });
  });
});
