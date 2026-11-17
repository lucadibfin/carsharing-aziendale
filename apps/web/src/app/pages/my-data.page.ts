import { JsonPipe, KeyValuePipe } from '@angular/common';
import { Component, inject, type OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Router, RouterLink } from '@angular/router';
import { ApiService, errorCode } from '../core/api.service';
import { SessionStore } from '../core/session.store';
import { ToastService } from '../core/toast.service';
import { BRAND } from '../../generated/brand';

/** Titoli leggibili delle sezioni dell'esportazione. */
const SECTION_LABELS: Record<string, string> = {
  informazioni: 'Informazioni sull’esportazione',
  account: 'Account e profilo',
  email: 'Email per le notifiche',
  consensi: 'Consensi',
  informativaETermini: 'Informativa e termini accettati',
  sessioni: 'Sessioni attive',
  notifichePush: 'Dispositivi con notifiche push',
  viaggiComeConducente: 'Viaggi come conducente',
  partecipazioni: 'Partecipazioni ai viaggi',
  inviti: 'Inviti',
  messaggiChatInviati: 'Messaggi in chat',
  chatSilenziate: 'Chat silenziate',
  colleghiPreferiti: 'Colleghi preferiti',
  segnalazioniDiAssenza: 'Segnalazioni di assenza',
  statistichePersonali: 'Statistiche personali',
};

@Component({
  selector: 'app-my-data-page',
  imports: [JsonPipe, KeyValuePipe, FormsModule, RouterLink, MatButtonModule, MatCardModule, MatCheckboxModule, MatIconModule, MatProgressBarModule],
  template: `
    <div class="page">
      <h1 class="page-title">I miei dati</h1>
      <p class="muted">
        Qui trovi tutti i dati personali che l'app conserva su di te. Puoi scaricarli in formato JSON, leggibile e
        riutilizzabile in altri servizi. Per correggerli usa il <a routerLink="/profilo">profilo</a>.
      </p>
      @if (!data()) { <mat-progress-bar mode="indeterminate" /> }
      @if (data(); as d) {
        <div class="actions start">
          <button mat-flat-button (click)="download()"><mat-icon svgIcon="download" />Scarica i miei dati (JSON)</button>
        </div>
        @for (s of d | keyvalue: keep; track s.key) {
          <details>
            <summary>{{ labels[s.key] ?? s.key }} <span class="muted">{{ count(s.value) }}</span></summary>
            <pre>{{ s.value | json }}</pre>
          </details>
        }
      }

      <h2 class="section-title danger">Cancella l'account</h2>
      <mat-card appearance="outlined">
        <mat-card-content class="stack">
          <p>La cancellazione è <strong>immediata e definitiva</strong>:</p>
          <ul class="muted">
            <li>i tuoi viaggi futuri vengono annullati e i partecipanti avvisati;</li>
            <li>le tue partecipazioni future vengono annullate;</li>
            <li>profilo, email, telefono, messaggi, preferiti e statistiche personali vengono cancellati;</li>
            <li>restano solo statistiche aggregate anonime, non riconducibili a te.</li>
          </ul>
          <p class="muted">Non ci sono conseguenze: potrai sempre tornare ad accedere, ripartendo da zero.</p>
          <mat-checkbox [(ngModel)]="confirmed">Ho capito, voglio cancellare il mio account</mat-checkbox>
          <div class="actions start">
            <button mat-flat-button class="danger-btn" (click)="deleteAccount()" [disabled]="!confirmed || busy()">
              <mat-icon svgIcon="delete_forever" />Cancella il mio account
            </button>
          </div>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: `
    .start { justify-content: flex-start; margin-bottom: var(--app-space-3); }
    details { border-bottom: 1px solid var(--mat-sys-outline-variant); padding: var(--app-space-2) 0; }
    summary { cursor: pointer; font: var(--mat-sys-title-small); padding: var(--app-space-1) 0; }
    pre { white-space: pre-wrap; word-break: break-word; font-size: 12px; background: var(--mat-sys-surface-container); padding: var(--app-space-2); border-radius: var(--app-radius-md); }
    .danger { color: var(--mat-sys-error); }
    .danger-btn { background: var(--mat-sys-error); color: var(--mat-sys-on-error); }
  `,
})
export class MyDataPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  protected readonly labels = SECTION_LABELS;
  protected readonly data = signal<Record<string, unknown> | null>(null);
  protected readonly busy = signal(false);
  protected confirmed = false;
  /** Mantiene l'ordine delle sezioni restituito dall'API. */
  protected readonly keep = () => 0;

  async ngOnInit(): Promise<void> {
    try {
      this.data.set(await this.api.myData());
    } catch (e) {
      this.toast.error(e);
    }
  }

  protected count(v: unknown): string {
    return Array.isArray(v) ? `(${v.length})` : '';
  }

  download(): void {
    const blob = new Blob([JSON.stringify(this.data(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${BRAND.shortName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-miei-dati-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async deleteAccount(): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.deleteAccount();
      this.session.clear();
      this.toast.info(`Account cancellato. Grazie per aver usato ${BRAND.appName}.`);
      await this.router.navigate(['/login']);
    } catch (e) {
      if (errorCode(e) === 'LAST_GLOBAL_ADMIN') this.toast.error(e);
      else this.toast.error(e, 'Cancellazione non riuscita. Riprova.');
    } finally {
      this.busy.set(false);
    }
  }
}
