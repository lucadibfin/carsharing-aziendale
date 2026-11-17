import { HttpStatus, Injectable } from '@nestjs/common';
import type { TripDetailDto } from '@fcs/shared';
import { AppException, Conflict, Forbidden, NotFound } from '../common/errors.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../common/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { StatsService } from '../stats/stats.service.js';
import { ChatMembershipEvents } from './chat-membership.events.js';
import { lockFreeSeat, TRIP_FULL } from './seats.js';
import { SeriesService } from './series.service.js';
import { TripAccessPolicy } from './trip-access.policy.js';
import { TripsService } from './trips.service.js';
import { WaitlistService } from './waitlist.service.js';

@Injectable()
export class ParticipationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: TripAccessPolicy,
    private readonly trips: TripsService,
    private readonly clock: Clock,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly chatEvents: ChatMembershipEvents,
    private readonly stats: StatsService,
    private readonly waitlist: WaitlistService,
    private readonly series: SeriesService,
  ) {}

  /**
   * Richiesta di partecipazione: solo viaggi PUBBLICI (i privati non accettano richieste esterne).
   * Viaggio al completo: con waitlist = true si entra in lista d'attesa, altrimenti TRIP_FULL.
   * Chi è in lista d'attesa e trova un posto libero rinnova la richiesta con la stessa chiamata.
   */
  async request(tripId: string, userId: string, boardingComune: string, waitlist = false): Promise<TripDetailDto> {
    const ctx = await this.policy.loadVisible(tripId, userId);
    if (ctx.isDriver) throw new AppException('OWN_TRIP', 'Sei il conducente di questo viaggio');
    if (ctx.isSeriesMember) throw Conflict('ALREADY_MEMBER', 'Fai già parte del gruppo fisso di questo viaggio');
    if (ctx.visibility !== 'PUBLIC') throw NotFound('Viaggio');
    this.trips.assertOpen(ctx.trip);
    this.assertStop(ctx.trip.series.stops, boardingComune);

    const existing = ctx.participant;
    const full = ctx.trip.participants.filter((p) => p.status === 'ACCEPTED').length >= ctx.trip.seats;
    if (existing?.status === 'WAITLISTED') {
      if (full) throw Conflict('ALREADY_REQUESTED', 'Sei già in lista d’attesa per questo viaggio');
    } else if (existing && ['REQUESTED', 'ACCEPTED'].includes(existing.status)) {
      throw Conflict('ALREADY_REQUESTED', 'Hai già una richiesta per questo viaggio');
    }
    if (existing?.status === 'REJECTED') {
      throw Conflict('REQUEST_REJECTED', 'Il conducente non ha accettato la tua richiesta per questo viaggio');
    }
    if (full && !waitlist) throw TRIP_FULL();

    const status = full ? ('WAITLISTED' as const) : ('REQUESTED' as const);
    const now = this.clock.now();
    await this.prisma.tripParticipant.upsert({
      where: { tripId_userId: { tripId, userId } },
      create: { tripId, userId, status, boardingComune, requestedAt: now },
      update: {
        status,
        boardingComune,
        // Chi rinnova la richiesta dalla lista d'attesa mantiene la sua posizione.
        ...(existing?.status === 'WAITLISTED' ? {} : { requestedAt: now }),
        decidedAt: null,
        cancelledAt: null,
        lateCancel: false,
      },
    });
    if (status === 'REQUESTED') await this.notifications.notify([ctx.trip.series.driverId], 'JOIN_REQUEST', tripId);
    return this.trips.detail(tripId, userId);
  }

  async accept(tripId: string, participantId: string, driverId: string): Promise<TripDetailDto> {
    const ctx = await this.driverCtx(tripId, driverId);
    const p = ctx.trip.participants.find((x) => x.id === participantId);
    if (!p) throw NotFound('Richiesta');
    await this.prisma.$transaction(async (tx) => {
      await lockFreeSeat(tx, tripId);
      const r = await tx.tripParticipant.updateMany({
        where: { id: participantId, tripId, status: { in: ['REQUESTED', 'WAITLISTED'] } },
        data: { status: 'ACCEPTED', decidedAt: this.clock.now() },
      });
      if (r.count === 0) throw Conflict('NOT_PENDING', 'La richiesta non è più in sospeso');
    });
    await this.notifications.notify([p.userId], 'REQUEST_ACCEPTED', tripId);
    return this.trips.detail(tripId, driverId);
  }

  async reject(tripId: string, participantId: string, driverId: string): Promise<TripDetailDto> {
    const ctx = await this.driverCtx(tripId, driverId);
    const p = ctx.trip.participants.find((x) => x.id === participantId);
    if (!p) throw NotFound('Richiesta');
    const r = await this.prisma.tripParticipant.updateMany({
      where: { id: participantId, tripId, status: { in: ['REQUESTED', 'WAITLISTED'] } },
      data: { status: 'REJECTED', decidedAt: this.clock.now() },
    });
    if (r.count === 0) throw Conflict('NOT_PENDING', 'La richiesta non è più in sospeso');
    await this.notifications.notify([p.userId], 'REQUEST_REJECTED', tripId);
    return this.trips.detail(tripId, driverId);
  }

  /** Il conducente annulla la partecipazione di un passeggero già confermato. */
  async remove(tripId: string, participantId: string, driverId: string): Promise<TripDetailDto> {
    const ctx = await this.driverCtx(tripId, driverId);
    const p = ctx.trip.participants.find((x) => x.id === participantId);
    if (!p) throw NotFound('Partecipante');
    const r = await this.prisma.tripParticipant.updateMany({
      where: { id: participantId, status: 'ACCEPTED' },
      data: { status: 'CANCELLED', cancelledAt: this.clock.now() },
    });
    if (r.count === 0) throw Conflict('NOT_ACCEPTED', 'Il partecipante non è confermato');
    await this.notifications.notify([p.userId], 'REMOVED_FROM_TRIP', tripId);
    await this.chatEvents.membershipChanged(ctx.trip.seriesId, p.userId);
    await this.waitlist.seatFreed(tripId);
    return this.trips.detail(tripId, driverId);
  }

  /**
   * Il partecipante annulla la propria partecipazione (o ritira la richiesta).
   * Oltre la scadenza la cancellazione resta possibile ma viene marcata
   * come tardiva (rende possibile una segnalazione di assenza).
   */
  async leave(tripId: string, userId: string): Promise<{ lateCancel: boolean }> {
    const ctx = await this.policy.loadVisible(tripId, userId);
    const p = ctx.participant;
    if (!p || !['REQUESTED', 'ACCEPTED', 'WAITLISTED'].includes(p.status)) throw NotFound('Partecipazione');
    this.trips.assertOpen(ctx.trip);
    // Un membro fisso che annulla una data dice "non ci sono": resta nel gruppo e può ripensarci.
    if (ctx.isSeriesMember) {
      const { cancellationDeadlineHours } = await this.settings.get();
      const late = p.status === 'ACCEPTED' && this.clock.now() > new Date(ctx.trip.arrivalAt.getTime() - cancellationDeadlineHours * 3600_000);
      await this.series.notThere(tripId, userId);
      return { lateCancel: late };
    }
    const now = this.clock.now();
    const { cancellationDeadlineHours } = await this.settings.get();
    const deadline = new Date(ctx.trip.arrivalAt.getTime() - cancellationDeadlineHours * 3600_000);
    const lateCancel = p.status === 'ACCEPTED' && now > deadline;
    await this.prisma.tripParticipant.update({
      where: { id: p.id },
      data: { status: 'CANCELLED', cancelledAt: now, lateCancel },
    });
    if (p.status === 'ACCEPTED') {
      await this.notifications.notify([ctx.trip.series.driverId], 'PARTICIPANT_LEFT', tripId);
      await this.chatEvents.membershipChanged(ctx.trip.seriesId, userId);
      await this.waitlist.seatFreed(tripId);
    }
    return { lateCancel };
  }

  /** Chiusura del viaggio: il conducente conferma i presenti. Solo i viaggi chiusi contano nelle statistiche. */
  async close(tripId: string, driverId: string, presentIds: string[]): Promise<TripDetailDto> {
    const ctx = await this.policy.loadVisible(tripId, driverId);
    if (!ctx.isDriver) throw Forbidden('Solo il conducente può chiudere il viaggio');
    const now = this.clock.now();
    const { closureWindowDays } = await this.settings.get();
    if (ctx.trip.status !== 'SCHEDULED') throw Conflict('TRIP_NOT_OPEN', 'Il viaggio è già chiuso o annullato');
    if (ctx.trip.arrivalAt > now) {
      throw new AppException('TOO_EARLY', 'Il viaggio potrà essere chiuso dopo l’orario di arrivo', HttpStatus.CONFLICT);
    }
    if (now.getTime() - ctx.trip.arrivalAt.getTime() > closureWindowDays * 86_400_000) {
      throw new AppException('CLOSURE_EXPIRED', 'Il termine per chiudere questo viaggio è scaduto', HttpStatus.CONFLICT);
    }
    const accepted = ctx.trip.participants.filter((p) => p.status === 'ACCEPTED');
    const acceptedIds = new Set(accepted.map((p) => p.id));
    if (presentIds.some((id) => !acceptedIds.has(id))) {
      throw new AppException('INVALID_PARTICIPANT', 'Puoi indicare come presenti solo i partecipanti confermati');
    }
    const present = new Set(presentIds);
    // Distanze calcolate prima della transazione (possibile chiamata al servizio di routing).
    const plan = await this.stats.planClosure(
      tripId,
      accepted.filter((p) => present.has(p.id)).map((p) => p.userId),
    );
    await this.prisma.$transaction(async (tx) => {
      // Chiusura atomica: due richieste concorrenti non generano statistiche doppie.
      const r = await tx.trip.updateMany({ where: { id: tripId, status: 'SCHEDULED' }, data: { status: 'CLOSED', closedAt: now } });
      if (r.count === 0) throw Conflict('TRIP_NOT_OPEN', 'Il viaggio è già chiuso o annullato');
      for (const p of accepted) {
        await tx.tripParticipant.update({ where: { id: p.id }, data: { attended: present.has(p.id) } });
      }
      // Fatto anonimo per i report aggregati e statistiche personali dei presenti.
      await this.stats.writeClosure(tx, plan);
    });
    return this.trips.detail(tripId, driverId);
  }

  private async driverCtx(tripId: string, driverId: string) {
    const ctx = await this.policy.loadVisible(tripId, driverId);
    if (!ctx.isDriver) throw Forbidden('Solo il conducente può gestire le richieste');
    this.trips.assertOpen(ctx.trip);
    return ctx;
  }

  assertStop(stops: { comuneIstat: string }[], boardingComune: string): void {
    if (!stops.some((s) => s.comuneIstat === boardingComune)) {
      throw new AppException('INVALID_BOARDING', 'Il comune di salita deve essere uno dei comuni del percorso');
    }
  }
}
