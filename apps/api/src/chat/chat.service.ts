import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type ChatMessageDto, QUICK_MESSAGES, type QuickMessageCode, type SendChatMessageInput } from '@fcs/shared';
import { Clock } from '../common/clock.js';
import { CryptoService } from '../common/crypto.service.js';
import { NotFound } from '../common/errors.js';
import { PrismaService } from '../common/prisma.service.js';
import { toIsoDate } from '../common/time.js';
import type { ChatMessage } from '../generated/prisma/client.js';
import { JobQueue } from '../jobs/job-queue.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { TripAccessPolicy } from '../trips/trip-access.policy.js';

type MessageWithSender = ChatMessage & { sender: { id: string; firstName: string; lastName: string } | null };

@Injectable()
export class ChatService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: TripAccessPolicy,
    private readonly crypto: CryptoService,
    private readonly notifications: NotificationsService,
    private readonly clock: Clock,
    private readonly settings: SettingsService,
    private readonly queue: JobQueue,
  ) {}

  onModuleInit(): void {
    // Cancellazione automatica dei messaggi oltre il periodo di conservazione (ogni notte alle 3:15).
    this.queue.register('chat-retention', () => this.purgeExpired().then(() => undefined));
    this.queue.schedule('chat-retention', '15 3 * * *');
  }

  /** Restituisce la serie del viaggio solo se l'utente può accedere alla chat, altrimenti 404. */
  async resolveSeries(tripId: string, userId: string): Promise<{ seriesId: string; tripDate: Date }> {
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId }, select: { seriesId: true, date: true } });
    if (!trip || !(await this.policy.canChat(trip.seriesId, userId))) throw NotFound('Chat');
    return { seriesId: trip.seriesId, tripDate: trip.date };
  }

  async list(tripId: string, userId: string): Promise<{ seriesId: string; muted: boolean; messages: ChatMessageDto[] }> {
    const { seriesId } = await this.resolveSeries(tripId, userId);
    const rows = await this.prisma.chatMessage.findMany({
      where: { seriesId },
      include: { sender: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    const muted = await this.prisma.chatMute.findUnique({ where: { userId_seriesId: { userId, seriesId } } });
    return { seriesId, muted: Boolean(muted), messages: rows.map((m) => this.toDto(m, tripId)) };
  }

  async send(userId: string, input: SendChatMessageInput): Promise<{ seriesId: string; message: ChatMessageDto }> {
    const { seriesId, tripDate } = await this.resolveSeries(input.tripId, userId);
    const msg = await this.prisma.chatMessage.create({
      data: {
        seriesId,
        tripDate,
        senderId: userId,
        kind: input.quickCode ? 'QUICK' : 'TEXT',
        bodyEnc: input.text ? this.crypto.encrypt(input.text) : null,
        quickCode: input.quickCode ?? null,
      },
      include: { sender: { select: { id: true, firstName: true, lastName: true } } },
    });
    const recipients = await this.members(seriesId);
    await this.notifications.notifyChat(recipients.filter((id) => id !== userId), seriesId, input.tripId);
    return { seriesId, message: this.toDto(msg, input.tripId) };
  }

  async setMuted(tripId: string, userId: string, muted: boolean): Promise<void> {
    const { seriesId } = await this.resolveSeries(tripId, userId);
    if (muted) {
      await this.prisma.chatMute.upsert({ where: { userId_seriesId: { userId, seriesId } }, create: { userId, seriesId }, update: {} });
    } else {
      await this.prisma.chatMute.deleteMany({ where: { userId, seriesId } });
    }
  }

  /** Membri della chat: conducente e partecipanti accettati delle date non annullate. */
  async members(seriesId: string): Promise<string[]> {
    const series = await this.prisma.tripSeries.findUnique({ where: { id: seriesId }, select: { driverId: true } });
    const parts = await this.prisma.tripParticipant.findMany({
      where: { status: 'ACCEPTED', trip: { seriesId, status: { not: 'CANCELLED' } } },
      select: { userId: true },
      distinct: ['userId'],
    });
    return [...new Set([series?.driverId, ...parts.map((p) => p.userId)].filter((x): x is string => Boolean(x)))];
  }

  async purgeExpired(): Promise<number> {
    const { chatRetentionDays } = await this.settings.get();
    const cutoff = new Date(this.clock.now().getTime() - chatRetentionDays * 86_400_000);
    const r = await this.prisma.chatMessage.deleteMany({ where: { createdAt: { lt: cutoff } } });
    return r.count;
  }

  private toDto(m: MessageWithSender, tripId: string): ChatMessageDto {
    return {
      id: m.id,
      tripId,
      tripDate: toIsoDate(m.tripDate),
      sender: m.sender,
      kind: m.kind,
      text: m.kind === 'QUICK' ? QUICK_MESSAGES[m.quickCode as QuickMessageCode] ?? null : this.crypto.decryptNullable(m.bodyEnc),
      quickCode: m.quickCode,
      createdAt: m.createdAt.toISOString(),
    };
  }
}
