import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { id, muteChatSchema, sendChatMessageSchema } from '@fcs/shared';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session.service.js';
import { AppException } from '../common/errors.js';
import { ChatGateway } from './chat.gateway.js';
import { ChatService } from './chat.service.js';

const restSendSchema = z.object({ text: z.string().optional(), quickCode: z.string().optional() });

@Controller('trips/:id/chat')
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly gateway: ChatGateway,
  ) {}

  @Get()
  list(@CurrentUser() u: SessionUser, @Param('id', { schema: id }) tripId: string) {
    return this.chat.list(tripId, u.userId);
  }

  /** Alternativa REST all'invio via socket (es. connessione WebSocket non disponibile). */
  @Post('messages')
  async send(
    @CurrentUser() u: SessionUser,
    @Param('id', { schema: id }) tripId: string,
    @Body({ schema: restSendSchema }) body: z.infer<typeof restSendSchema>,
  ) {
    const input = sendChatMessageSchema.safeParse({ ...body, tripId });
    if (!input.success) throw new AppException('VALIDATION_ERROR', 'Messaggio non valido');
    const { seriesId, message } = await this.chat.send(u.userId, input.data);
    this.gateway.server?.to(`series:${seriesId}`).emit('message', message);
    return message;
  }

  @Put('mute')
  @HttpCode(204)
  async mute(
    @CurrentUser() u: SessionUser,
    @Param('id', { schema: id }) tripId: string,
    @Body({ schema: muteChatSchema }) body: { muted: boolean },
  ): Promise<void> {
    await this.chat.setMuted(tripId, u.userId, body.muted);
  }
}
