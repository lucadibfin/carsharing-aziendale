import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TripDetailDto } from '@fcs/shared';
import { SeriesMaterializer } from '../src/trips/series-materializer.js';
import { COMUNI, createTestApp, createTrip, onboardedUser, resetDb, resetSpies, type ApiClient, type TestContext } from './helpers.js';

// Orologio dei test: lunedì 16/11/2026 alle 08:00 (Roma). Orizzonte di default: 28 giorni.
// Lun/mer/ven dal 16/11 al 14/12 compreso = 13 date.
const MON_WED_FRI = [1, 3, 5];

describe('Viaggi ricorrenti, gruppo fisso e lista d’attesa', () => {
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
    driver = await onboardedUser(ctx, 'mario.rossi');
    laura = await onboardedUser(ctx, 'laura.bianchi', { discoverable: true });
    giuseppe = await onboardedUser(ctx, 'giuseppe.verdi', { discoverable: true });
    anna = await onboardedUser(ctx, 'anna.neri');
  });

  const recurring = (overrides: Record<string, unknown> = {}) =>
    createTrip(ctx, driver, { date: '2026-11-16', weekdays: MON_WED_FRI, visibility: 'PRIVATE', seats: 2, ...overrides });

  /** id della data della serie in quel giorno. */
  async function dateId(trip: TripDetailDto, date: string): Promise<string> {
    const t = await ctx.prisma.trip.findFirstOrThrow({ where: { seriesId: trip.seriesId, date: new Date(`${date}T00:00:00Z`) } });
    return t.id;
  }
  async function statusOf(tripId: string, userId: string) {
    return (await ctx.prisma.tripParticipant.findUnique({ where: { tripId_userId: { tripId, userId } } }))?.status ?? null;
  }
  async function joinSeries(trip: TripDetailDto, who: ApiClient): Promise<void> {
    expect((await driver.post(`/trips/${trip.id}/invitations`, { userId: who.userId, scope: 'SERIES' })).status).toBe(201);
    const inv = (await who.get('/trips/mine')).body.pendingInvitations.find((i: { scope: string }) => i.scope === 'SERIES');
    const r = await who.post(`/invitations/${inv.id}/accept`, { boardingComune: COMUNI.MONZA });
    expect(r.status).toBe(200);
  }
  const notified = (type: string) => ctx.notify.mock.calls.filter((c: unknown[]) => c[1] === type);

  describe('creazione', () => {
    it('genera le date dei giorni scelti fino all’orizzonte; in elenco compare solo la prossima', async () => {
      const trip = await recurring();
      expect(trip.date).toBe('2026-11-16');
      expect(trip.recurrence).toEqual({ weekdays: MON_WED_FRI, endDate: null });
      expect(trip.seriesDates!.map((d) => d.date)).toEqual([
        '2026-11-16', '2026-11-18', '2026-11-20', '2026-11-23', '2026-11-25', '2026-11-27', '2026-11-30',
        '2026-12-02', '2026-12-04', '2026-12-07', '2026-12-09', '2026-12-11', '2026-12-14',
      ]);
      const mine = (await driver.get('/trips/mine')).body;
      expect(mine.asDriver).toHaveLength(1);
      expect(mine.asDriver[0].id).toBe(trip.id);
    });

    it('rispetta la data di fine e salta la prima data se l’orario è già passato', async () => {
      ctx.clock.set('2026-11-16T08:00:00.000Z'); // 09:00, dopo l'arrivo delle 08:30
      const trip = await recurring({ endDate: '2026-11-23' });
      expect(trip.date).toBe('2026-11-18');
      expect(trip.seriesDates!.map((d) => d.date)).toEqual(['2026-11-18', '2026-11-20', '2026-11-23']);
    });

    it('rifiuta periodi senza date valide e la data di fine senza ricorrenza', async () => {
      const none = await driver.post('/trips', { ...baseInput(ctx), date: '2026-11-17', weekdays: [1], endDate: '2026-11-22' });
      expect(none.status).toBe(400);
      expect(none.body.code).toBe('INVALID_DATE');
      const end = await driver.post('/trips', { ...baseInput(ctx), endDate: '2026-11-30' });
      expect(end.status).toBe(400);
    });

    it('il job notturno estende la serie e include i membri fissi', async () => {
      const trip = await recurring();
      await joinSeries(trip, laura);
      ctx.clock.set('2026-11-23T07:00:00.000Z');
      const created = await ctx.app.get(SeriesMaterializer).extendAll();
      expect(created).toBe(3); // 16, 18 e 21 dicembre
      const last = await ctx.prisma.trip.findFirstOrThrow({ where: { seriesId: trip.seriesId }, orderBy: { date: 'desc' } });
      expect(last.date.toISOString().slice(0, 10)).toBe('2026-12-21');
      expect(await statusOf(last.id, laura.userId)).toBe('ACCEPTED');
      expect(await ctx.app.get(SeriesMaterializer).extendAll()).toBe(0);
    });
  });

  describe('gruppo fisso', () => {
    it('l’invito alla serie rende membro: confermato in tutte le date, con la lista dei membri', async () => {
      const trip = await recurring();
      await joinSeries(trip, laura);
      const parts = await ctx.prisma.tripParticipant.findMany({ where: { userId: laura.userId, trip: { seriesId: trip.seriesId } } });
      expect(parts).toHaveLength(13);
      expect(parts.every((p) => p.status === 'ACCEPTED')).toBe(true);
      const d = (await laura.get(`/trips/${trip.id}`)).body as TripDetailDto;
      expect(d.isSeriesMember).toBe(true);
      expect(d.seriesMembers!.map((m) => m.id)).toEqual([laura.userId]);
      expect(notified('INVITATION_ACCEPTED').map((c: unknown[]) => c[0])).toEqual([[driver.userId]]);
      // Un altro collega non vede il viaggio privato.
      expect((await anna.get(`/trips/${trip.id}`)).status).toBe(404);
    });

    it('con un link alla serie si entra nel gruppo; il link resta valido per altri', async () => {
      const trip = await recurring();
      const link = await driver.post(`/trips/${trip.id}/invitation-links`, { expiresInHours: 72, scope: 'SERIES' });
      expect(link.status).toBe(201);
      const preview = await giuseppe.post('/invitation-links/preview', { token: link.body.token });
      expect(preview.body.invitationScope).toBe('SERIES');
      expect((await giuseppe.post('/invitation-links/accept', { token: link.body.token, boardingComune: COMUNI.MONZA })).status).toBe(200);
      expect((await anna.post('/invitation-links/accept', { token: link.body.token, boardingComune: COMUNI.MONZA })).status).toBe(200);
      expect(await ctx.prisma.seriesMember.count({ where: { seriesId: trip.seriesId } })).toBe(2);
    });

    it('il gruppo fisso esiste solo per i viaggi ricorrenti', async () => {
      const single = await createTrip(ctx, driver);
      const r = await driver.post(`/trips/${single.id}/invitations`, { userId: laura.userId, scope: 'SERIES' });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('NOT_RECURRING');
    });

    it('oltre i posti, il membro è in lista d’attesa e subentra quando un altro dice "non ci sono"', async () => {
      const trip = await recurring({ seats: 1 });
      await joinSeries(trip, laura);
      await joinSeries(trip, giuseppe);
      const wed = await dateId(trip, '2026-11-18');
      expect(await statusOf(wed, giuseppe.userId)).toBe('WAITLISTED');
      resetSpies(ctx);
      const r = await laura.post(`/trips/${wed}/not-there`);
      expect(r.status).toBe(200);
      expect(r.body.myStatus).toBe('NOT_THERE');
      expect(await statusOf(wed, giuseppe.userId)).toBe('ACCEPTED');
      expect(notified('REQUEST_ACCEPTED').map((c: unknown[]) => c[0])).toEqual([[giuseppe.userId]]);
      expect(notified('MEMBER_NOT_THERE').map((c: unknown[]) => c[0])).toEqual([[driver.userId]]);
      // Le altre date non cambiano.
      expect(await statusOf(await dateId(trip, '2026-11-20'), laura.userId)).toBe('ACCEPTED');
    });

    it('"non ci sono": il conducente rende pubblica solo quella data e un collega può chiedere il posto', async () => {
      const trip = await recurring({ seats: 1 });
      await joinSeries(trip, laura);
      const fri = await dateId(trip, '2026-11-20');
      expect((await laura.post(`/trips/${fri}/not-there`)).status).toBe(200);

      expect((await anna.get(`/trips/${fri}`)).status).toBe(404);
      const pub = await driver.patch(`/trips/${fri}/visibility`, { visibility: 'PUBLIC', scope: 'TRIP' });
      expect(pub.status).toBe(200);
      expect(pub.body.visibility).toBe('PUBLIC');
      const search = (date: string) => anna.get('/trips/search').query({ siteId: ctx.sites[0]!.id, date });
      expect((await search('2026-11-20')).body.map((t: { id: string }) => t.id)).toEqual([fri]);
      expect((await search('2026-11-18')).body).toEqual([]);
      const wed = await dateId(trip, '2026-11-18');
      expect((await anna.get(`/trips/${wed}`)).status).toBe(404);

      expect((await anna.post(`/trips/${fri}/requests`, { boardingComune: COMUNI.MONZA })).status).toBe(201);
      const pid = (await driver.get(`/trips/${fri}`)).body.participants.find((p: { user: { id: string } }) => p.user.id === anna.userId).id;
      expect((await driver.post(`/trips/${fri}/participants/${pid}/accept`)).status).toBe(200);

      // Laura ci ripensa, ma il posto ormai è preso: va in lista d'attesa.
      const back = await laura.post(`/trips/${fri}/back`);
      expect(back.body.myStatus).toBe('WAITLISTED');
      // Rendendo di nuovo privata la data, la lista d'attesa del membro fisso resta.
      await driver.patch(`/trips/${fri}/visibility`, { visibility: 'PRIVATE', scope: 'TRIP' });
      expect(await statusOf(fri, laura.userId)).toBe('WAITLISTED');
    });

    it('annullare una data da membro equivale a "non ci sono": resta nel gruppo e può tornare', async () => {
      const trip = await recurring();
      await joinSeries(trip, laura);
      const r = await laura.post(`/trips/${trip.id}/leave`);
      expect(r.status).toBe(200);
      expect(await statusOf(trip.id, laura.userId)).toBe('NOT_THERE');
      expect(await ctx.prisma.seriesMember.count({ where: { userId: laura.userId } })).toBe(1);
      expect((await laura.post(`/trips/${trip.id}/back`)).body.myStatus).toBe('ACCEPTED');
    });

    it('"non ci sono" oltre la scadenza resta segnalabile come cancellazione tardiva', async () => {
      const trip = await recurring();
      await joinSeries(trip, laura);
      ctx.clock.set('2026-11-16T07:10:00.000Z'); // 08:10, scadenza alle 06:30
      await laura.post(`/trips/${trip.id}/not-there`);
      ctx.clock.set('2026-11-16T09:00:00.000Z');
      const opts = (await driver.get(`/trips/${trip.id}/absence-reports/options`)).body;
      expect(opts.candidates).toEqual([expect.objectContaining({ id: laura.userId, why: 'LATE_CANCEL' })]);
    });

    it('uscita dal gruppo e rimozione da parte del conducente', async () => {
      const trip = await recurring();
      await joinSeries(trip, laura);
      await joinSeries(trip, giuseppe);
      resetSpies(ctx);
      expect((await laura.post(`/trips/${trip.id}/series/leave`)).status).toBe(204);
      expect(await ctx.prisma.tripParticipant.count({ where: { userId: laura.userId, status: 'ACCEPTED' } })).toBe(0);
      expect(notified('MEMBER_LEFT_SERIES').map((c: unknown[]) => c[0])).toEqual([[driver.userId]]);
      expect((await laura.get(`/trips/${trip.id}`)).status).toBe(404);

      const rm = await driver.post(`/trips/${trip.id}/series/members/${giuseppe.userId}/remove`);
      expect(rm.status).toBe(200);
      expect(rm.body.seriesMembers).toEqual([]);
      expect(notified('REMOVED_FROM_SERIES').map((c: unknown[]) => c[0])).toEqual([[giuseppe.userId]]);
      expect((await laura.post(`/trips/${trip.id}/series/members/${driver.userId}/remove`)).status).toBe(404);
    });

    it('terminare la serie annulla tutte le date future e avvisa i membri una volta sola', async () => {
      const trip = await recurring();
      await joinSeries(trip, laura);
      resetSpies(ctx);
      expect((await driver.post(`/trips/${trip.id}/series/end`)).status).toBe(204);
      expect(await ctx.prisma.trip.count({ where: { seriesId: trip.seriesId, status: 'SCHEDULED' } })).toBe(0);
      expect(notified('SERIES_CANCELLED').map((c: unknown[]) => c[0])).toEqual([[laura.userId]]);
      ctx.clock.set('2026-11-30T07:00:00.000Z');
      await ctx.app.get(SeriesMaterializer).extendAll();
      expect(await ctx.prisma.trip.count({ where: { seriesId: trip.seriesId, status: 'SCHEDULED' } })).toBe(0);
    });

    it('cambiare la visibilità di tutta la serie vale per tutte le date future', async () => {
      const trip = await recurring();
      const fri = await dateId(trip, '2026-11-20');
      await driver.patch(`/trips/${fri}/visibility`, { visibility: 'PUBLIC', scope: 'TRIP' });
      await driver.patch(`/trips/${trip.id}/visibility`, { visibility: 'PUBLIC' });
      const dates = (await driver.get(`/trips/${trip.id}`)).body.seriesDates as { visibility: string }[];
      expect(dates.every((d) => d.visibility === 'PUBLIC')).toBe(true);
      expect(await ctx.prisma.trip.count({ where: { seriesId: trip.seriesId, visibilityOverride: { not: null } } })).toBe(0);
    });
  });

  describe('lista d’attesa', () => {
    async function fullTrip() {
      const trip = await createTrip(ctx, driver, { seats: 1 });
      await laura.post(`/trips/${trip.id}/requests`, { boardingComune: COMUNI.MONZA });
      const pid = (await driver.get(`/trips/${trip.id}`)).body.participants[0].id;
      await driver.post(`/trips/${trip.id}/participants/${pid}/accept`);
      return trip;
    }

    it('a viaggio pieno si entra in lista d’attesa solo chiedendolo', async () => {
      const trip = await fullTrip();
      const full = await giuseppe.post(`/trips/${trip.id}/requests`, { boardingComune: COMUNI.MONZA });
      expect(full.status).toBe(409);
      expect(full.body.code).toBe('TRIP_FULL');
      const w = await giuseppe.post(`/trips/${trip.id}/requests`, { boardingComune: COMUNI.MONZA, waitlist: true });
      expect(w.status).toBe(201);
      expect(w.body.myStatus).toBe('WAITLISTED');
      expect(w.body.waitlistCount).toBe(1);
      expect((await giuseppe.get('/trips/mine')).body.asParticipant.map((t: { id: string }) => t.id)).toEqual([trip.id]);
      // Finché è pieno non può rinnovare la richiesta.
      expect((await giuseppe.post(`/trips/${trip.id}/requests`, { boardingComune: COMUNI.MONZA, waitlist: true })).status).toBe(409);
    });

    it('quando si libera un posto chi è in lista d’attesa riceve un avviso e può chiedere il posto', async () => {
      const trip = await fullTrip();
      await giuseppe.post(`/trips/${trip.id}/requests`, { boardingComune: COMUNI.MONZA, waitlist: true });
      await anna.post(`/trips/${trip.id}/requests`, { boardingComune: COMUNI.MONZA, waitlist: true });
      resetSpies(ctx);
      await laura.post(`/trips/${trip.id}/leave`);
      expect(notified('SEAT_AVAILABLE').map((c: unknown[]) => [...(c[0] as string[])].sort())).toEqual([[giuseppe.userId, anna.userId].sort()]);

      const again = await giuseppe.post(`/trips/${trip.id}/requests`, { boardingComune: COMUNI.MONZA });
      expect(again.status).toBe(201);
      expect(again.body.myStatus).toBe('REQUESTED');
      expect(notified('JOIN_REQUEST').map((c: unknown[]) => c[0])).toEqual([[driver.userId]]);
      // Il conducente può anche accettare direttamente dalla lista d'attesa.
      const annaPid = (await driver.get(`/trips/${trip.id}`)).body.participants.find((p: { user: { id: string } }) => p.user.id === anna.userId).id;
      expect((await driver.post(`/trips/${trip.id}/participants/${annaPid}/accept`)).status).toBe(200);
      const gPid = (await driver.get(`/trips/${trip.id}`)).body.participants.find((p: { user: { id: string } }) => p.user.id === giuseppe.userId).id;
      expect((await driver.post(`/trips/${trip.id}/participants/${gPid}/accept`)).body.code).toBe('TRIP_FULL');
    });

    it('la lista d’attesa esterna viene rifiutata se il viaggio diventa privato', async () => {
      const trip = await fullTrip();
      await giuseppe.post(`/trips/${trip.id}/requests`, { boardingComune: COMUNI.MONZA, waitlist: true });
      await driver.patch(`/trips/${trip.id}/visibility`, { visibility: 'PRIVATE' });
      expect(await statusOf(trip.id, giuseppe.userId)).toBe('REJECTED');
    });
  });
});

function baseInput(ctx: TestContext) {
  return {
    siteId: ctx.sites[0]!.id,
    date: '2026-11-20',
    arrivalTime: '08:30',
    departureComune: COMUNI.BERGAMO,
    viaComuni: [COMUNI.MONZA],
    seats: 2,
    visibility: 'PRIVATE',
  };
}
