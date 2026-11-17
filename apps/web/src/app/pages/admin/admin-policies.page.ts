import { DatePipe } from '@angular/common';
import { Component, inject, type OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { AdminPolicyDto, PolicyType } from '@fcs/shared';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { MarkdownPipe } from '../../shared/markdown.pipe';

const TYPE_LABELS: Record<PolicyType, string> = { PRIVACY_NOTICE: 'Informativa privacy', TERMS: 'Termini d’uso' };

@Component({
  selector: 'app-admin-policies',
  imports: [DatePipe, FormsModule, MatButtonModule, MatButtonToggleModule, MatCardModule, MatFormFieldModule, MatInputModule, MarkdownPipe],
  template: `
    <h2 class="section-title">Versioni pubblicate</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Documento</th><th>Versione</th><th>Pubblicata</th><th>Prese visione</th><th></th></tr></thead>
        <tbody>
          @for (p of versions(); track p.id) {
            <tr>
              <td>{{ labels[p.type] }}</td>
              <td>v{{ p.version }}</td>
              <td>{{ p.publishedAt | date: 'd/M/y HH:mm' }}</td>
              <td>{{ p.acceptances }}</td>
              <td><button mat-button (click)="startFrom(p)">Nuova versione da questa</button></td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    @if (draftType) {
      <h2 class="section-title">Nuova versione: {{ labels[draftType] }}</h2>
      <mat-card appearance="outlined">
        <mat-card-content class="stack">
          <p class="muted">
            Una versione pubblicata non si modifica più. Alla pubblicazione tutti gli utenti dovranno prenderne visione al
            prossimo accesso (data e versione vengono registrate). Far validare il testo al DPO prima di pubblicarlo.
          </p>
          <mat-form-field><mat-label>Titolo</mat-label><input matInput [(ngModel)]="title" maxlength="200" /></mat-form-field>
          <mat-button-toggle-group [(ngModel)]="mode" aria-label="Modalità">
            <mat-button-toggle value="edit">Testo (Markdown)</mat-button-toggle>
            <mat-button-toggle value="preview">Anteprima</mat-button-toggle>
          </mat-button-toggle-group>
          @if (mode === 'edit') {
            <textarea class="editor" [(ngModel)]="content" rows="20" aria-label="Testo del documento"></textarea>
          } @else {
            <div class="preview" [innerHTML]="content | markdown"></div>
          }
          <div class="actions">
            <button mat-button (click)="draftType = null">Annulla</button>
            <button mat-flat-button (click)="publish()" [disabled]="busy() || content.trim().length < 50 || title.trim().length < 3">Pubblica</button>
          </div>
        </mat-card-content>
      </mat-card>
    }
  `,
  styles: `
    .editor { width: 100%; box-sizing: border-box; font: 14px/1.5 monospace; padding: 8px; }
    .preview { max-height: 60vh; overflow: auto; border: 1px solid var(--mat-sys-outline-variant); border-radius: 8px; padding: 0 12px; }
  `,
})
export class AdminPoliciesPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  protected readonly labels = TYPE_LABELS;
  protected readonly versions = signal<AdminPolicyDto[]>([]);
  protected readonly busy = signal(false);
  protected draftType: PolicyType | null = null;
  protected title = '';
  protected content = '';
  protected mode: 'edit' | 'preview' = 'edit';

  async ngOnInit(): Promise<void> {
    this.versions.set(await this.api.adminPolicies());
  }

  startFrom(p: AdminPolicyDto): void {
    this.draftType = p.type;
    this.title = p.title;
    this.content = p.content;
    this.mode = 'edit';
  }

  async publish(): Promise<void> {
    if (!this.draftType || !window.confirm('Pubblicare la nuova versione? Tutti gli utenti dovranno prenderne visione.')) return;
    this.busy.set(true);
    try {
      this.versions.set(await this.api.adminPublishPolicy({ type: this.draftType, title: this.title.trim(), content: this.content }));
      this.toast.info('Nuova versione pubblicata');
      this.draftType = null;
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}
