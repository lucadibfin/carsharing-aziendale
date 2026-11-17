import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { SessionStore } from './session.store';

// Nota: inject() va chiamato PRIMA di qualunque await (contesto di iniezione sincrono).

/** Richiede il login; altrimenti porta alla pagina di accesso ricordando la destinazione. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const session = inject(SessionStore);
  const router = inject(Router);
  const me = await session.ensure();
  if (me) return true;
  return router.createUrlTree(['/login'], { queryParams: { next: state.url } });
};

/** Richiede anche l'onboarding completato (informativa, termini, profilo minimo). */
export const readyGuard: CanActivateFn = async (_route, state) => {
  const session = inject(SessionStore);
  const router = inject(Router);
  const me = await session.ensure();
  if (!me) return router.createUrlTree(['/login'], { queryParams: { next: state.url } });
  if (me.onboardingRequired) return router.createUrlTree(['/benvenuto'], { queryParams: { next: state.url } });
  return true;
};

/** Area amministrativa: serve un ruolo (le verifiche vere sono comunque nell'API). */
export const adminGuard: CanActivateFn = async () => {
  const session = inject(SessionStore);
  const router = inject(Router);
  const me = await session.ensure();
  return me && me.roles.length > 0 ? true : router.createUrlTree(['/']);
};

/** Sezioni riservate all'admin globale. */
export const globalAdminGuard: CanActivateFn = async () => {
  const session = inject(SessionStore);
  const router = inject(Router);
  await session.ensure();
  return session.isGlobalAdmin() ? true : router.createUrlTree(['/admin']);
};

/** La pagina di login non serve a chi è già autenticato. */
export const guestGuard: CanActivateFn = async () => {
  const session = inject(SessionStore);
  const router = inject(Router);
  const me = await session.ensure();
  return me ? router.createUrlTree(['/']) : true;
};

/** Accetta solo percorsi interni come destinazione dopo il login (evita open redirect). */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}
