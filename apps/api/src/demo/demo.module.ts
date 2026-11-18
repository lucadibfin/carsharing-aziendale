import { Controller, Get, HttpCode, Inject, Module, Post, UseGuards } from '@nestjs/common';
import type { AppConfigDto } from '@fcs/shared';
import { AdminGuard, GlobalAdminOnly } from '../admin/admin.guard.js';
import { CurrentUser, Public } from '../auth/decorators.js';
import { MOCK_PASSWORD } from '../auth/mock-identity.provider.js';
import type { SessionUser } from '../auth/session.service.js';
import { NotFound } from '../common/errors.js';
import { PrismaService } from '../common/prisma.service.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DEMO_ACCOUNTS, DemoDataService } from './demo-data.service.js';

/** Endpoint pubblici di servizio: stato (health check della piattaforma) e configurazione per il frontend. */
@Controller()
export class SystemController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
  ) {}

  /** Health check: l'app risponde e il database è raggiungibile. Nessun dato. */
  @Public()
  @Get('health')
  async health(): Promise<{ ok: true }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  }

  @Public()
  @Get('config')
  config(): AppConfigDto {
    return this.env.DEMO_MODE
      ? { demo: true, demoAccounts: DEMO_ACCOUNTS, demoPassword: MOCK_PASSWORD }
      : { demo: false, demoAccounts: [], demoPassword: null };
  }
}

/** Ripristino della demo, solo per gli admin globali e solo in modalità demo. */
@UseGuards(AdminGuard)
@Controller('admin/demo')
export class DemoAdminController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly demo: DemoDataService,
  ) {}

  @GlobalAdminOnly()
  @Post('reset')
  @HttpCode(204)
  async reset(@CurrentUser() u: SessionUser): Promise<void> {
    if (!this.env.DEMO_MODE) throw NotFound('Funzione');
    await this.demo.resetByAdmin(u.userId);
  }
}

@Module({
  controllers: [SystemController, DemoAdminController],
  providers: [DemoDataService, AdminGuard],
  exports: [DemoDataService],
})
export class DemoModule {}
