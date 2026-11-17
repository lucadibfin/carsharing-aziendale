import { Component, inject, input, model, type OnInit, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ReferenceStore } from '../../core/reference.store';
import { SessionStore } from '../../core/session.store';

/** Filtri comuni (sede e periodo) delle pagine admin. L'admin di sede vede solo le proprie sedi. */
@Component({
  selector: 'app-admin-filters',
  imports: [FormsModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <div class="row filters">
      <mat-form-field class="grow">
        <mat-label>Sede</mat-label>
        <mat-select [(ngModel)]="siteId">
          @if (session.isGlobalAdmin()) { <mat-option [value]="''">Tutte le sedi</mat-option> }
          @else if (mySites().length > 1) { <mat-option [value]="''">Tutte le mie sedi</mat-option> }
          @for (s of mySites(); track s.id) { <mat-option [value]="s.id">{{ s.name }}</mat-option> }
        </mat-select>
      </mat-form-field>
      @if (withPeriod()) {
        <mat-form-field class="grow">
          <mat-label>Dal</mat-label>
          <input matInput type="date" [(ngModel)]="from" />
        </mat-form-field>
        <mat-form-field class="grow">
          <mat-label>Al</mat-label>
          <input matInput type="date" [(ngModel)]="to" />
        </mat-form-field>
      }
      <ng-content />
    </div>
  `,
  styles: `.filters { align-items: baseline; }`,
})
export class AdminFiltersComponent implements OnInit {
  protected readonly session = inject(SessionStore);
  private readonly ref = inject(ReferenceStore);
  readonly withPeriod = input(true);
  readonly siteId = model('');
  readonly from = model('');
  readonly to = model('');
  readonly ready = output<void>();

  async ngOnInit(): Promise<void> {
    await this.ref.loadSites();
    const mine = this.mySites();
    if (!this.session.isGlobalAdmin() && mine.length === 1 && !this.siteId()) this.siteId.set(mine[0]!.id);
    if (!this.from()) this.from.set(`${new Date().getFullYear()}-01-01`);
    if (!this.to()) this.to.set(new Date().toISOString().slice(0, 10));
    // Il genitore carica i dati solo dopo che i default sono stati impostati.
    queueMicrotask(() => this.ready.emit());
  }

  protected mySites() {
    const all = this.ref.sites();
    if (this.session.isGlobalAdmin()) return all;
    const own = new Set(this.session.me()?.roles.filter((r) => r.role === 'SITE_ADMIN').map((r) => r.siteId));
    return all.filter((s) => own.has(s.id));
  }
}
