import { Module } from '@nestjs/common';
import { PoliciesModule } from '../policies/policies.module.js';
import { TripsModule } from '../trips/trips.module.js';
import { AdminConfigService } from './admin-config.service.js';
import { AdminTripsService } from './admin-trips.service.js';
import { AdminController } from './admin.controller.js';
import { AdminGuard } from './admin.guard.js';

@Module({
  imports: [TripsModule, PoliciesModule],
  controllers: [AdminController],
  providers: [AdminGuard, AdminTripsService, AdminConfigService],
})
export class AdminModule {}
