import { DatePipe } from '@angular/common';
import { Component, computed, type ElementRef, inject, input, type OnDestroy, type OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { RouterLink } from '@angular/router';
import { type ChatMessageDto, QUICK_MESSAGE_CODES, QUICK_MESSAGES } from '@fcs/shared';
import { ApiService, errorCode } from '../core/api.service';
import { ChatSocketService } from '../core/chat-socket.service';
import { SessionStore } from '../core/session.store';
import { ToastService } from '../core/toast.service';
import { ChatMessageComponent } from '../shared/chat-message.component';

@Component({
  selector: 'app-trip-chat-page',
  imports: [ChatMessageComponent, DatePipe, FormsModule, RouterLink, MatButtonModule, MatChipsModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSlideToggleModule],
  template: `
    <div class="chat">
      <header class="bar">
        <a mat-icon-button [routerLink]="['/viaggi', id()]" aria-label="Torna al viaggio">
          <mat-icon svgIcon="arrow_back" />
        </a>
        <span class="grow">Chat del viaggio</span>
        <mat-slide-toggle [checked]="muted()" (change)="setMuted($event.checked)">Silenzia</mat-slide-toggle>
      </header>

      @if (notFound()) {
        <p class="empty">La chat è visibile solo al conducente e ai partecipanti confermati.</p>
      } @else {
        <div class="messages" #scroller aria-live="polite">
          @for (g of grouped(); track g.date) {
            <div class="day">{{ g.date | date: 'EEEE d MMMM' }}</div>
            @for (m of g.messages; track m.id) {
              <app-chat-message
                [mine]="m.sender?.id === myId()"
                [quick]="m.kind === 'QUICK'"
                [who]="m.sender ? m.sender.firstName + ' ' + m.sender.lastName : 'Utente non più attivo'"
                [text]="m.text ?? ''"
                [time]="(m.createdAt | date: 'HH:mm') ?? ''"
              />
            }
          } @empty {
            <p class="empty">Nessun messaggio. Usa i messaggi rapidi per avvisare gli altri partecipanti.</p>
          }
        </div>
        <div class="quick">
          <mat-chip-set aria-label="Messaggi rapidi">
            @for (q of quickCodes; track q) { <mat-chip (click)="send({ quickCode: q })">{{ quick[q] }}</mat-chip> }
          </mat-chip-set>
        </div>
        <form class="composer" (ngSubmit)="sendText()">
          <mat-form-field class="grow" subscriptSizing="dynamic">
            <input matInput [(ngModel)]="text" name="text" maxlength="1000" placeholder="Scrivi un messaggio" autocomplete="off" />
          </mat-form-field>
          <button mat-icon-button type="submit" [disabled]="!text.trim()" aria-label="Invia">
            <mat-icon svgIcon="send" />
          </button>
        </form>
        <p class="muted hint">I messaggi vengono cancellati automaticamente dopo 30 giorni. Non condividere dati personali non necessari.</p>
      }
    </div>
  `,
  styles: `
    .chat { display: flex; flex-direction: column; height: calc(100dvh - 64px); max-width: 720px; margin: 0 auto; }
    .bar { display: flex; align-items: center; gap: 8px; padding: 8px; border-bottom: 1px solid var(--mat-sys-outline-variant); }
    .grow { flex: 1; }
    .messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 6px; }
    .day { align-self: center; font: var(--mat-sys-label-medium); color: var(--mat-sys-on-surface-variant); margin: 8px 0; text-transform: capitalize; }
    .quick { padding: 4px 8px; overflow-x: auto; }
    .composer { display: flex; align-items: center; gap: 4px; padding: 4px 8px; }
    .hint { font-size: 0.75em; padding: 0 12px 8px; margin: 0; }
  `,
})
export class TripChatPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly socket = inject(ChatSocketService);
  private readonly toast = inject(ToastService);
  private readonly session = inject(SessionStore);
  readonly id = input.required<string>();
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  protected readonly quick = QUICK_MESSAGES;
  protected readonly quickCodes = QUICK_MESSAGE_CODES;
  protected readonly messages = signal<ChatMessageDto[]>([]);
  protected readonly muted = signal(false);
  protected readonly notFound = signal(false);
  protected readonly myId = computed(() => this.session.me()?.id);
  protected text = '';
  private leave: (() => void) | null = null;

  protected readonly grouped = computed(() => {
    const groups: { date: string; messages: ChatMessageDto[] }[] = [];
    for (const m of this.messages()) {
      const last = groups.at(-1);
      if (last?.date === m.tripDate) last.messages.push(m);
      else groups.push({ date: m.tripDate, messages: [m] });
    }
    return groups;
  });

  async ngOnInit(): Promise<void> {
    try {
      const r = await this.api.chat(this.id());
      this.messages.set(r.messages);
      this.muted.set(r.muted);
      this.scrollDown();
      // Il server inoltra solo i messaggi della stanza di questa serie.
      this.leave = await this.socket.join(this.id(), (m) => this.add(m));
    } catch (e) {
      if (errorCode(e) === 'NOT_FOUND') this.notFound.set(true);
      else this.toast.error(e);
    }
  }

  ngOnDestroy(): void {
    this.leave?.();
  }

  private add(m: ChatMessageDto): void {
    if (this.messages().some((x) => x.id === m.id)) return;
    this.messages.update((list) => [...list, m]);
    this.scrollDown();
  }

  private scrollDown(): void {
    setTimeout(() => {
      const el = this.scroller()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  async send(body: { text?: string; quickCode?: string }): Promise<void> {
    // Via socket se connesso, altrimenti via REST.
    const ack = await this.socket.send(this.id(), body).catch(() => ({ ok: false as const }));
    if (ack.ok && 'message' in ack && ack.message) {
      this.add(ack.message);
      return;
    }
    try {
      this.add(await this.api.sendChat(this.id(), body));
    } catch (e) {
      this.toast.error(e, 'Messaggio non inviato');
    }
  }

  async sendText(): Promise<void> {
    const t = this.text.trim();
    if (!t) return;
    this.text = '';
    await this.send({ text: t });
  }

  async setMuted(m: boolean): Promise<void> {
    try {
      await this.api.muteChat(this.id(), m);
      this.muted.set(m);
    } catch (e) {
      this.toast.error(e);
    }
  }
}
