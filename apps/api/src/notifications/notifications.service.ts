import { Injectable, type OnModuleInit } from '@nestjs/common';
import { CryptoService } from '../common/crypto.service.js';
import { PrismaService } from '../common/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { JobQueue } from '../jobs/job-queue.js';
import { MailService } from './mail.service.js';
import { PushService } from './push.service.js';

export type NotificationType =
  // essenziali
  | 'TRIP_CANCELLED'
  | 'TRIP_RESCHEDULED'
  | 'REQUEST_ACCEPTED'
  | 'REQUEST_REJECTED'
  | 'REMOVED_FROM_TRIP'
  | 'INVITATION'
  | 'ACCOUNT_DEACTIVATED'
  | 'SEAT_AVAILABLE'
  | 'SERIES_CANCELLED'
  | 'REMOVED_FROM_SERIES'
  // facoltative (solo con consenso)
  | 'TRIP_REMINDER_EVENING'
  | 'TRIP_REMINDER'
  | 'FAVORITE_NEW_TRIP'
  | 'DIGEST'
  // solo push
  | 'JOIN_REQUEST'
  | 'PARTICIPANT_LEFT'
  | 'MEMBER_NOT_THERE'
  | 'MEMBER_LEFT_SERIES'
  | 'INVITATION_ACCEPTED'
  | 'INVITATION_DECLINED'
  | 'CHAT_MESSAGES';

/**
 * Categoria di ogni notifica (vedi informativa, par. 5, e PRIVACY.md):
 * - ESSENTIAL: comunicazioni di servizio che cambiano un impegno già preso o
 *   lo stato dell'account. Sempre push + email, senza consenso (art. 6.1.b).
 * - OPTIONAL: comunicazioni non necessarie al servizio. Push + email SOLO con
 *   il consenso "optionalNotifications" (art. 6.1.a).
 * - PUSH_ONLY: avvisi operativi all'interno dell'app. Solo push (attivabile e
 *   disattivabile dall'utente sul dispositivo), mai email. Include la chat.
 */
export type NotificationCategory = 'ESSENTIAL' | 'OPTIONAL' | 'PUSH_ONLY';

export const NOTIFICATION_CATEGORY: Record<NotificationType, NotificationCategory> = {
  TRIP_CANCELLED: 'ESSENTIAL',
  TRIP_RESCHEDULED: 'ESSENTIAL',
  REQUEST_ACCEPTED: 'ESSENTIAL',
  REQUEST_REJECTED: 'ESSENTIAL',
  // Per il passeggero equivale all'annullamento del viaggio.
  REMOVED_FROM_TRIP: 'ESSENTIAL',
  INVITATION: 'ESSENTIAL',
  ACCOUNT_DEACTIVATED: 'ESSENTIAL',
  // L'utente si è messo in lista d'attesa proprio per ricevere questo avviso.
  SEAT_AVAILABLE: 'ESSENTIAL',
  SERIES_CANCELLED: 'ESSENTIAL',
  REMOVED_FROM_SERIES: 'ESSENTIAL',
  TRIP_REMINDER_EVENING: 'OPTIONAL',
  TRIP_REMINDER: 'OPTIONAL',
  FAVORITE_NEW_TRIP: 'OPTIONAL',
  DIGEST: 'OPTIONAL',
  JOIN_REQUEST: 'PUSH_ONLY',
  PARTICIPANT_LEFT: 'PUSH_ONLY',
  MEMBER_NOT_THERE: 'PUSH_ONLY',
  MEMBER_LEFT_SERIES: 'PUSH_ONLY',
  INVITATION_ACCEPTED: 'PUSH_ONLY',
  INVITATION_DECLINED: 'PUSH_ONLY',
  CHAT_MESSAGES: 'PUSH_ONLY',
};

/**
 * Testi GENERICI: nessun nome, nessun contenuto dei messaggi, nessun dato
 * personale. Il dettaglio si vede solo aprendo l'app (autenticati).
 */
const TEXTS: Record<NotificationType, { title: string; body: string }> = {
  TRIP_CANCELLED: { title: 'Viaggio annullato', body: 'Un viaggio a cui partecipi è stato annullato.' },
  TRIP_RESCHEDULED: { title: 'Viaggio modificato', body: 'Sono cambiati la data o gli orari di un viaggio a cui partecipi.' },
  REQUEST_ACCEPTED: { title: 'Richiesta accettata', body: 'La tua richiesta di partecipazione è stata accettata.' },
  REQUEST_REJECTED: { title: 'Richiesta non accettata', body: 'Una tua richiesta di partecipazione non è stata accettata.' },
  REMOVED_FROM_TRIP: { title: 'Partecipazione annullata', body: 'Il conducente ha annullato la tua partecipazione a un viaggio.' },
  INVITATION: { title: 'Nuovo invito', body: 'Hai ricevuto un invito a un viaggio.' },
  ACCOUNT_DEACTIVATED: {
    title: 'Account disattivato',
    body:
      'Il tuo account nell’app è stato disattivato perché non risulti più tra i dipendenti attivi. ' +
      'I viaggi futuri sono stati annullati e i tuoi dati personali saranno cancellati.',
  },
  SEAT_AVAILABLE: {
    title: 'Si è liberato un posto',
    body: 'Si è liberato un posto in un viaggio per cui sei in lista d’attesa: puoi chiederlo dall’app.',
  },
  SERIES_CANCELLED: { title: 'Viaggio ricorrente terminato', body: 'Il conducente ha terminato un viaggio ricorrente: le date future sono annullate.' },
  REMOVED_FROM_SERIES: { title: 'Gruppo fisso', body: 'Il conducente ti ha tolto dal gruppo fisso di un viaggio ricorrente.' },
  TRIP_REMINDER_EVENING: { title: 'Promemoria', body: 'Domani hai un viaggio in programma.' },
  TRIP_REMINDER: { title: 'Promemoria', body: 'Tra poco si parte per un viaggio a cui partecipi.' },
  MEMBER_NOT_THERE: { title: 'Posto libero', body: 'Un membro del gruppo fisso non ci sarà in una data: il suo posto è libero.' },
  MEMBER_LEFT_SERIES: { title: 'Gruppo fisso', body: 'Un membro ha lasciato il gruppo fisso di un tuo viaggio ricorrente.' },
  FAVORITE_NEW_TRIP: { title: 'Nuovo viaggio', body: 'Un collega tra i tuoi preferiti ha proposto un nuovo viaggio.' },
  DIGEST: { title: 'Riepilogo', body: 'C’è un nuovo riepilogo dei tuoi viaggi.' },
  JOIN_REQUEST: { title: 'Nuova richiesta', body: 'Hai una nuova richiesta di partecipazione a un tuo viaggio.' },
  PARTICIPANT_LEFT: { title: 'Posto liberato', body: 'Un partecipante ha annullato la partecipazione a un tuo viaggio.' },
  INVITATION_ACCEPTED: { title: 'Invito accettato', body: 'Un collega ha accettato il tuo invito a un viaggio.' },
  INVITATION_DECLINED: { title: 'Invito rifiutato', body: 'Un collega ha rifiutato il tuo invito a un viaggio.' },
  CHAT_MESSAGES: { title: 'Nuovi messaggi', body: 'Ci sono nuovi messaggi nella chat di un tuo viaggio.' },
};

