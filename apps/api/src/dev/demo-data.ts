// Dati di esempio per provare l'app in locale. SOLO SVILUPPO.
//
//   npm run db:demo        (dalla radice; con l'API di sviluppo ferma)
//
// ATTENZIONE: cancella utenti, viaggi, chat, segnalazioni e statistiche del
// database di sviluppo e li ricrea (restano comuni, sedi, testi legali, parametri
// e audit log). Rifiuta di partire in produzione o con il login aziendale.
//
// Le date sono relative a oggi: viaggi conclusi nelle settimane passate (per
// statistiche e dashboard), uno da chiudere, uno chiuso da poco con un assente
// (per le segnalazioni) e viaggi futuri. Le statistiche dei viaggi conclusi sono
// calcolate con gli stessi servizi dell'app.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { Clock } from '../common/clock.js';
import { CryptoService } from '../common/crypto.service.js';
import { PrismaService } from '../common/prisma.service.js';
import { addDays, dateOnly, romeToUtc, todayInRome } from '../common/time.js';
import { loadEnv } from '../config/env.js';
import { MOCK_USERS } from '../auth/mock-identity.provider.js';
import { PoliciesService } from '../policies/policies.service.js';
import { StatsService } from '../stats/stats.service.js';

const COMUNI = { MILANO: '015146', MONZA: '108033', SESTO: '015209', BERGAMO: '016024' };
const SITE_NAME = 'Sede di Milano';

/** Utenti creati già con il primo accesso completato. paolo.gialli resta libero per provare il primo accesso. */
const PEOPLE = [
  { username: 'admin', comune: COMUNI.MILANO },
  { username: 'mario.rossi', comune: COMUNI.BERGAMO, phone: '+39 333 1111111', fuel: 'DIESEL' as const, consumption: 5.5, discoverable: true },
  { username: 'laura.bianchi', comune: COMUNI.MONZA, phone: '+39 333 2222222', discoverable: true },
  { username: 'giuseppe.verdi', comune: COMUNI.SESTO, discoverable: true },
  { username: 'anna.neri', comune: COMUNI.MONZA },
];

type Ids = Record<string, string>;

