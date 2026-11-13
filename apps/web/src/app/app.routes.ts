import type { Routes } from '@angular/router';
import { authGuard, guestGuard, readyGuard } from './core/guards';

export const routes: Routes = [
  { path: 'login', canActivate: [guestGuard], title: 'Accedi', loadComponent: () => import('./pages/login.page').then((m) => m.LoginPage) },
  { path: 'informativa', title: 'Privacy e termini', loadComponent: () => import('./pages/policies.page').then((m) => m.PoliciesPage) },
  {
    path: 'benvenuto',
    canActivate: [authGuard],
    title: 'Benvenuto',
    loadComponent: () => import('./pages/onboarding.page').then((m) => m.OnboardingPage),
  },
  {
    path: '',
    canActivate: [readyGuard],
    children: [
      { path: '', title: 'Home', loadComponent: () => import('./pages/home.page').then((m) => m.HomePage) },
      { path: 'cerca', title: 'Cerca', loadComponent: () => import('./pages/search.page').then((m) => m.SearchPage) },
      { path: 'proponi', title: 'Proponi un viaggio', loadComponent: () => import('./pages/trip-new.page').then((m) => m.TripNewPage) },
      { path: 'viaggi/:id', title: 'Viaggio', loadComponent: () => import('./pages/trip-detail.page').then((m) => m.TripDetailPage) },
      { path: 'viaggi/:id/chat', title: 'Chat', loadComponent: () => import('./pages/trip-chat.page').then((m) => m.TripChatPage) },
      { path: 'profilo', title: 'Profilo', loadComponent: () => import('./pages/profile.page').then((m) => m.ProfilePage) },
      { path: 'statistiche', title: 'Le mie statistiche', loadComponent: () => import('./pages/stats.page').then((m) => m.StatsPage) },
      { path: 'invito',title: 'Invito', loadComponent: () => import('./pages/invite.page').then((m) => m.InvitePage) },
    ],
  },
  { path: '**', redirectTo: '' },
];
