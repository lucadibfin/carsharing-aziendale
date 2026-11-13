import { Inject, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { id, sendChatMessageSchema } from '@fcs/shared';
import { z } from 'zod';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { SessionService } from '../auth/session.service.js';
import { ChatMembershipEvents } from '../trips/chat-membership.events.js';
import { TripAccessPolicy } from '../trips/trip-access.policy.js';
import { ChatService } from './chat.service.js';

const joinSchema = z.object({ tripId: id });

type Ack = { ok: true; [k: string]: unknown } | { ok: false; code: string };

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        // cookie malformato: ignorato
      }
    }
  }
  return out;
}

/**
 * Chat in tempo reale (Socket.IO, namespace /chat). Autenticazione con lo
 * stesso cookie di sessione dell'API; si accettano solo connessioni
 * dall'origine dell'app (difesa da Cross-Site WebSocket Hijacking).
 * Ogni socket è nella stanza user:<id>; entra in series:<id> solo dopo il
 * controllo dei permessi.
 */
@WebSocketGateway({ namespace: '/chat', serveClient: false, transports: ['websocket', 'polling'], maxHttpBufferSize: 16_000 })
export class ChatGateway implements OnGatewayInit {
  private readonly logger = new Logger('ChatGateway');
  @WebSocketServer() server!: Namespace;

  constructor(
    private readonly chat: ChatService,
    private readonly sessions: SessionService,
    private readonly policy: TripAccessPolicy,
    private readonly membership: ChatMembershipEvents,
    @Inject(ENV) private readonly env: Env,
  ) {}

  afterInit(server: Namespace): void {
    server.use(async (socket, next) => {
      try {
        const origin = socket.handshake.headers.origin;
        if (origin !== this.env.APP_ORIGIN) return next(new Error('forbidden'));
        const token = parseCookies(socket.handshake.headers.cookie)[this.sessions.cookieName];
        const auth = await this.sessions.validate(token);
        if (!auth) return next(new Error('unauthenticated'));
        socket.data.userId = auth.userId;
        await socket.join(`user:${auth.userId}`);
        next();
      } catch {
        next(new Error('error'));
      }
    });

    // Quando un utente perde l'accesso a una chat, le sue connessioni escono dalla stanza.
    this.membership.onChange(async (seriesId, userId) => {
      if (!(await this.policy.canChat(seriesId, userId))) {
        this.server.in(`user:${userId}`).socketsLeave(`series:${seriesId}`);
      }
    });
  }

  @SubscribeMessage('join')
  async join(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<Ack> {
    const parsed = joinSchema.safeParse(body);
    if (!parsed.success) return { ok: false, code: 'BAD_REQUEST' };
    try {
      const { seriesId } = await this.chat.resolveSeries(parsed.data.tripId, socket.data.userId as string);
      await socket.join(`series:${seriesId}`);
      return { ok: true, seriesId };
    } catch {
      return { ok: false, code: 'NOT_FOUND' };
    }
  }

  @SubscribeMessage('send')
  async send(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<Ack> {
    const parsed = sendChatMessageSchema.safeParse(body);
    if (!parsed.success) return { ok: false, code: 'BAD_REQUEST' };
    try {
      const { seriesId, message } = await this.chat.send(socket.data.userId as string, parsed.data);
      this.server.to(`series:${seriesId}`).emit('message', message);
      return { ok: true, message };
    } catch (e) {
      if ((e as { status?: number }).status !== 404) {
        this.logger.warn({ errName: e instanceof Error ? e.name : 'unknown' }, 'invio messaggio non riuscito');
      }
      return { ok: false, code: 'NOT_FOUND' };
    }
  }
}
