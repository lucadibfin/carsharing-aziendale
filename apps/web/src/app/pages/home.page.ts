import { Component, inject, type OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import type { MyTripsDto } from '@fcs/shared';
import { ApiService } from '../core/api.service';
import { SessionStore } from '../core/session.store';
import { ToastService } from '../core/toast.service';
import { TripCardComponent } from '../shared/trip-card.component';

@Component({
  selector: 'app-home-page',
  imports: [MatButtonModule, MatIconModule, MatProgressBarModule, RouterLink, TripCardComponent],
  template: `
    <div class="page">
      <h1 class="page-title">Ciao {{ session.me()?.firstName }}</h1>
      <div class="row quick">
        <a mat-flat-button routerLink="/cerca"><mat-icon svgIcon="search" />Cerca un passaggio</a>
        <a mat-stroked-button routerLink="/proponi"><mat-icon svgIcon="add" />Proponi un viaggio</a>
      </div>

      @if (loading()) { <mat-progress-bar mode="indeterminate" /> }
      @if (data(); as d) {
        @if (d.pendingInvitations.length) {
          <h2 class="section-title">Inviti ricevuti</h2>
          <div class="card-list">
            @for (i of d.pendingInvitations; track i.id) { <app-trip-card [trip]="i.trip" /> }
          </div>
        }
        @if (d.awaitingClosure.length) {
          <h2 class="section-title">Viaggi da chiudere</h2>
          <p class="muted">Conferma chi era presente: solo i viaggi chiusi contano nelle statistiche.</p>
          <div class="card-list">
            @for (t of d.awaitingClosure; track t.id) { <app-trip-card [trip]="t" /> }
          </div>
        }
        <h2 class="section-title">I miei viaggi come conducente</h2>
        @for (t of d.asDriver; track t.id) {
          <div class="with-badge">
            <app-trip-card [trip]="t" />
            @if (requests(t.id); as n) { <span class="badge">{{ n }} {{ n === 1 ? 'richiesta' : 'richieste' }}</span> }
          </div>
        } @empty {
          <p class="empty">Nessun viaggio in programma. <a routerLink="/proponi">Proponine uno</a>.</p>
        }
        <h2 class="section-title">Viaggi a cui partecipo</h2>
        <div class="card-list">
          @for (t of d.asParticipant; track t.id) { <app-trip-card [trip]="t" /> }
          @empty { <p class="empty">Non partecipi ancora a nessun viaggio. <a routerLink="/cerca">Cerca un passaggio</a>.</p> }
        </div>
        @if (d.recent.length) {
          <h2 class="section-title">Viaggi recenti</h2>
          <div class="card-list">
            @for (t of d.recent; track t.id) { <app-trip-card [trip]="t" /> }
          </div>
        }
      }
    </div>
  `,
  styles: `
    .quick { margin-bottom: 8px; }
    .quick a { flex: 1 1 160px; }
    .with-badge { position: relative; margin-bottom: 12px; }
    .badge { position: absolute; top: -8px; right: 8px; background: var(--mat-sys-error); color: var(--mat-sys-on-error);
      border-radius: 999px; padding: 2px 10px; font: var(--mat-sys-label-medium); }
  `,
})
export class HomePage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  protected readonly session = inject(SessionStore);
  protected readonly data = signal<MyTripsDto | null>(null);
  protected readonly loading = signal(true);

  async ngOnInit(): Promise<void> {
    try {
      this.data.set(await this.api.myTrips());
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.loading.set(false);
    }
  }

  protected requests(tripId: string): number {
    return this.data()?.pendingRequests.find((r) => r.tripId === tripId)?.count ?? 0;
  }
}
