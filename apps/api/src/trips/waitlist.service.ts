import { Injectable } from '@nestjs/common';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../common/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { lockSeats } from './seats.js';

/**
 * Lista d'attesa. Da chiamare ogni volta che un posto confermato si libera
 * (annullamento, rimozione, "non ci sono", uscita dal gruppo fisso):
 * 1. i membri fissi in attesa entrano subito, nell'ordine di ingresso nel gruppo;
 * 2. se restano posti, gli altri in lista d'attesa ricevono un avviso e possono
 *    chiedere il posto (la richiesta va poi accettata dal conducente, che può
 *    anche accettare direttamente dalla lista d'attesa).
 */
@Injectable()
export class WaitlistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly notifications: NotificationsService,
  ) {}

  async seatFreed(tripId: string): Promise<void> {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: {
        status: true,
        arrivalAt: true,
        participants: { where: { status: 'WAITLISTED' }, orderBy: { requestedAt: 'asc' }, select: { id: true, userId: true } },
        series: { select: { members: { orderBy: { joinedAt: 'asc' }, select: { userId: true } } } },
      },
    });
    if (!trip || trip.status !== 'SCHEDULED' || trip.arrivalAt <= this.clock.now() || trip.participants.length === 0) return;

    const memberOrder = trip.series.members.map((m) => m.userId);
    const waitingMembers = trip.participants
      .filter((p) => memberOrder.includes(p.userId))
      .sort((a, b) => memberOrder.indexOf(a.userId) - memberOrder.indexOf(b.userId));
    const now = this.clock.now();
    const { promoted, free } = await this.prisma.$transaction(async (tx) => {
      let free = await lockSeats(tx, tripId);
      const promoted: string[] = [];
      for (const p of waitingMembers) {
        if (free <= 0) break;
        const r = await tx.tripParticipant.updateMany({ where: { id: p.id, status: 'WAITLISTED' }, data: { status: 'ACCEPTED', decidedAt: now } });
        if (r.count) {
          promoted.push(p.userId);
          free--;
        }
      }
      return { promoted, free };
    });
    if (promoted.length) await this.notifications.notify(promoted, 'REQUEST_ACCEPTED', tripId);
    if (free > 0) {
      const others = trip.participants.filter((p) => !memberOrder.includes(p.userId)).map((p) => p.userId);
      if (others.length) await this.notifications.notify(others, 'SEAT_AVAILABLE', tripId);
    }
  }
}
