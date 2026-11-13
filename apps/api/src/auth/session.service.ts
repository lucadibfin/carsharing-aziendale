import { Inject, Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { CryptoService } from '../common/crypto.service.js';
import { PrismaService } from '../common/prisma.service.js';
import type { UserStatus } from '../generated/prisma/client.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Aggiorna lastSeenAt al massimo ogni 5 minuti per evitare scritture continue. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface SessionUser {
  sessionId: string;
  userId: string;
  status: UserStatus;
}

/**
 * Sessione applicativa lato server. Il cookie contiene solo un token casuale;
 * nel DB si conserva il suo hash. Revoca immediata (logout, disattivazione).
 * Durata massima assoluta configurabile (SESSION_MAX_DAYS): scaduta, serve un
 * nuovo login, che riverifica il dipendente presso il sistema aziendale.
 */
@Injectable()
export class SessionService {
  readonly cookieName: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @Inject(ENV) private readonly env: Env,
  ) {
    // Il prefisso __Host- richiede HTTPS: in sviluppo locale (http) si usa un nome semplice.
    this.cookieName = this.secure ? '__Host-sid' : 'sid';
  }

  get secure(): boolean {
    return this.env.APP_ORIGIN.startsWith('https://');
  }

  async create(userId: string, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
    const token = this.crypto.randomToken();
    const absoluteExpiresAt = new Date(now.getTime() + this.env.SESSION_MAX_DAYS * DAY_MS);
    await this.prisma.session.create({
      data: {
        tokenHash: this.crypto.sha256(token),
        userId,
        absoluteExpiresAt,
        idleExpiresAt: this.idleExpiry(now, absoluteExpiresAt),
        createdAt: now,
        lastSeenAt: now,
      },
    });
    return { token, expiresAt: absoluteExpiresAt };
  }

  async validate(token: string | undefined, now = new Date()): Promise<SessionUser | null> {
    if (!token || token.length > 100) return null;
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: this.crypto.sha256(token) },
      include: { user: { select: { status: true } } },
    });
    if (!session) return null;
    if (session.absoluteExpiresAt <= now || session.idleExpiresAt <= now || session.user.status !== 'ACTIVE') {
      await this.prisma.session.deleteMany({ where: { id: session.id } });
      return null;
    }
    if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { lastSeenAt: now, idleExpiresAt: this.idleExpiry(now, session.absoluteExpiresAt) },
      });
    }
    return { sessionId: session.id, userId: session.userId, status: session.user.status };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { userId } });
  }

  setCookie(res: Response, token: string, expiresAt: Date): void {
    res.cookie(this.cookieName, token, {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
  }

  clearCookie(res: Response): void {
    res.clearCookie(this.cookieName, { httpOnly: true, secure: this.secure, sameSite: 'lax', path: '/' });
  }

  private idleExpiry(now: Date, absolute: Date): Date {
    return new Date(Math.min(now.getTime() + this.env.SESSION_IDLE_DAYS * DAY_MS, absolute.getTime()));
  }
}
