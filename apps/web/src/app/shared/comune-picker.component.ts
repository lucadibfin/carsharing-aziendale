import { Component, effect, inject, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule, type MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { ComuneDto } from '@fcs/shared';
import { ReferenceStore } from '../core/reference.store';

/** Selezione di un comune dall'elenco ISTAT con ricerca per nome. Il valore è il codice ISTAT. */
@Component({
  selector: 'app-comune-picker',
  imports: [FormsModule, MatFormFieldModule, MatInputModule, MatAutocompleteModule],
  template: `
    <mat-form-field class="full-width" [subscriptSizing]="hint() ? 'fixed' : 'dynamic'">
      <mat-label>{{ label() }}</mat-label>
      <input
        matInput
        [ngModel]="text()"
        (ngModelChange)="onInput($event)"
        [matAutocomplete]="auto"
        [required]="required()"
        autocomplete="off"
        autocapitalize="words"
      />
      <mat-autocomplete #auto="matAutocomplete" (optionSelected)="onSelect($event)">
        @for (c of options(); track c.istat) {
          <mat-option [value]="c">{{ c.name }} ({{ c.province }})</mat-option>
        }
      </mat-autocomplete>
      @if (hint()) {
        <mat-hint>{{ hint() }}</mat-hint>
      }
    </mat-form-field>
  `,
})
export class ComunePickerComponent {
  private readonly ref = inject(ReferenceStore);
  readonly label = input('Comune');
  readonly hint = input('');
  readonly required = input(false);
  /** Codice ISTAT selezionato (two-way binding). */
  readonly value = model<string | null>(null);

  protected readonly text = signal('');
  protected readonly options = signal<ComuneDto[]>([]);
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    // Mostra il nome del comune quando il valore arriva dall'esterno.
    effect(() => {
      const istat = this.value();
      if (istat) void this.ref.comune(istat).then((c) => c && this.text.set(`${c.name} (${c.province})`));
    });
  }

  protected onInput(v: string | ComuneDto): void {
    if (typeof v !== 'string') return;
    this.text.set(v);
    if (this.value()) this.value.set(null);
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => this.options.set(await this.ref.searchComuni(v)), 250);
  }

  protected onSelect(e: MatAutocompleteSelectedEvent): void {
    const c = e.option.value as ComuneDto;
    this.text.set(`${c.name} (${c.province})`);
    this.value.set(c.istat);
  }
}
