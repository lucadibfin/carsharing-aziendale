import { Component, inject, type OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { FUEL_TYPE_LABELS, FUEL_UNITS, type FuelType, type Settings } from '@fcs/shared';
import { Router } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AppConfigStore } from '../../core/app-config.store';
import { SessionStore } from '../../core/session.store';
import { ToastService } from '../../core/toast.service';

type NumberKey = {
  [K in keyof Settings]: Settings[K] extends number ? K : never;
}[keyof Settings];

@Component({
  selector: 'app-admin-settings',
  imports: [FormsModule, MatButtonModule, MatCardModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    @if (s(); as s) {
      <h2 class="section-title">Viaggi e conservazione dei dati</h2>
      <div class="grid">
        @for (f of fields; track f.key) {
          <mat-form-field>
            <mat-label>{{ f.label }}</mat-label>
            <input matInput type="number" [min]="f.min" [max]="f.max" [step]="f.step ?? 1" [(ngModel)]="s[f.key]" />
            @if (f.hint) { <mat-hint>{{ f.hint }}</mat-hint> }
          </mat-form-field>
        }
      </div>

      <h2 class="section-title">Statistiche: consumi, emissioni e prezzi</h2>
      <p class="muted">
        Usati quando il conducente non ha indicato i dati della sua auto. I valori iniziali sono indicativi:
        prima di usare i report nel PSCL aggiornarli con le fonti di riferimento, cioè <strong>ISPRA</strong> per
        emissioni e consumi medi e i <strong>prezzi medi dei carburanti del Ministero delle Imprese e del Made in Italy</strong>,
        annotando anno e fonte dei valori usati.
      </p>
      <div class="row">
        <mat-form-field class="grow">
          <mat-label>Alimentazione di default</mat-label>
          <mat-select [(ngModel)]="s.defaultFuelType">
            @for (t of fuelTypes; track t) { <mat-option [value]="t">{{ fuelLabels[t] }}</mat-option> }
          </mat-select>
        </mat-form-field>
        <mat-form-field class="grow">
          <mat-label>Coefficiente stradale per le stime</mat-label>
          <input matInput type="number" min="1" max="3" step="0.05" [(ngModel)]="s.estimatedRoadFactor" />
          <mat-hint>Distanza su strada ≈ linea d'aria × coefficiente</mat-hint>
        </mat-form-field>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Alimentazione</th><th>Consumo ogni 100 km</th><th>kg CO2 per unità</th><th>€ per unità</th></tr></thead>
          <tbody>
            @for (t of fuelTypes; track t) {
              <tr>
                <td>{{ fuelLabels[t] }} ({{ units[t] }})</td>
                <td><input class="num" type="number" min="0.1" max="100" step="0.1" [(ngModel)]="s.fuelProfiles[t].consumptionPer100km" [attr.aria-label]="'Consumo ' + fuelLabels[t]" /></td>
                <td><input class="num" type="number" min="0" max="10" step="0.01" [(ngModel)]="s.fuelProfiles[t].co2KgPerUnit" [attr.aria-label]="'CO2 ' + fuelLabels[t]" /></td>
                <td><input class="num" type="number" min="0" max="20" step="0.01" [(ngModel)]="s.fuelProfiles[t].pricePerUnit" [attr.aria-label]="'Prezzo ' + fuelLabels[t]" /></td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <div class="actions">
        <button mat-button (click)="load()" [disabled]="busy()">Annulla le modifiche</button>
        <button mat-flat-button (click)="save()" [disabled]="busy()">Salva</button>
      </div>
    }
    @if (config.demo()) {
      <h2 class="section-title">Demo</h2>
      <p class="muted">
        Riporta la demo allo stato iniziale: utenti di prova, viaggi, chat, segnalazioni, sedi, testi legali e parametri
        tornano quelli di partenza (con le date riferite a oggi). Tutti gli utenti, te compreso, dovranno accedere di nuovo.
        L'audit log non si azzera.
      </p>
      <mat-checkbox [(ngModel)]="resetConfirmed">Ho capito, voglio ripristinare la demo</mat-checkbox>
      <div class="actions">
        <button mat-flat-button class="danger-btn" (click)="resetDemo()" [disabled]="!resetConfirmed || busy()" data-testid="demo-reset">
          Riporta la demo allo stato iniziale
        </button>
      </div>
    }
  `,
  styles: `
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: var(--app-space-1) var(--app-space-3); }
    .num { width: 90px; font: inherit; padding: var(--app-space-1); }
    .danger-btn { background: var(--mat-sys-error); color: var(--mat-sys-on-error); }
  `,
})
export class AdminSettingsPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  protected readonly config = inject(AppConfigStore);
  protected resetConfirmed = false;
  protected readonly s = signal<Settings | null>(null);
  protected readonly busy = signal(false);
  protected readonly fuelLabels = FUEL_TYPE_LABELS;
  protected readonly units = FUEL_UNITS;
  protected readonly fuelTypes = Object.keys(FUEL_TYPE_LABELS) as FuelType[];
  protected readonly fields: { key: NumberKey; label: string; min: number; max: number; step?: number; hint?: string }[] = [
    { key: 'cancellationDeadlineHours', label: 'Scadenza per annullare (ore prima dell’arrivo)', min: 0, max: 72 },
    { key: 'closureWindowDays', label: 'Giorni per chiudere un viaggio e segnalare', min: 1, max: 60 },
    { key: 'maxDaysAhead', label: 'Giorni massimi di anticipo per proporre', min: 1, max: 365 },
    { key: 'inviteLinkDefaultHours', label: 'Durata di default dei link d’invito (ore)', min: 1, max: 720 },
    { key: 'chatPushBatchSeconds', label: 'Raggruppamento notifiche chat (secondi)', min: 0, max: 3600 },
    { key: 'recurringHorizonDays', label: 'Viaggi ricorrenti: date generate in anticipo (giorni)', min: 7, max: 90 },
    { key: 'reminderEveningHour', label: 'Promemoria della sera prima: dalle ore', min: 12, max: 23 },
    {
      key: 'reminderBeforeDepartureMinutes',
      label: 'Promemoria prima della salita (minuti)',
      min: 15,
      max: 180,
      hint: 'Conducente: prima della partenza; passeggeri: prima del passaggio dal loro comune',
    },
    { key: 'chatRetentionDays', label: 'Conservazione chat (giorni)', min: 1, max: 365 },
    { key: 'absenceReportRetentionMonths', label: 'Conservazione segnalazioni (mesi)', min: 1, max: 60 },
    { key: 'tripRetentionMonths', label: 'Conservazione viaggi conclusi (mesi)', min: 1, max: 60, hint: 'Restano le statistiche anonime' },
    { key: 'inviteRetentionDays', label: 'Conservazione inviti scaduti o usati (giorni)', min: 1, max: 365 },
    { key: 'auditRetentionMonths', label: 'Conservazione audit log (mesi)', min: 6, max: 120 },
    {
      key: 'exportMinTrips',
      label: 'Report esportati: soglia minima di viaggi',
      min: 1,
      max: 50,
      hint: 'Sotto la soglia i valori di una riga non si pubblicano',
    },
    {
      key: 'deactivatedPurgeDays',
      label: 'Cancellazione dati degli ex dipendenti (giorni)',
      min: 0,
      max: 90,
      hint: 'Dopo la disattivazione; 0 = la notte successiva',
    },
  ];

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    try {
      this.s.set(structuredClone(await this.api.adminSettings()));
    } catch (e) {
      this.toast.error(e);
    }
  }

  async resetDemo(): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.adminResetDemo();
      // Le sessioni sono state cancellate: si torna al login.
      this.session.clear();
      this.toast.info('Demo ripristinata: accedi di nuovo');
      await this.router.navigateByUrl('/login');
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
      this.resetConfirmed = false;
    }
  }

  async save(): Promise<void> {
    const s = this.s();
    if (!s) return;
    this.busy.set(true);
    try {
      // Gli input numerici possono restituire stringhe: si normalizza prima dell'invio.
      const body = JSON.parse(JSON.stringify(s), (_k, v) => (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v)) as Settings;
      this.s.set(structuredClone(await this.api.adminUpdateSettings(body)));
      this.toast.info('Parametri salvati');
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}
