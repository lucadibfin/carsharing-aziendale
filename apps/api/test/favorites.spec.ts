import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TripDetailDto } from '@fcs/shared';
import { COMUNI, createTestApp, createTrip, onboardedUser, pushSpy, resetDb, resetSpies, type ApiClient, type TestContext } from './helpers.js';

describe('Colleghi preferiti', () => {
  let ctx: TestContext;
  let mario: ApiClient;
  let laura: ApiClient;
  let anna: ApiClient;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    resetSpies(ctx);
    ctx.clock.set('2026-11-16T07:00:00.000Z');
    mario = await onboardedUser(ctx, 'mario.rossi', { discoverable: true });
    laura = await onboardedUser(ctx, 'laura.bianchi'); // non trovabile
    anna = await onboardedUser(ctx, 'anna.neri', { optionalNotifications: true }); // sede 0, comune Monza
  });

  const favNotifications = () => ctx.notify.mock.calls.filter((c: unknown[]) => c[1] === 'FAVORITE_NEW_TRIP');

  describe('chi si può aggiungere', () => {
    it('un collega trovabile sì; uno non trovabile e mai incontrato no (404 come se non esistesse)', async () => {
      expect((await anna.put(`/favorites/${mario.userId}`)).status).toBe(200);
      expect((await anna.put(`/favorites/${laura.userId}`)).status).toBe(404);
      expect((await anna.put('/favorites/00000000-0000-4000-8000-000000000000')).status).toBe(404);
      expect((await anna.put(`/favorites/${anna.userId}`)).status).toBe(400);
      const list = (await anna.get('/favorites')).body;
      expect(list).toEqual([{ id: mario.userId, firstName: 'Mario', lastName: 'Rossi', siteName: ctx.sites[0]!.name }]);
    });

    it('dopo un viaggio condiviso e confermato si può aggiungere anche chi non è trovabile', async () => {
      const trip = await createTrip(ctx, laura);
      await anna.post(`/trips/${trip.id}/requests`, { boardingComune: COMUNI.MONZA });
      expect((await anna.put(`/favorites/${laura.userId}`)).status).toBe(404); // richiesta non ancora accettata
      const pid = ((await laura.get(`/trips/${trip.id}`)).body as TripDetailDto).participants[0]!.id;
      await laura.post(`/trips/${trip.id}/participants/${pid}/accept`);
      expect((await anna.put(`/favorites/${laura.userId}`)).status).toBe(200);
      // E viceversa.
      expect((await laura.put(`/favorites/${anna.userId}`)).status).toBe(200);
    });

    it('il collega non vede chi lo ha tra i preferiti; la rimozione funziona', async () => {
      await anna.put(`/favorites/${mario.userId}`);
      expect((await mario.get('/favorites')).body).toEqual([]);
      expect((await anna.delete(`/favorites/${mario.userId}`)).body).toEqual([]);
    });
  });

  describe('avviso per un nuovo viaggio di un preferito', () => {
    beforeEach(async () => {
      await anna.put(`/favorites/${mario.userId}`);
    });

    it('viaggio pubblico, stessa sede, passa dal mio comune: avviso (push solo con il consenso)', async () => {
      const push = pushSpy(ctx);
      const trip = await createTrip(ctx, mario); // Bergamo → Monza → Sesto
      expect(favNotifications()).toEqual([[[anna.userId], 'FAVORITE_NEW_TRIP', trip.id]]);
      expect(push.mock.calls.map((c) => c[0])).toContain(anna.userId);
      const payload = push.mock.calls.find((c) => c[0] === anna.userId)![1];
      expect(JSON.stringify(payload)).not.toMatch(/Mario|Rossi/);
    });

    it('nessun avviso push senza consenso alle notifiche facoltative', async () => {
      await anna.patch('/profile/consents', { optionalNotifications: false });
      const push = pushSpy(ctx);
      await createTrip(ctx, mario);
      expect(push.mock.calls.map((c) => c[0])).not.toContain(anna.userId);
    });

    it('nessun avviso se il viaggio non passa dal mio comune o è per un’altra sede', async () => {
      await createTrip(ctx, mario, { departureComune: COMUNI.BERGAMO, viaComuni: [COMUNI.SESTO_SG] });
      await createTrip(ctx, mario, { siteId: ctx.sites[1]!.id, arrivalTime: '09:00' });
      expect(favNotifications()).toHaveLength(0);
    });

    it('viaggio privato: nessun avviso; diventato pubblico: un solo avviso anche se cambia più volte', async () => {
      const trip = await createTrip(ctx, mario, { visibility: 'PRIVATE' });
      expect(favNotifications()).toHaveLength(0);
      await mario.patch(`/trips/${trip.id}/visibility`, { visibility: 'PUBLIC' });
      await mario.patch(`/trips/${trip.id}/visibility`, { visibility: 'PRIVATE' });
      await mario.patch(`/trips/${trip.id}/visibility`, { visibility: 'PUBLIC' });
      expect(favNotifications()).toEqual([[[anna.userId], 'FAVORITE_NEW_TRIP', trip.id]]);
    });
  });
});
