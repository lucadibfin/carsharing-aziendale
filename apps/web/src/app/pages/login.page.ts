import { Component, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Router, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';
import { safeNext } from '../core/guards';
import { SessionStore } from '../core/session.store';

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule, MatProgressBarModule, RouterLink],
  template: `
    <div class="page login">
      <div class="brand">
        <mat-icon svgIcon="directions_car" class="logo" />
        <h1>Car Sharing tra colleghi</h1>
        <p class="muted">Condividi il tragitto casa-lavoro con i colleghi della tua sede.</p>
      </div>
      <mat-card appearance="outlined">
        @if (busy()) { <mat-progress-bar mode="indeterminate" /> }
        <mat-card-content>
          <form [formGroup]="form" (ngSubmit)="submit()" class="stack" autocomplete="on">
            <mat-form-field>
              <mat-label>Username aziendale</mat-label>
              <input matInput formControlName="username" autocomplete="username" autocapitalize="none" spellcheck="false" />
            </mat-form-field>
            <mat-form-field>
              <mat-label>Password</mat-label>
              <input matInput formControlName="password" [type]="show() ? 'text' : 'password'" autocomplete="current-password" />
              <button mat-icon-button matSuffix type="button" (click)="show.set(!show())" [attr.aria-label]="show() ? 'Nascondi password' : 'Mostra password'">
                <mat-icon [svgIcon]="show() ? 'visibility_off' : 'visibility'" />
              </button>
            </mat-form-field>
            @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
            <button mat-flat-button type="submit" [disabled]="form.invalid || busy()">Accedi</button>
          </form>
          <p class="muted small">
            Usa le credenziali aziendali. La password viene inoltrata in modo sicuro al sistema di autenticazione aziendale
            e non viene mai salvata dall'app. L'uso dell'app è volontario.
            <a routerLink="/informativa">Informativa privacy</a>
          </p>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: `
    .login { max-width: 420px; padding-top: 48px; }
    .brand { text-align: center; margin-bottom: 24px; }
    .brand h1 { font: var(--mat-sys-headline-small); margin: 8px 0; }
    .logo { font-size: 56px; width: 56px; height: 56px; color: var(--mat-sys-primary); }
    .error { color: var(--mat-sys-error); margin: 0; }
    .small { font-size: 0.85em; margin-top: 16px; }
  `,
})
export class LoginPage {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  readonly next = input<string>();

  protected readonly busy = signal(false);
  protected readonly show = signal(false);
  protected readonly error = signal('');
  protected readonly form = inject(FormBuilder).nonNullable.group({
    username: ['', [Validators.required, Validators.maxLength(128)]],
    password: ['', [Validators.required, Validators.maxLength(256)]],
  });

  async submit(): Promise<void> {
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set('');
    const { username, password } = this.form.getRawValue();
    try {
      await this.api.login(username, password);
      // La password non resta nel form dopo l'invio.
      this.form.controls.password.reset('');
      const me = await this.session.refresh();
      const dest = safeNext(this.next());
      await this.router.navigateByUrl(me?.onboardingRequired ? `/benvenuto?next=${encodeURIComponent(dest)}` : dest);
    } catch (e) {
      this.form.controls.password.reset('');
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
