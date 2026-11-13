import { Inject, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

/**
 * Cifratura applicativa dei dati sensibili a riposo (AES-256-GCM) con chiavi
 * versionate per la rotazione, HMAC per pseudonimizzare gli identificativi
 * (log, contatori anti brute-force) e generazione di token casuali.
 */
@Injectable()
export class CryptoService {
  private readonly keys = new Map<number, Buffer>();
  private readonly currentVersion: number;
  private readonly hmacKey: Buffer;

  constructor(@Inject(ENV) env: Env) {
    for (const part of env.DATA_ENCRYPTION_KEYS.split(',')) {
      const [ver, key] = part.split(':');
      this.keys.set(Number(ver), Buffer.from(key!, 'base64'));
    }
    this.currentVersion = Math.max(...this.keys.keys());
    this.hmacKey = Buffer.from(env.HMAC_KEY, 'base64');
  }

  /** Formato: v<versione>.<iv>.<tag>.<ciphertext> (base64url). */
  encrypt(plain: string): string {
    const key = this.keys.get(this.currentVersion)!;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v' + this.currentVersion, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
  }

  decrypt(payload: string): string {
    const [v, iv, tag, ct] = payload.split('.');
    const key = this.keys.get(Number(v?.slice(1)));
    if (!key || !iv || !tag || ct === undefined) throw new Error('Payload cifrato non valido');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
  }

  encryptNullable(plain: string | null | undefined): string | null {
    return plain == null || plain === '' ? null : this.encrypt(plain);
  }

  decryptNullable(payload: string | null | undefined): string | null {
    return payload ? this.decrypt(payload) : null;
  }

  /** Pseudonimo stabile e non reversibile (senza la chiave) di un identificativo. */
  hmac(value: string): string {
    return createHmac('sha256', this.hmacKey).update(value).digest('base64url');
  }

  /** Token casuale URL-safe (default 32 byte → 43 caratteri). */
  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  /** Hash per token ad alta entropia (sessioni, link d'invito): non serve salt. */
  sha256(value: string): string {
    return createHash('sha256').update(value).digest('base64url');
  }

  safeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  }
}
