import { Injectable, Logger } from '@nestjs/common';
import { Clock } from '../common/clock.js';
import { CryptoService } from '../common/crypto.service.js';
import { PrismaService } from '../common/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ChatMembershipEvents } from '../trips/chat-membership.events.js';
import { TripsService } from '../trips/trips.service.js';

/**
 * Gestione di un utente non più dipendente attivo:
 *  1. disattivazione e revoca immediata delle sessioni;
 *  2. annullamento dei viaggi futuri come conducente, con notifica ai partecipanti;
 *  3. annullamento delle partecipazioni future, con notifica ai conducenti;
 *  4. avvio della cancellazione dei dati (stato PENDING_DELETION; la cancellazione
 *     effettiva con anonimizzazione delle statistiche è un job della Fase 2).
 */
@Injectable()
export class UserLifecycleService {
  private readonly logger = new Logger('UserLifecycle');

  constructor(
    private readonly prisma: PrismaService,
    private readonly trips: TripsService,
    private readonly notifications: NotificationsService,
    private readonly chatEvents: ChatMembershipEvents,
    private readonly clock: Clock,
    private readonly crypto: CryptoService,
  ) {}

  async handleNoLongerActive(username: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { username }, select: { id: true, status: true } });
    if (!user || user.status !== 'ACTIVE') return;
    await this.deactivate(user.id);
  }

  async deactivate(userId: string): Promise<void> {
    const now = this.clock.now();
    await this.prisma.user.update({
      where: { id: userId },
      data: { status: 'PENDING_DELETION', deactivatedAt: now },
    });
    await this.prisma.session.deleteMany({ where: { userId } });
    await this.prisma.pushSubscription.deleteMany({ where: { userId } });

    // Viaggi futuri come conducente.
    const driven = await this.prisma.trip.findMany({
      where: { series: { driverId: userId }, status: 'SCHEDULED', arrivalAt: { gt: now } },
      select: { id: true, seriesId: true },
    });
    for (const t of driven) {
      const toNotify = await this.trips.cancelTripInternal(t.id);
      await this.notifications.notify(toNotify, 'TRIP_CANCELLED', t.id);
      for (const u of toNotify) await this.chatEvents.membershipChanged(t.seriesId, u);
    }

    // Partecipazioni future.
    const parts = await this.prisma.tripParticipant.findMany({
      where: { userId, status: { in: ['REQUESTED', 'ACCEPTED', 'WAITLISTED'] }, trip: { status: 'SCHEDULED', arrivalAt: { gt: now } } },
      include: { trip: { select: { id: true, seriesId: true, series: { select: { driverId: true } } } } },
    });
    for (const p of parts) {
      await this.prisma.tripParticipant.update({ where: { id: p.id }, data: { status: 'CANCELLED', cancelledAt: now } });
      if (p.status === 'ACCEPTED') {
        await this.notifications.notify([p.trip.series.driverId], 'PARTICIPANT_LEFT', p.trip.id);
      }
    }
    await this.prisma.invitation.updateMany({
      where: { inviteeId: userId, status: 'PENDING' },
      data: { status: 'REVOKED', revokedAt: now },
    });
    this.logger.log({ user: this.crypto.hmac(userId).slice(0, 12), trips: driven.length }, 'utente disattivato');
  }
}
