import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AbsenceReportOptionsDto, TripDetailDto } from '@fcs/shared';
import { AuditService } from '../src/audit/audit.service.js';
import { AbsenceReportsService } from '../src/trips/absence-reports.service.js';
import { COMUNI, createTestApp, createTrip, onboardedUser, resetDb, resetSpies, type ApiClient, type TestContext } from './helpers.js';

const REASON = 'Non si è presentato al punto d’incontro e non ha risposto in chat.';

describe('Segnalazioni di assenza', () => {
  let ctx: TestContext;
  let driver: ApiClient;
  let laura: ApiClient;
  let giuseppe: ApiClient;
  let anna: ApiClient;
  let paolo: ApiClient;

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
    laura = await onboardedUser(ctx, 'laura.bianchi');
    giuseppe = await onboardedUser(ctx, 'giuseppe.verdi');
    anna = await onboardedUser(ctx, 'anna.neri');
    paolo = await onboardedUser(ctx, 'paolo.gialli');
  });

  async function join(trip: TripDetailDto, who: ApiClient): Promise<string> {
    await who.post(`/trips/${trip.id}/requests`, { boardingComune: COMUNI.MONZA });
    const pid = ((await driver.get(`/trips/${trip.id}`)).body as TripDetailDto).participants.find((p) => p.user.id === who.userId)!.id;
    await driver.post(`/trips/${trip.id}/participants/${pid}/accept`);
    return pid;
  }

  const options = async (c: ApiClient, tripId: string) =>
    (await c.get(`/trips/${tripId}/absence-reports/options`)).body as AbsenceReportOptionsDto;
  const ids = (o: AbsenceReportOptionsDto) => o.candidates.map((c) => `${c.id}:${c.why}`).sort();

  /** Viaggio chiuso il 20/11: Laura presente, Giuseppe assente, Anna ha annullato oltre la scadenza. */
  async function closedTrip(): Promise<TripDetailDto> {
    const trip = await createTrip(ctx, driver);
    const pLaura = await join(trip, laura);
    await join(trip, giuseppe);
    await join(trip, anna);
    ctx.clock.set('2026-11-20T07:00:00.000Z'); // 30 minuti prima dell'arrivo (scadenza: 2 ore)
    expect((await anna.post(`/trips/${trip.id}/leave`)).body).toEqual({ lateCancel: true });
    expect((await laura.get(`/trips/${trip.id}/absence-reports/options`)).body.candidates).toEqual([]); // non ancora passato
    ctx.clock.set('2026-11-20T09:00:00.000Z');
    await driver.post(`/trips/${trip.id}/close`, { presentParticipantIds: [pLaura] });
    return trip;
  }

  it('chi era presente può segnalare assenti e cancellazioni tardive; chi era assente no', async () => {
    const trip = await closedTrip();
    const expected = [`${anna.userId}:LATE_CANCEL`, `${giuseppe.userId}:NO_SHOW`].sort();
    expect(ids(await options(laura, trip.id))).toEqual(expected);
    expect(ids(await options(driver, trip.id))).toEqual(expected);
    expect((await options(giuseppe, trip.id)).candidates).toEqual([]);
    expect((await options(paolo, trip.id)).candidates).toEqual([]); // esterno (viaggio pubblico)
  });

  it('motivazione obbligatoria, una sola segnalazione per persona, testo cifrato nel DB', async () => {
    const trip = await closedTrip();
    const short = await laura.post(`/trips/${trip.id}/absence-reports`, { reportedUserId: giuseppe.userId, reason: 'no' });
    expect(short.status).toBe(400);
    const ok = await laura.post(`/trips/${trip.id}/absence-reports`, { reportedUserId: giuseppe.userId, reason: REASON });
    expect(ok.status).toBe(201);
    expect(ok.body.alreadyReported).toEqual([giuseppe.userId]);
    const dup = await laura.post(`/trips/${trip.id}/absence-reports`, { reportedUserId: giuseppe.userId, reason: REASON });
    expect(dup.status).toBe(409);
    expect((await laura.post(`/trips/${trip.id}/absence-reports`, { reportedUserId: driver.userId, reason: REASON })).body.code).toBe(
      'NOT_REPORTABLE',
    );
    expect((await paolo.post(`/trips/${trip.id}/absence-reports`, { reportedUserId: giuseppe.userId, reason: REASON })).status).toBe(400);

    const row = await ctx.prisma.absenceReport.findFirstOrThrow();
    expect(row.reasonEnc).not.toContain('presentato');
    expect(row).toMatchObject({ status: 'OPEN', reporterId: laura.userId, reportedId: giuseppe.userId });
    // La persona segnalata non ne vede traccia nell'app.
    expect(JSON.stringify((await giuseppe.get(`/trips/${trip.id}`)).body)).not.toContain('presentato');
  });

  it('viaggio privato: chi non è coinvolto riceve 404', async () => {
    const trip = await createTrip(ctx, driver, { visibility: 'PRIVATE' });
    ctx.clock.set('2026-11-20T09:00:00.000Z');
    expect((await paolo.get(`/trips/${trip.id}/absence-reports/options`)).status).toBe(404);
    expect((await paolo.post(`/trips/${trip.id}/absence-reports`, { reportedUserId: driver.userId, reason: REASON })).status).toBe(404);
  });

  it('oltre il termine di chiusura non si può più segnalare', async () => {
    const trip = await closedTrip();
    ctx.clock.set('2026-11-28T09:00:00.000Z'); // 8 giorni dopo (default 7)
    expect((await options(laura, trip.id)).candidates).toEqual([]);
  });

  it('il conducente si può segnalare se non chiude il viaggio o lo annulla oltre la scadenza', async () => {
    const a = await createTrip(ctx, driver);
    await join(a, laura);
    const b = await createTrip(ctx, driver, { arrivalTime: '09:30' });
    await join(b, giuseppe);
    ctx.clock.set('2026-11-20T08:00:00.000Z'); // 30 minuti prima dell'arrivo di b
    await driver.post(`/trips/${b.id}/cancel`);
    ctx.clock.set('2026-11-20T10:00:00.000Z');
    expect(ids(await options(laura, a.id))).toEqual([`${driver.userId}:DRIVER_NO_SHOW`]);
    expect(ids(await options(giuseppe, b.id))).toEqual([`${driver.userId}:LATE_CANCEL`]);
    expect((await options(driver, b.id)).candidates).toEqual([]);
  });

  it('cancellazione automatica dopo il periodo di conservazione (default 12 mesi)', async () => {
    const trip = await closedTrip();
    await laura.post(`/trips/${trip.id}/absence-reports`, { reportedUserId: giuseppe.userId, reason: REASON });
    const svc = ctx.app.get(AbsenceReportsService);
    ctx.clock.set('2027-11-19T09:00:00.000Z');
    expect(await svc.purgeExpired()).toBe(0);
    ctx.clock.set('2027-11-21T09:00:00.000Z');
    expect(await svc.purgeExpired()).toBe(1);
  });

  it('gestione admin: ambito di sede, motivazione solo nel dettaglio, accessi nell’audit log', async () => {
    const trip = await closedTrip();
    await laura.post(`/trips/${trip.id}/absence-reports`, { reportedUserId: giuseppe.userId, reason: REASON });
    const svc = ctx.app.get(AbsenceReportsService);
    const adminId = paolo.userId; // il ruolo è verificato dal controller admin; qui si prova il servizio
    const own = [ctx.sites[0]!.id];
    const other = [ctx.sites[1]!.id];

    const list = await svc.adminList(adminId, own, {});
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty('reason');
    expect(await svc.adminList(adminId, other, {})).toEqual([]);
    expect(await svc.adminList(adminId, other, { siteId: ctx.sites[0]!.id })).toEqual([]);
    await expect(svc.adminGet(adminId, other, list[0]!.id)).rejects.toThrow(/non trovata/);

    const detail = await svc.adminGet(adminId, null, list[0]!.id);
    expect(detail).toMatchObject({ reason: REASON, reportedTotal: 1, reported: { id: giuseppe.userId }, reporter: { id: laura.userId } });
    const decided = await svc.adminDecide(adminId, own, list[0]!.id, { status: 'DISMISSED', note: 'Chiarito con i colleghi' });
    expect(decided).toMatchObject({ status: 'DISMISSED', decisionNote: 'Chiarito con i colleghi' });

    const actions = (await ctx.prisma.auditLog.findMany({ where: { actorId: adminId }, orderBy: { id: 'asc' } })).map((a) => a.action);
    expect(actions).toEqual(['ADMIN_REPORTS_LIST', 'ADMIN_REPORTS_LIST', 'ADMIN_REPORTS_LIST', 'ADMIN_REPORT_VIEW', 'ADMIN_REPORT_DECISION']);
    const metas = (await ctx.prisma.auditLog.findMany({ where: { actorId: adminId } })).map((a) => a.meta);
    expect(JSON.stringify(metas)).not.toMatch(/Chiarito|presentato/);
    expect((await ctx.app.get(AuditService).verify()).ok).toBe(true);
  });
});
