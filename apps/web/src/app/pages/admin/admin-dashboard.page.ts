import { DecimalPipe, PercentPipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import type { DashboardDto, DashboardTotalsDto } from '@fcs/shared';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { AdminFiltersComponent } from './admin-filters.component';

@Component({
  selector: 'app-admin-dashboard',
  imports: [DecimalPipe, PercentPipe, MatButtonModule, MatCardModule, MatProgressBarModule, AdminFiltersComponent],
  template: `
    <app-admin-filters [(siteId)]="siteId" [(from)]="from" [(to)]="to" (ready)="load()">
      <button mat-flat-button (click)="load()">Aggiorna</button>
    </app-admin-filters>
    @if (loading()) { <mat-progress-bar mode="indeterminate" /> }
    @if (data(); as d) {
      <div class="grid">
        <mat-card appearance="outlined"><mat-card-content>
          <div class="value">{{ d.totals.registeredUsers }}</div><div class="label">utenti registrati</div>
        </mat-card-content></mat-card>
        <mat-card appearance="outlined"><mat-card-content>
          <div class="value">{{ d.totals.activeUsers }}</div><div class="label">con un accesso nel periodo</div>
        </mat-card-content></mat-card>
        <mat-card appearance="outlined"><mat-card-content>
          <div class="value">{{ d.totals.proposed.public + d.totals.proposed.private }}</div>
          <div class="label">viaggi proposti ({{ d.totals.proposed.public }} pubblici, {{ d.totals.proposed.private }} privati)</div>
        </mat-card-content></mat-card>
        <mat-card appearance="outlined"><mat-card-content>
          <div class="value">{{ d.totals.completed.public + d.totals.completed.private }}</div>
          <div class="label">completati ({{ d.totals.completed.public }} pubblici, {{ d.totals.completed.private }} privati) · {{ d.totals.cancelled }} annullati</div>
        </mat-card-content></mat-card>
        <mat-card appearance="outlined"><mat-card-content>
          <div class="value">{{ d.totals.fillRate === null ? '–' : (d.totals.fillRate | percent: '1.0-0') }}</div>
          <div class="label">tasso di riempimento ({{ d.totals.passengers }} passeggeri)</div>
        </mat-card-content></mat-card>
        <mat-card appearance="outlined"><mat-card-content>
          <div class="value">{{ d.totals.co2SavedKg | number: '1.0-0' }} kg</div><div class="label">CO2 risparmiata</div>
        </mat-card-content></mat-card>
        <mat-card appearance="outlined"><mat-card-content>
          <div class="value">{{ fuel(d.totals) }}</div><div class="label">carburante risparmiato</div>
        </mat-card-content></mat-card>
        <mat-card appearance="outlined"><mat-card-content>
          <div class="value">{{ d.totals.eurSaved | number: '1.0-0' }} €</div>
          <div class="label">di carburante non speso · {{ d.totals.kmAvoided | number: '1.0-0' }} km evitati</div>
        </mat-card-content></mat-card>
      </div>
      @if (d.totals.estimatedTrips || d.totals.incompleteTrips) {
        <p class="muted small">
          @if (d.totals.estimatedTrips) { {{ d.totals.estimatedTrips }} viaggi con distanze stimate in linea d'aria. }
          @if (d.totals.incompleteTrips) { {{ d.totals.incompleteTrips }} viaggi senza metriche: mancano le coordinate di comuni o sedi. }
        </p>
      }
      @if (d.bySite.length > 1) {
        <h2 class="section-title">Per sede</h2>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>Sede</th><th>Utenti</th><th>Proposti</th><th>Completati</th><th>Riempimento</th><th>CO2 (kg)</th><th>€</th>
            </tr></thead>
            <tbody>
              @for (s of d.bySite; track s.siteId) {
                <tr>
                  <td>{{ s.siteName }}</td>
                  <td>{{ s.registeredUsers }}</td>
                  <td>{{ s.proposed.public + s.proposed.private }}</td>
                  <td>{{ s.completed.public + s.completed.private }}</td>
                  <td>{{ s.fillRate === null ? '–' : (s.fillRate | percent: '1.0-0') }}</td>
                  <td>{{ s.co2SavedKg | number: '1.0-0' }}</td>
                  <td>{{ s.eurSaved | number: '1.0-0' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
      <p class="muted small">Dati aggregati e anonimi: nessun dato riconducibile ai singoli colleghi. Contano solo i viaggi chiusi dal conducente.</p>
    }
  `,
  styles: `
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-top: 8px; }
    .value { font: var(--mat-sys-headline-small); }
    .label { color: var(--mat-sys-on-surface-variant); font: var(--mat-sys-body-small); }
    .small { font-size: 0.85em; margin-top: 12px; }
  `,
})
export class AdminDashboardPage {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  protected readonly data = signal<DashboardDto | null>(null);
  protected readonly loading = signal(false);
  protected siteId = '';
  protected from = '';
  protected to = '';

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.data.set(await this.api.adminDashboard({ siteId: this.siteId || undefined, from: this.from || undefined, to: this.to || undefined }));
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.loading.set(false);
    }
  }

  protected fuel(t: DashboardTotalsDto): string {
    return t.fuelSaved.length ? t.fuelSaved.map((f) => `${Math.round(f.amount)} ${f.unit}`).join(', ') : '0';
  }
}
