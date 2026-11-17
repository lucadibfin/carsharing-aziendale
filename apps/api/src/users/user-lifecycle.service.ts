import { HttpStatus, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { AppException, NotFound } from '../common/errors.js';
import { Clock } from '../common/clock.js';
import { CryptoService } from '../common/crypto.service.js';
import { PrismaService } from '../common/prisma.service.js';
import { JobQueue } from '../jobs/job-queue.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { ChatMembershipEvents } from '../trips/chat-membership.events.js';
import { TripsService } from '../trips/trips.service.js';
import { WaitlistService } from '../trips/waitlist.service.js';

/**
 * Ciclo di vita dell'account.
 *
 * Ex dipendente (login negato o verifica notturna):
 *  1. avviso all'interessato, poi cancellazione di email, sessioni e push;
 *  2. annullamento dei viaggi futuri come conducente (notifica ai partecipanti),
 *     delle partecipazioni e degli inviti futuri;
 *  3. stato PENDING_DELETION; dopo deactivatedPurgeDays la cancellazione definitiva
 *     (job notturno). Se nel frattempo rientra in azienda e accede, l'account torna attivo.
 *
 * Cancellazione chiesta dall'utente: stessi passi 2, poi cancellazione immediata.
 *
 * Cancellazione definitiva: si eliminano utente e dati collegati. Restano solo
 * i fatti statistici anonimi (TripStatFact) e l'audit log, che contiene l'UUID
 * dell'account ma nessun dato che permetta di risalire alla persona.
 */
@Injectable()
export class UserLifecycleService implements OnModuleInit {
  private readonly logger = new Logger('UserLifecycle');

  constructor(
    private readonly prisma: PrismaService,
    private readonly trips: TripsService,
    private readonly notifications: NotificationsService,
    private readonly chatEvents: ChatMembershipEvents,
    private readonly clock: Clock,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly queue: JobQueue,
    private readonly waitlist: WaitlistService,
  ) {}

  onModuleInit(): void {
    this.queue.register('deactivated-purge', () => this.purgeDeactivated().then(() => undefined));
    this.queue.schedule('deactivated-purge', '0 4 * * *');
  }

  async handleNoLongerActive(username: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { username }, select: { id: true, status: true } });
    if (!user || user.status !== 'ACTIVE') return;
    await this.deactivate(user.id);
  }

  async deactivate(userId: string): Promise<void> {
    const now = this.clock.now();
    // Avviso all'interessato PRIMA di cancellare email e sottoscrizioni push.
    await this.notifications.notifyAccountDeactivated(userId);
    await this.prisma.user.update({
      where: { id: userId },
      // L'email serve solo alle notifiche: a un utente disattivato non si invia più nulla.
      data: { status: 'PENDING_DELETION', deactivatedAt: now, emailEnc: null, emailVerifiedAt: null },
    });
    await this.prisma.emailVerification.deleteMany({ where: { userId } });
    await this.prisma.session.deleteMany({ where: { userId } });
    await this.prisma.pushSubscription.deleteMany({ where: { userId } });
    const withdrawn = await this.withdrawFromFuture(userId);
    await this.audit.record({ actorId: null, action: 'USER_DEACTIVATED', targetType: 'User', targetId: userId, meta: withdrawn });
    this.logger.log({ user: this.pseudo(userId), trips: withdrawn.cancelledTrips }, 'utente disattivato');
  }

  /**
   * Cancellazione dell'account chiesta dall'interessato (art. 17): immediata,
   * "semplice quanto la registrazione". Unico limite: non può lasciare l'app
   * senza un amministratore globale.
   */
  async deleteOwnAccount(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { roles: true } });
    if (!user) throw NotFound('Utente');
    if (user.roles.some((r) => r.role === 'GLOBAL_ADMIN')) {
      const others = await this.prisma.roleAssignment.count({
        where: { role: 'GLOBAL_ADMIN', userId: { not: userId }, user: { status: 'ACTIVE' } },
      });
      if (others === 0) {
        throw new AppException(
          'LAST_GLOBAL_ADMIN',
          'Sei l’unico amministratore globale: assegna il ruolo a un collega prima di cancellare l’account',
          HttpStatus.CONFLICT,
        );
      }
    }
    // Blocca subito nuove azioni: sessioni revocate prima del resto.
    await this.prisma.session.deleteMany({ where: { userId } });
    const withdrawn = await this.withdrawFromFuture(userId);
    await this.purge(userId, 'USER_ACCOUNT_DELETED', withdrawn);
  }

  /** Job notturno: cancellazione definitiva degli ex dipendenti dopo il periodo configurato. */
  async purgeDeactivated(): Promise<number> {
    const { deactivatedPurgeDays } = await this.settings.get();
    const cutoff = new Date(this.clock.now().getTime() - deactivatedPurgeDays * 86_400_000);
    const due = await this.prisma.user.findMany({
      where: { status: 'PENDING_DELETION', deactivatedAt: { lte: cutoff } },
      select: { id: true },
    });
    for (const u of due) {
      try {
        await this.purge(u.id, 'USER_PURGED', {});
      } catch (e) {
        this.logger.error({ user: this.pseudo(u.id), errName: e instanceof Error ? e.name : 'unknown' }, 'cancellazione non riuscita');
      }
    }
    return due.length;
  }

  /** Annulla viaggi, partecipazioni e inviti futuri, avvisando gli altri coinvolti. */
  private async withdrawFromFuture(userId: string): Promise<{ cancelledTrips: number; cancelledParticipations: number }> {
    const now = this.clock.now();
    const driven = await this.prisma.trip.findMany({
      where: { series: { driverId: userId }, status: 'SCHEDULED', arrivalAt: { gt: now } },
      select: { id: true, seriesId: true },
    });
    for (const t of driven) {
      const toNotify = await this.trips.cancelTripInternal(t.id);
      await this.notifications.notify(toNotify, 'TRIP_CANCELLED', t.id);
      for (const u of toNotify) await this.chatEvents.membershipChanged(t.seriesId, u);
    }
    // Esce dai gruppi fissi: le prossime date non lo includono più.
    await this.prisma.seriesMember.deleteMany({ where: { userId } });
    const parts = await this.prisma.tripParticipant.findMany({
      where: { userId, status: { in: ['REQUESTED', 'ACCEPTED', 'WAITLISTED', 'NOT_THERE'] }, trip: { status: 'SCHEDULED', arrivalAt: { gt: now } } },
      include: { trip: { select: { id: true, series: { select: { driverId: true } } } } },
    });
    for (const p of parts) {
      await this.prisma.tripParticipant.update({ where: { id: p.id }, data: { status: 'CANCELLED', cancelledAt: now } });
      if (p.status === 'ACCEPTED') {
        await this.notifications.notify([p.trip.series.driverId], 'PARTICIPANT_LEFT', p.trip.id);
        await this.waitlist.seatFreed(p.trip.id);
      }
    }
    await this.prisma.invitation.updateMany({ where: { inviteeId: userId, status: 'PENDING' }, data: { status: 'REVOKED', revokedAt: now } });
    return { cancelledTrips: driven.length, cancelledParticipations: parts.length };
  }

  /**
   * Cancellazione definitiva. Oltre alla riga User (con cascata su consensi, ruoli,
   * sessioni, partecipazioni, inviti, preferiti, statistiche personali, segnalazioni
   * ricevute…) si eliminano i dati senza vincolo di chiave esterna verso l'utente.
   */
  private async purge(userId: string, action: 'USER_ACCOUNT_DELETED' | 'USER_PURGED', meta: Record<string, unknown>): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
    if (!user) return;
    await this.prisma.$transaction(async (tx) => {
      // Messaggi scritti dall'utente: sono suoi dati personali.
      const messages = await tx.chatMessage.deleteMany({ where: { senderId: userId } });
      // Viaggi di cui era conducente (con partecipazioni e chat). I fatti anonimi restano.
      const series = await tx.tripSeries.deleteMany({ where: { driverId: userId } });
      await tx.consentEvent.deleteMany({ where: { userId } });
      await tx.loginThrottle.deleteMany({ where: { key: `u:${this.crypto.hmac(user.username)}` } });
      await tx.user.delete({ where: { id: userId } });
      await this.audit.record(
        { actorId: action === 'USER_ACCOUNT_DELETED' ? userId : null, action, targetType: 'User', targetId: userId, meta: { ...meta, deletedSeries: series.count, deletedMessages: messages.count } },
        tx,
      );
    });
    this.logger.log({ user: this.pseudo(userId), action }, 'dati dell’utente cancellati');
  }

  private pseudo(userId: string): string {
    return this.crypto.hmac(userId).slice(0, 12);
  }
}
