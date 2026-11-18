import { Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { AppConfigStore } from '../core/app-config.store';

/**
 * Banner sempre visibile della demo pubblica (non chiudibile). Mentre il server
 * si risveglia dalla pausa (piano gratuito) avvisa anche dell'attesa.
 */
@Component({
  selector: 'app-demo-banner',
  imports: [MatIconModule],
  host: { role: 'status' },
  template: `
    <mat-icon svgIcon="info" aria-hidden="true" />
    <span>
      <strong>DEMO - dati fittizi</strong> · non inserire dati personali reali
      @if (config.slow()) {
        <br />Avvio del server in corso: può richiedere fino a un minuto…
      }
    </span>
  `,
  styles: `
    :host {
      display: flex; align-items: center; justify-content: center; gap: var(--app-space-2);
      padding: 4px var(--app-space-4); padding-top: calc(4px + env(safe-area-inset-top));
      background: var(--mat-sys-tertiary-container); color: var(--mat-sys-on-tertiary-container);
      font: var(--mat-sys-label-large); text-align: center;
    }
    mat-icon { flex: none; width: 20px; height: 20px; }
  `,
})
export class DemoBannerComponent {
  protected readonly config = inject(AppConfigStore);
}
