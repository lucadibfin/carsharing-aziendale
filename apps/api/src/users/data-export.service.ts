import { Injectable } from '@nestjs/common';
import { QUICK_MESSAGES, type QuickMessageCode } from '@fcs/shared';
import { AuditService } from '../audit/audit.service.js';
import { NotFound } from '../common/errors.js';
import { Clock } from '../common/clock.js';
import { CryptoService } from '../common/crypto.service.js';
import { PrismaService } from '../common/prisma.service.js';
import { toIsoDate } from '../common/time.js';

const name = (u: { firstName: string; lastName: string } | null | undefined) => (u ? `${u.firstName} ${u.lastName}` : null);
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

/**
 * Esportazione di TUTTI i dati personali dell'utente (diritto di accesso, art. 15,
 * e portabilità, art. 20) in JSON leggibile.
 *
 * Scelte (da validare con il DPO, vedi documento tecnico):
 * - dei colleghi compaiono solo i nomi già noti all'utente nell'app (conducente dei
 *   viaggi a cui ha partecipato, preferiti, persone che ha segnalato);
 * - nelle segnalazioni RICEVUTE non compare chi ha segnalato (art. 15 par. 4: diritti
 *   altrui) né la nota interna dell'admin; compaiono data, motivazione e stato;
 * - nessun token, hash o chiave tecnica.
 */
