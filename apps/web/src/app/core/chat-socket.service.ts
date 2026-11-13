import { Injectable, type OnDestroy, signal } from '@angular/core';
import type { ChatMessageDto } from '@fcs/shared';
import { io, type Socket } from 'socket.io-client';

type Ack = { ok: boolean; code?: string; message?: ChatMessageDto };

/** Connessione Socket.IO alla chat (stessa origine, cookie di sessione). */
@Injectable({ providedIn: 'root' })
export class ChatSocketService implements OnDestroy {
  private socket: Socket | null = null;
  readonly connected = signal(false);

  private ensure(): Socket {
    if (!this.socket) {
      this.socket = io('/chat', { withCredentials: true, transports: ['websocket', 'polling'] });
      this.socket.on('connect', () => this.connected.set(true));
      this.socket.on('disconnect', () => this.connected.set(false));
    }
    return this.socket;
  }

  async join(tripId: string, onMessage: (m: ChatMessageDto) => void): Promise<() => void> {
    const s = this.ensure();
    const handler = (m: ChatMessageDto) => onMessage(m);
    s.on('message', handler);
    const doJoin = () => s.emit('join', { tripId });
    s.on('connect', doJoin); // ri-entra nella stanza dopo una riconnessione
    if (s.connected) doJoin();
    return () => {
      s.off('message', handler);
      s.off('connect', doJoin);
    };
  }

  async send(tripId: string, body: { text?: string; quickCode?: string }): Promise<Ack> {
    const s = this.ensure();
    if (!s.connected) return { ok: false, code: 'OFFLINE' };
    return (await s.timeout(8000).emitWithAck('send', { tripId, ...body })) as Ack;
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.connected.set(false);
  }

  ngOnDestroy(): void {
    this.disconnect();
  }
}
