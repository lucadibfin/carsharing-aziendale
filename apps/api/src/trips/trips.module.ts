import { Module } from '@nestjs/common';
import { FavoritesModule } from '../favorites/favorites.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AbsenceReportsService } from './absence-reports.service.js';
import { ChatMembershipEvents } from './chat-membership.events.js';
import { InvitationsController } from './invitations.controller.js';
import { InvitationsService } from './invitations.service.js';
import { ParticipationService } from './participation.service.js';
import { TripAccessPolicy } from './trip-access.policy.js';
import { TripMapper } from './trip-mapper.js';
import { TripsController } from './trips.controller.js';
import { TripsService } from './trips.service.js';

@Module({
  imports: [NotificationsModule, FavoritesModule],
  controllers: [TripsController, InvitationsController],
  providers: [
    TripAccessPolicy, TripMapper, TripsService, ParticipationService, InvitationsService, ChatMembershipEvents, AbsenceReportsService,
  ],
  exports: [TripAccessPolicy, TripsService, ChatMembershipEvents, AbsenceReportsService],
})
export class TripsModule {}
