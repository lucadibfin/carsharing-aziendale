import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../common/errors.js';
import { PrismaService } from '../common/prisma.service.js';
import { PoliciesService } from '../policies/policies.service.js';
import { ALLOW_DURING_ONBOARDING, type AuthedRequest, IS_PUBLIC } from './decorators.js';
import { SessionService } from './session.service.js';

/** Richiede una sessione valida su tutti gli endpoint, salvo @Public(). */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    const token = (req.cookies as Record<string, string> | undefined)?.[this.sessions.cookieName];
    const auth = await this.sessions.validate(token);
    if (auth) req.auth = auth;
    if (isPublic) return true;
    if (!auth) throw new AppException('UNAUTHENTICATED', 'Sessione scaduta: accedi di nuovo', HttpStatus.UNAUTHORIZED);
    return true;
  }
}

/**
 * Blocca ogni trattamento oltre al login finché l'utente non ha preso visione
 * dell'informativa, accettato i termini (versioni correnti) e completato il
 * profilo minimo.
 */
@Injectable()
export class OnboardingGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly policies: PoliciesService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_DURING_ONBOARDING, targets)) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const userId = req.auth!.userId;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { onboardedAt: true, emailVerifiedAt: true } });
    if (!user?.onboardedAt || !user.emailVerifiedAt || (await this.policies.pendingFor(userId)).length > 0) {
      throw new AppException(
        'ONBOARDING_REQUIRED',
        'Prima di continuare devi completare il primo accesso (informativa, termini ed email per le notifiche)',
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
