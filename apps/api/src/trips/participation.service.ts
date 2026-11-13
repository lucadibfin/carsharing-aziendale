import { HttpStatus, Injectable } from '@nestjs/common';
import type { TripDetailDto } from '@fcs/shared';
import { AppException, Conflict, Forbidden, NotFound } from '../common/errors.js';
import { Clock } from '../common/clock.js';
import { PrismaService, type Tx } from '../common/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { ChatMembershipEvents } from './chat-membership.events.js';
import { TripAccessPolicy } from './trip-access.policy.js';
import { TripsService } from './trips.service.js';

export const TRIP_FULL = () => Conflict('TRIP_FULL', 'Il viaggio è al completo');

/**
 * Blocca la riga del viaggio (SELECT … FOR UPDATE) e verifica che ci sia un
 * posto libero. Chiamata dentro una transazione: due accettazioni
 * concorrenti vengono serializzate, quindi niente overbooking.
 */
export async function lockFreeSeat(tx: Tx, tripId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ seats: number }[]>`SELECT seats FROM "Trip" WHERE id = ${tripId}::uuid FOR UPDATE`;
  if (rows.length === 0) throw NotFound('Viaggio');
  const accepted = await tx.tripParticipant.count({ where: { tripId, status: 'ACCEPTED' } });
  if (accepted >= rows[0]!.seats) throw TRIP_FULL();
}

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
  ) {}

  /** Richiesta di partecipazione: solo viaggi PUBBLICI (i privati non accettano richieste esterne). */
  async request(tripId: string, userId: string, boardingComune: string): Promise<TripDetailDto> {
    const ctx = await this.policy.loadVisible(tripId, userId);
    if (ctx.isDriver) throw new AppException('OWN_TRIP', 'Sei il conducente di questo viaggio');
    if (ctx.visibility !== 'PUBLIC') throw NotFound('Viaggio');
    this.trips.assertOpen(ctx.trip);
    this.assertStop(ctx.trip.series.stops, boardingComune);

    const existing = ctx.participant;
    if (existing && ['REQUESTED', 'ACCEPTED', 'WAITLISTED'].includes(existing.status)) {
      throw Conflict('ALREADY_REQUESTED', 'Hai già una richiesta per questo viaggio');
    }
    if (existing?.status === 'REJECTED') {
      throw Conflict('REQUEST_REJECTED', 'Il conducente non ha accettato la tua richiesta per questo viaggio');
    }
    const accepted = ctx.trip.participants.filter((p) => p.status === 'ACCEPTED').length;
    if (accepted >= ctx.trip.seats) throw TRIP_FULL();

    const now = this.clock.now();
    await this.prisma.tripParticipant.upsert({
      where: { tripId_userId: { tripId, userId } },
      create: { tripId, userId, status: 'REQUESTED', boardingComune, requestedAt: now },
      update: { status: 'REQUESTED', boardingComune, requestedAt: now, decidedAt: null, cancelledAt: null, lateCancel: false },
    });
    await this.notifications.notify([ctx.trip.series.driverId], 'JOIN_REQUEST', tripId);
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
    await this.prisma.$transaction(async (tx) => {
      for (const p of accepted) {
        await tx.tripParticipant.update({ where: { id: p.id }, data: { attended: present.has(p.id) } });
      }
      await tx.trip.update({ where: { id: tripId }, data: { status: 'CLOSED', closedAt: now } });
      // Fase 2: qui si genera il TripStatFact anonimo per le statistiche aggregate.
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
