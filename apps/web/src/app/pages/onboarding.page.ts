import { Component, computed, inject, input, type OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatStepperModule } from '@angular/material/stepper';
import { Router } from '@angular/router';
import type { EmailStatusDto, PolicyDto } from '@fcs/shared';
import { ApiService } from '../core/api.service';
import { safeNext } from '../core/guards';
import { ReferenceStore } from '../core/reference.store';
import { SessionStore } from '../core/session.store';
import { ToastService } from '../core/toast.service';
import { ComunePickerComponent } from '../shared/comune-picker.component';
import { EmailVerifyComponent } from '../shared/email-verify.component';
import { MarkdownPipe } from '../shared/markdown.pipe';

/**
 * Primo avvio (e nuova presa visione quando i testi cambiano):
 * informativa art. 13 → termini d'uso → email per le notifiche (verificata con
 * codice) → consensi facoltativi separati e NON preselezionati → sede e comune. Nessun trattamento oltre al login prima di
 * questo passaggio.
 */
@Component({
  selector: 'app-onboarding-page',
  imports: [FormsModule, MatStepperModule, MatIconModule, MatButtonModule, MatCheckboxModule, MatSlideToggleModule, MatFormFieldModule, MatSelectModule, MarkdownPipe, ComunePickerComponent, EmailVerifyComponent],
  template: `
    <div class="page">
      <h1 class="page-title">{{ isUpdate() ? 'Documenti aggiornati' : 'Benvenuto' }}</h1>
      @if (isUpdate()) {
        <p class="muted">Alcuni documenti sono stati aggiornati. Prendine visione per continuare a usare l'app.</p>
      } @else {
        <p class="muted">Prima di iniziare, leggi come trattiamo i tuoi dati. L'uso dell'app è volontario: puoi smettere quando vuoi senza alcuna conseguenza.</p>
      }

      <mat-stepper orientation="vertical" [linear]="true" #stepper>
        <!-- Icone SVG locali al posto delle legature del font Material Icons (non incluso). -->
        <ng-template matStepperIcon="edit"><mat-icon svgIcon="check" /></ng-template>
        <ng-template matStepperIcon="done"><mat-icon svgIcon="check" /></ng-template>
        @for (p of pendingDocs(); track p.id) {
          <mat-step [completed]="stepDone(p)" [editable]="true">
            <ng-template matStepLabel>{{ p.title }} (v{{ p.version }})</ng-template>
            <div class="doc" tabindex="0" (scroll)="onScroll($event, p.id)" [attr.aria-label]="p.title">
              <div class="legal-text" [innerHTML]="p.content | markdown"></div>
            </div>
            @if (p.type === 'TERMS') {
              <mat-checkbox [(ngModel)]="termsAccepted">Ho letto e accetto i termini d'uso</mat-checkbox>
            } @else {
              <mat-checkbox [ngModel]="read()[p.id]" (ngModelChange)="markRead(p.id, $event)">Ho preso visione dell'informativa</mat-checkbox>
            }
            <div class="actions">
              <button mat-flat-button matStepperNext [disabled]="!stepDone(p)">Continua</button>
            </div>
          </mat-step>
        }

        @if (emailNeeded()) {
          <mat-step [completed]="emailDone()" [editable]="true">
            <ng-template matStepLabel>Email per le notifiche</ng-template>
            @if (emailStatus(); as s) {
              <app-email-verify [status]="s" (changed)="emailStatus.set($event)" />
            }
            <div class="actions">
              <button mat-flat-button matStepperNext [disabled]="!emailDone()">Continua</button>
            </div>
          </mat-step>
        }

        @if (!isUpdate()) {
          <mat-step>
            <ng-template matStepLabel>Consensi facoltativi</ng-template>
            <p class="muted">Ogni opzione è facoltativa e indipendente. Puoi cambiarla in qualsiasi momento dal profilo.</p>
            <div class="stack consents">
              <mat-slide-toggle [(ngModel)]="consents.phoneVisible">
                Mostra il mio telefono ai partecipanti confermati dei miei viaggi
              </mat-slide-toggle>
              <mat-slide-toggle [(ngModel)]="consents.discoverable">
                Rendimi trovabile nella ricerca colleghi per ricevere inviti
              </mat-slide-toggle>
              <mat-slide-toggle [(ngModel)]="consents.optionalNotifications">
                Inviami anche le notifiche facoltative: promemoria la sera prima e prima della partenza, nuovi viaggi dei colleghi preferiti, riepiloghi
              </mat-slide-toggle>
            </div>
            <div class="actions"><button mat-flat-button matStepperNext>Continua</button></div>
          </mat-step>

          <mat-step>
            <ng-template matStepLabel>Sede e comune</ng-template>
            <p class="muted">Indica solo il comune: non chiediamo mai il tuo indirizzo.</p>
            <mat-form-field class="full-width">
              <mat-label>Sede di riferimento</mat-label>
              <mat-select [(ngModel)]="siteId" required>
                @for (s of ref.sites(); track s.id) { <mat-option [value]="s.id">{{ s.name }}</mat-option> }
              </mat-select>
            </mat-form-field>
            <app-comune-picker label="Comune di residenza" [required]="true" [(value)]="comuneIstat" />
            <div class="actions">
              <button mat-flat-button (click)="finish()" [disabled]="!canFinish() || busy()">Inizia a usare l'app</button>
            </div>
          </mat-step>
        } @else {
          <mat-step>
            <ng-template matStepLabel>Conferma</ng-template>
            <div class="actions">
              <button mat-flat-button (click)="finish()" [disabled]="!canFinish() || busy()">Conferma e continua</button>
            </div>
          </mat-step>
        }
      </mat-stepper>
      <div class="actions"><button mat-button (click)="logout()">Esci</button></div>
    </div>
  `,
  styles: `
    .doc { max-height: 55vh; overflow-y: auto; border: 1px solid var(--mat-sys-outline-variant); border-radius: var(--app-radius-md); padding: var(--app-space-3) var(--app-space-4); margin-bottom: var(--app-space-3); }
    .small { font-size: 0.85em; }
    .consents { margin: var(--app-space-3) 0; }
  `,
})
export class OnboardingPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly ref = inject(ReferenceStore);
  readonly next = input<string>();

  protected readonly docs = signal<PolicyDto[]>([]);
  protected readonly read = signal<Record<string, boolean>>({});
  protected readonly busy = signal(false);
  protected readonly emailStatus = signal<EmailStatusDto | null>(null);
  /** Calcolato una volta all'apertura: lo step resta visibile anche dopo la verifica. */
  protected readonly emailNeeded = signal(false);
  protected readonly emailDone = computed(() => Boolean(this.emailStatus()?.email));
  protected termsAccepted = false;
  // Consensi: tutti disattivati di default (privacy by default).
  protected consents = { phoneVisible: false, discoverable: false, optionalNotifications: false };
  protected siteId: string | null = null;
  protected comuneIstat: string | null = null;

  /** true se l'utente ha già completato l'onboarding e deve solo accettare nuove versioni. */
  protected readonly isUpdate = computed(() => {
    const me = this.session.me();
    return Boolean(me && me.siteId && me.comuneIstat);
  });

  protected readonly pendingDocs = computed(() => {
    const me = this.session.me();
    const pending = new Set(me?.pendingPolicyIds ?? []);
    return this.docs().filter((d) => !this.isUpdate() || pending.has(d.id));
  });

  async ngOnInit(): Promise<void> {
    this.emailNeeded.set(!this.session.me()?.emailVerified);
    const [docs, email] = await Promise.all([this.api.policies(), this.api.emailStatus(), this.ref.loadSites()]);
    this.emailStatus.set(email);
    // Prima l'informativa, poi i termini.
    this.docs.set([...docs].sort((a, b) => (a.type === 'PRIVACY_NOTICE' ? -1 : b.type === 'PRIVACY_NOTICE' ? 1 : 0)));
    const me = this.session.me();
    this.siteId = me?.siteId ?? null;
    this.comuneIstat = me?.comuneIstat ?? null;
  }

  protected onScroll(ev: Event, id: string): void {
    const el = ev.target as HTMLElement;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) this.markRead(id, true);
  }

  protected markRead(id: string, v: boolean): void {
    this.read.update((r) => ({ ...r, [id]: v }));
  }

  protected stepDone(p: PolicyDto): boolean {
    return p.type === 'TERMS' ? this.termsAccepted : Boolean(this.read()[p.id]);
  }

  protected canFinish(): boolean {
    const docsOk = this.pendingDocs().every((p) => this.stepDone(p));
    const emailOk = !this.emailNeeded() || this.emailDone();
    return docsOk && emailOk && (this.isUpdate() || Boolean(this.siteId && this.comuneIstat));
  }

  async finish(): Promise<void> {
    this.busy.set(true);
    try {
      const ids = this.pendingDocs().map((d) => d.id);
      const me = this.isUpdate()
        ? ids.length > 0
          ? await this.api.acceptPolicies(ids)
          : await this.api.me()
        : await this.api.onboarding({
            acceptedPolicyIds: ids,
            consents: this.consents,
            siteId: this.siteId!,
            comuneIstat: this.comuneIstat!,
          });
      this.session.me.set(me);
      await this.router.navigateByUrl(safeNext(this.next()));
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  async logout(): Promise<void> {
    await this.api.logout().catch(() => undefined);
    this.session.clear();
    await this.router.navigate(['/login']);
  }
}
