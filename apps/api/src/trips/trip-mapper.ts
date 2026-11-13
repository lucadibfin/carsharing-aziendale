import { Injectable } from '@nestjs/common';
import type { TripDetailDto, TripParticipantDto, TripSummaryDto } from '@fcs/shared';
import { CryptoService } from '../common/crypto.service.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../common/prisma.service.js';
import { toIsoDate } from '../common/time.js';
import type { TripStatus } from '../generated/prisma/client.js';
import { SettingsService } from '../settings/settings.service.js';
import { effectiveVisibility, TripAccessPolicy, type TripContext } from './trip-access.policy.js';
import type { LoadedTrip } from './trip-loader.js';

@Injectable()
export class TripMapper {
  constructor(
    private readonly policy: TripAccessPolicy,
    private readonly crypto: CryptoService,
    private readonly clock: Clock,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Stato effettivo: un viaggio programmato il cui orario è passato è "da chiudere". */
  effectiveStatus(trip: { status: TripStatus; arrivalAt: Date }): TripStatus {
    if (trip.status === 'SCHEDULED' && trip.arrivalAt <= this.clock.now()) return 'AWAITING_CLOSURE';
    return trip.status;
  }

  summary(trip: LoadedTrip, userId: string, opts: { invited?: boolean } = {}): TripSummaryDto {
    const isDriver = trip.series.driverId === userId;
    const me = trip.participants.find((p) => p.userId === userId);
    return {
      id: trip.id,
      seriesId: trip.seriesId,
      siteId: trip.siteId,
      siteName: trip.series.site.name,
      date: toIsoDate(trip.date),
      arrivalTime: trip.arrivalTime,
      returnTime: trip.returnTime,
      visibility: effectiveVisibility(trip),
      status: this.effectiveStatus(trip),
      seats: trip.seats,
      seatsTaken: trip.participants.filter((p) => p.status === 'ACCEPTED').length,
      driver: { id: trip.series.driver.id, firstName: trip.series.driver.firstName, lastName: trip.series.driver.lastName },
      stops: trip.series.stops.map((s) => ({ order: s.order, comuneIstat: s.comuneIstat, comuneName: s.comune.name })),
      meetingPoint: trip.series.meetingPoint,
      myRole: isDriver ? 'DRIVER' : me ? 'PARTICIPANT' : opts.invited ? 'INVITED' : 'NONE',
      myStatus: me?.status ?? null,
    };
  }

  async detail(ctx: TripContext): Promise<TripDetailDto> {
    const { trip } = ctx;
    const { cancellationDeadlineHours } = await this.settings.get();
    const deadline = new Date(trip.arrivalAt.getTime() - cancellationDeadlineHours * 3600_000);
    const stopName = new Map(trip.series.stops.map((s) => [s.comuneIstat, s.comune.name]));

    let participants: TripParticipantDto[] = [];
    if (this.policy.canSeeParticipants(ctx)) {
      participants = trip.participants
        // Il conducente vede anche richieste e storico; gli altri solo i confermati.
        .filter((p) => ctx.isDriver || p.status === 'ACCEPTED')
        .map((p) => ({
          id: p.id,
          user: { id: p.user.id, firstName: p.user.firstName, lastName: p.user.lastName },
          status: p.status,
          boardingComune: p.boardingComune,
          boardingComuneName: stopName.get(p.boardingComune) ?? p.boardingComune,
          phone:
            p.status === 'ACCEPTED' && p.userId !== ctx.userId && this.policy.canSeePhoneOf(ctx, p.user.consent?.phoneVisible)
              ? this.crypto.decryptNullable(p.user.phoneEnc)
              : undefined,
          attended: p.attended,
        }));
    } else if (ctx.participant) {
      // Chi ha una richiesta in sospeso vede solo la propria riga.
      const p = ctx.participant;
      participants = [
        {
          id: p.id,
          user: { id: p.user.id, firstName: p.user.firstName, lastName: p.user.lastName },
          status: p.status,
          boardingComune: p.boardingComune,
          boardingComuneName: stopName.get(p.boardingComune) ?? p.boardingComune,
          attended: p.attended,
        },
      ];
    }

    const driver = trip.series.driver;
    const dto: TripDetailDto = {
      ...this.summary(trip, ctx.userId, { invited: ctx.hasInvitation }),
      notes: trip.series.notes,
      driverPhone:
        !ctx.isDriver && this.policy.canSeePhoneOf(ctx, driver.consent?.phoneVisible)
          ? this.crypto.decryptNullable(driver.phoneEnc)
          : undefined,
      participants,
      myInvitationId: ctx.invitationId,
      canCancelWithoutPenalty: this.clock.now() <= deadline,
      cancellationDeadline: deadline.toISOString(),
    };

    if (ctx.isDriver) {
      const invitations = await this.prisma.invitation.findMany({
        where: { OR: [{ tripId: trip.id }, { tripId: null, seriesId: trip.seriesId }] },
        include: { invitee: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
      });
      dto.invitations = invitations.map((i) => ({
        id: i.id,
        tripId: i.tripId ?? trip.id,
        scope: i.scope,
        status: i.status === 'PENDING' && i.expiresAt <= this.clock.now() ? 'EXPIRED' : i.status,
        invitee: i.invitee,
        isLink: i.tokenHash !== null,
        expiresAt: i.expiresAt.toISOString(),
        createdAt: i.createdAt.toISOString(),
      }));
    }
    return dto;
  }
}
