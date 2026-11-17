import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, type OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { Router, RouterLink } from '@angular/router';
import type { AbsenceReportOptionsDto, TripDetailDto, TripVisibility, UserSummaryDto } from '@fcs/shared';
import { ApiService, errorCode } from '../core/api.service';
import { SessionStore } from '../core/session.store';
import { ToastService } from '../core/toast.service';
import { BRAND } from '../../generated/brand';
import { STATUS_LABELS } from '../shared/labels';

@Component({
  selector: 'app-trip-detail-page',
  imports: [
    DatePipe, NgTemplateOutlet, FormsModule, RouterLink, MatButtonModule, MatCardModule, MatCheckboxModule, MatDividerModule,
    MatFormFieldModule, MatIconModule, MatInputModule, MatListModule, MatProgressBarModule, MatSelectModule,
  ],
  template: `
    <div class="page">
      @if (loading()) { <mat-progress-bar mode="indeterminate" /> }
      @if (notFound()) {
        <p class="empty">Viaggio non trovato o non visibile.</p>
        <div class="actions"><a mat-button routerLink="/">Torna alla home</a></div>
      }
      @if (trip(); as t) {
        <h1 class="page-title cap">{{ t.date | date: 'EEEE d MMMM y' }}</h1>
        <div class="row tags">
          <span class="chip" [class.private]="t.visibility === 'PRIVATE'">{{ t.visibility === 'PUBLIC' ? 'Pubblico' : 'Privato' }}</span>
          @if (t.status !== 'SCHEDULED') { <span class="chip warn">{{ labels.trip[t.status] }}</span> }
          @if (t.myStatus) { <span class="chip">{{ labels.participant[t.myStatus] }}</span> }
        </div>

        <mat-card appearance="outlined" class="block">
          <mat-card-content class="stack">
            <div><mat-icon svgIcon="schedule" />
              Arrivo in <strong>{{ t.siteName }}</strong> alle <strong>{{ t.arrivalTime }}</strong>
              @if (t.returnTime) { · ripartenza alle <strong>{{ t.returnTime }}</strong> }
            </div>
            <div><mat-icon svgIcon="route" />
              @for (s of t.stops; track s.order) { {{ s.comuneName }} → } {{ t.siteName }}
            </div>
            @if (t.meetingPoint) { <div><mat-icon svgIcon="location_on" />{{ t.meetingPoint }}</div> }
            <div><mat-icon svgIcon="person" />
              Conducente: {{ t.driver.firstName }} {{ t.driver.lastName }}
              @if (t.driverPhone) { · <a [href]="'tel:' + t.driverPhone">{{ t.driverPhone }}</a> }
              @if (isMember() && !isDriver()) {
                <ng-container *ngTemplateOutlet="star; context: { $implicit: t.driver }" />
              }
            </div>
            <div><mat-icon svgIcon="airline_seat_recline_normal" />
              {{ t.seats - t.seatsTaken }} posti liberi su {{ t.seats }}
            </div>
            @if (t.notes) { <div class="notes">{{ t.notes }}</div> }
            <p class="muted small">Gli orari sono vincolanti: chi si unisce si adegua a quelli del conducente.</p>
          </mat-card-content>
        </mat-card>

        @if (isMember() && t.status !== 'CANCELLED') {
          <a mat-flat-button class="full-width chat-btn" [routerLink]="['/viaggi', t.id, 'chat']">
            <mat-icon svgIcon="chat" />Chat del viaggio
          </a>
        }

        <!-- ===== Utente esterno: richiesta di partecipazione ===== -->
        @if (t.myRole === 'NONE' && open() && t.visibility === 'PUBLIC') {
          <h2 class="section-title">Partecipa</h2>
          @if (t.seatsTaken >= t.seats) {
            <p class="muted">Il viaggio è al completo.</p>
          } @else {
            <ng-container *ngTemplateOutlet="boarding" />
            <button mat-flat-button (click)="requestJoin()" [disabled]="!boardingComune || busy()">Chiedi di partecipare</button>
          }
        }

        <!-- ===== Invitato ===== -->
        @if (t.myInvitationId && t.myRole !== 'PARTICIPANT' && open()) {
          <h2 class="section-title">Sei stato invitato</h2>
          <ng-container *ngTemplateOutlet="boarding" />
          <div class="actions">
            <button mat-button (click)="declineInvite()" [disabled]="busy()">Rifiuta</button>
            <button mat-flat-button (click)="acceptInvite()" [disabled]="!boardingComune || busy()">Accetta</button>
          </div>
        }

        <!-- ===== Partecipante ===== -->
        @if (t.myRole === 'PARTICIPANT' && open() && (t.myStatus === 'REQUESTED' || t.myStatus === 'ACCEPTED')) {
          <h2 class="section-title">La tua partecipazione</h2>
          @if (t.myStatus === 'ACCEPTED' && !t.canCancelWithoutPenalty) {
            <p class="muted">La scadenza per annullare ({{ t.cancellationDeadline | date: 'd/M HH:mm' }}) è passata: puoi comunque
              annullare, ma avvisa il conducente in chat.</p>
          }
          <button mat-stroked-button (click)="leave()" [disabled]="busy()">
            {{ t.myStatus === 'REQUESTED' ? 'Ritira la richiesta' : 'Annulla la partecipazione' }}
          </button>
        }

        <!-- ===== Partecipanti (membri confermati) ===== -->
        @if (accepted().length) {
          <h2 class="section-title">Partecipanti confermati</h2>
          <mat-list>
            @for (p of accepted(); track p.id) {
              <mat-list-item>
                <span matListItemTitle>{{ p.user.firstName }} {{ p.user.lastName }}</span>
                <span matListItemLine>Sale a {{ p.boardingComuneName }}
                  @if (p.phone) { · <a [href]="'tel:' + p.phone">{{ p.phone }}</a> }
                </span>
                <div matListItemMeta class="row">
                  @if (isMember() && p.user.id !== myId()) {
                    <ng-container *ngTemplateOutlet="star; context: { $implicit: p.user }" />
                  }
                  @if (isDriver() && open()) {
                    <button mat-icon-button (click)="remove(p.id)" aria-label="Annulla partecipazione">
                      <mat-icon svgIcon="person_remove" />
                    </button>
                  }
                </div>
              </mat-list-item>
            }
          </mat-list>
        }

        <!-- ===== Segnalazioni di assenza (viaggio passato) ===== -->
        @if (reportOptions(); as ro) {
          @if (ro.candidates.length) {
            <h2 class="section-title"><mat-icon svgIcon="flag" class="inline" /> Segnala un'assenza</h2>
            <p class="muted small">
              Puoi segnalare chi non si è presentato o ha annullato oltre la scadenza, entro il {{ ro.deadline | date: 'd/M/y' }}.
              La segnalazione la leggono solo gli amministratori e non comporta alcuna sanzione automatica.
            </p>
            @for (c of ro.candidates; track c.id) {
              <div class="report">
                <div class="row">
                  <span class="grow">{{ c.firstName }} {{ c.lastName }} <span class="muted">· {{ whyLabels[c.why] }}</span></span>
                  @if (ro.alreadyReported.includes(c.id)) {
                    <span class="chip">Segnalazione inviata</span>
                  } @else if (reporting() !== c.id) {
                    <button mat-stroked-button (click)="reporting.set(c.id); reason = ''">Segnala</button>
                  }
                </div>
                @if (reporting() === c.id) {
                  <mat-form-field class="full-width">
                    <mat-label>Motivazione (obbligatoria)</mat-label>
                    <textarea matInput [(ngModel)]="reason" rows="3" maxlength="1000"></textarea>
                    <mat-hint>Descrivi i fatti, senza giudizi personali.</mat-hint>
                  </mat-form-field>
                  <div class="actions">
                    <button mat-button (click)="reporting.set(null)">Annulla</button>
                    <button mat-flat-button (click)="sendReport(c.id)" [disabled]="reason.trim().length < 10 || busy()">Invia</button>
                  </div>
                }
              </div>
            }
          }
        }

        <!-- ===== Conducente ===== -->
        @if (isDriver()) {
          @if (t.status === 'AWAITING_CLOSURE') {
            <h2 class="section-title">Chiudi il viaggio</h2>
            <p class="muted">Conferma chi era presente. Solo i viaggi chiusi contano nelle statistiche.</p>
            @for (p of accepted(); track p.id) {
              <mat-checkbox [checked]="present().has(p.id)" (change)="togglePresent(p.id, $event.checked)">
                {{ p.user.firstName }} {{ p.user.lastName }}
              </mat-checkbox>
            } @empty { <p class="muted">Nessun passeggero confermato.</p> }
            <div class="actions"><button mat-flat-button (click)="close()" [disabled]="busy()">Chiudi il viaggio</button></div>
          }

          @if (open()) {
            @if (requests().length) {
              <h2 class="section-title">Richieste in sospeso</h2>
              <mat-list>
                @for (p of requests(); track p.id) {
                  <mat-list-item>
                    <span matListItemTitle>{{ p.user.firstName }} {{ p.user.lastName }}</span>
                    <span matListItemLine>Sale a {{ p.boardingComuneName }}</span>
                    <div matListItemMeta class="row">
                      <button mat-icon-button (click)="reject(p.id)" aria-label="Rifiuta"><mat-icon svgIcon="close" /></button>
                      <button mat-icon-button color="primary" (click)="accept(p.id)" aria-label="Accetta"><mat-icon svgIcon="check" /></button>
                    </div>
                  </mat-list-item>
                }
              </mat-list>
            }

            <h2 class="section-title">Invita colleghi</h2>
            <mat-form-field class="full-width">
              <mat-label>Cerca un collega per nome</mat-label>
              <input matInput [(ngModel)]="colleagueQuery" (ngModelChange)="searchColleagues()" autocomplete="off" />
              <mat-hint>Compaiono solo i colleghi che hanno scelto di essere trovabili.</mat-hint>
            </mat-form-field>
            @for (c of colleagues(); track c.id) {
              <div class="row colleague">
                <span class="grow">{{ c.firstName }} {{ c.lastName }} <span class="muted">{{ c.siteName }}</span></span>
                <button mat-stroked-button (click)="invite(c)">Invita</button>
              </div>
            }
            <div class="row link-row">
              <mat-form-field class="grow">
                <mat-label>Validità del link</mat-label>
                <mat-select [(ngModel)]="linkHours">
                  <mat-option [value]="24">24 ore</mat-option>
                  <mat-option [value]="72">3 giorni</mat-option>
                  <mat-option [value]="168">7 giorni</mat-option>
                </mat-select>
              </mat-form-field>
              <button mat-stroked-button (click)="createLink()" [disabled]="busy()">
                <mat-icon svgIcon="link" />Crea link d'invito
              </button>
            </div>
            @if (lastLink()) {
              <div class="link-box">
                <p class="muted small">Condividi questo link con i colleghi (anche non ancora registrati). Viene mostrato una sola volta.</p>
                <code>{{ lastLink() }}</code>
                <div class="actions">
                  <button mat-button (click)="copyLink()">Copia</button>
                  @if (canShare) { <button mat-button (click)="shareLink()">Condividi</button> }
                </div>
              </div>
            }
            @if (activeInvitations().length) {
              <h3 class="subtitle">Inviti attivi</h3>
              @for (i of activeInvitations(); track i.id) {
                <div class="row colleague">
                  <span class="grow">
                    @if (i.isLink) { Link d'invito } @else { {{ i.invitee?.firstName }} {{ i.invitee?.lastName }} }
                    <span class="muted">· scade {{ i.expiresAt | date: 'd/M HH:mm' }}</span>
                  </span>
                  <button mat-button (click)="revoke(i.id)">Revoca</button>
                </div>
              }
            }

            <h2 class="section-title">Visibilità</h2>
            <p class="muted">
              @if (t.visibility === 'PUBLIC') { Il viaggio compare nelle ricerche. Rendendolo privato, le richieste in sospeso saranno rifiutate. }
              @else { Il viaggio è visibile solo a te e agli invitati. }
            </p>
            <button mat-stroked-button (click)="toggleVisibility()" [disabled]="busy()">
              Rendi {{ t.visibility === 'PUBLIC' ? 'privato' : 'pubblico' }}
            </button>

            <mat-divider class="sep" />
            <button mat-button class="danger" (click)="cancelTrip()" [disabled]="busy()">Annulla il viaggio</button>
          }
        }

        <ng-template #star let-u>
          @let fav = favoriteIds().has(u.id);
          <button mat-icon-button class="star" (click)="toggleFavorite(u)" [attr.aria-pressed]="fav"
                  [attr.aria-label]="(fav ? 'Togli dai preferiti ' : 'Aggiungi ai preferiti ') + u.firstName + ' ' + u.lastName">
            <mat-icon [svgIcon]="fav ? 'star-fill' : 'star'" />
          </button>
        </ng-template>

        <ng-template #boarding>
          <mat-form-field class="full-width">
            <mat-label>Dove sali?</mat-label>
            <mat-select [(ngModel)]="boardingComune">
              @for (s of t.stops; track s.order) { <mat-option [value]="s.comuneIstat">{{ s.comuneName }}</mat-option> }
            </mat-select>
          </mat-form-field>
        </ng-template>
      }
    </div>
  `,
  styles: `
    .cap { text-transform: capitalize; }
    .tags { margin-bottom: var(--app-space-3); }
    .block mat-icon { vertical-align: middle; margin-right: var(--app-space-2); color: var(--mat-sys-primary); }
    .notes { white-space: pre-wrap; padding: var(--app-space-2); background: var(--mat-sys-surface-container); border-radius: var(--app-radius-md); }
    .small { font-size: 0.85em; }
    .chat-btn { margin: var(--app-space-4) 0 0; }
    .colleague { padding: var(--app-space-1) 0; }
    .link-row { margin-top: var(--app-space-3); }
    .link-box { background: var(--mat-sys-surface-container); border-radius: var(--app-radius-md); padding: var(--app-space-3); }
    .link-box code { word-break: break-all; font-size: 0.85em; }
    .subtitle { font: var(--mat-sys-title-small); margin: var(--app-space-4) 0 var(--app-space-1); }
    .sep { margin: var(--app-space-5) 0 var(--app-space-2); }
    .danger { color: var(--mat-sys-error); }
    .star { vertical-align: middle; color: var(--mat-sys-tertiary); }
    .inline { width: 20px; height: 20px; vertical-align: text-bottom; }
    .report { padding: var(--app-space-1) 0 var(--app-space-2); border-bottom: 1px solid var(--mat-sys-outline-variant); }
    .block .star mat-icon { margin: 0; color: inherit; }
  `,
})
export class TripDetailPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly session = inject(SessionStore);
  readonly id = input.required<string>();

  protected readonly labels = STATUS_LABELS;
  protected readonly trip = signal<TripDetailDto | null>(null);
  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);
  protected readonly busy = signal(false);
  protected readonly colleagues = signal<(UserSummaryDto & { siteName: string | null })[]>([]);
  protected readonly lastLink = signal<string | null>(null);
  protected readonly present = signal(new Set<string>());
  protected boardingComune: string | null = null;
  protected colleagueQuery = '';
  protected linkHours = 72;
  protected readonly canShare = typeof navigator !== 'undefined' && 'share' in navigator;
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly isDriver = computed(() => this.trip()?.myRole === 'DRIVER');
  protected readonly isMember = computed(() => this.isDriver() || this.trip()?.myStatus === 'ACCEPTED');
  protected readonly open = computed(() => this.trip()?.status === 'SCHEDULED');
  protected readonly accepted = computed(() => this.trip()?.participants.filter((p) => p.status === 'ACCEPTED') ?? []);
  protected readonly requests = computed(() => this.trip()?.participants.filter((p) => p.status === 'REQUESTED') ?? []);
  protected readonly activeInvitations = computed(() => this.trip()?.invitations?.filter((i) => i.status === 'PENDING') ?? []);

  protected readonly favoriteIds = signal(new Set<string>());
  protected readonly myId = computed(() => this.session.me()?.id);

  async ngOnInit(): Promise<void> {
    await this.load();
    this.api.favorites().then((f) => this.favoriteIds.set(new Set(f.map((x) => x.id))), () => undefined);
  }

  async toggleFavorite(u: UserSummaryDto): Promise<void> {
    const fav = this.favoriteIds().has(u.id);
    const list = await this.run(
      () => (fav ? this.api.removeFavorite(u.id) : this.api.addFavorite(u.id)),
      fav ? 'Tolto dai preferiti' : `${u.firstName} è tra i tuoi preferiti`,
    );
    if (list) this.favoriteIds.set(new Set(list.map((x) => x.id)));
  }

  private async load(): Promise<void> {
    try {
      const t = await this.api.trip(this.id());
      this.set(t);
    } catch (e) {
      if (errorCode(e) === 'NOT_FOUND') this.notFound.set(true);
      else this.toast.error(e);
    } finally {
      this.loading.set(false);
    }
  }

  protected readonly reportOptions = signal<AbsenceReportOptionsDto | null>(null);
  protected readonly reporting = signal<string | null>(null);
  protected reason = '';
  protected readonly whyLabels: Record<AbsenceReportOptionsDto['candidates'][number]['why'], string> = {
    NO_SHOW: 'assente alla partenza',
    LATE_CANCEL: 'ha annullato oltre la scadenza',
    DRIVER_NO_SHOW: 'conducente, viaggio non chiuso',
  };

  async sendReport(userId: string): Promise<void> {
    const r = await this.run(
      () => this.api.reportAbsence(this.id(), userId, this.reason.trim()),
      'Segnalazione inviata agli amministratori',
    );
    if (r) {
      this.reportOptions.set(r);
      this.reporting.set(null);
    }
  }

  private set(t: TripDetailDto): void {
    this.trip.set(t);
    if (t.status !== 'SCHEDULED') {
      this.api.absenceReportOptions(t.id).then((o) => this.reportOptions.set(o), () => undefined);
    }
    this.boardingComune ??= t.stops[0]?.comuneIstat ?? null;
    this.present.set(new Set(t.participants.filter((p) => p.status === 'ACCEPTED').map((p) => p.id)));
  }

  private async run<T>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> {
    this.busy.set(true);
    try {
      const r = await fn();
      if (ok) this.toast.info(ok);
      return r;
    } catch (e) {
      this.toast.error(e);
      return undefined;
    } finally {
      this.busy.set(false);
    }
  }

  async requestJoin(): Promise<void> {
    const t = await this.run(() => this.api.requestJoin(this.id(), this.boardingComune!), 'Richiesta inviata al conducente');
    if (t) this.set(t);
  }
  async acceptInvite(): Promise<void> {
    const t = await this.run(() => this.api.acceptInvitation(this.trip()!.myInvitationId!, this.boardingComune!), 'Invito accettato');
    if (t) this.set(t);
  }
  async declineInvite(): Promise<void> {
    await this.run(() => this.api.declineInvitation(this.trip()!.myInvitationId!), 'Invito rifiutato');
    await this.router.navigate(['/']);
  }
  async leave(): Promise<void> {
    if (!confirmAction('Confermi di voler annullare la tua partecipazione?')) return;
    const r = await this.run(() => this.api.leaveTrip(this.id()), 'Partecipazione annullata');
    if (r) await this.load();
  }
  async accept(pid: string): Promise<void> {
    const t = await this.run(() => this.api.acceptRequest(this.id(), pid), 'Richiesta accettata');
    if (t) this.set(t);
  }
  async reject(pid: string): Promise<void> {
    const t = await this.run(() => this.api.rejectRequest(this.id(), pid));
    if (t) this.set(t);
  }
  async remove(pid: string): Promise<void> {
    if (!confirmAction('Annullare la partecipazione di questo collega? Riceverà una notifica.')) return;
    const t = await this.run(() => this.api.removeParticipant(this.id(), pid));
    if (t) this.set(t);
  }
  async toggleVisibility(): Promise<void> {
    const next: TripVisibility = this.trip()!.visibility === 'PUBLIC' ? 'PRIVATE' : 'PUBLIC';
    const t = await this.run(() => this.api.setVisibility(this.id(), next), next === 'PUBLIC' ? 'Ora il viaggio è pubblico' : 'Ora il viaggio è privato');
    if (t) this.set(t);
  }
  async cancelTrip(): Promise<void> {
    if (!confirmAction('Annullare il viaggio? I partecipanti riceveranno una notifica.')) return;
    await this.run(() => this.api.cancelTrip(this.id()), 'Viaggio annullato');
    await this.load();
  }
  togglePresent(pid: string, on: boolean): void {
    this.present.update((s) => {
      const n = new Set(s);
      if (on) n.add(pid);
      else n.delete(pid);
      return n;
    });
  }
  async close(): Promise<void> {
    const t = await this.run(() => this.api.closeTrip(this.id(), [...this.present()]), 'Viaggio chiuso. Grazie!');
    if (t) this.set(t);
  }

  searchColleagues(): void {
    clearTimeout(this.searchTimer);
    const q = this.colleagueQuery.trim();
    if (q.length < 2) {
      this.colleagues.set([]);
      return;
    }
    this.searchTimer = setTimeout(async () => this.colleagues.set(await this.api.searchColleagues(q).catch(() => [])), 300);
  }
  async invite(c: UserSummaryDto): Promise<void> {
    const r = await this.run(() => this.api.inviteUser(this.id(), c.id), `Invito inviato a ${c.firstName}`);
    if (r) {
      this.colleagues.set([]);
      this.colleagueQuery = '';
      await this.load();
    }
  }
  async createLink(): Promise<void> {
    const r = await this.run(() => this.api.createInviteLink(this.id(), this.linkHours));
    if (r) {
      // Il token è nel frammento (#): non viene inviato al server né registrato nei log.
      this.lastLink.set(`${location.origin}/invito#${r.token}`);
      await this.load();
    }
  }
  async copyLink(): Promise<void> {
    await navigator.clipboard.writeText(this.lastLink()!);
    this.toast.info('Link copiato');
  }
  async shareLink(): Promise<void> {
    await navigator.share({ title: `Invito a un viaggio · ${BRAND.shortName}`, url: this.lastLink()! }).catch(() => undefined);
  }
  async revoke(id: string): Promise<void> {
    await this.run(() => this.api.revokeInvitation(id), 'Invito revocato');
    await this.load();
  }
}

function confirmAction(msg: string): boolean {
  return window.confirm(msg);
}
