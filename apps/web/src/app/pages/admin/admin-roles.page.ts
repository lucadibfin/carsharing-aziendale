import { DatePipe } from '@angular/common';
import { Component, inject, type OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import type { AdminRoleDto, AdminUserDto, Role } from '@fcs/shared';
import { ApiService } from '../../core/api.service';
import { ReferenceStore } from '../../core/reference.store';
import { SessionStore } from '../../core/session.store';
import { ToastService } from '../../core/toast.service';

@Component({
  selector: 'app-admin-roles',
  imports: [DatePipe, FormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
  template: `
    <h2 class="section-title">Ruoli assegnati</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Persona</th><th>Ruolo</th><th>Sede</th><th>Dal</th><th></th></tr></thead>
        <tbody>
          @for (r of roles(); track r.id) {
            <tr>
              <td>{{ r.user.firstName }} {{ r.user.lastName }}</td>
              <td>{{ r.role === 'GLOBAL_ADMIN' ? 'Admin globale' : 'Admin di sede' }}</td>
              <td>{{ r.siteName ?? 'Tutte' }}</td>
              <td>{{ r.createdAt | date: 'd/M/y' }}</td>
              <td>
                <button mat-icon-button (click)="revoke(r)" [attr.aria-label]="'Revoca il ruolo a ' + r.user.firstName + ' ' + r.user.lastName">
                  <mat-icon svgIcon="delete" />
                </button>
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    <h2 class="section-title">Assegna un ruolo</h2>
    <mat-card appearance="outlined">
      <mat-card-content class="stack">
        <mat-form-field class="full-width">
          <mat-label>Cerca un collega per nome</mat-label>
          <input matInput [(ngModel)]="query" (ngModelChange)="search()" autocomplete="off" />
          <mat-hint>Compaiono tutti gli utenti registrati, anche quelli non "trovabili". La ricerca viene registrata.</mat-hint>
        </mat-form-field>
        @for (u of results(); track u.id) {
          <button mat-stroked-button class="pick" [class.selected]="selected()?.id === u.id" (click)="selected.set(u)">
            {{ u.firstName }} {{ u.lastName }} <span class="muted">{{ u.siteName }}</span>
          </button>
        }
        @if (selected(); as u) {
          <div class="row">
            <mat-form-field class="grow">
              <mat-label>Ruolo</mat-label>
              <mat-select [(ngModel)]="role">
                <mat-option value="SITE_ADMIN">Admin di sede</mat-option>
                <mat-option value="GLOBAL_ADMIN">Admin globale</mat-option>
              </mat-select>
            </mat-form-field>
            @if (role === 'SITE_ADMIN') {
              <mat-form-field class="grow">
                <mat-label>Sede</mat-label>
                <mat-select [(ngModel)]="siteId">
                  @for (s of ref.sites(); track s.id) { <mat-option [value]="s.id">{{ s.name }}</mat-option> }
                </mat-select>
              </mat-form-field>
            }
            <button mat-flat-button (click)="grant(u)" [disabled]="role === 'SITE_ADMIN' && !siteId">Assegna a {{ u.firstName }}</button>
          </div>
        }
      </mat-card-content>
    </mat-card>
  `,
  styles: `
    .pick { justify-content: flex-start; }
    .pick.selected { background: var(--mat-sys-secondary-container); }
  `,
})
export class AdminRolesPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly session = inject(SessionStore);
  protected readonly ref = inject(ReferenceStore);
  protected readonly roles = signal<AdminRoleDto[]>([]);
  protected readonly results = signal<AdminUserDto[]>([]);
  protected readonly selected = signal<AdminUserDto | null>(null);
  protected query = '';
  protected role: Role = 'SITE_ADMIN';
  protected siteId = '';
  private timer: ReturnType<typeof setTimeout> | undefined;

  async ngOnInit(): Promise<void> {
    await this.ref.loadSites();
    this.roles.set(await this.api.adminRoles());
  }

  search(): void {
    clearTimeout(this.timer);
    const q = this.query.trim();
    if (q.length < 2) return void this.results.set([]);
    this.timer = setTimeout(async () => {
      try {
        this.results.set(await this.api.adminSearchUsers(q));
      } catch (e) {
        this.toast.error(e);
      }
    }, 400);
  }

  async grant(u: AdminUserDto): Promise<void> {
    try {
      this.roles.set(await this.api.adminGrantRole({ userId: u.id, role: this.role, siteId: this.role === 'SITE_ADMIN' ? this.siteId : null }));
      this.toast.info('Ruolo assegnato');
      this.selected.set(null);
    } catch (e) {
      this.toast.error(e);
    }
  }

  async revoke(r: AdminRoleDto): Promise<void> {
    const self = r.user.id === this.session.me()?.id;
    const msg = self ? 'Stai revocando un tuo ruolo: potresti perdere l’accesso a questa pagina. Continuare?' : `Revocare il ruolo a ${r.user.firstName} ${r.user.lastName}?`;
    if (!window.confirm(msg)) return;
    try {
      this.roles.set(await this.api.adminRevokeRole(r.id));
      if (self) await this.session.refresh();
    } catch (e) {
      this.toast.error(e);
    }
  }
}
