import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AdminModule } from './admin/admin.module.js';
import { AuthModule } from './auth/auth.module.js';
import { OnboardingGuard, SessionGuard } from './auth/guards.js';
import { ChatModule } from './chat/chat.module.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { CommonModule } from './common/common.module.js';
import { ConfigModule } from './config/config.module.js';
import { loadEnv } from './config/env.js';
import { loggerOptions } from './logging.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { PoliciesModule } from './policies/policies.module.js';
import { RetentionModule } from './retention/retention.module.js';
import { StatsModule } from './stats/stats.module.js';
import { TripsModule } from './trips/trips.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({ useFactory: () => loggerOptions(loadEnv()) }),
    CommonModule,
    StatsModule,
    PoliciesModule,
    NotificationsModule,
    AuthModule,
    UsersModule,
    TripsModule,
    ChatModule,
    AdminModule,
    RetentionModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Ordine: prima l'autenticazione, poi il controllo dell'onboarding.
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: OnboardingGuard },
  ],
})
export class AppModule {}
