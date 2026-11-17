import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../common/prisma.service.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { JobQueue } from '../jobs/job-queue.js';
import { UserLifecycleService } from '../users/user-lifecycle.service.js';
import { IDENTITY_PROVIDER, type IdentityProvider } from './identity-provider.js';

export interface EmployeeCheckResult {
  checked: number;
  inactive: number;
  deactivated: number;
  errors: number;
  aborted: boolean;
}

/** Freno di sicurezza: oltre questa quota di "non attivi" in una notte si sospetta un guasto dell'API. */
const MAX_INACTIVE_SHARE = 0.1;
const MAX_INACTIVE_ALWAYS_OK = 5;

/**
 * Verifica notturna dei dipendenti usciti (EMPLOYEE_CHECK_MODE = nightly | both),
 * se il sistema di identità espone la verifica per username senza password.
 * - Un errore su un singolo utente non lo disattiva mai (si riprova la notte dopo).
 * - Se troppi utenti risultano non attivi nella stessa notte (es. API guasta o
 *   configurata male) non si disattiva nessuno e si registra l'anomalia.
 */
@Injectable()
export class EmployeeCheckService implements OnModuleInit {
  private readonly logger = new Logger('EmployeeCheck');

  constructor(
    @Inject(IDENTITY_PROVIDER) private readonly idp: IdentityProvider,
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly lifecycle: UserLifecycleService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly queue: JobQueue,
  ) {}

  get enabled(): boolean {
    return this.env.EMPLOYEE_CHECK_MODE !== 'session-expiry' && typeof this.idp.checkActive === 'function';
  }

  onModuleInit(): void {
    if (this.env.EMPLOYEE_CHECK_MODE !== 'session-expiry' && !this.idp.checkActive) {
      this.logger.warn('EMPLOYEE_CHECK_MODE richiede la verifica notturna, ma il sistema di identità non la supporta');
    }
    if (!this.enabled) return;
    this.queue.register('employee-check', () => this.run().then(() => undefined));
    this.queue.schedule('employee-check', '30 2 * * *');
  }

  async run(): Promise<EmployeeCheckResult> {
    const result: EmployeeCheckResult = { checked: 0, inactive: 0, deactivated: 0, errors: 0, aborted: false };
    if (!this.enabled) return result;
    const users = await this.prisma.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true, username: true } });
    const inactive: string[] = [];
    const confirmed: string[] = [];
    for (const u of users) {
      try {
        if (await this.idp.checkActive!(u.username)) confirmed.push(u.id);
        else inactive.push(u.username);
        result.checked++;
      } catch {
        result.errors++;
      }
    }
    result.inactive = inactive.length;
    if (confirmed.length) {
      await this.prisma.user.updateMany({ where: { id: { in: confirmed } }, data: { lastVerifiedAt: this.clock.now() } });
    }
    if (inactive.length > Math.max(MAX_INACTIVE_ALWAYS_OK, Math.ceil(result.checked * MAX_INACTIVE_SHARE))) {
      result.aborted = true;
      this.logger.error({ inactive: inactive.length, checked: result.checked }, 'troppi utenti non attivi: disattivazioni sospese, verificare il sistema di identità');
    } else {
      for (const username of inactive) {
        await this.lifecycle.handleNoLongerActive(username);
        result.deactivated++;
      }
    }
    await this.audit.record({ actorId: null, action: 'EMPLOYEE_CHECK_RUN', meta: { ...result } });
    return result;
  }
}
