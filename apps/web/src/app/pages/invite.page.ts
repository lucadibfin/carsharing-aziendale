import { Component, inject, type OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { Router, RouterLink } from '@angular/router';
import type { InvitationScope, TripSummaryDto } from '@fcs/shared';
import { ApiService, errorMessage } from '../core/api.service';
import { ToastService } from '../core/toast.service';
import { TripCardComponent } from '../shared/trip-card.component';

const STORAGE_KEY = 'pendingInviteToken';

/**
 * Atterraggio del link d'invito: /invito#<token>.
 * Il token sta nel frammento dell'URL (mai inviato al server nei log di accesso).
 * Se l'utente non è autenticato, il token viene conservato solo per la sessione
 * del browser mentre passa da login e onboarding.
 */
@Component({
  selector: 'app-invite-page',
  imports: [FormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatSelectModule, MatProgressBarModule, TripCardComponent],
  template: `
    <div class="page">
      <h1 class="page-title">Invito a un viaggio</h1>
      @if (loading()) { <mat-progress-bar mode="indeterminate" /> }
      @if (error()) {
        <p class="empty">{{ error() }}</p>
        <div class="actions"><a mat-button routerLink="/">Vai alla home</a></div>
      }
      @if (trip(); as t) {
        @if (t.invitationScope === 'SERIES') {
          <p>Sei invitato nel <strong>gruppo fisso</strong> di un viaggio ricorrente: sarai confermato in tutte le date,
            finché c'è posto, e potrai dire "non ci sono" per una singola data. Qui sotto la prossima data.</p>
        }
        <app-trip-card [trip]="t" />
        <mat-form-field class="full-width pick">
          <mat-label>Dove sali?</mat-label>
          <mat-select [(ngModel)]="boarding">
            @for (s of t.stops; track s.order) { <mat-option [value]="s.comuneIstat">{{ s.comuneName }}</mat-option> }
          </mat-select>
        </mat-form-field>
        <div class="actions">
          <a mat-button routerLink="/">Non ora</a>
          <button mat-flat-button (click)="accept()" [disabled]="!boarding || busy()">Accetta l'invito</button>
        </div>
      }
    </div>
  `,
  styles: `.pick { margin-top: var(--app-space-4); }`,
})
export class InvitePage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly trip = signal<(TripSummaryDto & { invitationScope: InvitationScope }) | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected boarding: string | null = null;
  private token = '';

  async ngOnInit(): Promise<void> {
    const fromHash = location.hash.replace(/^#/, '');
    if (fromHash) {
      safeSession(() => sessionStorage.setItem(STORAGE_KEY, fromHash));
      history.replaceState(null, '', '/invito'); // rimuove il token dalla barra degli indirizzi
    }
    this.token = fromHash || safeSession(() => sessionStorage.getItem(STORAGE_KEY)) || '';
    if (!this.token) {
      this.error.set('Link d’invito non valido.');
      this.loading.set(false);
      return;
    }
    try {
      const t = await this.api.previewInviteLink(this.token);
      this.trip.set(t);
      this.boarding = t.stops[0]?.comuneIstat ?? null;
    } catch (e) {
      this.error.set(errorMessage(e, 'Invito non valido, scaduto o revocato.'));
      safeSession(() => sessionStorage.removeItem(STORAGE_KEY));
    } finally {
      this.loading.set(false);
    }
  }

  async accept(): Promise<void> {
    this.busy.set(true);
    try {
      const t = await this.api.acceptInviteLink(this.token, this.boarding!);
      safeSession(() => sessionStorage.removeItem(STORAGE_KEY));
      this.toast.info('Invito accettato');
      await this.router.navigate(['/viaggi', t.id]);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}

function safeSession<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}
