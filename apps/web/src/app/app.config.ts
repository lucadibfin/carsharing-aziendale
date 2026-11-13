import { registerLocaleData } from '@angular/common';
import { provideHttpClient, withInterceptors, withXsrfConfiguration } from '@angular/common/http';
import localeIt from '@angular/common/locales/it';
import {
  type ApplicationConfig,
  isDevMode,
  LOCALE_ID,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { routes } from './app.routes';
import { httpErrorInterceptor } from './core/http-error.interceptor';
import { registerIcons } from './core/icons';

registerLocaleData(localeIt);

/**
 * Il link d'invito ha il token nel frammento (#). Va salvato subito, prima che
 * un eventuale redirect al login lo faccia perdere.
 */
function captureInviteToken(): void {
  if (location.pathname === '/invito' && location.hash.length > 1) {
    try {
      sessionStorage.setItem('pendingInviteToken', location.hash.slice(1));
    } catch {
      // storage non disponibile: l'utente dovrà riaprire il link dopo il login
    }
    history.replaceState(null, '', '/invito');
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideAppInitializer(captureInviteToken),
    provideAppInitializer(registerIcons),
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    // XSRF: Angular legge il cookie XSRF-TOKEN e invia l'header X-XSRF-TOKEN (verificato dall'API).
    provideHttpClient(withXsrfConfiguration({ cookieName: 'XSRF-TOKEN', headerName: 'X-XSRF-TOKEN' }), withInterceptors([httpErrorInterceptor])),
    { provide: LOCALE_ID, useValue: 'it-IT' },
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
