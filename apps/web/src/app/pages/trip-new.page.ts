import { Component, inject, type OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Router } from '@angular/router';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { createTripSchema, type TripVisibility, WEEKDAY_LABELS } from '@fcs/shared';
import { ApiService } from '../core/api.service';
import { ReferenceStore } from '../core/reference.store';
import { SessionStore } from '../core/session.store';
import { ToastService } from '../core/toast.service';
import { ComunePickerComponent } from '../shared/comune-picker.component';
import { todayIso } from '../shared/dates';

@Component({
  selector: 'app-trip-new-page',
  imports: [
    FormsModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule, MatButtonToggleModule, MatIconModule,
    MatCheckboxModule, MatSlideToggleModule, ComunePickerComponent,
  ],
  template: `
    <div class="page">
      <h1 class="page-title">Proponi un viaggio</h1>
      <form class="stack" (ngSubmit)="submit()">
        <mat-form-field>
          <mat-label>Sede di destinazione</mat-label>
          <mat-select [(ngModel)]="siteId" name="siteId" required>
            @for (s of ref.sites(); track s.id) { <mat-option [value]="s.id">{{ s.name }}</mat-option> }
          </mat-select>
        </mat-form-field>
        <mat-slide-toggle [(ngModel)]="recurring" name="recurring">Si ripete ogni settimana</mat-slide-toggle>
        @if (recurring) {
          <fieldset class="weekdays">
            <legend>In quali giorni?</legend>
            <div class="row wrap">
              @for (d of weekdayOptions; track d.value) {
                <mat-checkbox [checked]="weekdays().includes(d.value)" (change)="toggleDay(d.value, $event.checked)">{{ d.label }}</mat-checkbox>
              }
            </div>
          </fieldset>
        }
        <div class="row">
          <mat-form-field class="grow">
            <mat-label>{{ recurring ? 'Dal' : 'Data' }}</mat-label>
            <input matInput type="date" [(ngModel)]="date" name="date" [min]="today" required />
          </mat-form-field>
          @if (recurring) {
            <mat-form-field class="grow">
              <mat-label>Fino al</mat-label>
              <input matInput type="date" [(ngModel)]="endDate" name="endDate" [min]="date" />
              <mat-hint>Facoltativa</mat-hint>
            </mat-form-field>
          }
        </div>
        @if (recurring) {
          <p class="muted small">
            Senza data di fine il viaggio continua finché non lo termini. Puoi invitare dei colleghi nel <strong>gruppo fisso</strong>: saranno confermati in tutte le date e potranno
            dire "non ci sono" per una singola data.
          </p>
        }
        <div class="row">
          <mat-form-field class="grow">
            <mat-label>Arrivo in ufficio</mat-label>
            <input matInput type="time" [(ngModel)]="arrivalTime" name="arrivalTime" required />
          </mat-form-field>
          <mat-form-field class="grow">
            <mat-label>Ripartenza</mat-label>
            <input matInput type="time" [(ngModel)]="returnTime" name="returnTime" />
            <mat-hint>Facoltativa</mat-hint>
          </mat-form-field>
        </div>

        <h2 class="section-title">Percorso</h2>
        <app-comune-picker label="Comune di partenza" [required]="true" [(value)]="departure" />
        @for (v of via(); track $index; let i = $index) {
          <div class="row via">
            <app-comune-picker class="grow" [label]="'Comune di passaggio ' + (i + 1)" [value]="v" (valueChange)="setVia(i, $event)" />
            <button mat-icon-button type="button" (click)="move(i, -1)" [disabled]="i === 0" aria-label="Sposta su">
              <mat-icon svgIcon="arrow_upward" />
            </button>
            <button mat-icon-button type="button" (click)="removeVia(i)" aria-label="Rimuovi comune">
              <mat-icon svgIcon="delete" />
            </button>
          </div>
        }
        @if (via().length < 10) {
          <button mat-stroked-button type="button" (click)="addVia()">
            <mat-icon svgIcon="add_location_alt" />Aggiungi comune di passaggio
          </button>
        }
        <mat-form-field>
          <mat-label>Punto d'incontro (facoltativo)</mat-label>
          <input matInput [(ngModel)]="meetingPoint" name="meetingPoint" maxlength="200" />
          <mat-hint>Descrizione a testo, es. "parcheggio della stazione". Non inserire indirizzi di abitazione.</mat-hint>
        </mat-form-field>

        <h2 class="section-title">Posti e visibilità</h2>
        <mat-form-field>
          <mat-label>Posti disponibili per i passeggeri</mat-label>
          <mat-select [(ngModel)]="seats" name="seats">
            @for (n of [1, 2, 3, 4, 5, 6, 7, 8]; track n) { <mat-option [value]="n">{{ n }}</mat-option> }
          </mat-select>
        </mat-form-field>
        <mat-button-toggle-group [(ngModel)]="visibility" name="visibility" aria-label="Visibilità" class="full-width">
          <mat-button-toggle value="PUBLIC" class="grow">Pubblico</mat-button-toggle>
          <mat-button-toggle value="PRIVATE" class="grow">Privato</mat-button-toggle>
        </mat-button-toggle-group>
        <p class="muted">
          @if (visibility === 'PUBLIC') { Compare nelle ricerche: tutti i colleghi possono chiedere di partecipare. }
          @else { Visibile solo a te e alle persone che inviterai. Non compare nelle ricerche. }
        </p>
        <mat-form-field>
          <mat-label>Note (facoltative)</mat-label>
          <textarea matInput [(ngModel)]="notes" name="notes" maxlength="500" rows="3"></textarea>
        </mat-form-field>
        <button mat-flat-button type="submit" [disabled]="busy()">Pubblica il viaggio</button>
      </form>
    </div>
  `,
  styles: `
    .weekdays { border: 0; margin: 0; padding: 0; }
    .weekdays legend { font: var(--mat-sys-body-medium); color: var(--mat-sys-on-surface-variant); margin-bottom: var(--app-space-1); }
    .wrap { flex-wrap: wrap; gap: 0 var(--app-space-2); }
    .small { font-size: 0.85em; margin: 0; }
    .via app-comune-picker { flex: 1 1 auto; }
    mat-button-toggle-group { display: flex; }
    mat-button-toggle { flex: 1; }
  `,
})
export class TripNewPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly session = inject(SessionStore);
  protected readonly ref = inject(ReferenceStore);

  protected readonly today = todayIso();
  protected readonly weekdayOptions = [1, 2, 3, 4, 5, 6, 7].map((value) => ({ value, label: WEEKDAY_LABELS[value]! }));
  protected siteId: string | null = null;
  protected date = todayIso(1);
  protected recurring = false;
  protected readonly weekdays = signal<number[]>([1, 2, 3, 4, 5]);
  protected endDate = '';
  protected arrivalTime = '08:30';
  protected returnTime = '17:30';
  protected departure: string | null = null;
  protected readonly via = signal<(string | null)[]>([]);
  protected meetingPoint = '';
  protected seats = 3;
  protected visibility: TripVisibility = 'PUBLIC';
  protected notes = '';
  protected readonly busy = signal(false);

  async ngOnInit(): Promise<void> {
    await this.ref.loadSites();
    this.siteId = this.session.me()?.siteId ?? null;
    this.departure = this.session.me()?.comuneIstat ?? null;
  }

  protected toggleDay(day: number, on: boolean): void {
    this.weekdays.update((w) => (on ? [...w, day].sort() : w.filter((d) => d !== day)));
  }

  protected addVia(): void {
    this.via.update((v) => [...v, null]);
  }
  protected setVia(i: number, istat: string | null): void {
    this.via.update((v) => v.map((x, j) => (j === i ? istat : x)));
  }
  protected removeVia(i: number): void {
    this.via.update((v) => v.filter((_, j) => j !== i));
  }
  protected move(i: number, d: number): void {
    this.via.update((v) => {
      const a = [...v];
      [a[i], a[i + d]] = [a[i + d]!, a[i]!];
      return a;
    });
  }

  async submit(): Promise<void> {
    if (!this.siteId || !this.departure || !this.date || !this.arrivalTime) {
      this.toast.info('Indica sede, data, orario di arrivo e comune di partenza');
      return;
    }
    if (this.recurring && this.weekdays().length === 0) {
      this.toast.info('Scegli almeno un giorno della settimana');
      return;
    }
    const parsed = createTripSchema.safeParse({
      siteId: this.siteId,
      date: this.date,
      weekdays: this.recurring ? this.weekdays() : [],
      endDate: this.recurring && this.endDate ? this.endDate : null,
      arrivalTime: this.arrivalTime,
      returnTime: this.returnTime || null,
      departureComune: this.departure,
      viaComuni: this.via().filter((v): v is string => Boolean(v)),
      meetingPoint: this.meetingPoint || undefined,
      seats: this.seats,
      visibility: this.visibility,
      notes: this.notes || undefined,
    });
    if (!parsed.success) {
      this.toast.info(parsed.error.issues[0]?.message ?? 'Controlla i dati inseriti');
      return;
    }
    this.busy.set(true);
    try {
      const trip = await this.api.createTrip(parsed.data);
      this.toast.info('Viaggio pubblicato');
      await this.router.navigate(['/viaggi', trip.id]);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}
