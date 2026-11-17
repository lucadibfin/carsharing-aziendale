import { type CanActivate, createParamDecorator, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthedRequest } from '../auth/decorators.js';
import { Forbidden } from '../common/errors.js';
import { PrismaService } from '../common/prisma.service.js';

/** Sedi su cui l'admin opera: null = tutte (admin globale). */
export type SiteScope = string[] | null;

type AdminRequest = AuthedRequest & { adminScope?: SiteScope };

const GLOBAL_ONLY = 'globalAdminOnly';
/** Endpoint riservato agli admin globali (parametri, ruoli, sedi, testi legali, audit). */
export const GlobalAdminOnly = () => SetMetadata(GLOBAL_ONLY, true);

/**
 * Accesso all'area amministrativa: serve un ruolo SITE_ADMIN o GLOBAL_ADMIN.
 * I ruoli si leggono dal DB a ogni richiesta, così una revoca ha effetto subito.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AdminRequest>();
    const roles = await this.prisma.roleAssignment.findMany({
      where: { userId: req.auth!.userId, user: { status: 'ACTIVE' } },
      select: { role: true, siteId: true },
    });
    const isGlobal = roles.some((r) => r.role === 'GLOBAL_ADMIN');
    const sites = roles.filter((r) => r.role === 'SITE_ADMIN' && r.siteId).map((r) => r.siteId!);
    const globalOnly = this.reflector.getAllAndOverride<boolean>(GLOBAL_ONLY, [ctx.getHandler(), ctx.getClass()]);
    if (globalOnly ? !isGlobal : !isGlobal && sites.length === 0) {
      throw Forbidden('Area riservata agli amministratori');
    }
    req.adminScope = isGlobal ? null : sites;
    return true;
  }
}

export const AdminScope = createParamDecorator((_: unknown, ctx: ExecutionContext): SiteScope => {
  const req = ctx.switchToHttp().getRequest<AdminRequest>();
  return req.adminScope ?? null;
});

/** Filtra per sede rispettando l'ambito: un admin di sede non può chiedere altre sedi. */
export function scopedSiteFilter(scope: SiteScope, requested?: string): string | { in: string[] } | undefined {
  if (scope === null) return requested;
  if (requested) {
    if (!scope.includes(requested)) throw Forbidden('Non gestisci questa sede');
    return requested;
  }
  return { in: scope };
}
