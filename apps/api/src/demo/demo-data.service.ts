import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { DemoAccountDto } from '@fcs/shared';
import { AuditService } from '../audit/audit.service.js';
import { MOCK_USERS } from '../auth/mock-identity.provider.js';
import { Clock } from '../common/clock.js';
import { CryptoService } from '../common/crypto.service.js';
import { PrismaService } from '../common/prisma.service.js';
import { addDays, dateOnly, romeToUtc, todayInRome } from '../common/time.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { PoliciesService } from '../policies/policies.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { StatsService } from '../stats/stats.service.js';

const COMUNI = { MILANO: '015146', MONZA: '108033', SESTO: '015209', BERGAMO: '016024' };
const SITE_NAME = 'Sede di Milano';

/** Sedi di esempio: le stesse create da prisma/seed.mjs fuori produzione o in demo. */
export const DEMO_SITES = [
  { name: 'Sede di Milano', address: 'Via di Esempio 1, Milano', comuneIstat: '015146' },
  { name: 'Sede di Roma', address: 'Via di Esempio 2, Roma', comuneIstat: '058091' },
  { name: 'Sede di Torino', address: 'Via di Esempio 3, Torino', comuneIstat: '001272' },
];

/** Utenze di prova mostrate nella pagina di login della demo (password: demo). */
export const DEMO_ACCOUNTS: DemoAccountDto[] = [
  { username: 'admin', label: 'Amministratore globale' },
  { username: 'giuseppe.verdi', label: 'Amministratore della Sede di Milano' },
  { username: 'mario.rossi', label: 'Conducente: storico, un viaggio da chiudere, uno domani' },
  { username: 'laura.bianchi', label: 'Passeggera: può segnalare un’assenza' },
  { username: 'anna.neri', label: 'Passeggera con una segnalazione aperta' },
  { username: 'paolo.gialli', label: 'Nuovo utente: prova il primo accesso' },
];

/** Utenti creati già con il primo accesso completato. paolo.gialli resta libero per provare il primo accesso. */
const PEOPLE = [
  { username: 'admin', comune: COMUNI.MILANO },
  { username: 'mario.rossi', comune: COMUNI.BERGAMO, phone: '+39 333 1111111', fuel: 'DIESEL' as const, consumption: 5.5, discoverable: true },
  { username: 'laura.bianchi', comune: COMUNI.MONZA, phone: '+39 333 2222222', discoverable: true },
  { username: 'giuseppe.verdi', comune: COMUNI.SESTO, discoverable: true },
  { username: 'anna.neri', comune: COMUNI.MONZA },
];

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

/**
 * Dati di esempio (utenti fittizi, viaggi conclusi e futuri, una segnalazione,
 * qualche messaggio). Le date sono relative a oggi.
 *
 * Usati da `npm run db:demo` in sviluppo e, in modalità demo (DEMO_MODE), al
 * primo avvio e dal pulsante "Riporta la demo allo stato iniziale".
 * Cancella utenti, viaggi, chat, segnalazioni, statistiche, parametri e sedi o
 * testi legali aggiunti; restano comuni e audit log (immutabile per costruzione).
 */
