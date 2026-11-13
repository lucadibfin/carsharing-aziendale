import { Inject, Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import type { PushSubscriptionInput } from '@fcs/shared';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../common/prisma.service.js';

export interface PushPayload {
  title: string;
  body: string;
  /** Percorso interno dell'app da aprire al click. */
  url: string;
  /** Notifiche con lo stesso tag si sostituiscono sul dispositivo. */
  tag?: string;
}

/**
 * Web Push standard con VAPID (nessun Firebase SDK). Il payload è cifrato
 * end-to-end verso il browser e non contiene MAI testi dei messaggi o dati
 * personali: solo un avviso generico e un link interno.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger('Push');
  readonly enabled: boolean;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
  ) {
    this.enabled = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
    if (this.enabled) webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  }

  get publicKey(): string {
    return this.env.VAPID_PUBLIC_KEY;
  }

  async subscribe(userId: string, sub: PushSubscriptionInput): Promise<void> {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
  }

  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    if (!this.enabled) return;
    const subs = await this.prisma.pushSubscription.findMany({ where: { userId } });
    // Formato atteso dal service worker di Angular (SwPush).
    const body = JSON.stringify({
      notification: {
        title: payload.title,
        body: payload.body,
        tag: payload.tag,
        renotify: Boolean(payload.tag),
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-96x96.png',
        lang: 'it',
        data: { onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url: payload.url } } },
      },
    });
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
            TTL: 6 * 60 * 60,
            urgency: 'normal',
            // Proxy HTTP(S) aziendale per raggiungere i servizi push dei browser, se necessario.
            ...(this.env.PUSH_HTTPS_PROXY ? { proxy: this.env.PUSH_HTTPS_PROXY } : {}),
          });
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            // Sottoscrizione scaduta o revocata dal browser.
            await this.prisma.pushSubscription.deleteMany({ where: { id: s.id } });
          } else {
            this.logger.warn({ status }, 'invio push non riuscito');
          }
        }
      }),
    );
  }
}