@Injectable()
export class DataExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  async export(userId: string): Promise<Record<string, unknown>> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        site: { select: { name: true } },
        consent: true,
        roles: { include: { site: { select: { name: true } } } },
        emailVerification: true,
        policyAcceptances: { include: { document: { select: { type: true, version: true, title: true } } }, orderBy: { acceptedAt: 'asc' } },
        sessions: { orderBy: { createdAt: 'desc' } },
        pushSubscriptions: true,
        chatMutes: true,
        favorites: { include: { favorite: { select: { firstName: true, lastName: true } } } },
        statEntries: { orderBy: { date: 'asc' } },
      },
    });
    if (!u) throw NotFound('Utente');
    const comuni = new Map<string, string>();
    const comuneName = async (istat: string | null) => {
      if (!istat) return null;
      if (!comuni.has(istat)) comuni.set(istat, (await this.prisma.comune.findUnique({ where: { istat } }))?.name ?? istat);
      return comuni.get(istat)!;
    };

    const consentHistory = await this.prisma.consentEvent.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    const driven = await this.prisma.trip.findMany({
      where: { series: { driverId: userId } },
      include: {
        series: { include: { site: { select: { name: true } }, stops: { orderBy: { order: 'asc' }, include: { comune: { select: { name: true } } } } } },
        participants: { select: { status: true, attended: true } },
      },
      orderBy: { date: 'asc' },
    });
    const participations = await this.prisma.tripParticipant.findMany({
      where: { userId },
      include: { trip: { include: { series: { include: { site: { select: { name: true } }, driver: { select: { firstName: true, lastName: true } } } } } } },
      orderBy: { requestedAt: 'asc' },
    });
    const invitationsReceived = await this.prisma.invitation.findMany({ where: { inviteeId: userId }, include: { trip: { select: { date: true } } } });
    const invitationsCreated = await this.prisma.invitation.findMany({ where: { createdById: userId }, include: { trip: { select: { date: true } } } });
    const messages = await this.prisma.chatMessage.findMany({ where: { senderId: userId }, orderBy: { createdAt: 'asc' } });
    const reportsMade = await this.prisma.absenceReport.findMany({ where: { reporterId: userId }, include: { reported: { select: { firstName: true, lastName: true } } } });
    const reportsReceived = await this.prisma.absenceReport.findMany({ where: { reportedId: userId } });
    const sites = new Map((await this.prisma.site.findMany({ select: { id: true, name: true } })).map((s) => [s.id, s.name]));

    const data = {
      informazioni: {
        esportatoIl: this.clock.now().toISOString(),
        contenuto:
          'Tutti i dati personali che l’app Car Sharing conserva su di te. Restano esclusi solo i dati statistici anonimi, ' +
          'non riconducibili a te. Per domande scrivi al DPO indicato nell’informativa.',
      },
      account: {
        id: u.id,
        username: u.username,
        nome: u.firstName,
        cognome: u.lastName,
        stato: u.status,
        registratoIl: iso(u.createdAt),
        primoAccessoCompletatoIl: iso(u.onboardedAt),
        ultimoAccesso: iso(u.lastLoginAt),
        ultimaVerificaDipendente: iso(u.lastVerifiedAt),
        sede: u.site?.name ?? null,
        comuneDiResidenza: await comuneName(u.comuneIstat),
        // Avviso non ancora chiuso: comune precedente, cambiato per fusione o incorporazione.
        comunePrecedenteDaAvvisare: u.comuneChangedFrom,
        telefono: this.crypto.decryptNullable(u.phoneEnc),
        auto: { alimentazione: u.fuelType, consumoOgni100km: u.consumptionPer100km },
        ruoli: u.roles.map((r) => ({ ruolo: r.role, sede: r.site?.name ?? null, dal: iso(r.createdAt) })),
      },
      email: {
        indirizzo: this.crypto.decryptNullable(u.emailEnc),
        verificataIl: iso(u.emailVerifiedAt),
        inVerifica: u.emailVerification
          ? { indirizzo: this.crypto.decrypt(u.emailVerification.emailEnc), scadeIl: iso(u.emailVerification.expiresAt) }
          : null,
      },
      consensi: {
        attuali: {
          telefonoVisibile: u.consent?.phoneVisible ?? false,
          trovabileNegliInviti: u.consent?.discoverable ?? false,
          notificheFacoltative: u.consent?.optionalNotifications ?? false,
        },
        storico: consentHistory.map((c) => ({ consenso: c.consent, concesso: c.granted, il: iso(c.createdAt) })),
      },
      informativaETermini: u.policyAcceptances.map((a) => ({
        documento: a.document.title,
        tipo: a.document.type,
        versione: a.document.version,
        accettatoIl: iso(a.acceptedAt),
      })),
      sessioni: u.sessions.map((s) => ({ apertaIl: iso(s.createdAt), ultimoUso: iso(s.lastSeenAt), scadeIl: iso(s.absoluteExpiresAt) })),
      notifichePush: u.pushSubscriptions.map((p) => ({ servizio: new URL(p.endpoint).host, attivataIl: iso(p.createdAt) })),
      viaggiComeConducente: await Promise.all(
        driven.map(async (t) => ({
          data: toIsoDate(t.date),
          sede: t.series.site.name,
          arrivo: t.arrivalTime,
          ripartenza: t.returnTime,
          percorso: t.series.stops.map((s) => s.comune.name),
          puntoDiIncontro: t.series.meetingPoint,
          note: t.series.notes,
          posti: t.seats,
          visibilita: t.visibilityOverride ?? t.series.visibility,
          stato: t.status,
          partecipantiConfermati: t.participants.filter((p) => p.status === 'ACCEPTED').length,
          presenti: t.status === 'CLOSED' ? t.participants.filter((p) => p.attended).length : null,
        })),
      ),
      partecipazioni: await Promise.all(
        participations.map(async (p) => ({
          data: toIsoDate(p.trip.date),
          sede: p.trip.series.site.name,
          arrivo: p.trip.arrivalTime,
          conducente: name(p.trip.series.driver),
          comuneDiSalita: await comuneName(p.boardingComune),
          stato: p.status,
          richiestaIl: iso(p.requestedAt),
          annullataIl: iso(p.cancelledAt),
          annullataOltreLaScadenza: p.lateCancel,
          presente: p.attended,
        })),
      ),
      inviti: {
        ricevuti: invitationsReceived.map((i) => ({ viaggioDel: i.trip ? toIsoDate(i.trip.date) : null, stato: i.status, il: iso(i.createdAt), scadenza: iso(i.expiresAt) })),
        creati: invitationsCreated.map((i) => ({
          viaggioDel: i.trip ? toIsoDate(i.trip.date) : null,
          tipo: i.tokenHash ? 'link' : 'personale',
          stato: i.status,
          il: iso(i.createdAt),
        })),
      },
      messaggiChatInviati: messages.map((m) => ({
        viaggioDel: toIsoDate(m.tripDate),
        il: iso(m.createdAt),
        testo: m.kind === 'QUICK' ? (QUICK_MESSAGES[m.quickCode as QuickMessageCode] ?? m.quickCode) : this.crypto.decryptNullable(m.bodyEnc),
      })),
      chatSilenziate: u.chatMutes.length,
      colleghiPreferiti: u.favorites.map((f) => name(f.favorite)),
      segnalazioniDiAssenza: {
        inviate: reportsMade.map((r) => ({
          viaggioDel: toIsoDate(r.tripDate),
          sede: sites.get(r.siteId) ?? null,
          personaSegnalata: name(r.reported),
          motivazione: this.crypto.decrypt(r.reasonEnc),
          stato: r.status,
          il: iso(r.createdAt),
        })),
        ricevute: reportsReceived.map((r) => ({
          viaggioDel: toIsoDate(r.tripDate),
          sede: sites.get(r.siteId) ?? null,
          motivazione: this.crypto.decrypt(r.reasonEnc),
          stato: r.status,
          gestitaIl: iso(r.handledAt),
          il: iso(r.createdAt),
        })),
      },
      statistichePersonali: u.statEntries.map((s) => ({
        data: toIsoDate(s.date),
        ruolo: s.role,
        kmCondivisi: s.sharedKm,
        kmEvitati: s.kmAvoided,
        co2RisparmiataKg: s.co2SavedKg,
        carburanteRisparmiato: `${s.fuelSaved} ${s.fuelUnit}`,
        euroRisparmiati: s.eurSaved,
        distanzeStimate: s.estimated,
      })),
    };
    await this.audit.record({ actorId: userId, action: 'USER_DATA_EXPORT', targetType: 'User', targetId: userId });
    return data;
  }
}
