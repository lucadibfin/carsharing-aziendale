import { Component, inject, type OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import type { TripSummaryDto } from '@fcs/shared';
import { ApiService } from '../core/api.service';
import { ReferenceStore } from '../core/reference.store';
import { SessionStore } from '../core/session.store';
import { ToastService } from '../core/toast.service';
import { ComunePickerComponent } from '../shared/comune-picker.component';
import { TripCardComponent } from '../shared/trip-card.component';
import { todayIso } from '../shared/dates';

@Component({
  selector: 'app-search-page',
  imports: [FormsModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule, MatProgressBarModule, ComunePickerComponent, TripCardComponent],
  template: `
    <div class="page">
      <h1 class="page-title">Cerca un passaggio</h1>
      <form class="stack" (ngSubmit)="search()">
        <mat-form-field>
          <mat-label>Sede</mat-label>
          <mat-select [(ngModel)]="siteId" name="siteId" required>
            @for (s of ref.sites(); track s.id) { <mat-option [value]="s.id">{{ s.name }}</mat-option> }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Data</mat-label>
          <input matInput type="date" [(ngModel)]="date" name="date" [min]="today" required />
        </mat-form-field>
        <app-comune-picker label="Comune di partenza o di passaggio (facoltativo)" [(value)]="comune" />
        <button mat-flat-button type="submit" [disabled]="!siteId || !date || loading()">Cerca</button>
      </form>
      <p class="muted">Vengono mostrati solo i viaggi pubblici. Gli orari sono quelli del conducente: chi si unisce si adegua.</p>

      @if (loading()) { <mat-progress-bar mode="indeterminate" /> }
      @if (results(); as r) {
        <h2 class="section-title">{{ r.length }} {{ r.length === 1 ? 'viaggio trovato' : 'viaggi trovati' }}</h2>
        <div class="card-list">
          @for (t of r; track t.id) { <app-trip-card [trip]="t" /> }
          @empty { <p class="empty">Nessun viaggio pubblico per questi criteri. Prova un'altra data o proponi tu un viaggio.</p> }
        </div>
      }
    </div>
  `,
})
export class SearchPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly session = inject(SessionStore);
  protected readonly ref = inject(ReferenceStore);
  protected readonly today = todayIso();
  protected siteId: string | null = null;
  protected date = todayIso(1);
  protected comune: string | null = null;
  protected readonly results = signal<TripSummaryDto[] | null>(null);
  protected readonly loading = signal(false);

  async ngOnInit(): Promise<void> {
    await this.ref.loadSites();
    this.siteId = this.session.me()?.siteId ?? null;
    this.comune = this.session.me()?.comuneIstat ?? null;
  }

  async search(): Promise<void> {
    if (!this.siteId || !this.date) return;
    this.loading.set(true);
    try {
      this.results.set(await this.api.searchTrips({ siteId: this.siteId, date: this.date, comuneIstat: this.comune ?? undefined }));
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.loading.set(false);
    }
  }
}
