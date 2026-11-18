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
import { AppConfigStore } from '../core/app-config.store';
import { safeNext } from '../core/guards';
import { SessionStore } from '../core/session.store';
import { BRAND } from '../../generated/brand';

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule, MatProgressBarModule, RouterLink],
  template: `
    <div class="page login">
      <div class="brand">
        <div class="brand-row">
          <img [src]="brand.logo" alt="" class="logo" />
          <h1>{{ brand.appName }}</h1>
        </div>
        @if (brand.tagline) { <p class="muted">{{ brand.tagline }}</p> }
      </div>
      @if (config.config()?.demo) {
        <mat-card appearance="outlined" class="demo">
          <mat-card-content>
            <h2>Utenti di prova</h2>
            <p class="muted small-top">
              Questa è una demo con dati fittizi. Tocca un utente per compilare l'accesso
              (password per tutti: <strong>{{ config.config()?.demoPassword }}</strong>).
            </p>
            <ul class="accounts">
              @for (a of config.config()?.demoAccounts ?? []; track a.username) {
                <li>
                  <button type="button" mat-stroked-button (click)="pick(a.username)" [attr.data-testid]="'demo-' + a.username">
                    {{ a.username }}
                  </button>
                  <span class="muted">{{ a.label }}</span>
                </li>
              }
            </ul>
          </mat-card-content>
        </mat-card>
      }
      <mat-card appearance="outlined">
        @if (busy()) { <mat-progress-bar mode="indeterminate" /> }
        <mat-card-content>
          <form [formGroup]="form" (ngSubmit)="submit()" class="stack" autocomplete="on">
            <mat-form-field>
              <mat-label>{{ config.demo() ? 'Username' : 'Username aziendale' }}</mat-label>
              <input matInput formControlName="username" autocomplete="username" autocapitalize="none" spellcheck="false" />
            </mat-form-field>
            <mat-form-field>
              <mat-label>Password</mat-label>
              <input matInput formControlName="password" [type]="show() ? 'text' : 'password'" autocomplete="current-password" />
              <button mat-icon-button matSuffix type="button" (click)="show.set(!show())" [attr.aria-label]="show() ? 'Nascondi password' : 'Mostra password'">
                <mat-icon [svgIcon]="show() ? 'visibility_off' : 'visibility'" />
              </button>
            </mat-form-field>
            @if (error()) { <p class="error-text" role="alert">{{ error() }}</p> }
            <button mat-flat-button type="submit" [disabled]="form.invalid || busy()">Accedi</button>
          </form>
          @if (config.demo()) {
            <p class="muted small">
              Demo: accedono solo gli utenti di prova, non le credenziali aziendali. Non inserire dati personali reali.
              <a routerLink="/informativa">Informativa privacy</a>
            </p>
          } @else {
            <p class="muted small">
              Usa le credenziali aziendali. La password viene inoltrata in modo sicuro al sistema di autenticazione aziendale
              e non viene mai salvata dall'app. L'uso dell'app è volontario.
              <a routerLink="/informativa">Informativa privacy</a>
            </p>
          }
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: `
    .login { max-width: 420px; padding-top: var(--app-space-7); }
    .brand { text-align: center; margin-bottom: var(--app-space-5); }
    .brand-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: var(--app-space-3); }
    .brand h1 { font: var(--mat-sys-headline-small); margin: 0; }
    .logo { height: 56px; max-width: 200px; }
    .small { font-size: 0.85em; margin-top: var(--app-space-4); }
    .demo { margin-bottom: var(--app-space-4); }
    .demo h2 { font: var(--mat-sys-title-medium); margin: 0 0 var(--app-space-2); }
    .small-top { font-size: 0.9em; margin: 0 0 var(--app-space-3); }
    .accounts { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--app-space-2); }
    .accounts li { display: flex; align-items: center; gap: var(--app-space-3); flex-wrap: wrap; }
    .accounts button { min-width: 140px; }
    .accounts span { flex: 1 1 160px; font-size: 0.9em; }
  `,
})
export class LoginPage {
  protected readonly brand = BRAND;
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  protected readonly config = inject(AppConfigStore);
  readonly next = input<string>();

  protected readonly busy = signal(false);
  protected readonly show = signal(false);
  protected readonly error = signal('');
  protected readonly form = inject(FormBuilder).nonNullable.group({
    username: ['', [Validators.required, Validators.maxLength(128)]],
    password: ['', [Validators.required, Validators.maxLength(256)]],
  });

  /** Demo: compila l'accesso con un utente di prova (il login resta quello normale). */
  protected pick(username: string): void {
    this.form.setValue({ username, password: this.config.config()?.demoPassword ?? '' });
    this.error.set('');
  }

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
