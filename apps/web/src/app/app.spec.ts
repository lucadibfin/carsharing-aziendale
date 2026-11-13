import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { safeNext } from './core/guards';
import { SessionStore } from './core/session.store';

describe('App shell', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('mostra la navigazione solo a utenti autenticati con onboarding completato', async () => {
    const fixture = TestBed.createComponent(App);
    const session = TestBed.inject(SessionStore);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('nav')).toBeNull();

    session.me.set({
      id: 'u1', firstName: 'Mario', lastName: 'Rossi', siteId: 's', comuneIstat: '015146', roles: [],
      onboardingRequired: true, pendingPolicyIds: ['p'], emailVerified: false,
    });
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('nav')).toBeNull();

    session.me.set({ ...session.me()!, onboardingRequired: false, pendingPolicyIds: [], emailVerified: true });
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('nav a').length).toBe(4);
  });
});

describe('safeNext (redirect dopo il login)', () => {
  it('accetta solo percorsi interni', () => {
    expect(safeNext('/viaggi/1')).toBe('/viaggi/1');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext(undefined)).toBe('/');
  });
});
