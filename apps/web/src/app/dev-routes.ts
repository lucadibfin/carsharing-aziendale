import type { Routes } from '@angular/router';

/**
 * Pagine riservate allo sviluppo. Nella build di produzione angular.json sostituisce
 * questo file con dev-routes.prod.ts (vuoto), quindi il codice non finisce nel bundle.
 */
export const devRoutes: Routes = [
  { path: 'dev/stile', title: 'Guida di stile', loadComponent: () => import('./pages/dev/styleguide.page').then((m) => m.StyleguidePage) },
];
