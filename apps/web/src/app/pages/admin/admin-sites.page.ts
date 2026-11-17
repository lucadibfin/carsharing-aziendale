import { Component, inject, type OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import type { AdminSiteDto } from '@fcs/shared';
import { ApiService } from '../../core/api.service';
import { ReferenceStore } from '../../core/reference.store';
import { ToastService } from '../../core/toast.service';
import { ComunePickerComponent } from '../../shared/comune-picker.component';

interface SiteForm {
  id: string | null;
  name: string;
  address: string;
  comuneIstat: string | null;
  lat: number | null;
  lon: number | null;
  active: boolean;
}

const empty = (): SiteForm => ({ id: null, name: '', address: '', comuneIstat: null, lat: null, lon: null, active: true });

@Component({
  selector: 'app-admin-sites',
  imports: [FormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule, MatSlideToggleModule, ComunePickerComponent],
  template: `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Sede</th><th>Indirizzo</th><th>Coordinate</th><th>Stato</th><th></th></tr></thead>
        <tbody>
          @for (s of sites(); track s.id) {
            <tr>
              <td>{{ s.name }}</td>
              <td>{{ s.address }}</td>
              <td>{{ s.lat !== null ? s.lat + ', ' + s.lon : 'quelle del comune' }}</td>
              <td>{{ s.active ? 'Attiva' : 'Non attiva' }}</td>
              <td><button mat-button (click)="edit(s)">Modifica</button></td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    <h2 class="section-title">{{ form.id ? 'Modifica sede' : 'Nuova sede' }}</h2>
    <mat-card appearance="outlined">
      <mat-card-content class="stack">
        <mat-form-field><mat-label>Nome</mat-label><input matInput [(ngModel)]="form.name" maxlength="100" /></mat-form-field>
        <mat-form-field>
          <mat-label>Indirizzo</mat-label><input matInput [(ngModel)]="form.address" maxlength="200" />
          <mat-hint>Indirizzo pubblico della sede aziendale (mai quello degli utenti).</mat-hint>
        </mat-form-field>
        <app-comune-picker label="Comune" [(value)]="form.comuneIstat" />
        <div class="row">
          <mat-form-field class="grow"><mat-label>Latitudine</mat-label><input matInput type="number" step="0.0001" [(ngModel)]="form.lat" /></mat-form-field>
          <mat-form-field class="grow"><mat-label>Longitudine</mat-label><input matInput type="number" step="0.0001" [(ngModel)]="form.lon" /></mat-form-field>
        </div>
        <p class="muted small">Facoltative: senza coordinate si usa il centro del comune. Cambiandole, le distanze verso la sede vengono ricalcolate.</p>
        @if (form.id) { <mat-slide-toggle [(ngModel)]="form.active">Sede attiva (selezionabile da utenti e viaggi)</mat-slide-toggle> }
        <div class="actions">
          @if (form.id) { <button mat-button (click)="reset()">Annulla</button> }
          <button mat-flat-button (click)="save()" [disabled]="busy() || !form.name || !form.address || !form.comuneIstat">Salva</button>
        </div>
      </mat-card-content>
    </mat-card>
  `,
  styles: `.small { font-size: 0.85em; }`,
})
export class AdminSitesPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly ref = inject(ReferenceStore);
  protected readonly sites = signal<AdminSiteDto[]>([]);
  protected readonly busy = signal(false);
  protected form: SiteForm = empty();

  async ngOnInit(): Promise<void> {
    this.sites.set(await this.api.adminSites());
  }

  edit(s: AdminSiteDto): void {
    this.form = { ...s };
  }

  reset(): void {
    this.form = empty();
  }

  async save(): Promise<void> {
    const f = this.form;
    const coord = (v: number | string | null) => (v === null || v === '' ? null : Number(v));
    const body = {
      name: f.name.trim(),
      address: f.address.trim(),
      comuneIstat: f.comuneIstat!,
      lat: coord(f.lat),
      lon: coord(f.lon),
    };
    if ((body.lat === null) !== (body.lon === null)) return void this.toast.info('Indica entrambe le coordinate oppure nessuna');
    this.busy.set(true);
    try {
      this.sites.set(f.id ? await this.api.adminUpdateSite(f.id, { ...body, active: f.active }) : await this.api.adminCreateSite(body));
      await this.ref.invalidateSites();
      this.toast.info('Sede salvata');
      this.reset();
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}
