import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
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
      onboardingRequired: true, pendingPolicyIds: ['p'], emailVerified: false, comuneNotice: null,
    });
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('nav')).toBeNull();

    session.me.set({ ...session.me()!, onboardingRequired: false, pendingPolicyIds: [], emailVerified: true });
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('nav a').length).toBe(4);
  });

  it('avviso sul comune cambiato per fusione: si chiude con un tocco', async () => {
    const fixture = TestBed.createComponent(App);
    const session = TestBed.inject(SessionStore);
    const http = TestBed.inject(HttpTestingController);
    session.me.set({
      id: 'u1', firstName: 'Mario', lastName: 'Rossi', siteId: 's', comuneIstat: '024129', roles: [],
      onboardingRequired: false, pendingPolicyIds: [], emailVerified: true,
      comuneNotice: { from: 'Castegnero', to: 'Castegnero Nanto' },
    });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.comune-notice')?.textContent).toContain('Il tuo comune Castegnero è ora Castegnero Nanto');

    el.querySelector<HTMLButtonElement>('.comune-notice button')!.click();
    await fixture.whenStable();
    expect(el.querySelector('.comune-notice')).toBeNull();
    http.expectOne((r) => r.method === 'DELETE' && r.url.endsWith('/me/comune-notice')).flush(null);
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
