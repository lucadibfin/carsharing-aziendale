import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import type { BrandConfig } from '@fcs/brand';
import { BRAND, ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

export class MailDeliveryError extends Error {
  override readonly name = 'MailDeliveryError';
}

export interface MailMessage {
  to: string;
  /** Oggetto senza prefisso: il nome breve del marchio viene aggiunto all'invio. */
  subject: string;
  /** Corpo senza firma: la firma del marchio viene aggiunta all'invio. */
  text: string;
}

/**
 * Invio email. Trasporti (MAIL_TRANSPORT):
 * - smtp: SMTP aziendale (unico ammesso in produzione);
 * - outbox: solo sviluppo/e2e, le email vengono scritte come file JSON in
 *   MAIL_OUTBOX_DIR invece di essere spedite;
 * - disabled: nessun invio (test automatici).
 * Gli indirizzi non compaiono mai nei log.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  private readonly smtp: Transporter | null;
  private readonly outboxDir: string;

  /** Mittente: nome del marchio + indirizzo da MAIL_FROM. */
  private readonly from: string;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(BRAND) private readonly brand: BrandConfig,
  ) {
    this.from = `"${brand.email.senderName.replace(/["\\]/g, '')}" <${env.MAIL_FROM}>`;
    this.smtp =
      env.MAIL_TRANSPORT === 'smtp'
        ? nodemailer.createTransport({
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            secure: env.SMTP_SECURE,
            requireTLS: env.NODE_ENV === 'production',
            auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
          })
        : null;
    this.outboxDir = resolve(env.MAIL_OUTBOX_DIR);
  }

  get enabled(): boolean {
    return this.env.MAIL_TRANSPORT !== 'disabled';
  }

  /** Invia e segnala l'errore al chiamante (es. codice di verifica: l'utente deve saperlo). */
  async send(msg: MailMessage): Promise<void> {
    try {
      await this.deliver(this.compose(msg));
    } catch (e) {
      this.logger.warn({ errName: e instanceof Error ? e.name : 'unknown' }, 'invio email non riuscito');
      throw new MailDeliveryError('invio non riuscito');
    }
  }

  /** Invio "best effort" per le notifiche: un errore non deve bloccare il resto. */
  async trySend(msg: MailMessage): Promise<void> {
    try {
      await this.send(msg);
    } catch {
      /* già registrato */
    }
  }

  /** Oggetto preceduto dal nome breve del marchio, firma del marchio in fondo al testo. */
  compose(msg: MailMessage): MailMessage {
    const signature = this.brand.email.signature ? `\n\n-- \n${this.brand.email.signature}` : '';
    return { to: msg.to, subject: `${this.brand.shortName} – ${msg.subject}`, text: msg.text + signature };
  }

  /** Separato per poterlo sostituire nei test. Riceve il messaggio già composto. */
  async deliver(msg: MailMessage): Promise<void> {
    switch (this.env.MAIL_TRANSPORT) {
      case 'smtp':
        await this.smtp!.sendMail({ from: this.from, to: msg.to, subject: msg.subject, text: msg.text });
        return;
      case 'outbox': {
        await mkdir(this.outboxDir, { recursive: true });
        const name = `${Date.now()}-${randomBytes(4).toString('hex')}.json`;
        await writeFile(resolve(this.outboxDir, name), JSON.stringify({ date: new Date().toISOString(), from: this.from, ...msg }, null, 2));
        this.logger.log({ file: name }, 'email scritta nella outbox di sviluppo');
        return;
      }
      case 'disabled':
        return;
    }
  }
}
