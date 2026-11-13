import { inject, Injectable, signal } from '@angular/core';
import { SwPush } from '@angular/service-worker';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';

export type PushState = 'unsupported' | 'ios-not-installed' | 'denied' | 'off' | 'on';

/**
 * Notifiche Web Push standard (VAPID). Su iPhone/iPad funzionano solo se
 * l'app è installata sulla schermata Home (iOS ≥ 16.4).
 */
@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly sw = inject(SwPush);
  private readonly api = inject(ApiService);
  readonly state = signal<PushState>('off');

  get isIos(): boolean {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  get isStandalone(): boolean {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  }

  async refresh(): Promise<PushState> {
    let s: PushState;
    if (this.isIos && !this.isStandalone) s = 'ios-not-installed';
    else if (!this.sw.isEnabled || !('Notification' in window)) s = 'unsupported';
    else if (Notification.permission === 'denied') s = 'denied';
    else s = (await firstValueFrom(this.sw.subscription)) ? 'on' : 'off';
    this.state.set(s);
    return s;
  }

  /** Da chiamare solo in risposta a un gesto dell'utente (requisito dei browser, in particolare iOS). */
  async enable(): Promise<void> {
    const { publicKey, enabled } = await this.api.pushKey();
    if (!enabled || !publicKey) throw new Error('Le notifiche push non sono configurate sul server');
    const sub = await this.sw.requestSubscription({ serverPublicKey: publicKey });
    const json = sub.toJSON();
    await this.api.pushSubscribe({
      endpoint: json.endpoint!,
      keys: { p256dh: json.keys!['p256dh']!, auth: json.keys!['auth']! },
    });
    await this.refresh();
  }

  async disable(): Promise<void> {
    const sub = await firstValueFrom(this.sw.subscription);
    if (sub) {
      await this.api.pushUnsubscribe(sub.endpoint).catch(() => undefined);
      await this.sw.unsubscribe();
    }
    await this.refresh();
  }
}
