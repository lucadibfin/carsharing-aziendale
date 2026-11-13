import { DecimalPipe } from '@angular/common';
import { Component, inject, type OnInit, signal } from '@angular/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import type { PersonalStatsDto, StatsPeriodDto } from '@fcs/shared';
import { ApiService } from '../core/api.service';
import { ToastService } from '../core/toast.service';

@Component({
  selector: 'app-stats-page',
  imports: [DecimalPipe, MatCardModule, MatIconModule, MatButtonToggleModule],
  template: `
    <div class="page">
      <h1 class="page-title">Le mie statistiche</h1>
      @if (stats(); as s) {
        <mat-button-toggle-group [value]="period()" (change)="period.set($event.value)" aria-label="Periodo" class="period">
          <mat-button-toggle value="year">{{ s.year }}</mat-button-toggle>
          <mat-button-toggle value="all">Da sempre</mat-button-toggle>
        </mat-button-toggle-group>
        @let t = current(s);
        @if (t.asDriver + t.asPassenger === 0) {
          <p class="muted">Ancora nessun viaggio concluso in questo periodo. Le statistiche si aggiornano quando il conducente chiude un viaggio confermando i presenti.</p>
        } @else {
          <div class="grid">
            <mat-card appearance="outlined"><mat-card-content>
              <div class="value">{{ t.asDriver }}</div><div class="label">viaggi come conducente</div>
            </mat-card-content></mat-card>
            <mat-card appearance="outlined"><mat-card-content>
              <div class="value">{{ t.asPassenger }}</div><div class="label">viaggi come passeggero</div>
            </mat-card-content></mat-card>
            <mat-card appearance="outlined"><mat-card-content>
              <div class="value">{{ t.sharedKm | number: '1.0-0' }} km</div><div class="label">percorsi insieme ai colleghi</div>
            </mat-card-content></mat-card>
            <mat-card appearance="outlined" class="eco"><mat-card-content>
              <mat-icon svgIcon="eco" />
              <div class="value">{{ t.co2SavedKg | number: '1.0-1' }} kg</div><div class="label">di CO2 risparmiata</div>
            </mat-card-content></mat-card>
            <mat-card appearance="outlined"><mat-card-content>
              <div class="value">
                @for (f of t.fuelSaved; track f.unit; let last = $last) { {{ f.amount | number: '1.0-1' }} {{ f.unit }}@if (!last) {, } }
                @empty { 0 }
              </div>
              <div class="label">di carburante risparmiato</div>
            </mat-card-content></mat-card>
            <mat-card appearance="outlined"><mat-card-content>
              <div class="value">{{ t.eurSaved | number: '1.2-2' }} €</div><div class="label">di carburante non speso</div>
            </mat-card-content></mat-card>
          </div>
          <p class="muted small">
            I risparmi sono calcolati sui km che ogni passeggero avrebbe percorso da solo in auto
            ({{ t.kmAvoided | number: '1.0-0' }} km evitati), dal comune di salita alla sede.
            Come conducente vedi quelli dei tuoi passeggeri. Consumo ed emissioni sono quelli dell'auto del
            conducente se li ha indicati, altrimenti valori medi.
            @if (s.anyEstimated) { Alcune distanze sono stimate in linea d'aria e non calcolate su strada. }
          </p>
        }
      }
    </div>
  `,
  styles: `
    .period { margin-bottom: 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
    .value { font: var(--mat-sys-headline-small); }
    .label { color: var(--mat-sys-on-surface-variant); font: var(--mat-sys-body-small); }
    .eco mat-icon { color: var(--mat-sys-primary); }
    .small { font-size: 0.85em; margin-top: 16px; }
  `,
})
export class StatsPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  protected readonly stats = signal<PersonalStatsDto | null>(null);
  protected readonly period = signal<'year' | 'all'>('year');

  async ngOnInit(): Promise<void> {
    try {
      this.stats.set(await this.api.myStats());
    } catch (e) {
      this.toast.error(e);
    }
  }

  protected current(s: PersonalStatsDto): StatsPeriodDto {
    return this.period() === 'year' ? s.thisYear : s.allTime;
  }
}
