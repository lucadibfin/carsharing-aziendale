import { Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SessionStore } from './core/session.store';
import { NoticeBannerComponent } from './shared/notice-banner.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatIconModule, NoticeBannerComponent],
  template: `
    @if (session.ready() && session.me()?.comuneNotice; as notice) {
      <app-notice-banner class="comune-notice" (closed)="session.dismissComuneNotice()">
        Il tuo comune {{ notice.from }} è ora <strong>{{ notice.to }}</strong>.
      </app-notice-banner>
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
    .bottom-nav {
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 10;
      display: flex; justify-content: space-around;
      background: var(--mat-sys-surface-container);
      border-top: 1px solid var(--mat-sys-outline-variant);
      padding-bottom: env(safe-area-inset-bottom);
    }
    .bottom-nav a {
      flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px;
      padding: var(--app-space-2) 0 6px; text-decoration: none; color: var(--mat-sys-on-surface-variant);
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
