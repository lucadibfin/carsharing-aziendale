import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { CryptoService } from '../common/crypto.service.js';
import { PrismaService } from '../common/prisma.service.js';

/** I fallimenti si azzerano dopo 24 ore senza nuovi errori. */
const RESET_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_LOCK_MS = 24 * 60 * 60 * 1000;

/**
 * Protezione anti brute-force, applicata PRIMA di contattare il sistema di
 * identità: oltre la soglia, la richiesta non arriva mai ad Active Directory.
 * In questo modo nessuno può far bloccare l'account AD di un collega
 * tentando password a caso dall'app.
 *
 * Per username (default 3 errori): blocco di LOGIN_WINDOW_MINUTES, che
 * raddoppia a ogni ulteriore errore (15, 30, 60… minuti, max 24 h).
 * Esempio con i default e una policy AD di 5 tentativi in 30 minuti: in 30
 * minuti l'app inoltra al massimo 3 + 1 = 4 tentativi.
 * Per IP (default 20 errori): stessa logica, contro attacchi su molti username.
 *
 * Le chiavi sono HMAC: nel DB non compaiono né username né indirizzi IP.
 */
@Injectable()
export class LoginThrottleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  userKey(username: string): string {
    return 'u:' + this.crypto.hmac(username);
  }

  ipKey(ip: string): string {
    return 'ip:' + this.crypto.hmac(ip);
  }

  /** true se almeno una delle chiavi è bloccata in questo momento. */
  async isLocked(keys: string[], now = new Date()): Promise<boolean> {
    const rows = await this.prisma.loginThrottle.findMany({ where: { key: { in: keys } } });
    return rows.some((r) => r.lockedUntil && r.lockedUntil > now);
  }

  async registerFailure(username: string, ip: string, now = new Date()): Promise<void> {
    await this.bump(this.userKey(username), this.env.LOGIN_MAX_FAILURES_PER_USER, now);
    await this.bump(this.ipKey(ip), this.env.LOGIN_MAX_FAILURES_PER_IP, now);
  }

  /** Dopo un login riuscito si azzera il contatore dello username (non quello dell'IP). */
  async registerSuccess(username: string): Promise<void> {
    await this.prisma.loginThrottle.deleteMany({ where: { key: this.userKey(username) } });
  }

  private async bump(key: string, max: number, now: Date): Promise<void> {
    const windowMs = this.env.LOGIN_WINDOW_MINUTES * 60_000;
    await this.prisma.$transaction(async (tx) => {
      // Lock della riga per contare correttamente anche tentativi concorrenti.
      await tx.$executeRaw`INSERT INTO "LoginThrottle" (key, failures, "windowStart", "updatedAt")
        VALUES (${key}, 0, ${now}, ${now}) ON CONFLICT (key) DO NOTHING`;
      const [row] = await tx.$queryRaw<{ failures: number; updatedAt: Date }[]>`
        SELECT failures, "updatedAt" FROM "LoginThrottle" WHERE key = ${key} FOR UPDATE`;
      const stale = row!.failures > 0 && now.getTime() - row!.updatedAt.getTime() > RESET_AFTER_MS;
      const failures = (stale ? 0 : row!.failures) + 1;
      const lockedUntil =
        failures >= max ? new Date(now.getTime() + Math.min(windowMs * 2 ** (failures - max), MAX_LOCK_MS)) : null;
      await tx.loginThrottle.update({
        where: { key },
        data: { failures, lockedUntil, updatedAt: now, ...(stale ? { windowStart: now } : {}) },
      });
    });
  }
}
