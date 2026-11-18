import { HttpStatus, Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { EMAIL_CODE_LENGTH, type EmailStatusDto } from '@fcs/shared';
import { Clock } from '../common/clock.js';
import { CryptoService } from '../common/crypto.service.js';
import { AppException } from '../common/errors.js';
import { PrismaService } from '../common/prisma.service.js';
import { JobQueue } from '../jobs/job-queue.js';
import { MailDeliveryError, MailService } from '../notifications/mail.service.js';
import { BRAND, ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import type { BrandConfig } from '@fcs/brand';

/** Validità del codice. */
export const EMAIL_CODE_TTL_MINUTES = 15;
/** Tentativi errati ammessi per ciascun codice; poi serve un nuovo codice. */
export const EMAIL_CODE_MAX_ATTEMPTS = 5;
/** Attesa minima tra due invii. */
export const EMAIL_RESEND_COOLDOWN_SECONDS = 60;
/** Invii massimi per utente in un'ora (evita di usare l'app per mandare email a terzi). */
export const EMAIL_MAX_SENDS_PER_HOUR = 5;

/**
 * Email per le notifiche, inserita dall'utente (anche personale) e verificata
 * con un codice inviato all'indirizzo stesso.
 * - Il nuovo indirizzo diventa effettivo solo dopo la conferma; fino ad allora
 *   resta in uso quello precedente.
 * - Indirizzi cifrati a riposo; del codice si salva solo l'HMAC.
 * - Non serve per il login e non è visibile ad altri utenti.
 */
@Injectable()
export class EmailVerificationService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly mail: MailService,
    private readonly clock: Clock,
    private readonly queue: JobQueue,
    @Inject(BRAND) private readonly brand: BrandConfig,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    // Le verifiche non completate (con l'indirizzo cifrato) si cancellano dopo 24 ore.
    this.queue.register('email-verification-retention', () => this.purgeStale().then(() => undefined));
    this.queue.schedule('email-verification-retention', '20 3 * * *');
  }

  async purgeStale(): Promise<number> {
    const cutoff = new Date(this.clock.now().getTime() - 24 * 3_600_000);
    const r = await this.prisma.emailVerification.deleteMany({ where: { lastSentAt: { lt: cutoff } } });
    return r.count;
  }

  async status(userId: string): Promise<EmailStatusDto> {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { emailEnc: true, emailVerifiedAt: true, emailVerification: true },
    });
    const now = this.clock.now();
    const v = u.emailVerification && u.emailVerification.expiresAt > now ? u.emailVerification : null;
    return {
      email: this.crypto.decryptNullable(u.emailEnc),
      verifiedAt: u.emailVerifiedAt?.toISOString() ?? null,
      pendingEmail: v ? this.crypto.decrypt(v.emailEnc) : null,
      pendingExpiresAt: v?.expiresAt.toISOString() ?? null,
      resendAvailableAt: u.emailVerification ? this.nextSendAt(u.emailVerification, now)?.toISOString() ?? null : null,
    };
  }

  /** Genera un nuovo codice e lo invia al nuovo indirizzo. */
  async requestCode(userId: string, email: string): Promise<EmailStatusDto> {
    const now = this.clock.now();
    const existing = await this.prisma.emailVerification.findUnique({ where: { userId } });
    if (existing) {
      const next = this.nextSendAt(existing, now);
      if (next) {
        throw new AppException(
          'EMAIL_CODE_RATE_LIMIT',
          `Hai già richiesto un codice da poco: riprova tra ${minutesLabel(next.getTime() - now.getTime())}`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const code = String(randomInt(0, 10 ** EMAIL_CODE_LENGTH)).padStart(EMAIL_CODE_LENGTH, '0');
    const sameWindow = existing && now.getTime() - existing.windowStart.getTime() < 3_600_000;
    const data = {
      emailEnc: this.crypto.encrypt(email),
      codeHash: this.codeHash(userId, code),
      expiresAt: new Date(now.getTime() + EMAIL_CODE_TTL_MINUTES * 60_000),
      attempts: 0,
      sendCount: sameWindow ? existing.sendCount + 1 : 1,
      windowStart: sameWindow ? existing.windowStart : now,
      lastSentAt: now,
    };
    await this.prisma.emailVerification.upsert({ where: { userId }, create: { userId, ...data }, update: data });

    // Demo pubblica: nessuna email viene inviata, il codice compare a schermo.
    if (this.env.DEMO_MODE) return { ...(await this.status(userId)), demoCode: code };

    try {
      await this.mail.send({
        to: email,
        subject: 'Codice di verifica',
        text:
          `Il tuo codice per confermare questo indirizzo nell'app ${this.brand.appName} è: ${code}\n\n` +
          `Il codice scade tra ${EMAIL_CODE_TTL_MINUTES} minuti.\n` +
          `L'indirizzo sarà usato solo per le notifiche dell'app.\n` +
          `Se non hai richiesto tu il codice, ignora questo messaggio.`,
      });
    } catch (e) {
      if (e instanceof MailDeliveryError) {
        // L'invio è fallito: il tentativo non conta nel limite.
        await this.prisma.emailVerification.update({
          where: { userId },
          data: { lastSentAt: new Date(0), sendCount: Math.max(0, data.sendCount - 1), expiresAt: now },
        });
        throw new AppException('EMAIL_SEND_FAILED', 'Non è stato possibile inviare l’email: riprova più tardi', HttpStatus.SERVICE_UNAVAILABLE);
      }
      throw e;
    }
    return this.status(userId);
  }

  /** Verifica il codice: se corretto, il nuovo indirizzo sostituisce il precedente. */
  async confirm(userId: string, code: string): Promise<EmailStatusDto> {
    const now = this.clock.now();
    const ok = await this.prisma.$transaction(async (tx) => {
      const [v] = await tx.$queryRaw<{ codeHash: string; expiresAt: Date; attempts: number; emailEnc: string }[]>`
        SELECT "codeHash", "expiresAt", attempts, "emailEnc" FROM "EmailVerification" WHERE "userId" = ${userId}::uuid FOR UPDATE`;
      if (!v || v.expiresAt <= now) {
        throw new AppException('EMAIL_CODE_EXPIRED', 'Il codice è scaduto o non è stato richiesto: chiedine uno nuovo');
      }
      if (v.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
        throw new AppException('EMAIL_CODE_TOO_MANY_ATTEMPTS', 'Troppi tentativi errati: chiedi un nuovo codice');
      }
      if (!this.crypto.safeEqual(v.codeHash, this.codeHash(userId, code))) {
        await tx.emailVerification.update({ where: { userId }, data: { attempts: { increment: 1 } } });
        return false;
      }
      await tx.user.update({ where: { id: userId }, data: { emailEnc: v.emailEnc, emailVerifiedAt: now } });
      await tx.emailVerification.delete({ where: { userId } });
      return true;
    });
    if (!ok) throw new AppException('EMAIL_CODE_INVALID', 'Codice non corretto');
    return this.status(userId);
  }

  /** Annulla un cambio in corso (l'indirizzo attuale resta invariato). */
  async cancelPending(userId: string): Promise<EmailStatusDto> {
    await this.prisma.emailVerification.deleteMany({ where: { userId } });
    return this.status(userId);
  }

  /** Indirizzo verificato per l'invio delle notifiche (null se assente). */
  async verifiedAddress(userId: string): Promise<string | null> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { emailEnc: true, emailVerifiedAt: true } });
    return u?.emailVerifiedAt ? this.crypto.decryptNullable(u.emailEnc) : null;
  }

  private codeHash(userId: string, code: string): string {
    return this.crypto.hmac(`email-code:${userId}:${code}`);
  }

  /** null se si può inviare subito, altrimenti il momento da cui si potrà. */
  private nextSendAt(v: { lastSentAt: Date; sendCount: number; windowStart: Date }, now: Date): Date | null {
    const cooldownEnd = new Date(v.lastSentAt.getTime() + EMAIL_RESEND_COOLDOWN_SECONDS * 1000);
    const windowEnd = new Date(v.windowStart.getTime() + 3_600_000);
    const candidates: Date[] = [];
    if (cooldownEnd > now) candidates.push(cooldownEnd);
    if (v.sendCount >= EMAIL_MAX_SENDS_PER_HOUR && windowEnd > now) candidates.push(windowEnd);
    return candidates.length ? new Date(Math.max(...candidates.map((d) => d.getTime()))) : null;
  }
}

function minutesLabel(ms: number): string {
  const m = Math.ceil(ms / 60_000);
  return m <= 1 ? 'un minuto' : `${m} minuti`;
}
