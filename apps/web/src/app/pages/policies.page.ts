import { Component, inject, type OnInit, signal } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';
import type { PolicyDto } from '@fcs/shared';
import { ApiService } from '../core/api.service';
import { MarkdownPipe } from '../shared/markdown.pipe';

/** Informativa e termini consultabili in qualsiasi momento. */
@Component({
  selector: 'app-policies-page',
  imports: [MatTabsModule, MarkdownPipe],
  template: `
    <div class="page">
      <h1 class="page-title">Privacy e termini</h1>
      @if (docs().length) {
        <mat-tab-group>
          @for (d of docs(); track d.id) {
            <mat-tab [label]="d.title">
              <div class="legal-text" [innerHTML]="d.content | markdown"></div>
            </mat-tab>
          }
        </mat-tab-group>
      } @else if (unauth()) {
        <p class="muted">Accedi per consultare l'informativa completa e i termini d'uso.</p>
      }
    </div>
  `,
})
export class PoliciesPage implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly docs = signal<PolicyDto[]>([]);
  protected readonly unauth = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      this.docs.set(await this.api.policies());
    } catch {
      this.unauth.set(true);
    }
  }
}
