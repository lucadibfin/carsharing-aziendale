import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { ABSENCE_REPORT_STATUS_LABELS, type AbsenceReportStatus, type AdminAbsenceReportDto } from '@fcs/shared';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { AdminFiltersComponent } from './admin-filters.component';

@Component({
  selector: 'app-admin-reports',
  imports: [
    DatePipe, FormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule, MatProgressBarModule, MatSelectModule,
    AdminFiltersComponent,
  ],
  template: `
    <app-admin-filters [withPeriod]="false" [(siteId)]="siteId" (ready)="load()">
      <mat-form-field class="grow">
        <mat-label>Stato</mat-label>
        <mat-select [(ngModel)]="status">
          <mat-option [value]="''">Tutte</mat-option>
          @for (s of statuses; track s) { <mat-option [value]="s">{{ statusLabels[s] }}</mat-option> }
        </mat-select>
      </mat-form-field>
      <button mat-flat-button (click)="load()">Cerca</button>
    </app-admin-filters>
    <p class="muted small">
      Le segnalazioni non comportano alcuna conseguenza automatica: ogni decisione è tua. Non sono visibili agli altri
      utenti; la persona segnalata le ritrova nell'esportazione dei propri dati. Aprire una segnalazione ne registra l'accesso.
    </p>
    @if (loading()) { <mat-progress-bar mode="indeterminate" /> }
    <div class="card-list">
      @for (r of reports(); track r.id) {
        <mat-card appearance="outlined">
          <mat-card-content class="stack">
            <div class="row">
              <span class="grow">
                <strong>{{ r.reported.firstName }} {{ r.reported.lastName }}</strong>
                <span class="muted"> · viaggio del {{ r.tripDate | date: 'd/M/y' }} · {{ r.siteName }}</span>
              </span>
              <span class="chip" [class.warn]="r.status === 'OPEN'">{{ statusLabels[r.status] }}</span>
            </div>
            <div class="muted small">
              Segnalata il {{ r.createdAt | date: 'd/M/y HH:mm' }} da
              {{ r.reporter ? r.reporter.firstName + ' ' + r.reporter.lastName : 'un utente che ha cancellato l’account' }}
              @if (r.reportedTotal > 1) { · {{ r.reportedTotal }} segnalazioni ricevute da questa persona negli ultimi mesi }
            </div>
            @if (open() === r.id && detail(); as d) {
              <div class="reason"><strong>Motivazione:</strong> {{ d.reason }}</div>
              @if (d.decisionNote) { <div class="reason"><strong>Nota della decisione:</strong> {{ d.decisionNote }}</div> }
              <mat-form-field class="full-width">
                <mat-label>Nota (facoltativa, visibile solo agli admin)</mat-label>
                <textarea matInput rows="2" [(ngModel)]="note" maxlength="1000"></textarea>
              </mat-form-field>
              <div class="actions">
                <button mat-button (click)="open.set(null)">Chiudi</button>
                <button mat-stroked-button (click)="decide(r.id, 'DISMISSED')" [disabled]="busy()">Archivia</button>
                <button mat-flat-button (click)="decide(r.id, 'ACKNOWLEDGED')" [disabled]="busy()">Prendi in carico</button>
              </div>
            } @else {
              <div class="actions"><button mat-button (click)="show(r.id)">Leggi la motivazione</button></div>
            }
          </mat-card-content>
        </mat-card>
      } @empty {
        <p class="muted">Nessuna segnalazione.</p>
      }
    </div>
  `,
  styles: `
    .small { font-size: 0.85em; }
    .reason { white-space: pre-wrap; background: var(--mat-sys-surface-container); padding: var(--app-space-2); border-radius: var(--app-radius-md); }
  `,
})
export class AdminReportsPage {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  protected readonly statusLabels = ABSENCE_REPORT_STATUS_LABELS;
  protected readonly statuses = Object.keys(ABSENCE_REPORT_STATUS_LABELS) as AbsenceReportStatus[];
  protected readonly reports = signal<AdminAbsenceReportDto[]>([]);
  protected readonly detail = signal<AdminAbsenceReportDto | null>(null);
  protected readonly open = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected siteId = '';
  protected status: '' | AbsenceReportStatus = 'OPEN';
  protected note = '';

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.reports.set(await this.api.adminReports({ siteId: this.siteId || undefined, status: this.status || undefined }));
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.loading.set(false);
    }
  }

  async show(id: string): Promise<void> {
    try {
      const d = await this.api.adminReport(id);
      this.detail.set(d);
      this.note = d.decisionNote ?? '';
      this.open.set(id);
    } catch (e) {
      this.toast.error(e);
    }
  }

  async decide(id: string, status: 'DISMISSED' | 'ACKNOWLEDGED'): Promise<void> {
    this.busy.set(true);
    try {
      const d = await this.api.adminDecideReport(id, { status, note: this.note.trim() || undefined });
      this.reports.update((list) => list.map((r) => (r.id === id ? { ...r, status: d.status, handledAt: d.handledAt } : r)));
      this.open.set(null);
      this.toast.info(status === 'DISMISSED' ? 'Segnalazione archiviata' : 'Segnalazione presa in carico');
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}
