import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import type { AdminTripDto, AdminTripsQuery } from '@fcs/shared';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { STATUS_LABELS } from '../../shared/labels';
import { AdminFiltersComponent } from './admin-filters.component';

@Component({
  selector: 'app-admin-trips',
  imports: [DatePipe, FormsModule, MatButtonModule, MatFormFieldModule, MatProgressBarModule, MatSelectModule, AdminFiltersComponent],
  template: `
    <app-admin-filters [(siteId)]="siteId" [(from)]="from" [(to)]="to" (ready)="load()">
      <mat-form-field class="grow">
        <mat-label>Stato</mat-label>
        <mat-select [(ngModel)]="state">
          <mat-option [value]="''">Tutti</mat-option>
          <mat-option value="upcoming">Futuri</mat-option>
          <mat-option value="awaiting">In corso / da chiudere</mat-option>
          <mat-option value="closed">Conclusi</mat-option>
          <mat-option value="cancelled">Annullati</mat-option>
        </mat-select>
      </mat-form-field>
      <button mat-flat-button (click)="load()">Cerca</button>
    </app-admin-filters>
    @if (loading()) { <mat-progress-bar mode="indeterminate" /> }
    <p class="muted small">
      Per minimizzare i dati personali l'elenco non mostra conducenti, passeggeri né comuni di partenza.
      {{ trips().length }} viaggi{{ trips().length === 500 ? ' (primi 500: restringi il periodo)' : '' }}.
    </p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Data</th><th>Arrivo</th><th>Ritorno</th><th>Sede</th><th>Visibilità</th><th>Stato</th><th>Posti</th><th>Presenti</th><th>Comuni</th></tr></thead>
        <tbody>
          @for (t of trips(); track t.id) {
            <tr>
              <td>{{ t.date | date: 'EEE d/M/y' }}</td>
              <td>{{ t.arrivalTime }}</td>
              <td>{{ t.returnTime ?? '–' }}</td>
              <td>{{ t.siteName }}</td>
              <td>{{ t.visibility === 'PUBLIC' ? 'Pubblico' : 'Privato' }}</td>
              <td>{{ labels[t.status] }}</td>
              <td>{{ t.seatsTaken }}/{{ t.seats }}</td>
              <td>{{ t.passengersPresent ?? '–' }}</td>
              <td>{{ t.stopsCount }}</td>
            </tr>
          } @empty {
            <tr><td colspan="9" class="muted">Nessun viaggio con questi filtri.</td></tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `.small { font-size: 0.85em; }`,
})
export class AdminTripsPage {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  protected readonly labels = STATUS_LABELS.trip;
  protected readonly trips = signal<AdminTripDto[]>([]);
  protected readonly loading = signal(false);
  protected siteId = '';
  protected from = '';
  protected to = '';
  protected state: '' | NonNullable<AdminTripsQuery['state']> = '';

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.trips.set(
        await this.api.adminTrips({
          siteId: this.siteId || undefined,
          from: this.from || undefined,
          to: this.to || undefined,
          state: this.state || undefined,
        }),
      );
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.loading.set(false);
    }
  }
}
