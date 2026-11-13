import { Injectable } from '@nestjs/common';
import { NotFound } from '../common/errors.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../common/prisma.service.js';
import type { ParticipantStatus, TripVisibility } from '../generated/prisma/client.js';
import { type LoadedTrip, tripInclude } from './trip-loader.js';

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
