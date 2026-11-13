import { Controller, Get, Global, Module } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session.service.js';
import { RoutingService } from './routing.service.js';
import { StatsService } from './stats.service.js';

@Controller('stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  /** Statistiche personali: solo i propri dati. */
  @Get('me')
  me(@CurrentUser() u: SessionUser) {
    return this.stats.personal(u.userId);
  }
}

@Global()
@Module({
  controllers: [StatsController],
  providers: [RoutingService, StatsService],
  exports: [RoutingService, StatsService],
})
export class StatsModule {}
