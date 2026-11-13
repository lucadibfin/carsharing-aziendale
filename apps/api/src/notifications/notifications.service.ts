import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { JobQueue } from '../jobs/job-queue.js';
import { MailService } from './mail.service.js';
import { PushService } from './push.service.js';

export type NotificationType =
  | 'JOIN_REQUEST'
  | 'REQUEST_ACCEPTED'
  | 'REQUEST_REJECTED'
  | 'PARTICIPANT_LEFT'
  | 'REMOVED_FROM_TRIP'
  | 'TRIP_CANCELLED'
  | 'INVITATION'
  | 'INVITATION_ACCEPTED'
  | 'INVITATION_DECLINED'
  | 'CHAT_MESSAGES';

/**
 * Testi GENERICI: nessun nome, nessun contenuto dei messaggi, nessun dato
 * personale. Il dettaglio si vede solo aprendo l'app (autenticati).
 */
const TEXTS: Record<NotificationType, { title: string; body: string }> = {
  JOIN_REQUEST: { title: 'Nuova richiesta', body: 'Hai una nuova richiesta di partecipazione a un tuo viaggio.' },
  REQUEST_ACCEPTED: { title: 'Richiesta accettata', body: 'La tua richiesta di partecipazione è stata accettata.' },
  REQUEST_REJECTED: { title: 'Richiesta non accettata', body: 'Una tua richiesta di partecipazione non è stata accettata.' },
  PARTICIPANT_LEFT: { title: 'Posto liberato', body: 'Un partecipante ha annullato la partecipazione a un tuo viaggio.' },
  REMOVED_FROM_TRIP: { title: 'Partecipazione annullata', body: 'Il conducente ha annullato la tua partecipazione a un viaggio.' },
  TRIP_CANCELLED: { title: 'Viaggio annullato', body: 'Un viaggio a cui partecipi è stato annullato.' },
  INVITATION: { title: 'Nuovo invito', body: 'Hai ricevuto un invito a un viaggio.' },
  INVITATION_ACCEPTED: { title: 'Invito accettato', body: 'Un collega ha accettato il tuo invito a un viaggio.' },
  INVITATION_DECLINED: { title: 'Invito rifiutato', body: 'Un collega ha rifiutato il tuo invito a un viaggio.' },
  CHAT_MESSAGES: { title: 'Nuovi messaggi', body: 'Ci sono nuovi messaggi nella chat di un tuo viaggio.' },
};

/** Tipi per cui si invia anche l'email (se l'utente ha dato il consenso). */
const EMAIL_TYPES = new Set<NotificationType>([
  'JOIN_REQUEST',
  'REQUEST_ACCEPTED',
  'REQUEST_REJECTED',
  'REMOVED_FROM_TRIP',
  'TRIP_CANCELLED',
  'INVITATION',
]);

interface NotifyJob {
  userId: string;
  type: NotificationType;
  tripId: string;
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
  ) {}

  onModuleInit(): void {
    this.queue.register('notify', (job: NotifyJob) => this.deliver(job));
    this.queue.register('chat-push', (job: ChatPushJob) => this.deliverChat(job));
  }

  /** Accoda una notifica per ciascun destinatario (fuori dalla richiesta HTTP). */
  async notify(userIds: string[], type: NotificationType, tripId: string): Promise<void> {
    for (const userId of new Set(userIds)) {
      await this.queue.send('notify', { userId, type, tripId } satisfies NotifyJob);
    }
  }

  /**
   * Notifica di nuovi messaggi in chat, raggruppata: con la stessa chiave
   * (utente + chat) resta in coda un solo job, inviato dopo la finestra
   * configurata. Esclusi mittente e chi ha silenziato la chat.
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

  private async deliver(job: NotifyJob): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: job.userId },
      select: { username: true, status: true, consent: { select: { emailNotifications: true } } },
    });
    if (!user || user.status !== 'ACTIVE') return;
    const t = TEXTS[job.type];
    const url = `/viaggi/${job.tripId}`;
    await this.push.sendToUser(job.userId, { ...t, url, tag: `trip:${job.tripId}` });
    if (EMAIL_TYPES.has(job.type) && user.consent?.emailNotifications) {
      await this.mail.send(user.username, `Car Sharing – ${t.title}`, `${t.body}\n\nApri l'app per i dettagli.`);
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
