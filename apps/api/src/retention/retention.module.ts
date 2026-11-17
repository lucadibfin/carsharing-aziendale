import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { RetentionService } from './retention.service.js';

@Module({
  imports: [NotificationsModule],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
