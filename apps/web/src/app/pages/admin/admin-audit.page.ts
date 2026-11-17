import { DatePipe, JsonPipe } from '@angular/common';
import { Component, inject, type OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import type { AuditEntryDto, AuditVerifyDto } from '@fcs/shared';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';

/** Descrizioni delle azioni registrate (codici in apps/api/src/audit/audit.service.ts). */
const ACTIONS: Record<string, string> = {
  ADMIN_TRIPS_LIST: 'Consultazione elenco viaggi',
  ADMIN_DASHBOARD_VIEW: 'Consultazione dashboard',
  ADMIN_REPORTS_LIST: 'Consultazione elenco segnalazioni',
  ADMIN_REPORT_VIEW: 'Lettura di una segnalazione',
  ADMIN_USER_SEARCH: 'Ricerca utenti (ruoli)',
  ADMIN_AUDIT_VIEW: 'Consultazione audit log',
  ADMIN_AUDIT_VERIFY: 'Verifica integrità audit log',
  ADMIN_REPORT_DECISION: 'Decisione su una segnalazione',
  ADMIN_SETTINGS_UPDATE: 'Modifica parametri',
  ADMIN_ROLE_GRANT: 'Assegnazione ruolo',
  ADMIN_ROLE_REVOKE: 'Revoca ruolo',
  ADMIN_POLICY_PUBLISH: 'Pubblicazione testo legale',
  ADMIN_SITE_CREATE: 'Creazione sede',
  ADMIN_SITE_UPDATE: 'Modifica sede',
  USER_DATA_EXPORT: 'Esportazione dei propri dati',
  USER_ACCOUNT_DELETED: 'Cancellazione account (dall’utente)',
  USER_DEACTIVATED: 'Disattivazione ex dipendente',
  USER_PURGED: 'Cancellazione definitiva dati',
  EMPLOYEE_CHECK_RUN: 'Verifica notturna dipendenti',
};

@Component({
  selector: 'app-admin-audit',
  imports: [DatePipe, JsonPipe, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <div class="row filters">
      <mat-form-field class="grow">
        <mat-label>Azione</mat-label>
        <mat-select [(ngModel)]="action">
          <mat-option [value]="''">Tutte</mat-option>
          @for (a of actionCodes; track a) { <mat-option [value]="a">{{ actions[a] }}</mat-option> }
        </mat-select>
      </mat-form-field>
      <mat-form-field class="grow"><mat-label>Dal</mat-label><input matInput type="date" [(ngModel)]="from" /></mat-form-field>
      <mat-form-field class="grow"><mat-label>Al</mat-label><input matInput type="date" [(ngModel)]="to" /></mat-form-field>
      <button mat-flat-button (click)="load()">Cerca</button>
      <button mat-stroked-button (click)="verify()">Verifica integrità</button>
    </div>
    @if (verified(); as v) {
      <p [class.ok]="v.ok" [class.ko]="!v.ok">
        @if (v.ok) { Catena integra: {{ v.checked }} registrazioni verificate. }
        @else { ATTENZIONE: catena non coerente dalla registrazione n. {{ v.brokenAtId }}. Il registro potrebbe essere stato manomesso: avvisare il DPO. }
      </p>
    }
    <p class="muted small">Registro immutabile: non si può modificare né cancellare. Gli autori sono indicati per nome finché il loro account esiste.</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Quando</th><th>Chi</th><th>Azione</th><th>Oggetto</th><th>Dettagli</th></tr></thead>
        <tbody>
          @for (e of entries(); track e.id) {
            <tr>
              <td>{{ e.at | date: 'd/M/y HH:mm:ss' }}</td>
              <td>{{ e.actor ? e.actor.firstName + ' ' + e.actor.lastName : (e.actorId ? 'account cancellato' : 'sistema') }}</td>
              <td>{{ actions[e.action] ?? e.action }}</td>
              <td>{{ e.targetType ?? '' }}</td>
              <td class="meta">{{ e.meta ? (e.meta | json) : '' }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    @if (nextBefore()) { <div class="actions"><button mat-button (click)="more()">Carica altre</button></div> }
  `,
  styles: `
    .small { font-size: 0.85em; }
    .meta { white-space: normal; font: 12px/1.4 monospace; max-width: 360px; }
    .ok { color: var(--mat-sys-primary); }
    .ko { color: var(--mat-sys-error); font-weight: 500; }
  `,
})
export class AdminAuditPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  protected readonly actions = ACTIONS;
  protected readonly actionCodes = Object.keys(ACTIONS);
  protected readonly entries = signal<AuditEntryDto[]>([]);
  protected readonly nextBefore = signal<string | null>(null);
  protected readonly verified = signal<AuditVerifyDto | null>(null);
  protected action = '';
  protected from = '';
  protected to = '';

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private query(before?: string) {
    return { action: this.action || undefined, from: this.from || undefined, to: this.to || undefined, before };
  }

  async load(): Promise<void> {
    try {
      const p = await this.api.adminAudit(this.query());
      this.entries.set(p.entries);
      this.nextBefore.set(p.nextBefore);
    } catch (e) {
      this.toast.error(e);
    }
  }

  async more(): Promise<void> {
    try {
      const p = await this.api.adminAudit(this.query(this.nextBefore() ?? undefined));
      this.entries.update((x) => [...x, ...p.entries]);
      this.nextBefore.set(p.nextBefore);
    } catch (e) {
      this.toast.error(e);
    }
  }

  async verify(): Promise<void> {
    try {
      this.verified.set(await this.api.adminVerifyAudit());
    } catch (e) {
      this.toast.error(e);
    }
  }
}
