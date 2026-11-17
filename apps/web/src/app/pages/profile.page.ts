import { Component, computed, inject, type OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Router, RouterLink } from '@angular/router';
import { type ConsentsInput, type FavoriteDto, FUEL_TYPE_LABELS, type FuelType, type ProfileDto } from '@fcs/shared';
import { ApiService } from '../core/api.service';
import { PushService } from '../core/push.service';
import { ReferenceStore } from '../core/reference.store';
import { SessionStore } from '../core/session.store';
import { ToastService } from '../core/toast.service';
import { ComunePickerComponent } from '../shared/comune-picker.component';
import { EmailVerifyComponent } from '../shared/email-verify.component';

@Component({
  selector: 'app-profile-page',
  imports: [FormsModule, RouterLink, MatButtonModule, MatCardModule, MatIconModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatSlideToggleModule, ComunePickerComponent, EmailVerifyComponent],
  template: `
    <div class="page">
      <h1 class="page-title">Profilo</h1>
      <nav class="links" aria-label="Sezioni del profilo">
        <a mat-stroked-button routerLink="/statistiche"><mat-icon svgIcon="eco" />Le mie statistiche</a>
        <a mat-stroked-button routerLink="/profilo/dati"><mat-icon svgIcon="description" />I miei dati</a>
        @if (isAdmin()) {
          <a mat-stroked-button routerLink="/admin"><mat-icon svgIcon="admin_panel_settings" />Area amministrativa</a>
        }
      </nav>
      @if (p(); as p) {
        <mat-card appearance="outlined">
          <mat-card-content class="stack">
            <div>
              <div class="name">{{ p.firstName }} {{ p.lastName }}</div>
              <div class="muted small">Nome e cognome provengono dal sistema aziendale e non sono modificabili.</div>
            </div>
            <mat-form-field>
              <mat-label>Sede di riferimento</mat-label>
              <mat-select [(ngModel)]="siteId">
                @for (s of ref.sites(); track s.id) { <mat-option [value]="s.id">{{ s.name }}</mat-option> }
              </mat-select>
            </mat-form-field>
            <app-comune-picker label="Comune di residenza" [(value)]="comuneIstat" />
            <mat-form-field>
              <mat-label>Telefono (facoltativo)</mat-label>
              <input matInput type="tel" [(ngModel)]="phone" autocomplete="tel" />
              <mat-hint>Visibile solo ai partecipanti confermati dei tuoi viaggi, e solo se lo consenti qui sotto.</mat-hint>
            </mat-form-field>
            <h2 class="section-title">La tua auto (facoltativo)</h2>
            <p class="muted">Serve solo a stimare il carburante e la CO2 risparmiati.</p>
            <div class="row">
              <mat-form-field class="grow">
                <mat-label>Alimentazione</mat-label>
                <mat-select [(ngModel)]="fuelType">
                  <mat-option [value]="null">Non indicata</mat-option>
                  @for (f of fuelTypes; track f) { <mat-option [value]="f">{{ fuelLabels[f] }}</mat-option> }
                </mat-select>
              </mat-form-field>
              <mat-form-field class="grow">
                <mat-label>Consumo medio ({{ fuelType === 'ELECTRIC' ? 'kWh' : 'l' }}/100 km)</mat-label>
                <input matInput type="number" min="0.1" max="50" step="0.1" [(ngModel)]="consumption" />
              </mat-form-field>
            </div>
            <div class="actions"><button mat-flat-button (click)="save()" [disabled]="busy()">Salva</button></div>
          </mat-card-content>
        </mat-card>

        <h2 class="section-title">Email per le notifiche</h2>
        <mat-card appearance="outlined">
          <mat-card-content class="stack">
            <app-email-verify [status]="p.email" (changed)="onEmailChanged($event)" />
          </mat-card-content>
        </mat-card>

        <h2 class="section-title">Privacy e consensi</h2>
        <mat-card appearance="outlined">
          <mat-card-content class="stack">
            <mat-slide-toggle [checked]="p.consents.phoneVisible" (change)="setConsent('phoneVisible', $event.checked)">
              Mostra il mio telefono ai partecipanti confermati
            </mat-slide-toggle>
            <mat-slide-toggle [checked]="p.consents.discoverable" (change)="setConsent('discoverable', $event.checked)">
              Rendimi trovabile nella ricerca colleghi per gli inviti
            </mat-slide-toggle>
            <mat-slide-toggle [checked]="p.consents.optionalNotifications" (change)="setConsent('optionalNotifications', $event.checked)">
              Notifiche facoltative (promemoria, nuovi viaggi dei preferiti, riepiloghi)
            </mat-slide-toggle>
            <p class="muted small">Puoi revocare ogni consenso in qualsiasi momento, senza alcuna conseguenza.</p>
            <a mat-button routerLink="/informativa">Leggi l'informativa privacy e i termini d'uso</a>
          </mat-card-content>
        </mat-card>

        <h2 class="section-title">Colleghi preferiti</h2>
        <mat-card appearance="outlined">
          <mat-card-content class="stack">
            @for (f of favorites(); track f.id) {
              <div class="row">
                <span class="grow">{{ f.firstName }} {{ f.lastName }} <span class="muted">{{ f.siteName }}</span></span>
                <button mat-icon-button (click)="removeFavorite(f.id)" [attr.aria-label]="'Togli ' + f.firstName + ' ' + f.lastName + ' dai preferiti'">
                  <mat-icon svgIcon="delete" />
                </button>
              </div>
            } @empty {
              <p class="muted">Nessun preferito. Aggiungi un collega con la stella <mat-icon svgIcon="star" class="inline" /> nel dettaglio di un viaggio fatto insieme.</p>
            }
            <p class="muted small">
              Quando un preferito propone un viaggio pubblico per la tua sede che passa dal tuo comune ricevi un avviso,
              se hai attivato le notifiche facoltative. Il collega non sa di essere tra i tuoi preferiti.
            </p>
          </mat-card-content>
        </mat-card>

        <h2 class="section-title">Notifiche push</h2>
        <mat-card appearance="outlined">
          <mat-card-content class="stack">
            @switch (push.state()) {
              @case ('on') {
                <p>Notifiche attive su questo dispositivo.</p>
                <button mat-stroked-button (click)="disablePush()">Disattiva</button>
              }
              @case ('off') {
                <p class="muted">Ricevi un avviso per richieste, conferme e nuovi messaggi. Le notifiche non contengono mai il testo dei messaggi.</p>
                <button mat-flat-button (click)="enablePush()">Attiva le notifiche</button>
              }
              @case ('ios-not-installed') {
                <p>Su iPhone e iPad le notifiche funzionano solo con l'app installata:</p>
                <ol class="muted">
                  <li>tocca il pulsante <strong>Condividi</strong> di Safari;</li>
                  <li>scegli <strong>Aggiungi alla schermata Home</strong>;</li>
                  <li>apri l'app dall'icona e torna qui per attivare le notifiche.</li>
                </ol>
              }
              @case ('denied') {
                <p class="muted">Hai bloccato le notifiche per questo sito. Puoi riattivarle dalle impostazioni del browser.</p>
              }
              @default {
                <p class="muted">Questo browser non supporta le notifiche push. Le comunicazioni importanti sui tuoi viaggi ti arrivano comunque via email.</p>
              }
            }
          </mat-card-content>
        </mat-card>

        <div class="actions"><button mat-button (click)="logout()">Esci</button></div>
      }
    </div>
  `,
  styles: `
    .name { font: var(--mat-sys-title-large); }
    .links { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
    .inline { width: 18px; height: 18px; vertical-align: text-bottom; }
    .small { font-size: 0.85em; }
  `,
})
export class ProfilePage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  protected readonly ref = inject(ReferenceStore);
  protected readonly push = inject(PushService);

  protected readonly fuelLabels = FUEL_TYPE_LABELS;
  protected readonly fuelTypes = Object.keys(FUEL_TYPE_LABELS) as FuelType[];
  protected readonly p = signal<ProfileDto | null>(null);
  protected readonly busy = signal(false);
  protected siteId: string | null = null;
  protected comuneIstat: string | null = null;
  protected phone = '';
  protected fuelType: FuelType | null = null;
  protected consumption: number | null = null;

  protected readonly favorites = signal<FavoriteDto[]>([]);
  protected readonly isAdmin = computed(() => (this.session.me()?.roles.length ?? 0) > 0);

  async ngOnInit(): Promise<void> {
    await this.ref.loadSites();
    this.fill(await this.api.profile());
    this.api.favorites().then((f) => this.favorites.set(f), () => undefined);
    await this.push.refresh().catch(() => undefined);
  }

  private fill(p: ProfileDto): void {
    this.p.set(p);
    this.siteId = p.siteId;
    this.comuneIstat = p.comuneIstat;
    this.phone = p.phone ?? '';
    this.fuelType = p.fuelType;
    this.consumption = p.consumptionPer100km;
  }

  async save(): Promise<void> {
    this.busy.set(true);
    try {
      this.fill(
        await this.api.updateProfile({
          siteId: this.siteId ?? undefined,
          comuneIstat: this.comuneIstat ?? undefined,
          phone: this.phone.trim() || null,
          fuelType: this.fuelType,
          consumptionPer100km: this.consumption ? Number(this.consumption) : null,
        }),
      );
      await this.session.refresh();
      this.toast.info('Profilo aggiornato');
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  protected onEmailChanged(email: ProfileDto['email']): void {
    this.p.update((p) => (p ? { ...p, email } : p));
  }

  async setConsent(key: keyof ConsentsInput, value: boolean): Promise<void> {
    try {
      this.fill(await this.api.updateConsents({ [key]: value }));
    } catch (e) {
      this.toast.error(e);
    }
  }

  async removeFavorite(userId: string): Promise<void> {
    try {
      this.favorites.set(await this.api.removeFavorite(userId));
    } catch (e) {
      this.toast.error(e);
    }
  }

  async enablePush(): Promise<void> {
    try {
      await this.push.enable();
      this.toast.info('Notifiche attivate');
    } catch (e) {
      this.toast.error(e, 'Impossibile attivare le notifiche');
      await this.push.refresh();
    }
  }

  async disablePush(): Promise<void> {
    await this.push.disable();
  }

  async logout(): Promise<void> {
    await this.api.logout().catch(() => undefined);
    this.session.clear();
    await this.router.navigate(['/login']);
  }
}
