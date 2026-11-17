import { Component, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/** Avviso in cima alla pagina, chiudibile (es. cambio di comune per fusione). */
@Component({
  selector: 'app-notice-banner',
  imports: [MatIconModule],
  host: { role: 'status' },
  template: `
    <mat-icon svgIcon="info" class="lead" aria-hidden="true" />
    <span><ng-content /></span>
    <button type="button" (click)="closed.emit()" aria-label="Chiudi l'avviso">
      <mat-icon svgIcon="close" />
    </button>
  `,
  styles: `
    :host {
      display: flex; align-items: center; gap: var(--app-space-2);
      padding: 6px var(--app-space-1) 6px var(--app-space-4); padding-top: calc(6px + env(safe-area-inset-top));
      background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container);
      font: var(--mat-sys-body-medium);
    }
    span { flex: 1; }
    .lead { flex: none; }
    button {
      display: inline-flex; align-items: center; justify-content: center;
      width: 40px; height: 40px; border: 0; border-radius: var(--app-radius-pill);
      background: transparent; color: inherit; cursor: pointer;
    }
  `,
})
export class NoticeBannerComponent {
  readonly closed = output<void>();
}