async function main(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    // variabili già nell'ambiente
  }
  // I job in coda verrebbero eseguiti: qui non servono (nessuna notifica viene inviata).
  process.env['JOBS_ENABLED'] = 'false';
  const env = loadEnv();
  if (env.NODE_ENV === 'production' || env.AUTH_PROVIDER !== 'mock') {
    throw new Error('Dati di esempio ammessi solo in sviluppo con AUTH_PROVIDER=mock');
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    const crypto = app.get(CryptoService);
    const stats = app.get(StatsService);
    const policies = app.get(PoliciesService);
    const now = app.get(Clock).now();
    const today = todayInRome(now);

    const site = await prisma.site.findUnique({ where: { name: SITE_NAME } });
    if (!site) throw new Error(`Sede "${SITE_NAME}" non trovata: lanciare prima npm run db:seed -w api`);

    // ---------- pulizia ----------
    await prisma.$executeRawUnsafe(`TRUNCATE "ChatMessage", "ChatMute", "PushSubscription", "Invitation", "TripParticipant",
      "Trip", "TripStop", "TripSeries", "PolicyAcceptance", "ConsentEvent", "UserConsent", "RoleAssignment", "Session",
      "LoginThrottle", "EmailVerification", "TripStatFact", "UserStatEntry", "Favorite", "AbsenceReport", "User" CASCADE`);

    // ---------- utenti ----------
    const docs = await policies.current();
    const ids: Ids = {};
    for (const p of PEOPLE) {
      const who = MOCK_USERS[p.username]!;
      const u = await prisma.user.create({
        data: {
          username: p.username,
          firstName: who.firstName,
          lastName: who.lastName,
          siteId: site.id,
          comuneIstat: p.comune,
          phoneEnc: crypto.encryptNullable(p.phone),
          emailEnc: crypto.encrypt(`${p.username}@example.test`),
          emailVerifiedAt: now,
          fuelType: p.fuel ?? null,
          consumptionPer100km: p.consumption ?? null,
          onboardedAt: now,
          lastLoginAt: now,
          lastVerifiedAt: now,
          consent: { create: { phoneVisible: Boolean(p.phone), discoverable: Boolean(p.discoverable), optionalNotifications: true } },
          policyAcceptances: { create: docs.map((d) => ({ documentId: d.id })) },
        },
      });
      ids[p.username] = u.id;
      await prisma.consentEvent.createMany({
        data: [
          ...(p.phone ? [{ userId: u.id, consent: 'phoneVisible', granted: true }] : []),
          ...(p.discoverable ? [{ userId: u.id, consent: 'discoverable', granted: true }] : []),
          { userId: u.id, consent: 'optionalNotifications', granted: true },
        ],
      });
    }
    await prisma.roleAssignment.createMany({
      data: [
        { userId: ids['admin']!, role: 'GLOBAL_ADMIN' },
        { userId: ids['giuseppe.verdi']!, role: 'SITE_ADMIN', siteId: site.id },
      ],
    });
    await prisma.favorite.create({ data: { userId: ids['laura.bianchi']!, favoriteUserId: ids['mario.rossi']! } });

    // ---------- viaggi ----------
    interface TripSpec {
      driver: string;
      daysFromToday: number;
      arrival?: string;
      ret?: string | null;
      stops: string[];
      visibility?: 'PUBLIC' | 'PRIVATE';
      seats?: number;
      /** username → comune di salita */
      passengers?: Record<string, string>;
      /** chiuso con questi presenti (gli altri passeggeri risultano assenti) */
      closedWith?: string[];
      cancelled?: boolean;
      notes?: string;
    }
    const createTrip = async (t: TripSpec): Promise<string> => {
      const date = addDays(today, t.daysFromToday);
      const arrival = t.arrival ?? '08:30';
      const ret = t.ret === undefined ? '17:30' : t.ret;
      const series = await prisma.tripSeries.create({
        data: {
          driverId: ids[t.driver]!,
          siteId: site.id,
          visibility: t.visibility ?? 'PUBLIC',
          startDate: dateOnly(date),
          endDate: dateOnly(date),
          arrivalTime: arrival,
          returnTime: ret,
          seats: t.seats ?? 3,
          meetingPoint: 'Parcheggio della stazione',
          notes: t.notes ?? null,
          stops: { create: t.stops.map((comuneIstat, order) => ({ order, comuneIstat })) },
        },
      });
      const trip = await prisma.trip.create({
        data: {
          seriesId: series.id,
          siteId: site.id,
          date: dateOnly(date),
          arrivalTime: arrival,
          returnTime: ret,
          arrivalAt: romeToUtc(date, arrival),
          seats: t.seats ?? 3,
          favoritesNotifiedAt: now,
          participants: {
            create: Object.entries(t.passengers ?? {}).map(([u, boardingComune]) => ({
              userId: ids[u]!,
              status: 'ACCEPTED' as const,
              boardingComune,
              decidedAt: now,
            })),
          },
        },
      });
      if (t.cancelled) {
        await prisma.trip.update({ where: { id: trip.id }, data: { status: 'CANCELLED', cancelledAt: romeToUtc(addDays(date, -1), '18:00') } });
      }
      await stats.syncFact(trip.id);
      if (t.closedWith) {
        const present = t.closedWith.map((u) => ids[u]!);
        const plan = await stats.planClosure(trip.id, present);
        await prisma.$transaction(async (tx) => {
          await tx.trip.update({ where: { id: trip.id }, data: { status: 'CLOSED', closedAt: romeToUtc(date, '18:00') } });
          await tx.tripParticipant.updateMany({ where: { tripId: trip.id }, data: { attended: false } });
          await tx.tripParticipant.updateMany({ where: { tripId: trip.id, userId: { in: present } }, data: { attended: true } });
          await stats.writeClosure(tx, plan);
        });
      }
      return trip.id;
    };

    const route = [COMUNI.BERGAMO, COMUNI.MONZA, COMUNI.SESTO];
    // Storico concluso (statistiche personali e dashboard).
    const history: [number, string[]][] = [
      [-35, ['laura.bianchi', 'anna.neri']],
      [-28, ['laura.bianchi']],
      [-21, ['laura.bianchi', 'giuseppe.verdi']],
      [-14, ['laura.bianchi', 'anna.neri', 'giuseppe.verdi']],
      [-7, ['laura.bianchi']],
    ];
    for (const [days, present] of history) {
      const pax: Record<string, string> = {};
      for (const u of present) pax[u] = u === 'giuseppe.verdi' ? COMUNI.SESTO : COMUNI.MONZA;
      await createTrip({ driver: 'mario.rossi', daysFromToday: days, stops: route, passengers: pax, closedWith: present });
    }
    // Viaggio privato concluso di Laura con Anna, senza ritorno.
    await createTrip({
      driver: 'laura.bianchi',
      daysFromToday: -10,
      ret: null,
      stops: [COMUNI.MONZA],
      visibility: 'PRIVATE',
      passengers: { 'anna.neri': COMUNI.MONZA },
      closedWith: ['anna.neri'],
    });
    // Viaggio annullato.
    await createTrip({ driver: 'mario.rossi', daysFromToday: -17, stops: route, cancelled: true });

    // Chiuso due giorni fa con Anna assente: Laura può segnalarla (Viaggi recenti).
    await createTrip({
      driver: 'mario.rossi',
      daysFromToday: -2,
      stops: route,
      passengers: { 'laura.bianchi': COMUNI.MONZA, 'anna.neri': COMUNI.MONZA },
      closedWith: ['laura.bianchi'],
    });
    // Da chiudere: ieri, Laura e Giuseppe confermati (Mario lo trova in "Viaggi da chiudere").
    await createTrip({
      driver: 'mario.rossi',
      daysFromToday: -1,
      stops: route,
      passengers: { 'laura.bianchi': COMUNI.MONZA, 'giuseppe.verdi': COMUNI.SESTO },
    });
    // Segnalazione già aperta, per l'area admin: Mario segnala Anna per il viaggio di due giorni fa.
    const twoDaysAgo = await prisma.trip.findFirstOrThrow({ where: { date: dateOnly(addDays(today, -2)) } });
    await prisma.absenceReport.create({
      data: {
        tripId: twoDaysAgo.id,
        siteId: site.id,
        tripDate: twoDaysAgo.date,
        reporterId: ids['mario.rossi']!,
        reportedId: ids['anna.neri']!,
        reasonEnc: crypto.encrypt('Non si è presentata al parcheggio e non ha risposto ai messaggi. Abbiamo aspettato 10 minuti.'),
      },
    });

    // Futuri.
    const tomorrow = await createTrip({
      driver: 'mario.rossi',
      daysFromToday: 1,
      stops: route,
      passengers: { 'laura.bianchi': COMUNI.MONZA },
      notes: 'Auto grigia, targa sul cruscotto',
    });
    await createTrip({ driver: 'laura.bianchi', daysFromToday: 3, arrival: '09:00', stops: [COMUNI.MONZA, COMUNI.SESTO], seats: 2 });
    await createTrip({ driver: 'giuseppe.verdi', daysFromToday: 2, stops: [COMUNI.SESTO], visibility: 'PRIVATE', seats: 2 });

    const series = await prisma.trip.findUniqueOrThrow({ where: { id: tomorrow }, select: { seriesId: true, date: true } });
    await prisma.chatMessage.createMany({
      data: [
        { seriesId: series.seriesId, tripDate: series.date, senderId: ids['mario.rossi']!, kind: 'TEXT', bodyEnc: crypto.encrypt('Domani partenza puntuale alle 7:40 dal parcheggio') },
        { seriesId: series.seriesId, tripDate: series.date, senderId: ids['laura.bianchi']!, kind: 'QUICK', quickCode: 'AT_MEETING_POINT' },
      ],
    });

    console.log('Dati di esempio creati (password di tutte le utenze: demo):');
    console.log('  admin            admin globale');
    console.log('  giuseppe.verdi   admin della Sede di Milano');
    console.log('  mario.rossi      conducente: storico, un viaggio da chiudere, uno domani');
    console.log('  laura.bianchi    passeggera: può segnalare Anna nei "Viaggi recenti"');
    console.log('  anna.neri        passeggera, con una segnalazione aperta');
    console.log('  paolo.gialli     non creato: per provare il primo accesso');
  } finally {
    await app.close();
  }
}

await main();