interface NotifyJob {
  userId: string;
  type: NotificationType;
  tripId?: string;
}

interface ChatPushJob {
  userId: string;
  seriesId: string;
  tripId: string;
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  constructor(
    private readonly queue: JobQueue,
    private readonly push: PushService,
    private readonly mail: MailService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly crypto: CryptoService,
  ) {}

  onModuleInit(): void {
    this.queue.register('notify', (job: NotifyJob) => this.deliver(job));
    this.queue.register('chat-push', (job: ChatPushJob) => this.deliverChat(job));
  }

  /** Accoda una notifica per ciascun destinatario (fuori dalla richiesta HTTP). */
  async notify(userIds: string[], type: NotificationType, tripId?: string): Promise<void> {
    if (type === 'CHAT_MESSAGES' || type === 'ACCOUNT_DEACTIVATED') {
      throw new Error(`usare il metodo dedicato per ${type}`);
    }
    for (const userId of new Set(userIds)) {
      await this.queue.send('notify', { userId, type, tripId } satisfies NotifyJob);
    }
  }

  /**
   * Notifica di nuovi messaggi in chat, raggruppata: con la stessa chiave
   * (utente + chat) resta in coda un solo job, inviato dopo la finestra
   * configurata. Esclusi mittente e chi ha silenziato la chat. Mai via email.
   */
  async notifyChat(recipientIds: string[], seriesId: string, tripId: string): Promise<void> {
    const muted = await this.prisma.chatMute.findMany({
      where: { seriesId, userId: { in: recipientIds } },
      select: { userId: true },
    });
    const mutedSet = new Set(muted.map((m) => m.userId));
    const { chatPushBatchSeconds } = await this.settings.get();
    for (const userId of recipientIds) {
      if (mutedSet.has(userId)) continue;
      await this.queue.send('chat-push', { userId, seriesId, tripId } satisfies ChatPushJob, {
        singletonKey: `chat:${userId}:${seriesId}`,
        startAfterSeconds: chatPushBatchSeconds,
      });
    }
  }

  /**
   * Avviso di disattivazione: inviato SUBITO (non in coda), prima che email e
   * sottoscrizioni push vengano cancellate. È l'unico modo per avvisare chi non
   * ha più accesso alla posta aziendale.
   */
  async notifyAccountDeactivated(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { emailEnc: true, emailVerifiedAt: true } });
    if (!user) return;
    await this.send(userId, 'ACCOUNT_DEACTIVATED', '/', user, { optionalConsent: false });
  }

  private async deliver(job: NotifyJob): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: job.userId },
      select: { status: true, emailEnc: true, emailVerifiedAt: true, consent: { select: { optionalNotifications: true } } },
    });
    if (!user || user.status !== 'ACTIVE') return;
    const url = job.tripId ? `/viaggi/${job.tripId}` : '/';
    await this.send(job.userId, job.type, url, user, { optionalConsent: user.consent?.optionalNotifications ?? false });
  }

  private async send(
    userId: string,
    type: NotificationType,
    url: string,
    user: { emailEnc: string | null; emailVerifiedAt: Date | null },
    opts: { optionalConsent: boolean },
  ): Promise<void> {
    const category = NOTIFICATION_CATEGORY[type];
    if (category === 'OPTIONAL' && !opts.optionalConsent) return;
    const t = TEXTS[type];
    await this.push.sendToUser(userId, { ...t, url, tag: `${type}:${url}` });
    if (category !== 'PUSH_ONLY' && user.emailVerifiedAt && user.emailEnc) {
      await this.mail.trySend({
        to: this.crypto.decrypt(user.emailEnc),
        subject: t.title,
        text: `${t.body}\n\nApri l'app per i dettagli.`,
      });
    }
  }

  private async deliverChat(job: ChatPushJob): Promise<void> {
    const muted = await this.prisma.chatMute.findUnique({
      where: { userId_seriesId: { userId: job.userId, seriesId: job.seriesId } },
    });
    if (muted) return;
    const t = TEXTS.CHAT_MESSAGES;
    await this.push.sendToUser(job.userId, { ...t, url: `/viaggi/${job.tripId}/chat`, tag: `chat:${job.seriesId}` });
  }
}
