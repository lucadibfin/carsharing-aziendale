import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TripDetailDto } from '@fcs/shared';
import { COMUNI, createTestApp, createTrip, onboardedUser, resetDb, resetSpies, type ApiClient, type TestContext } from './helpers.js';

describe('Viaggi: visibilità, permessi, posti, cancellazioni, chiusura', () => {
  let ctx: TestContext;
  let driver: ApiClient;
  let laura: ApiClient;
  let giuseppe: ApiClient;
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
    driver = await onboardedUser(ctx, 'mario.rossi', { phoneVisible: true });
    laura = await onboardedUser(ctx, 'laura.bianchi', { phoneVisible: true, discoverable: true });
    giuseppe = await onboardedUser(ctx, 'giuseppe.verdi');
    anna = await onboardedUser(ctx, 'anna.neri');
    await driver.patch('/profile', { phone: '+39 333 1111111' });
    await laura.patch('/profile', { phone: '+39 333 2222222' });
  });

  const search = (c: ApiClient, extra: Record<string, string> = {}) =>
    c.get('/trips/search').query({ siteId: ctx.sites[0]!.id, date: '2026-11-20', ...extra });

  async function requestAndAccept(trip: TripDetailDto, who: ApiClient): Promise<string> {
    const r = await who.post(`/trips/${trip.id}/requests`, { boardingComune: COMUNI.MONZA });
    expect(r.status).toBe(201);
    const pid = (await driver.get(`/trips/${trip.id}`)).body.participants.find(
      (p: { user: { id: string } }) => p.user.id === who.userId,
    ).id as string;
    expect((await driver.post(`/trips/${trip.id}/participants/${pid}/accept`)).status).toBe(200);
    return pid;
  }

  describe('visibilità dei viaggi privati', () => {
    it('un viaggio privato non compare nella ricerca, quello pubblico sì', async () => {
      const pub = await createTrip(ctx, driver, { visibility: 'PUBLIC' });
      const priv = await createTrip(ctx, driver, { visibility: 'PRIVATE', arrivalTime: '09:00' });
      const ids = (await search(laura)).body.map((t: { id: string }) => t.id);
      expect(ids).toContain(pub.id);
      expect(ids).not.toContain(priv.id);
    });

    it('chi non è coinvolto riceve 404 (non 403) su dettaglio, richiesta e chat di un viaggio privato', async () => {
      const priv = await createTrip(ctx, driver, { visibility: 'PRIVATE' });
      const d = await laura.get(`/trips/${priv.id}`);
      expect(d.status).toBe(404);
      const req = await laura.post(`/trips/${priv.id}/requests`, { boardingComune: COMUNI.MONZA });
      expect(req.status).toBe(404);
      expect((await laura.get(`/trips/${priv.id}/chat`)).status).toBe(404);
      // Stessa risposta di un viaggio inesistente: l'esistenza non viene rivelata.
      const missing = await laura.get('/trips/00000000-0000-4000-8000-000000000000');
      expect(d.body).toEqual(missing.body);
    });

    it('l’invitato vede il viaggio privato e può accettare; gli altri continuano a non vederlo', async () => {
      const priv = await createTrip(ctx, driver, { visibility: 'PRIVATE' });
      expect((await driver.post(`/trips/${priv.id}/invitations`, { userId: laura.userId })).status).toBe(201);
      expect((await laura.get(`/trips/${priv.id}`)).status).toBe(200);
      expect((await giuseppe.get(`/trips/${priv.id}`)).status).toBe(404);
      const mine = (await laura.get('/trips/mine')).body;
      expect(mine.pendingInvitations).toHaveLength(1);
      const acc = await laura.post(`/invitations/${mine.pendingInvitations[0].id}/accept`, { boardingComune: COMUNI.MONZA });
      expect(acc.status).toBe(200);
      expect(acc.body.myStatus).toBe('ACCEPTED');
    });

    it('si possono invitare per nome solo i colleghi che hanno attivato la trovabilità', async () => {
      const priv = await createTrip(ctx, driver, { visibility: 'PRIVATE' });
      const found = (await driver.get('/users/search').query({ q: 'bia' })).body;
      expect(found.map((u: { id: string }) => u.id)).toEqual([laura.userId]);
      expect((await driver.get('/users/search').query({ q: 'verdi' })).body).toEqual([]);
      // Anche conoscendo l'id, l'invito a chi non è trovabile viene rifiutato.
      expect((await driver.post(`/trips/${priv.id}/invitations`, { userId: giuseppe.userId })).status).toBe(404);
    });

    it('solo il conducente può cambiare la visibilità; passando a privato le richieste in sospeso sono rifiutate', async () => {
      const trip = await createTrip(ctx, driver);
      await laura.post(`/trips/${trip.id}/requests`, { boardingComune: COMUNI.MONZA });
      await requestAndAccept(trip, giuseppe);
      expect((await giuseppe.patch(`/trips/${trip.id}/visibility`, { visibility: 'PRIVATE' })).status).toBe(403);

      const r = await driver.patch(`/trips/${trip.id}/visibility`, { visibility: 'PRIVATE' });
      expect(r.status).toBe(200);
      expect(r.body.visibility).toBe('PRIVATE');
      const statuses = Object.fromEntries(
        r.body.participants.map((p: { user: { id: string }; status: string }) => [p.user.id, p.status]),
      );
      expect(statuses[laura.userId]).toBe('REJECTED');
      expect(statuses[giuseppe.userId]).toBe('ACCEPTED'); // i confermati restano
      expect(ctx.notify).toHaveBeenCalledWith([laura.userId], 'REQUEST_REJECTED', trip.id);
      expect((await anna.get(`/trips/${trip.id}`)).status).toBe(404);
      expect((await giuseppe.get(`/trips/${trip.id}`)).status).toBe(200);
    });

    it('ricerca filtrata per comune di partenza o di passaggio', async () => {
      const t = await createTrip(ctx, driver);
      expect((await search(laura, { comuneIstat: COMUNI.SESTO_SG })).body.map((x: { id: string }) => x.id)).toEqual([t.id]);
      expect((await search(laura, { comuneIstat: COMUNI.MILANO })).body).toEqual([]);
    });
  });

  describe('gestione dei posti', () => {
    it('accettazioni concorrenti non superano mai i posti disponibili (niente overbooking)', async () => {
      const trip = await createTrip(ctx, driver, { seats: 2 });
      const others = [laura, giuseppe, anna, await onboardedUser(ctx, 'paolo.gialli')];
      for (const o of others) {
        expect((await o.post(`/trips/${trip.id}/requests`, { boardingComune: COMUNI.MONZA })).status).toBe(201);
      }
      const pids = (await driver.get(`/trips/${trip.id}`)).body.participants.map((p: { id: string }) => p.id);
      const results = await Promise.all(pids.map((pid: string) => driver.post(`/trips/${trip.id}/participants/${pid}/accept`)));
      const codes = results.map((r) => r.status).sort();
      expect(codes).toEqual([200, 200, 409, 409]);
      expect(results.filter((r) => r.status === 409).every((r) => r.body.code === 'TRIP_FULL')).toBe(true);
      expect(await ctx.prisma.tripParticipant.count({ where: { tripId: trip.id, status: 'ACCEPTED' } })).toBe(2);
    });

    it('accettazioni concorrenti via link d’invito rispettano i posti', async () => {
      const trip = await createTrip(ctx, driver, { seats: 1, visibility: 'PRIVATE' });
      const { token } = (await driver.post(`/trips/${trip.id}/invitation-links`, { expiresInHours: 24 })).body;
      const results = await Promise.all(
        [laura, giuseppe, anna].map((c) => c.post('/invitation-links/accept', { token, boardingComune: COMUNI.MONZA })),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    });

    it('un viaggio al completo non accetta nuove richieste', async () => {
      const trip = await createTrip(ctx, driver, { seats: 1 });
      await requestAndAccept(trip, laura);
      const r = await giuseppe.post(`/trips/${trip.id}/requests`, { boardingComune: COMUNI.MONZA });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('TRIP_FULL');
    });

    it('il comune di salita deve essere nel percorso; il conducente non può chiedere di partecipare', async () => {
      const trip = await createTrip(ctx, driver);
      expect((await laura.post(`/trips/${trip.id}/requests`, { boardingComune: COMUNI.MILANO })).body.code).toBe('INVALID_BOARDING');
      expect((await driver.post(`/trips/${trip.id}/requests`, { boardingComune: COMUNI.MONZA })).body.code).toBe('OWN_TRIP');
    });

    it('solo il conducente può accettare o rifiutare', async () => {
      const trip = await createTrip(ctx, driver);
      await laura.post(`/trips/${trip.id}/requests`, { boardingComune: COMUNI.MONZA });
      await requestAndAccept(trip, giuseppe);
      const pid = (await driver.get(`/trips/${trip.id}`)).body.participants.find(
        (p: { user: { id: string } }) => p.user.id === laura.userId,
      ).id;
      expect((await giuseppe.post(`/trips/${trip.id}/participants/${pid}/accept`)).status).toBe(403);
    });
  });

  describe('cancellazioni', () => {
    it('cancellazione del partecipante entro la scadenza: posto liberato, conducente avvisato', async () => {
      const trip = await createTrip(ctx, driver, { seats: 1 });
      await requestAndAccept(trip, laura);
      const r = await laura.post(`/trips/${trip.id}/leave`);
      expect(r.body).toEqual({ lateCancel: false });
      expect(ctx.notify).toHaveBeenCalledWith([driver.userId], 'PARTICIPANT_LEFT', trip.id);
      // Il posto si è liberato.
      expect((await giuseppe.post(`/trips/${trip.id}/requests`, { boardingComune: COMUNI.MONZA })).status).toBe(201);
    });

    it('cancellazione oltre la scadenza: consentita ma marcata come tardiva', async () => {
      const trip = await createTrip(ctx, driver); // arrivo 20/11 08:30, scadenza default 2 h prima
      await requestAndAccept(trip, laura);
      ctx.clock.set('2026-11-20T07:00:00.000Z'); // 08:00 a Roma
      expect((await laura.post(`/trips/${trip.id}/leave`)).body).toEqual({ lateCancel: true });
    });

    it('scadenza configurabile dagli admin', async () => {
      await ctx.prisma.setting.create({ data: { key: 'cancellationDeadlineHours', value: 24 } });
      const { SettingsService } = await import('../src/settings/settings.service.js');
      ctx.app.get(SettingsService).invalidate();
      try {
        const trip = await createTrip(ctx, driver);
        await requestAndAccept(trip, laura);
        ctx.clock.set('2026-11-19T12:00:00.000Z'); // meno di 24 h prima
        expect((await laura.post(`/trips/${trip.id}/leave`)).body).toEqual({ lateCancel: true });
      } finally {
        ctx.app.get(SettingsService).invalidate();
      }
    });

    it('annullamento del viaggio da parte del conducente: partecipanti avvisati, viaggio non più modificabile', async () => {
      const trip = await createTrip(ctx, driver);
      await requestAndAccept(trip, laura);
      await giuseppe.post(`/trips/${trip.id}/requests`, { boardingComune: COMUNI.MONZA });
      expect((await laura.post(`/trips/${trip.id}/cancel`)).status).toBe(403);
      expect((await driver.post(`/trips/${trip.id}/cancel`)).status).toBe(204);
      const call = ctx.notify.mock.calls.find((c: unknown[]) => c[1] === 'TRIP_CANCELLED')!;
      expect(new Set(call[0] as string[])).toEqual(new Set([laura.userId, giuseppe.userId]));
      expect((await anna.post(`/trips/${trip.id}/requests`, { boardingComune: COMUNI.MONZA })).status).toBe(409);
      expect((await search(anna)).body).toEqual([]);
    });

    it('il conducente può annullare la partecipazione di un passeggero', async () => {
      const trip = await createTrip(ctx, driver);
      const pid = await requestAndAccept(trip, laura);
      expect((await driver.post(`/trips/${trip.id}/participants/${pid}/remove`)).status).toBe(200);
      expect(ctx.notify).toHaveBeenCalledWith([laura.userId], 'REMOVED_FROM_TRIP', trip.id);
      expect((await laura.get(`/trips/${trip.id}/chat`)).status).toBe(404);
    });
  });

  describe('telefono e dati dei partecipanti', () => {
    it('telefono visibile solo tra membri confermati e solo con consenso', async () => {
      const trip = await createTrip(ctx, driver);
      // Richiesta in sospeso: non vede il telefono del conducente né gli altri partecipanti.
      await laura.post(`/trips/${trip.id}/requests`, { boardingComune: COMUNI.MONZA });
      let d = (await laura.get(`/trips/${trip.id}`)).body;
      expect(d.driverPhone).toBeUndefined();
      // Esterno su viaggio pubblico: nessun partecipante, nessun telefono.
      d = (await anna.get(`/trips/${trip.id}`)).body;
      expect(d.participants).toEqual([]);
      expect(d.driverPhone).toBeUndefined();

      const pid = (await driver.get(`/trips/${trip.id}`)).body.participants[0].id;
      await driver.post(`/trips/${trip.id}/participants/${pid}/accept`);
      await requestAndAccept(trip, giuseppe); // giuseppe non ha dato il consenso al telefono

      d = (await laura.get(`/trips/${trip.id}`)).body;
      expect(d.driverPhone).toBe('+39 333 1111111');
      const asDriver = (await driver.get(`/trips/${trip.id}`)).body;
      const lauraRow = asDriver.participants.find((p: { user: { id: string } }) => p.user.id === laura.userId);
      expect(lauraRow.phone).toBe('+39 333 2222222');

      // Revoca del consenso: il telefono sparisce subito.
      await laura.patch('/profile/consents', { phoneVisible: false });
      const after = (await driver.get(`/trips/${trip.id}`)).body;
      expect(after.participants.find((p: { user: { id: string } }) => p.user.id === laura.userId).phone).toBeUndefined();
    });

    it('il telefono è cifrato a riposo', async () => {
      const u = await ctx.prisma.user.findUniqueOrThrow({ where: { id: laura.userId } });
      expect(u.phoneEnc).toBeTruthy();
      expect(u.phoneEnc).not.toContain('2222222');
    });
  });

  describe('chiusura del viaggio', () => {
    it('si chiude solo dopo l’orario, solo dal conducente, indicando i presenti tra i confermati', async () => {
      const trip = await createTrip(ctx, driver);
      const pLaura = await requestAndAccept(trip, laura);
      const pGiu = await requestAndAccept(trip, giuseppe);
      expect((await driver.post(`/trips/${trip.id}/close`, { presentParticipantIds: [pLaura] })).body.code).toBe('TOO_EARLY');

      ctx.clock.set('2026-11-20T09:00:00.000Z');
      expect((await driver.get('/trips/mine')).body.awaitingClosure.map((t: { id: string }) => t.id)).toEqual([trip.id]);
      expect((await laura.post(`/trips/${trip.id}/close`, { presentParticipantIds: [] })).status).toBe(403);
      const r = await driver.post(`/trips/${trip.id}/close`, { presentParticipantIds: [pLaura] });
      expect(r.status).toBe(200);
      expect(r.body.status).toBe('CLOSED');
      const att = Object.fromEntries(r.body.participants.map((p: { id: string; attended: boolean }) => [p.id, p.attended]));
      expect(att).toEqual({ [pLaura]: true, [pGiu]: false });
      expect((await driver.post(`/trips/${trip.id}/close`, { presentParticipantIds: [] })).status).toBe(409);
    });
  });

  describe('link d’invito', () => {
    it('scadenza e revoca', async () => {
      const trip = await createTrip(ctx, driver, { visibility: 'PRIVATE' });
      const link = (await driver.post(`/trips/${trip.id}/invitation-links`, { expiresInHours: 1 })).body;
      expect((await laura.post('/invitation-links/preview', { token: link.token })).status).toBe(200);
      ctx.clock.set('2026-11-16T08:30:00.000Z');
      expect((await laura.post('/invitation-links/preview', { token: link.token })).status).toBe(404);

      ctx.clock.set('2026-11-16T07:00:00.000Z');
      const link2 = (await driver.post(`/trips/${trip.id}/invitation-links`, { expiresInHours: 24 })).body;
      expect((await laura.delete(`/invitations/${link2.invitation.id}`)).status).toBe(404); // solo il conducente revoca
      expect((await driver.delete(`/invitations/${link2.invitation.id}`)).status).toBe(204);
      expect((await laura.post('/invitation-links/accept', { token: link2.token, boardingComune: COMUNI.MONZA })).status).toBe(404);
    });

    it('nel DB si salva solo l’hash del token', async () => {
      const trip = await createTrip(ctx, driver, { visibility: 'PRIVATE' });
      const { token } = (await driver.post(`/trips/${trip.id}/invitation-links`, { expiresInHours: 24 })).body;
      const inv = await ctx.prisma.invitation.findFirstOrThrow({ where: { tripId: trip.id } });
      expect(inv.tokenHash).not.toBe(token);
      expect(JSON.stringify(inv)).not.toContain(token);
    });
  });

  describe('chat', () => {
    it('visibile solo a conducente e partecipanti accettati; notifiche push generiche e silenziabili', async () => {
      const { pushSpy } = await import('./helpers.js');
      const push = pushSpy(ctx);
      const trip = await createTrip(ctx, driver);
      await requestAndAccept(trip, laura);
      await giuseppe.post(`/trips/${trip.id}/requests`, { boardingComune: COMUNI.MONZA }); // non accettato

      expect((await giuseppe.get(`/trips/${trip.id}/chat`)).status).toBe(404);
      expect((await giuseppe.post(`/trips/${trip.id}/chat/messages`, { text: 'ciao' })).status).toBe(404);

      push.mockClear(); // si considerano solo le push generate dalla chat
      const sent = await laura.post(`/trips/${trip.id}/chat/messages`, { text: 'Testo riservato 12345' });
      expect(sent.status).toBe(201);
      const q = await laura.post(`/trips/${trip.id}/chat/messages`, { quickCode: 'LATE_5' });
      expect(q.body.text).toBe('Sono in ritardo di qualche minuto');

      const list = (await driver.get(`/trips/${trip.id}/chat`)).body;
      expect(list.messages.map((m: { text: string }) => m.text)).toEqual(['Testo riservato 12345', 'Sono in ritardo di qualche minuto']);

      // Messaggio cifrato a riposo.
      const row = await ctx.prisma.chatMessage.findFirstOrThrow({ where: { kind: 'TEXT' } });
      expect(row.bodyEnc).not.toContain('Testo riservato');

      // Push al conducente, senza testo né nomi.
      const payloads = push.mock.calls.map((c) => JSON.stringify(c[1]));
      expect(push.mock.calls.every((c) => c[0] === driver.userId)).toBe(true);
      expect(payloads.length).toBeGreaterThan(0);
      for (const p of payloads) {
        expect(p).not.toContain('Testo riservato');
        expect(p).not.toContain('Laura');
        expect(p).not.toContain('Bianchi');
      }

      // Chat silenziata: nessuna push.
      push.mockClear();
      await driver.put(`/trips/${trip.id}/chat/mute`, { muted: true });
      await laura.post(`/trips/${trip.id}/chat/messages`, { text: 'altro' });
      expect(push).not.toHaveBeenCalled();
    });

    it('cancellazione automatica dei messaggi oltre il periodo di conservazione', async () => {
      const trip = await createTrip(ctx, driver);
      await driver.post(`/trips/${trip.id}/chat/messages`, { text: 'vecchio' });
      await ctx.prisma.chatMessage.updateMany({ data: { createdAt: new Date('2026-10-01T00:00:00Z') } });
      await driver.post(`/trips/${trip.id}/chat/messages`, { text: 'recente' });
      const { ChatService } = await import('../src/chat/chat.service.js');
      expect(await ctx.app.get(ChatService).purgeExpired()).toBe(1);
      expect((await driver.get(`/trips/${trip.id}/chat`)).body.messages.map((m: { text: string }) => m.text)).toEqual(['recente']);
    });
  });
});
