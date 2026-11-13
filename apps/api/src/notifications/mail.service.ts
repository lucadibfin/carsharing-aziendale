import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

/** Email via SMTP aziendale. Senza SMTP_HOST l'invio è disattivato. */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  private readonly transport: Transporter | null;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.transport = env.SMTP_HOST
      ? nodemailer.createTransport({
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          secure: env.SMTP_SECURE,
          requireTLS: env.NODE_ENV === 'production',
          auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
        })
      : null;
  }

  /** Indirizzo aziendale derivato dallo username (l'API di identità non fornisce l'email). */
  addressFor(username: string): string {
    const local = username.includes('@') ? username.split('@')[0] : username.split('\\').pop();
    return `${local}@${this.env.MAIL_DOMAIN}`;
  }

  async send(username: string, subject: string, text: string): Promise<void> {
    if (!this.transport) return;
    try {
      await this.transport.sendMail({ from: this.env.MAIL_FROM, to: this.addressFor(username), subject, text });
    } catch (e) {
      // Nessun indirizzo nei log.
      this.logger.warn({ errName: e instanceof Error ? e.name : 'unknown' }, 'invio email non riuscito');
    }
  }
}
