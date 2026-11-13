import { HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import type { MeDto } from '@fcs/shared';
import { ApiService } from './api.service';

/** Stato della sessione dell'utente corrente (signal). */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly api = inject(ApiService);

  /** undefined = non ancora verificato; null = non autenticato. */
  readonly me = signal<MeDto | null | undefined>(undefined);
  readonly loggedIn = computed(() => Boolean(this.me()));
  readonly ready = computed(() => Boolean(this.me()) && !this.me()!.onboardingRequired);
  readonly isGlobalAdmin = computed(() => this.me()?.roles.some((r) => r.role === 'GLOBAL_ADMIN') ?? false);

  async refresh(): Promise<MeDto | null> {
    try {
      const me = await this.api.me();
      this.me.set(me);
      return me;
    } catch (e) {
      if (e instanceof HttpErrorResponse && e.status === 401) {
        this.me.set(null);
        return null;
      }
      throw e;
    }
  }

  /** Verifica la sessione solo la prima volta. */
  async ensure(): Promise<MeDto | null> {
    const cur = this.me();
    return cur === undefined ? this.refresh() : cur;
  }

  clear(): void {
    this.me.set(null);
  }
}
