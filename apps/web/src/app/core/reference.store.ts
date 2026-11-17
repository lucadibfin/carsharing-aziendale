import { inject, Injectable, signal } from '@angular/core';
import type { ComuneDto, SiteDto } from '@fcs/shared';
import { ApiService } from './api.service';

/** Dati di riferimento (sedi, nomi dei comuni) con cache in memoria. */
@Injectable({ providedIn: 'root' })
export class ReferenceStore {
  private readonly api = inject(ApiService);
  readonly sites = signal<SiteDto[]>([]);
  private loaded: Promise<void> | null = null;
  private readonly comuniCache = new Map<string, ComuneDto>();

  loadSites(): Promise<void> {
    this.loaded ??= this.api.sites().then((s) => this.sites.set(s));
    return this.loaded;
  }

  /** Da chiamare dopo una modifica delle sedi nell'area admin. */
  invalidateSites(): Promise<void> {
    this.loaded = null;
    return this.loadSites();
  }

  siteName(id: string | null | undefined): string {
    return this.sites().find((s) => s.id === id)?.name ?? '';
  }

  async searchComuni(q: string): Promise<ComuneDto[]> {
    if (q.trim().length < 2) return [];
    const res = await this.api.comuni(q.trim());
    res.forEach((c) => this.comuniCache.set(c.istat, c));
    return res;
  }

  async comune(istat: string): Promise<ComuneDto | null> {
    if (this.comuniCache.has(istat)) return this.comuniCache.get(istat)!;
    try {
      const c = await this.api.comune(istat);
      this.comuniCache.set(istat, c);
      return c;
    } catch {
      return null;
    }
  }
}
