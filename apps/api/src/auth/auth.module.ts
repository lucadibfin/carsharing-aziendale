import { Global, Module } from '@nestjs/common';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { CorporateIdentityProvider } from './corporate-identity.provider.js';
import { EmployeeCheckService } from './employee-check.service.js';
import { IDENTITY_PROVIDER } from './identity-provider.js';
import { LoginThrottleService } from './login-throttle.service.js';
import { MockIdentityProvider } from './mock-identity.provider.js';
import { SessionService } from './session.service.js';

/**
 * Modulo di autenticazione, sostituibile: un futuro modulo OIDC dovrà solo
 * creare la sessione con SessionService.create(). Il resto dell'app dipende
 * esclusivamente da SessionGuard e @CurrentUser().
 */
@Global()
@Module({
  imports: [UsersModule, NotificationsModule],
  controllers: [AuthController],
  providers: [
    SessionService,
    LoginThrottleService,
    AuthService,
    EmployeeCheckService,
    {
      provide: IDENTITY_PROVIDER,
      inject: [ENV],
      // In modalità demo l'integrazione aziendale non è mai attiva, qualunque sia la configurazione.
      useFactory: (env: Env) =>
        env.AUTH_PROVIDER === 'corporate' && !env.DEMO_MODE ? new CorporateIdentityProvider(env) : new MockIdentityProvider(),
    },
  ],
  exports: [SessionService, IDENTITY_PROVIDER],
})
export class AuthModule {}
