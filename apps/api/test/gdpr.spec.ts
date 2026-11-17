import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TripDetailDto } from '@fcs/shared';
import { EmployeeCheckService } from '../src/auth/employee-check.service.js';
import { IDENTITY_PROVIDER } from '../src/auth/identity-provider.js';
import type { MockIdentityProvider } from '../src/auth/mock-identity.provider.js';
import { UserLifecycleService } from '../src/users/user-lifecycle.service.js';
import { ApiClient, COMUNI, createTestApp, createTrip, onboardedUser, resetDb, resetSpies, type TestContext } from './helpers.js';

const REASON = 'Non si è presentata e non ha avvisato nessuno in chat.';

async function join(driver: ApiClient, trip: TripDetailDto, who: ApiClient): Promise<string> {
  await who.post(`/trips/${trip.id}/requests`, { boardingComune: COMUNI.MONZA });
  const pid = ((await driver.get(`/trips/${trip.id}`)).body as TripDetailDto).participants.find((p) => p.user.id === who.userId)!.id;
  await driver.post(`/trips/${trip.id}/participants/${pid}/accept`);
  return pid;
}

describe('Diritti GDPR e ciclo di vita dell’account', () => {
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
    laura = await onboardedUser(ctx, 'laura.bianchi', { phoneVisible: true });
    anna = await onboardedUser(ctx, 'anna.neri');
  });

  /**
   * Storia comune: viaggio di Mario del 20/11 chiuso con Laura presente e Anna assente;
   * Laura scrive in chat, aggiunge Mario ai preferiti e segnala Anna; Laura propone
   * un viaggio futuro a cui partecipa Mario.
   */
  async function history(): Promise<{ past: TripDetailDto; future: TripDetailDto }> {
    await laura.patch('/profile', { phone: '+39 333 7654321' });
    const past = await createTrip(ctx, mario);
    const pLaura = await join(mario, past, laura);
    await join(mario, past, anna);
    await laura.post(`/trips/${past.id}/chat/messages`, { text: 'Arrivo cinque minuti prima' });
    await laura.put(`/favorites/${mario.userId}`);
    const future = await createTrip(ctx, laura, { date: '2026-11-25' });
    await join(laura, future, mario);
    ctx.clock.set('2026-11-20T09:00:00.000Z');
    await mario.post(`/trips/${past.id}/close`, { presentParticipantIds: [pLaura] });
    expect((await laura.post(`/trips/${past.id}/absence-reports`, { reportedUserId: anna.userId, reason: REASON })).status).toBe(201);
    return { past, future };
  }

  describe('esportazione dei dati (accesso e portabilità)', () => {
    it('contiene tutti i dati dell’utente, senza segreti tecnici', async () => {
      await history();
      const res = await laura.get('/me/data');
      expect(res.status).toBe(200);
      const d = res.body;
      expect(d.account).toMatchObject({ username: 'laura.bianchi', nome: 'Laura', telefono: '+39 333 7654321', comuneDiResidenza: 'Monza' });
      expect(d.email.indirizzo).toBe('laura.bianchi@example.test');
      expect(d.consensi.attuali.telefonoVisibile).toBe(true);
      expect(d.consensi.storico.length).toBeGreaterThan(0);
      expect(d.informativaETermini).toHaveLength(2);
      expect(d.partecipazioni[0]).toMatchObject({ conducente: 'Mario Rossi', comuneDiSalita: 'Monza', presente: true });
      expect(d.viaggiComeConducente[0]).toMatchObject({ data: '2026-11-25', partecipantiConfermati: 1 });
      expect(d.messaggiChatInviati[0].testo).toBe('Arrivo cinque minuti prima');
      expect(d.colleghiPreferiti).toEqual(['Mario Rossi']);
      expect(d.segnalazioniDiAssenza.inviate[0]).toMatchObject({ personaSegnalata: 'Anna Neri', motivazione: REASON });
      expect(d.statistichePersonali).toHaveLength(1);
      expect(JSON.stringify(d)).not.toMatch(/Hash|Enc"|token|p256dh/i);
      const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'USER_DATA_EXPORT', targetId: laura.userId } });
      expect(audit?.actorId).toBe(laura.userId);
    });

    it('le segnalazioni ricevute compaiono con motivazione e stato, ma senza chi le ha inviate', async () => {
      await history();
      const d = (await anna.get('/me/data')).body;
      expect(d.segnalazioniDiAssenza.ricevute).toEqual([expect.objectContaining({ motivazione: REASON, stato: 'OPEN' })]);
      expect(JSON.stringify(d.segnalazioniDiAssenza)).not.toMatch(/Laura|Bianchi/);
      expect(d.partecipazioni[0].presente).toBe(false);
    });
  });

  describe('cancellazione dell’account', () => {
    it('cancella tutti i dati, avvisa gli altri e conserva solo le statistiche anonime', async () => {
      const { future } = await history();
      const res = await laura.delete('/me');
      expect(res.status).toBe(204);
      expect(String(res.headers['set-cookie'])).toMatch(/sid=;/);
      expect((await laura.get('/me')).status).toBe(401);

      // Il viaggio futuro di Laura è annullato e Mario avvisato.
      expect(ctx.notify).toHaveBeenCalledWith([mario.userId], 'TRIP_CANCELLED', future.id);

      const id = laura.userId;
      expect(await ctx.prisma.user.findUnique({ where: { id } })).toBeNull();
      expect(await ctx.prisma.chatMessage.count({ where: { senderId: id } })).toBe(0);
      expect(await ctx.prisma.chatMessage.count()).toBe(0);
      expect(await ctx.prisma.consentEvent.count({ where: { userId: id } })).toBe(0);
      expect(await ctx.prisma.tripSeries.count({ where: { driverId: id } })).toBe(0);
      expect(await ctx.prisma.favorite.count({ where: { userId: id } })).toBe(0);
      expect(await ctx.prisma.userStatEntry.count({ where: { userId: id } })).toBe(0);
      // La segnalazione inviata resta per gli admin, senza autore.
      expect(await ctx.prisma.absenceReport.findFirstOrThrow()).toMatchObject({ reporterId: null, reportedId: anna.userId });
      // Statistiche anonime e personali degli altri intatte.
      expect(await ctx.prisma.tripStatFact.count({ where: { status: 'COMPLETED' } })).toBe(1);
      expect(await ctx.prisma.userStatEntry.count({ where: { userId: mario.userId } })).toBe(1);
      expect(await ctx.prisma.auditLog.findFirst({ where: { action: 'USER_ACCOUNT_DELETED', targetId: id } })).toBeTruthy();

      // Nuovo accesso: account nuovo, nessun dato precedente.
      const again = await new ApiClient(ctx.app).init();
      await again.login('laura.bianchi');
      const me = (await again.get('/me')).body;
      expect(me.id).not.toBe(id);
      expect(me.onboardingRequired).toBe(true);
    });

    it('l’unico admin globale non può cancellarsi', async () => {
      const admin = await onboardedUser(ctx, 'admin');
      expect((await admin.delete('/me')).body.code).toBe('LAST_GLOBAL_ADMIN');
      await admin.post('/admin/roles', { userId: mario.userId, role: 'GLOBAL_ADMIN' });
      expect((await admin.delete('/me')).status).toBe(204);
    });
  });

  describe('ex dipendenti', () => {
    it('disattivazione, rientro durante il periodo di attesa, cancellazione definitiva dopo 30 giorni', async () => {
      const lifecycle = ctx.app.get(UserLifecycleService);
      await history();
      await lifecycle.deactivate(anna.userId);
      expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: anna.userId } })).status).toBe('PENDING_DELETION');

      ctx.clock.set('2026-12-19T09:00:00.000Z');
      expect(await lifecycle.purgeDeactivated()).toBe(0);
      ctx.clock.set('2026-12-20T09:00:01.000Z');
      expect(await lifecycle.purgeDeactivated()).toBe(1);
      expect(await ctx.prisma.user.findUnique({ where: { id: anna.userId } })).toBeNull();
      // Con lei spariscono le segnalazioni che la riguardano.
      expect(await ctx.prisma.absenceReport.count()).toBe(0);
      expect(await ctx.prisma.auditLog.findFirst({ where: { action: 'USER_PURGED', targetId: anna.userId, actorId: null } })).toBeTruthy();
    });

    it('chi rientra in azienda e accede prima della cancellazione torna attivo', async () => {
      const lifecycle = ctx.app.get(UserLifecycleService);
      await lifecycle.deactivate(anna.userId);
      const c = await new ApiClient(ctx.app).init();
      expect((await c.login('anna.neri')).status).toBe(204);
      expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: anna.userId } })).status).toBe('ACTIVE');
      expect(await lifecycle.purgeDeactivated()).toBe(0);
      // L'email era stata cancellata: va verificata di nuovo.
      expect((await c.get('/me')).body).toMatchObject({ emailVerified: false, onboardingRequired: true });
    });
  });
});

