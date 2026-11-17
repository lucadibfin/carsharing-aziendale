import { Component, input } from '@angular/core';

/** Fumetto di un messaggio della chat del viaggio. */
@Component({
  selector: 'app-chat-message',
  template: `
    @if (!mine()) { <div class="who">{{ who() }}</div> }
    <div class="text">{{ text() }}</div>
    <div class="time">{{ time() }}</div>
  `,
  host: { class: 'msg', '[class.mine]': 'mine()', '[class.quick]': 'quick()' },
  styles: `
    :host {
      display: block; max-width: 80%; align-self: flex-start;
      padding: 6px 10px; border-radius: var(--app-radius-lg);
      background: var(--mat-sys-surface-container-high); color: var(--mat-sys-on-surface);
    }
    :host(.mine) { align-self: flex-end; background: var(--mat-sys-primary-container); color: var(--mat-sys-on-primary-container); }
    :host(.quick) .text { font-style: italic; }
    .who { font: var(--mat-sys-label-small); color: var(--mat-sys-primary); }
    .text { white-space: pre-wrap; word-break: break-word; }
    .time { font: var(--mat-sys-label-small); text-align: right; }
    :host(:not(.mine)) .time { color: var(--mat-sys-on-surface-variant); }
  `,
})
export class ChatMessageComponent {
  readonly who = input('');
  readonly text = input.required<string>();
  readonly time = input('');
  readonly mine = input(false);
  readonly quick = input(false);
}
