import { Component, computed, inject, input, type OnDestroy, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { EmailStatusDto } from '@fcs/shared';
import { ApiService } from '../core/api.service';
import { ToastService } from '../core/toast.service';

/**
 * Inserimento (o cambio) dell'email per le notifiche con verifica tramite
 * codice inviato all'indirizzo stesso. Usato nel primo accesso e nel profilo.
 */
@Component({
  selector: 'app-email-verify',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    @if (status(); as s) {
      @if (s.email && !editing() && !s.pendingEmail) {
        <p>Email per le notifiche: <strong data-testid="verified-email">{{ s.email }}</strong> <span class="ok">✓ verificata</span></p>
        <button mat-stroked-button type="button" (click)="startEdit()">Cambia indirizzo</button>
      } @else if (s.pendingEmail) {
        <p>
          Abbiamo inviato un codice di {{ codeLength }} cifre a <strong>{{ s.pendingEmail }}</strong>.
          Controlla anche la cartella spam. Il codice scade tra 15 minuti.
        </p>
        @if (s.email) {
          <p class="muted small">Fino alla conferma le notifiche continuano ad arrivare a {{ s.email }}.</p>
        }
        <form class="row" (ngSubmit)="confirm()">
          <mat-form-field class="code">
            <mat-label>Codice</mat-label>
            <input matInput name="code" [(ngModel)]="code" inputmode="numeric" autocomplete="one-time-code"
                   [maxlength]="codeLength" pattern="[0-9]*" required />
          </mat-form-field>
          <button mat-flat-button type="submit" [disabled]="busy() || code.trim().length !== codeLength">Conferma</button>
        </form>
        <div class="row">
          <button mat-button type="button" (click)="resend()" [disabled]="busy() || waitSeconds() > 0">
            {{ waitSeconds() > 0 ? 'Invia di nuovo tra ' + waitSeconds() + ' s' : 'Invia di nuovo' }}
          </button>
          <button mat-button type="button" (click)="cancel()" [disabled]="busy()">Usa un altro indirizzo</button>
        </div>
      } @else {
        <p class="muted small">
          Può essere anche un indirizzo personale. Lo usiamo solo per le notifiche importanti dell'app, come un viaggio annullato o una richiesta accettata (mai per il login),
          non è visibile ai colleghi e puoi cambiarlo quando vuoi.
        </p>
        <form class="row" (ngSubmit)="send()">
          <mat-form-field class="grow">
            <mat-label>Email</mat-label>
            <input matInput type="email" name="email" [(ngModel)]="email" autocomplete="email" required maxlength="254" />
          </mat-form-field>
          <button mat-flat-button type="submit" [disabled]="busy() || !email.includes('@')">Invia codice</button>
        </form>
        @if (s.email) {
          <button mat-button type="button" (click)="editing.set(false)">Annulla</button>
        }
      }
    }
  `,
  styles: `
    .row { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
    .grow { flex: 1 1 220px; }
    .code { width: 140px; }
    .ok { color: var(--mat-sys-primary); }
    .small { font-size: 0.85em; }
  `,
})
export class EmailVerifyComponent implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly status = input.required<EmailStatusDto>();
  /** Nuovo stato dopo ogni operazione (il genitore lo memorizza). */
  readonly changed = output<EmailStatusDto>();

  protected readonly codeLength = 6;
  protected readonly busy = signal(false);
  protected readonly editing = signal(false);
  protected email = '';
  protected code = '';

  private readonly now = signal(Date.now());
  private readonly timer = setInterval(() => this.now.set(Date.now()), 1000);
  protected readonly waitSeconds = computed(() => {
    const at = this.status().resendAvailableAt;
    return at ? Math.max(0, Math.ceil((Date.parse(at) - this.now()) / 1000)) : 0;
  });

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  protected startEdit(): void {
    this.email = '';
    this.editing.set(true);
  }

  protected send(): Promise<void> {
    return this.run(async () => {
      const s = await this.api.requestEmailCode(this.email);
      this.code = '';
      this.editing.set(false);
      this.changed.emit(s);
    });
  }

  protected resend(): Promise<void> {
    return this.run(async () => this.changed.emit(await this.api.requestEmailCode(this.status().pendingEmail!)));
  }

  protected confirm(): Promise<void> {
    return this.run(async () => {
      const s = await this.api.confirmEmail(this.code.trim());
      this.code = '';
      this.toast.info('Indirizzo email confermato');
      this.changed.emit(s);
    });
  }

  protected cancel(): Promise<void> {
    return this.run(async () => {
      this.email = this.status().pendingEmail ?? '';
      this.changed.emit(await this.api.cancelPendingEmail());
      this.editing.set(true);
    });
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await fn();
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}
