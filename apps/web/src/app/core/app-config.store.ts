import { computed, inject, Injectable, signal } from '@angular/core';
import type { AppConfigDto } from '@fcs/shared';
import { ApiService } from './api.service';

/** Oltre questa attesa si avvisa che il server (demo in pausa) si sta avviando. */
const SLOW_MS = 3000;
const RETRY_MS = 5000;
const DEMO_KEY = 'fcs.demo';

function lastKnownDemo(): boolean {
  try {
    return localStorage.getItem(DEMO_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Configurazione pubblica dell'app (GET /api/config), caricata all'avvio senza
 * bloccare la shell: se il server è in pausa (demo su piattaforma gratuita) la
 * PWA si apre comunque e il banner avvisa dell'attesa.
 */
@Injectable({ providedIn: 'root' })
export class AppConfigStore {
  private readonly api = inject(ApiService);

  readonly config = signal<AppConfigDto | null>(null);
  /** Finché la configurazione non arriva vale l'ultima nota (la shell PWA si apre anche a server fermo). */
  readonly demo = computed(() => this.config()?.demo ?? lastKnownDemo());
  /** true se la risposta tarda: il server si sta probabilmente risvegliando. */
  readonly slow = signal(false);
  private started = false;

  load(): void {
    if (this.started) return;
    this.started = true;
    const timer = setTimeout(() => this.slow.set(true), SLOW_MS);
    const attempt = async (): Promise<void> => {
      try {
        const cfg = await this.api.appConfig();
        this.config.set(cfg);
        clearTimeout(timer);
        this.slow.set(false);
        try {
          localStorage.setItem(DEMO_KEY, cfg.demo ? '1' : '0');
        } catch {
          // memoria del browser non disponibile: nessun problema
        }
      } catch {
        setTimeout(() => void attempt(), RETRY_MS);
      }
    };
    void attempt();
  }
}
