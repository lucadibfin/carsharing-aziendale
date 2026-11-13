import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { id, inviteTokenSchema, istatCode, respondInvitationSchema, type RespondInvitationInput, userSearchSchema } from '@fcs/shared';
import { CurrentUser } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session.service.js';
import { InvitationsService } from './invitations.service.js';

const linkSchema = z.object({ token: inviteTokenSchema });
const linkAcceptSchema = z.object({ token: inviteTokenSchema, boardingComune: istatCode });

@Controller()
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get('users/search')
  searchUsers(@CurrentUser() u: SessionUser, @Query({ schema: userSearchSchema }) q: { q: string }) {
    return this.invitations.searchUsers(u.userId, q.q);
  }

  @Delete('invitations/:id')
  @HttpCode(204)
  async revoke(@CurrentUser() u: SessionUser, @Param('id', { schema: id }) invId: string): Promise<void> {
    await this.invitations.revoke(invId, u.userId);
  }

  @Post('invitations/:id/accept')
  @HttpCode(200)
  accept(
    @CurrentUser() u: SessionUser,
    @Param('id', { schema: id }) invId: string,
    @Body({ schema: respondInvitationSchema }) body: RespondInvitationInput,
  ) {
    return this.invitations.accept(invId, u.userId, body.boardingComune);
  }

  @Post('invitations/:id/decline')
  @HttpCode(204)
  async decline(@CurrentUser() u: SessionUser, @Param('id', { schema: id }) invId: string): Promise<void> {
    await this.invitations.decline(invId, u.userId);
  }

  // Il token del link viaggia nel corpo (POST), mai nell'URL: così non finisce nei log.
  @Post('invitation-links/preview')
  @HttpCode(200)
  preview(@CurrentUser() u: SessionUser, @Body({ schema: linkSchema }) body: { token: string }) {
    return this.invitations.previewLink(body.token, u.userId);
  }

  @Post('invitation-links/accept')
  @HttpCode(200)
  acceptLink(
    @CurrentUser() u: SessionUser,
    @Body({ schema: linkAcceptSchema }) body: { token: string; boardingComune: string },
  ) {
    return this.invitations.acceptLink(body.token, u.userId, body.boardingComune);
  }
}
