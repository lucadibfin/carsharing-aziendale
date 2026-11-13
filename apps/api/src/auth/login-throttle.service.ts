import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { Clock } from '../common/clock.js';
import { CryptoService } from '../common/crypto.service.js';
import { PrismaService } from '../common/prisma.service.js';

/**
 * Protezione anti brute-force, applicata PRIMA di contattare il sistema di
 * identità: oltre la soglia, la richiesta non arriva mai ad Active Directory.
 * In questo modo nessuno può far bloccare l'account AD di un collega
 * tentando password a caso dall'app.
 *
 * Il blocco è sempre TEMPORANEO e si toglie da solo, senza intervento di un admin:
 * - dopo LOGIN_MAX_FAILURES_PER_USER errori (default 3) lo username è bloccato
 *   per LOGIN_LOCK_MINUTES (default 15);
 * - scaduto il blocco si può riprovare. Se si sbaglia ancora prima che il
 *   contatore sia azzerato, si viene bloccati di nuovo per lo stesso tempo:
 *   in questo modo l'app inoltra ad AD al massimo un tentativo ogni 15 minuti
 *   e non può causare il blocco dell'account AD;
 * - il contatore si azzera con un login riuscito oppure dopo
 *   LOGIN_FAILURES_RESET_HOURS (default 24) ore senza errori;
 * - facoltativo: con LOGIN_LOCK_MAX_MINUTES > LOGIN_LOCK_MINUTES il blocco
 *   raddoppia a ogni ulteriore errore fino a quel massimo (backoff progressivo).
 * Per IP (LOGIN_MAX_FAILURES_PER_IP, default 20) vale la stessa logica, contro
 * attacchi distribuiti su molti username.
 *
 * Le chiavi sono HMAC: nel DB non compaiono né username né indirizzi IP.
 */
@Injectable()
export class LoginThrottleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  userKey(username: string): string {
    return 'u:' + this.crypto.hmac(username);
  }

  ipKey(ip: string): string {
    return 'ip:' + this.crypto.hmac(ip);
  }

  /** true se almeno una delle chiavi è bloccata in questo momento. */
  async isLocked(keys: string[]): Promise<boolean> {
    const now = this.clock.now();
    const rows = await this.prisma.loginThrottle.findMany({ where: { key: { in: keys } } });
    return rows.some((r) => r.lockedUntil && r.lockedUntil > now);
  }

  async registerFailure(username: string, ip: string): Promise<void> {
    const now = this.clock.now();
    await this.bump(this.userKey(username), this.env.LOGIN_MAX_FAILURES_PER_USER, now);
    await this.bump(this.ipKey(ip), this.env.LOGIN_MAX_FAILURES_PER_IP, now);
  }

  /** Dopo un login riuscito si azzera il contatore dello username (non quello dell'IP). */
  async registerSuccess(username: string): Promise<void> {
    await this.prisma.loginThrottle.deleteMany({ where: { key: this.userKey(username) } });
  }

  private async bump(key: string, max: number, now: Date): Promise<void> {
    const lockMs = this.env.LOGIN_LOCK_MINUTES * 60_000;
    const maxLockMs = Math.max(this.env.LOGIN_LOCK_MAX_MINUTES * 60_000, lockMs);
    const resetAfterMs = this.env.LOGIN_FAILURES_RESET_HOURS * 3_600_000;
    await this.prisma.$transaction(async (tx) => {
      // Lock della riga per contare correttamente anche tentativi concorrenti.
      await tx.$executeRaw`INSERT INTO "LoginThrottle" (key, failures, "windowStart", "updatedAt")
        VALUES (${key}, 0, ${now}, ${now}) ON CONFLICT (key) DO NOTHING`;
      const [row] = await tx.$queryRaw<{ failures: number; updatedAt: Date }[]>`
        SELECT failures, "updatedAt" FROM "LoginThrottle" WHERE key = ${key} FOR UPDATE`;
      const stale = row!.failures > 0 && now.getTime() - row!.updatedAt.getTime() > resetAfterMs;
      const failures = (stale ? 0 : row!.failures) + 1;
      const lockedUntil =
        failures >= max ? new Date(now.getTime() + Math.min(lockMs * 2 ** (failures - max), maxLockMs)) : null;
      await tx.loginThrottle.update({
        where: { key },
        data: { failures, lockedUntil, updatedAt: now, ...(stale ? { windowStart: now } : {}) },
      });
    });
  }
}
