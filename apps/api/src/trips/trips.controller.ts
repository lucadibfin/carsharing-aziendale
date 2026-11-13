import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  closeTripSchema,
  type CloseTripInput,
  createAbsenceReportSchema,
  type CreateAbsenceReportInput,
  createInviteLinkSchema,
  type CreateInviteLinkInput,
  createTripSchema,
  type CreateTripInput,
  id,
  inviteUserSchema,
  type InviteUserInput,
  joinRequestSchema,
  type JoinRequestInput,
  searchTripsSchema,
  type SearchTripsInput,
  updateVisibilitySchema,
  type UpdateVisibilityInput,
} from '@fcs/shared';
import { CurrentUser } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session.service.js';
import { AbsenceReportsService } from './absence-reports.service.js';
import { InvitationsService } from './invitations.service.js';
import { ParticipationService } from './participation.service.js';
import { TripsService } from './trips.service.js';

@Controller('trips')
export class TripsController {
  constructor(
    private readonly trips: TripsService,
    private readonly participation: ParticipationService,
    private readonly invitations: InvitationsService,
    private readonly reports: AbsenceReportsService,
  ) {}

  @Post()
  create(@CurrentUser() u: SessionUser, @Body({ schema: createTripSchema }) body: CreateTripInput) {
    return this.trips.create(u.userId, body);
  }

  @Get('search')
  search(@CurrentUser() u: SessionUser, @Query({ schema: searchTripsSchema }) q: SearchTripsInput) {
    return this.trips.search(u.userId, q);
  }

  @Get('mine')
  mine(@CurrentUser() u: SessionUser) {
    return this.trips.mine(u.userId);
  }

  @Get(':id')
  detail(@CurrentUser() u: SessionUser, @Param('id', { schema: id }) tripId: string) {
    return this.trips.detail(tripId, u.userId);
  }

  @Patch(':id/visibility')
  visibility(
    @CurrentUser() u: SessionUser,
    @Param('id', { schema: id }) tripId: string,
    @Body({ schema: updateVisibilitySchema }) body: UpdateVisibilityInput,
  ) {
    return this.trips.changeVisibility(tripId, u.userId, body.visibility);
  }

  @Post(':id/cancel')
  @HttpCode(204)
  async cancel(@CurrentUser() u: SessionUser, @Param('id', { schema: id }) tripId: string): Promise<void> {
    await this.trips.cancel(tripId, u.userId);
  }

  @Post(':id/requests')
  request(
    @CurrentUser() u: SessionUser,
    @Param('id', { schema: id }) tripId: string,
    @Body({ schema: joinRequestSchema }) body: JoinRequestInput,
  ) {
    return this.participation.request(tripId, u.userId, body.boardingComune);
  }

  @Post(':id/participants/:pid/accept')
  @HttpCode(200)
  accept(@CurrentUser() u: SessionUser, @Param('id', { schema: id }) tripId: string, @Param('pid', { schema: id }) pid: string) {
    return this.participation.accept(tripId, pid, u.userId);
  }

  @Post(':id/participants/:pid/reject')
  @HttpCode(200)
  reject(@CurrentUser() u: SessionUser, @Param('id', { schema: id }) tripId: string, @Param('pid', { schema: id }) pid: string) {
    return this.participation.reject(tripId, pid, u.userId);
  }

  @Post(':id/participants/:pid/remove')
  @HttpCode(200)
  remove(@CurrentUser() u: SessionUser, @Param('id', { schema: id }) tripId: string, @Param('pid', { schema: id }) pid: string) {
    return this.participation.remove(tripId, pid, u.userId);
  }

  @Post(':id/leave')
  @HttpCode(200)
  leave(@CurrentUser() u: SessionUser, @Param('id', { schema: id }) tripId: string) {
    return this.participation.leave(tripId, u.userId);
  }

  @Post(':id/close')
  @HttpCode(200)
  close(
    @CurrentUser() u: SessionUser,
    @Param('id', { schema: id }) tripId: string,
    @Body({ schema: closeTripSchema }) body: CloseTripInput,
  ) {
    return this.participation.close(tripId, u.userId, body.presentParticipantIds);
  }

  /** Chi posso segnalare per questo viaggio (lista vuota se nessuno o fuori termine). */
  @Get(':id/absence-reports/options')
  absenceOptions(@CurrentUser() u: SessionUser, @Param('id', { schema: id }) tripId: string) {
    return this.reports.options(tripId, u.userId);
  }

  @Post(':id/absence-reports')
  reportAbsence(
    @CurrentUser() u: SessionUser,
    @Param('id', { schema: id }) tripId: string,
    @Body({ schema: createAbsenceReportSchema }) body: CreateAbsenceReportInput,
  ) {
    return this.reports.create(tripId, u.userId, body.reportedUserId, body.reason);
  }

  @Post(':id/invitations')
  invite(
    @CurrentUser() u: SessionUser,
    @Param('id', { schema: id }) tripId: string,
    @Body({ schema: inviteUserSchema }) body: InviteUserInput,
  ) {
    return this.invitations.inviteUser(tripId, u.userId, body.userId);
  }

  @Post(':id/invitation-links')
  createLink(
    @CurrentUser() u: SessionUser,
    @Param('id', { schema: id }) tripId: string,
    @Body({ schema: createInviteLinkSchema }) body: CreateInviteLinkInput,
  ) {
    return this.invitations.createLink(tripId, u.userId, body.expiresInHours);
  }
}
