import { DatePipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import type { TripSummaryDto } from '@fcs/shared';
import { STATUS_LABELS } from './labels';

@Component({
  selector: 'app-trip-card',
  imports: [MatCardModule, MatIconModule, RouterLink, DatePipe],
  template: `
    <mat-card appearance="outlined" class="trip-card" [routerLink]="['/viaggi', trip().id]" role="link" tabindex="0">
      <mat-card-content>
        <div class="head">
          <div>
            <div class="date">{{ trip().date | date: 'EEE d MMMM' }}</div>
            <div class="muted">Arrivo in {{ trip().siteName }} alle <strong>{{ trip().arrivalTime }}</strong>
              @if (trip().returnTime) { · ripartenza {{ trip().returnTime }} }
            </div>
          </div>
          <div class="seats" [attr.aria-label]="'Posti liberi: ' + free()">
            <mat-icon svgIcon="airline_seat_recline_normal" />{{ free() }}/{{ trip().seats }}
          </div>
        </div>
        <div class="route">{{ route() }}</div>
        <div class="row tags">
          @if (trip().visibility === 'PRIVATE') { <span class="chip private">Privato</span> }
          @if (trip().myRole === 'DRIVER') { <span class="chip">Conducente</span> }
          @else { <span class="muted">con {{ trip().driver.firstName }} {{ trip().driver.lastName }}</span> }
          @if (trip().myStatus) { <span class="chip">{{ statusLabel() }}</span> }
          @if (trip().status !== 'SCHEDULED') { <span class="chip warn">{{ tripStatus() }}</span> }
        </div>
      </mat-card-content>
    </mat-card>
  `,
  styles: `
    .trip-card { cursor: pointer; }
    .head { display: flex; justify-content: space-between; gap: 8px; }
    .date { font: var(--mat-sys-title-medium); text-transform: capitalize; }
    .seats { display: flex; align-items: center; gap: 2px; font: var(--mat-sys-title-small); color: var(--mat-sys-primary); }
    .route { margin: 8px 0; font: var(--mat-sys-body-large); }
    .tags { gap: 8px; }
  `,
})
export class TripCardComponent {
  readonly trip = input.required<TripSummaryDto>();
  protected readonly free = computed(() => Math.max(0, this.trip().seats - this.trip().seatsTaken));
  protected readonly route = computed(() => this.trip().stops.map((s) => s.comuneName).join(' → ') + ' → ' + this.trip().siteName);
  protected readonly statusLabel = computed(() => STATUS_LABELS.participant[this.trip().myStatus!] ?? '');
  protected readonly tripStatus = computed(() => STATUS_LABELS.trip[this.trip().status]);
}