@Injectable()
export class DemoDataService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Demo');

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly stats: StatsService,
    private readonly policies: PoliciesService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /** Demo: al primo avvio (nessun utente nel database) si caricano i dati di esempio. */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.env.DEMO_MODE) return;
    if ((await this.prisma.user.count()) > 0) return;
    await this.reset();
    this.logger.log('dati di esempio caricati (primo avvio della demo)');
  }

  /** Ripristino richiesto da un admin globale (solo modalità demo). */
  async resetByAdmin(actorId: string): Promise<void> {
    await this.reset();
    await this.audit.record({ actorId, action: 'DEMO_RESET' });
  }

  /** Riporta il database allo stato iniziale della demo. */
  async reset(): Promise<void> {
    const prisma = this.prisma;
    const now = this.clock.now();
    const today = todayInRome(now);

    // ---------- pulizia ----------
    await prisma.$executeRawUnsafe(`TRUNCATE "ChatMessage", "ChatMute", "PushSubscription", "Invitation", "TripParticipant",
      "Trip", "TripStop", "TripSeries", "SeriesMember", "PolicyAcceptance", "ConsentEvent", "UserConsent", "RoleAssignment",
      "Session", "LoginThrottle", "Setting", "EmailVerification", "TripStatFact", "UserStatEntry", "Favorite", "AbsenceReport",
      "User" CASCADE`);
    // Notifiche ancora in coda: riguarderebbero utenti appena cancellati.
    const queue = await prisma.$queryRaw<{ t: string | null }[]>`SELECT to_regclass('pgboss.job')::text AS t`;
    if (queue[0]?.t) {
      await prisma.$executeRawUnsafe(`DELETE FROM pgboss.job WHERE name IN ('notify', 'chat-push') AND state IN ('created', 'retry')`);
    }
    // Sedi e testi legali tornano quelli iniziali; parametri ai default.
    await prisma.site.deleteMany({ where: { name: { notIn: DEMO_SITES.map((s) => s.name) } } });
    for (const s of DEMO_SITES) {
      await prisma.site.upsert({
        where: { name: s.name },
        create: s,
        update: { address: s.address, comuneIstat: s.comuneIstat, active: true },
      });
    }
    await prisma.policyDocument.deleteMany({ where: { version: { gt: 1 } } });
    this.settings.invalidate();
    this.policies.invalidate();

    const site = await prisma.site.findUniqueOrThrow({ where: { name: SITE_NAME } });

    // ---------- utenti ----------
    const docs = await this.policies.current();
    const ids: Record<string, string> = {};
    for (const p of PEOPLE) {
      const who = MOCK_USERS[p.username]!;
      const u = await prisma.user.create({
        data: {
          username: p.username,
          firstName: who.firstName,
          lastName: who.lastName,
          siteId: site.id,
          comuneIstat: p.comune,
          phoneEnc: this.crypto.encryptNullable(p.phone),
          emailEnc: this.crypto.encrypt(`${p.username}@example.test`),
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
          // I promemoria dei viaggi di esempio già passati non vanno inviati.
          ...(t.daysFromToday < 0 ? { eveningReminderAt: now, departureReminderAt: now } : {}),
          participants: {
            create: Object.entries(t.passengers ?? {}).map(([u, boardingComune]) => ({
              userId: ids[u]!,
              status: 'ACCEPTED' as const,
              boardingComune,
              decidedAt: now,
              ...(t.daysFromToday < 0 ? { reminderSentAt: now } : {}),
            })),
          },
        },
      });
      if (t.cancelled) {
        await prisma.trip.update({ where: { id: trip.id }, data: { status: 'CANCELLED', cancelledAt: romeToUtc(addDays(date, -1), '18:00') } });
      }
      await this.stats.syncFact(trip.id);
      if (t.closedWith) {
        const present = t.closedWith.map((u) => ids[u]!);
        const plan = await this.stats.planClosure(trip.id, present);
        await prisma.$transaction(async (tx) => {
          await tx.trip.update({ where: { id: trip.id }, data: { status: 'CLOSED', closedAt: romeToUtc(date, '18:00') } });
          await tx.tripParticipant.updateMany({ where: { tripId: trip.id }, data: { attended: false } });
          await tx.tripParticipant.updateMany({ where: { tripId: trip.id, userId: { in: present } }, data: { attended: true } });
          await this.stats.writeClosure(tx, plan);
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
    const twoDaysAgo = await createTrip({
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
    const reported = await prisma.trip.findUniqueOrThrow({ where: { id: twoDaysAgo }, select: { id: true, date: true } });
    await prisma.absenceReport.create({
      data: {
        tripId: reported.id,
        siteId: site.id,
        tripDate: reported.date,
        reporterId: ids['mario.rossi']!,
        reportedId: ids['anna.neri']!,
        reasonEnc: this.crypto.encrypt('Non si è presentata al parcheggio e non ha risposto ai messaggi. Abbiamo aspettato 10 minuti.'),
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
        {
          seriesId: series.seriesId,
          tripDate: series.date,
          senderId: ids['mario.rossi']!,
          kind: 'TEXT',
          bodyEnc: this.crypto.encrypt('Domani partenza puntuale alle 7:40 dal parcheggio'),
        },
        { seriesId: series.seriesId, tripDate: series.date, senderId: ids['laura.bianchi']!, kind: 'QUICK', quickCode: 'AT_MEETING_POINT' },
      ],
    });
  }
}
