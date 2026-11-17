import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { LoginInput } from '@fcs/shared';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { AppException } from '../common/errors.js';
import { Clock } from '../common/clock.js';
import { CryptoService } from '../common/crypto.service.js';
import { PrismaService } from '../common/prisma.service.js';
import { UserLifecycleService } from '../users/user-lifecycle.service.js';
import {
  IDENTITY_PROVIDER,
  type IdentityProvider,
  IdentityProviderUnavailableError,
  InvalidCredentialsError,
} from './identity-provider.js';
import { LoginThrottleService } from './login-throttle.service.js';
import { SessionService } from './session.service.js';

const GENERIC_FAIL = 'Credenziali non valide oppure utente non abilitato';

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');

  constructor(
    @Inject(IDENTITY_PROVIDER) private readonly idp: IdentityProvider,
    @Inject(ENV) private readonly env: Env,
    private readonly throttle: LoginThrottleService,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly lifecycle: UserLifecycleService,
    private readonly clock: Clock,
  ) {}

  /**
   * Verifica le credenziali e apre una sessione applicativa.
   * La password vive solo dentro questa funzione: non viene salvata, loggata,
   * inclusa in errori, né passata ad altro che all'adapter del sistema di identità.
   */
  async login(input: LoginInput, ip: string): Promise<{ token: string; expiresAt: Date; userId: string }> {
    const started = Date.now();
    const { username } = input;
    const userPseudo = this.crypto.hmac(username).slice(0, 12);

    try {
      // 1. Blocco anti brute-force PRIMA di contattare AD.
      if (await this.throttle.isLocked([this.throttle.userKey(username), this.throttle.ipKey(ip)])) {
        this.logger.warn({ user: userPseudo }, 'login bloccato da throttling');
        throw new AppException(
          'TOO_MANY_ATTEMPTS',
          'Troppi tentativi non riusciti. Riprova più tardi.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // 2. Verifica presso il sistema di identità aziendale.
      let identity;
      try {
        identity = await this.idp.authenticate(username, input.password);
      } catch (e) {
        if (e instanceof InvalidCredentialsError) {
          await this.throttle.registerFailure(username, ip);
          this.logger.warn({ user: userPseudo }, 'login fallito');
          throw new AppException('INVALID_CREDENTIALS', GENERIC_FAIL, HttpStatus.UNAUTHORIZED);
        }
        if (e instanceof IdentityProviderUnavailableError) {
          this.logger.error({ reason: e.message }, 'sistema di identità non disponibile');
          throw new AppException(
            'AUTH_UNAVAILABLE',
            'Servizio di autenticazione temporaneamente non disponibile. Riprova più tardi.',
            HttpStatus.SERVICE_UNAVAILABLE,
          );
        }
        // Errore imprevisto: non si propaga nulla dell'originale.
        this.logger.error({ errName: e instanceof Error ? e.name : 'unknown' }, 'errore imprevisto nel login');
        throw new AppException('AUTH_UNAVAILABLE', 'Servizio di autenticazione non disponibile', HttpStatus.SERVICE_UNAVAILABLE);
      }

      // 3. Dipendente non più attivo: accesso negato e avvio della disattivazione.
      if (!identity.active) {
        await this.throttle.registerFailure(username, ip);
        await this.lifecycle.handleNoLongerActive(username);
        this.logger.warn({ user: userPseudo }, 'login negato: dipendente non attivo');
        throw new AppException('INVALID_CREDENTIALS', GENERIC_FAIL, HttpStatus.UNAUTHORIZED);
      }

      await this.throttle.registerSuccess(username);
      const user = await this.upsertUser(username, identity.firstName, identity.lastName);
      const session = await this.sessions.create(user.id);
      this.logger.log({ user: userPseudo }, 'login riuscito');
      return { ...session, userId: user.id };
    } catch (e) {
      // Tempo di risposta uniforme per gli esiti negativi (riduce le informazioni ricavabili dai tempi).
      const elapsed = Date.now() - started;
      if (elapsed < this.env.LOGIN_MIN_RESPONSE_MS) {
        await new Promise((r) => setTimeout(r, this.env.LOGIN_MIN_RESPONSE_MS - elapsed));
      }
      throw e;
    }
  }

  private async upsertUser(username: string, firstName: string, lastName: string) {
    const now = this.clock.now();
    const user = await this.prisma.user.upsert({
      where: { username },
      create: { username, firstName, lastName, lastLoginAt: now, lastVerifiedAt: now, consent: { create: {} } },
      // Nome e cognome provengono sempre dall'API e non sono modificabili dall'utente.
      update: { firstName, lastName, lastLoginAt: now, lastVerifiedAt: now, status: 'ACTIVE', deactivatedAt: null },
    });
    if (this.env.INITIAL_GLOBAL_ADMIN && username === this.env.INITIAL_GLOBAL_ADMIN) {
      const existing = await this.prisma.roleAssignment.findFirst({ where: { userId: user.id, role: 'GLOBAL_ADMIN' } });
      if (!existing) await this.prisma.roleAssignment.create({ data: { userId: user.id, role: 'GLOBAL_ADMIN' } });
    }
    return user;
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
  }
}
