import { Component, computed, inject } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SessionStore } from '../../core/session.store';

/** Contenitore dell'area amministrativa con la navigazione tra le sezioni. */
@Component({
  selector: 'app-admin-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatTabsModule],
  template: `
    <div class="page wide">
      <h1 class="page-title">Area amministrativa</h1>
      <p class="muted scope">
        @if (session.isGlobalAdmin()) { Amministratore globale: tutte le sedi. }
        @else { Amministratore di sede: vedi solo i dati della tua sede. }
        Ogni accesso ai dati è registrato.
      </p>
      <nav mat-tab-nav-bar [tabPanel]="panel" mat-stretch-tabs="false" aria-label="Sezioni dell'area amministrativa">
        @for (s of sections(); track s.path) {
          <a mat-tab-link [routerLink]="s.path" routerLinkActive #rla="routerLinkActive" [active]="rla.isActive"
             [routerLinkActiveOptions]="{ exact: s.path === '/admin' }">{{ s.label }}</a>
        }
      </nav>
      <mat-tab-nav-panel #panel>
        <div class="content"><router-outlet /></div>
      </mat-tab-nav-panel>
    </div>
  `,
  styles: `
    .wide { max-width: 1100px; }
    .scope { margin-top: -8px; }
    .content { padding-top: 16px; }
  `,
})
export class AdminShellPage {
  protected readonly session = inject(SessionStore);
  protected readonly sections = computed(() => [
    { path: '/admin', label: 'Dashboard' },
    { path: '/admin/viaggi', label: 'Viaggi' },
    { path: '/admin/segnalazioni', label: 'Segnalazioni' },
    ...(this.session.isGlobalAdmin()
      ? [
          { path: '/admin/parametri', label: 'Parametri' },
          { path: '/admin/ruoli', label: 'Ruoli' },
          { path: '/admin/sedi', label: 'Sedi' },
          { path: '/admin/testi', label: 'Testi legali' },
          { path: '/admin/audit', label: 'Audit log' },
        ]
      : []),
  ]);
}