describe('Verifica notturna dei dipendenti (EMPLOYEE_CHECK_MODE=nightly)', () => {
  let ctx: TestContext;
  let idp: MockIdentityProvider;
  let check: EmployeeCheckService;
  const users = ['admin', 'mario.rossi', 'laura.bianchi', 'giuseppe.verdi', 'anna.neri', 'paolo.gialli'];

  beforeAll(async () => {
    ctx = await createTestApp({ EMPLOYEE_CHECK_MODE: 'nightly' });
    idp = ctx.app.get(IDENTITY_PROVIDER);
    check = ctx.app.get(EmployeeCheckService);
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    resetSpies(ctx);
    idp.departed.clear();
    idp.departed.add('ex.dipendente');
    for (const u of users) await onboardedUser(ctx, u);
  });

  it('disattiva chi non è più dipendente e aggiorna la verifica degli altri', async () => {
    idp.departed.add('anna.neri');
    const r = await check.run();
    expect(r).toEqual({ checked: 6, inactive: 1, deactivated: 1, errors: 0, aborted: false });
    const anna = await ctx.prisma.user.findUniqueOrThrow({ where: { username: 'anna.neri' } });
    expect(anna.status).toBe('PENDING_DELETION');
    const mario = await ctx.prisma.user.findUniqueOrThrow({ where: { username: 'mario.rossi' } });
    expect(mario.lastVerifiedAt?.toISOString()).toBe(ctx.clock.now().toISOString());
    expect(await ctx.prisma.auditLog.findFirst({ where: { action: 'EMPLOYEE_CHECK_RUN' }, orderBy: { id: 'desc' } })).toMatchObject({
      meta: { deactivated: 1, aborted: false },
    });
  });

  it('un errore del sistema di identità non disattiva nessuno', async () => {
    const original = idp.checkActive.bind(idp);
    idp.checkActive = async (u: string) => {
      if (u === 'paolo.gialli') throw new Error('timeout');
      return original(u);
    };
    try {
      const r = await check.run();
      expect(r).toMatchObject({ checked: 5, errors: 1, deactivated: 0 });
      expect((await ctx.prisma.user.findUniqueOrThrow({ where: { username: 'paolo.gialli' } })).status).toBe('ACTIVE');
    } finally {
      idp.checkActive = original;
    }
  });

  it('freno di sicurezza: troppi "non attivi" in una notte sospendono le disattivazioni', async () => {
    for (const u of users) idp.departed.add(u);
    const r = await check.run();
    expect(r).toMatchObject({ checked: 6, inactive: 6, deactivated: 0, aborted: true });
    expect(await ctx.prisma.user.count({ where: { status: 'ACTIVE' } })).toBe(6);
  });
});
