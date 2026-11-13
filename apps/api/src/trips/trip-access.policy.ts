import { Injectable } from '@nestjs/common';
import { NotFound } from '../common/errors.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../common/prisma.service.js';
import type { AbsenceReportOptionsDto } from '@fcs/shared';
import type { ParticipantStatus, TripVisibility } from '../generated/prisma/client.js';
import { SettingsService } from '../settings/settings.service.js';
import { type LoadedTrip, tripInclude } from './trip-loader.js';

export type AbsenceCandidate = AbsenceReportOptionsDto['candidates'][number];

/** Stati di partecipazione che danno diritto a vedere un viaggio privato. */
const VIEWING_STATUSES: ParticipantStatus[] = ['REQUESTED', 'ACCEPTED', 'WAITLISTED', 'NOT_THERE'];

export interface TripContext {
  trip: LoadedTrip;
  userId: string;
  visibility: TripVisibility;
  isDriver: boolean;
  participant: LoadedTrip['participants'][number] | undefined;
  /** Invito personale valido (per la data o per la serie). */
  hasInvitation: boolean;
  invitationId: string | undefined;
}

export function effectiveVisibility(trip: { visibilityOverride: TripVisibility | null; series: { visibility: TripVisibility } }): TripVisibility {
  return trip.visibilityOverride ?? trip.series.visibility;
}

/**
 * UNICO punto che decide chi può vedere e fare cosa su un viaggio.
 * Regola chiave: un viaggio PRIVATO è invisibile (404, non 403) a chi non è
 * conducente, partecipante o invitato, così non se ne rivela nemmeno l'esistenza.
 */
@Injectable()
export class TripAccessPolicy {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly settings: SettingsService,
  ) {}

  async load(tripId: string, userId: string): Promise<TripContext> {
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId }, include: tripInclude });
    if (!trip) throw NotFound('Viaggio');
    const isDriver = trip.series.driverId === userId;
    const participant = trip.participants.find((p) => p.userId === userId);
    const invitation = isDriver
      ? null
      : await this.prisma.invitation.findFirst({
          where: {
            inviteeId: userId,
            status: 'PENDING',
            expiresAt: { gt: this.clock.now() },
            OR: [{ tripId }, { tripId: null, seriesId: trip.seriesId }],
          },
          select: { id: true },
        });
    return {
      trip,
      userId,
      visibility: effectiveVisibility(trip),
      isDriver,
      participant,
      hasInvitation: Boolean(invitation),
      invitationId: invitation?.id,
    };
  }

  /** Carica il viaggio e verifica che l'utente possa vederlo, altrimenti 404. */
  async loadVisible(tripId: string, userId: string): Promise<TripContext> {
    const ctx = await this.load(tripId, userId);
    if (!this.canView(ctx)) throw NotFound('Viaggio');
    return ctx;
  }

  canView(ctx: TripContext): boolean {
    if (ctx.isDriver || ctx.hasInvitation) return true;
    if (ctx.participant && VIEWING_STATUSES.includes(ctx.participant.status)) return true;
    return ctx.visibility === 'PUBLIC';
  }

  /** Membro confermato: conducente o partecipante accettato. */
  isConfirmedMember(ctx: TripContext): boolean {
    return ctx.isDriver || ctx.participant?.status === 'ACCEPTED';
  }

  /** Può vedere la lista dei partecipanti (minimizzazione: non chi guarda un viaggio pubblico da esterno). */
  canSeeParticipants(ctx: TripContext): boolean {
    return this.isConfirmedMember(ctx);
  }

  /**
   * Il telefono di X è visibile a Y solo se entrambi sono membri confermati
   * dello stesso viaggio e X ha dato il consenso alla visibilità.
   */
  canSeePhoneOf(ctx: TripContext, targetPhoneVisibleConsent: boolean | undefined): boolean {
    return this.isConfirmedMember(ctx) && Boolean(targetPhoneVisibleConsent);
  }

  /**
   * Segnalazioni di assenza: chi l'utente del contesto può segnalare. Regole:
   * - viaggio con orario di arrivo passato da non più di closureWindowDays;
   * - chi segnala: il conducente (non per viaggi annullati) o un partecipante
   *   confermato (se il viaggio è chiuso, solo se era presente);
   * - segnalabili: il partecipante assente alla chiusura; il partecipante che ha
   *   annullato oltre la scadenza; il conducente, se non ha chiuso il viaggio
   *   (possibile mancata presentazione) o lo ha annullato oltre la scadenza.
   */
  async absenceReportCandidates(ctx: TripContext): Promise<{ candidates: AbsenceCandidate[]; deadline: Date }> {
    const { trip } = ctx;
    const now = this.clock.now();
    const s = await this.settings.get();
    const deadline = new Date(trip.arrivalAt.getTime() + s.closureWindowDays * 86_400_000);
    if (now < trip.arrivalAt || now > deadline) return { candidates: [], deadline };

    const me = ctx.participant;
    const cancelled = trip.status === 'CANCELLED';
    const closed = trip.status === 'CLOSED';
    const isReporter = ctx.isDriver ? !cancelled : me?.status === 'ACCEPTED' && (!closed || me.attended === true);
    if (!isReporter) return { candidates: [], deadline };

    const out: AbsenceCandidate[] = [];
    const summary = (u: { id: string; firstName: string; lastName: string }) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName });
    if (!cancelled) {
      for (const p of trip.participants) {
        if (p.userId === ctx.userId) continue;
        if (p.status === 'ACCEPTED' && closed && p.attended === false) out.push({ ...summary(p.user), why: 'NO_SHOW' });
        if (p.status === 'CANCELLED' && p.lateCancel) out.push({ ...summary(p.user), why: 'LATE_CANCEL' });
      }
    }
    if (!ctx.isDriver) {
      const cancelDeadline = new Date(trip.arrivalAt.getTime() - s.cancellationDeadlineHours * 3600_000);
      const lateCancelByDriver = cancelled && trip.cancelledAt !== null && trip.cancelledAt > cancelDeadline;
      if (lateCancelByDriver || trip.status === 'SCHEDULED') {
        out.push({ ...summary(trip.series.driver), why: lateCancelByDriver ? 'LATE_CANCEL' : 'DRIVER_NO_SHOW' });
      }
    }
    return { candidates: out, deadline };
  }

  /** Accesso alla chat della serie: conducente o partecipante accettato di almeno una data non annullata. */
  async canChat(seriesId: string, userId: string): Promise<boolean> {
    const series = await this.prisma.tripSeries.findUnique({ where: { id: seriesId }, select: { driverId: true } });
    if (!series) return false;
    if (series.driverId === userId) return true;
    const accepted = await this.prisma.tripParticipant.count({
      where: { userId, status: 'ACCEPTED', trip: { seriesId, status: { not: 'CANCELLED' } } },
    });
    return accepted > 0;
  }
}
