import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { SessionUser } from './session.service.js';

export const IS_PUBLIC = 'isPublic';
/** Endpoint accessibile senza sessione (es. login). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ALLOW_DURING_ONBOARDING = 'allowDuringOnboarding';
/** Endpoint accessibile anche prima di aver accettato informativa e termini. */
export const AllowDuringOnboarding = () => SetMetadata(ALLOW_DURING_ONBOARDING, true);

export type AuthedRequest = Request & { auth?: SessionUser };

/** Utente autenticato della richiesta corrente. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): SessionUser => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  return req.auth!;
});
