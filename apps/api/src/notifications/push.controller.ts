import { Body, Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import { pushSubscriptionSchema, type PushSubscriptionInput } from '@fcs/shared';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session.service.js';
import { PushService } from './push.service.js';

@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('public-key')
  publicKey(): { publicKey: string; enabled: boolean } {
    return { publicKey: this.push.publicKey, enabled: this.push.enabled };
  }

  @Post('subscriptions')
  @HttpCode(204)
  async subscribe(
    @CurrentUser() user: SessionUser,
    @Body({ schema: pushSubscriptionSchema }) body: PushSubscriptionInput,
  ): Promise<void> {
    await this.push.subscribe(user.userId, body);
  }

  @Delete('subscriptions')
  @HttpCode(204)
  async unsubscribe(
    @CurrentUser() user: SessionUser,
    @Body('endpoint', { schema: z.url() }) endpoint: string,
  ): Promise<void> {
    await this.push.unsubscribe(user.userId, endpoint);
  }
}
