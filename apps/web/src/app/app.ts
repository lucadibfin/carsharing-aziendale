import { Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SessionStore } from './core/session.store';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatIconModule],
  template: `
    @if (session.ready() && session.me()?.comuneNotice; as notice) {
      <div class="comune-notice" role="status">
        <span>Il tuo comune {{ notice.from }} è ora <strong>{{ notice.to }}</strong>.</span>
        <button type="button" (click)="session.dismissComuneNotice()" aria-label="Chiudi l'avviso">
          <mat-icon svgIcon="close" />
        </button>
      </div>
    }
    <main>
      <router-outlet />
    </main>
    @if (session.ready()) {
      <nav class="bottom-nav" aria-label="Navigazione principale">
        @for (item of nav; track item.path) {
          <a [routerLink]="item.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: item.path === '/' }">
            <mat-icon [svgIcon]="item.icon" />
            <span>{{ item.label }}</span>
          </a>
        }
      </nav>
    }
  `,
  styles: `
    .comune-notice {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 4px 6px 16px; padding-top: calc(6px + env(safe-area-inset-top));
      background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container);
      font: var(--mat-sys-body-medium);
    }
    .comune-notice span { flex: 1; }
    .comune-notice button {
      display: inline-flex; align-items: center; justify-content: center;
      width: 40px; height: 40px; border: 0; border-radius: 50%;
      background: transparent; color: inherit; cursor: pointer;
    }
    .bottom-nav {
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 10;
      display: flex; justify-content: space-around;
      background: var(--mat-sys-surface-container);
      border-top: 1px solid var(--mat-sys-outline-variant);
      padding-bottom: env(safe-area-inset-bottom);
    }
    .bottom-nav a {
      flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px;
      padding: 8px 0 6px; text-decoration: none; color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-medium);
    }
    .bottom-nav a.active { color: var(--mat-sys-primary); }
    .bottom-nav a.active mat-icon { font-variation-settings: 'FILL' 1; }
  `,
})
export class App {
  protected readonly session = inject(SessionStore);
  protected readonly nav = [
    { path: '/', icon: 'home', label: 'Home' },
    { path: '/cerca', icon: 'search', label: 'Cerca' },
    { path: '/proponi', icon: 'add_circle', label: 'Proponi' },
    { path: '/profilo', icon: 'person', label: 'Profilo' },
  ];
}
