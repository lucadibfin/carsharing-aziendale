import { Module } from '@nestjs/common';
import { JobQueue } from '../jobs/job-queue.js';
import { MailService } from './mail.service.js';
import { NotificationsService } from './notifications.service.js';
import { PushController } from './push.controller.js';
import { PushService } from './push.service.js';

@Module({
  controllers: [PushController],
  providers: [JobQueue, PushService, MailService, NotificationsService],
  exports: [JobQueue, NotificationsService, PushService, MailService],
})
export class NotificationsModule {}
