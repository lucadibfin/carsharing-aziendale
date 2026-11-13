import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { SessionStore } from './session.store';

/**
 * Gestione centralizzata di sessione scaduta (401) e onboarding richiesto
 * (403 ONBOARDING_REQUIRED, es. nuova versione dell'informativa).
 */
export const httpErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const session = inject(SessionStore);
  return next(req).pipe(
    catchError((e: unknown) => {
      if (e instanceof HttpErrorResponse) {
        const isAuthCall = req.url.endsWith('/api/me') || req.url.endsWith('/api/auth/login');
        if (e.status === 401 && !isAuthCall) {
          session.clear();
          void router.navigate(['/login'], { queryParams: { next: router.url } });
        } else if (e.status === 403 && e.error?.code === 'ONBOARDING_REQUIRED') {
          void session.refresh().then(() => router.navigate(['/benvenuto']));
        }
      }
      return throwError(() => e);
    }),
  );
};
