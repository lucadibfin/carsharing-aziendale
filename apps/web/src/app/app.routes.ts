import type { Routes } from '@angular/router';
import { adminGuard, authGuard, globalAdminGuard, guestGuard, readyGuard } from './core/guards';
import { devRoutes } from './dev-routes';

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
      { path: 'profilo/dati', title: 'I miei dati', loadComponent: () => import('./pages/my-data.page').then((m) => m.MyDataPage) },
      { path: 'statistiche', title: 'Le mie statistiche', loadComponent: () => import('./pages/stats.page').then((m) => m.StatsPage) },
      { path: 'invito', title: 'Invito', loadComponent: () => import('./pages/invite.page').then((m) => m.InvitePage) },
      {
        path: 'admin',
        canActivate: [adminGuard],
        loadComponent: () => import('./pages/admin/admin-shell.page').then((m) => m.AdminShellPage),
        children: [
          { path: '', title: 'Admin · Dashboard', loadComponent: () => import('./pages/admin/admin-dashboard.page').then((m) => m.AdminDashboardPage) },
          { path: 'viaggi', title: 'Admin · Viaggi', loadComponent: () => import('./pages/admin/admin-trips.page').then((m) => m.AdminTripsPage) },
          {
            path: 'segnalazioni',
            title: 'Admin · Segnalazioni',
            loadComponent: () => import('./pages/admin/admin-reports.page').then((m) => m.AdminReportsPage),
          },
          {
            path: '',
            canActivateChild: [globalAdminGuard],
            children: [
              { path: 'parametri', title: 'Admin · Parametri', loadComponent: () => import('./pages/admin/admin-settings.page').then((m) => m.AdminSettingsPage) },
              { path: 'ruoli', title: 'Admin · Ruoli', loadComponent: () => import('./pages/admin/admin-roles.page').then((m) => m.AdminRolesPage) },
              { path: 'sedi', title: 'Admin · Sedi', loadComponent: () => import('./pages/admin/admin-sites.page').then((m) => m.AdminSitesPage) },
              { path: 'testi', title: 'Admin · Testi legali', loadComponent: () => import('./pages/admin/admin-policies.page').then((m) => m.AdminPoliciesPage) },
              { path: 'audit', title: 'Admin · Audit log', loadComponent: () => import('./pages/admin/admin-audit.page').then((m) => m.AdminAuditPage) },
            ],
          },
        ],
      },
    ],
  },
  ...devRoutes,
  { path: '**', redirectTo: '' },
];
