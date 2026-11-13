import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { TripsModule } from '../trips/trips.module.js';
import { ReferenceController } from './reference.controller.js';
import { EmailVerificationService } from './email-verification.service.js';
import { UserLifecycleService } from './user-lifecycle.service.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [TripsModule, NotificationsModule],
  controllers: [UsersController, ReferenceController],
  providers: [UsersService, UserLifecycleService, EmailVerificationService],
  exports: [UserLifecycleService],
})
export class UsersModule {}
