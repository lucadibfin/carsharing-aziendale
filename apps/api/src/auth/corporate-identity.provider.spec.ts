import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../config/env.js';
import { CorporateIdentityProvider } from './corporate-identity.provider.js';
import { IdentityProviderUnavailableError, InvalidCredentialsError } from './identity-provider.js';

const SECRET = 'Pa55word-Segreta';
const baseEnv = {
  APP_ORIGIN: 'http://localhost:4200',
  DATABASE_URL: 'postgresql://x',
  DATA_ENCRYPTION_KEYS: '1:' + Buffer.alloc(32, 1).toString('base64'),
  HMAC_KEY: Buffer.alloc(32, 2).toString('base64'),
};

function provider(overrides: Record<string, string> = {}) {
  return new CorporateIdentityProvider(
    loadEnv({ ...baseEnv, AUTH_PROVIDER: 'corporate', CORPORATE_AUTH_URL: 'https://idp.example.invalid/verify', ...overrides }),
  );
}

describe('CorporateIdentityProvider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('la configurazione rifiuta un endpoint non HTTPS', () => {
    expect(() => loadEnv({ ...baseEnv, AUTH_PROVIDER: 'corporate', CORPORATE_AUTH_URL: 'http://idp/verify' })).toThrow(
      /CORPORATE_AUTH_URL/,
    );
  });

  it('il provider mock non è ammesso in produzione', () => {
    expect(() =>
      loadEnv({ ...baseEnv, NODE_ENV: 'production', APP_ORIGIN: 'https://app.example.invalid', AUTH_PROVIDER: 'mock' }),
    ).toThrow(/AUTH_PROVIDER/);
  });

  it('in produzione l’admin iniziale non può essere l’utenza fittizia "admin"', () => {
    const prod = {
      ...baseEnv,
      NODE_ENV: 'production',
      APP_ORIGIN: 'https://app.example.invalid',
      AUTH_PROVIDER: 'corporate',
      CORPORATE_AUTH_URL: 'https://idp.example.invalid/verify',
      SMTP_HOST: 'smtp.example.invalid',
    };
    expect(() => loadEnv({ ...prod, INITIAL_GLOBAL_ADMIN: 'admin' })).toThrow(/INITIAL_GLOBAL_ADMIN/);
    expect(loadEnv({ ...prod, INITIAL_GLOBAL_ADMIN: 'mario.rossi' }).INITIAL_GLOBAL_ADMIN).toBe('mario.rossi');
  });

  it('gli errori di configurazione non riportano i valori dei segreti', () => {
    try {
      loadEnv({ ...baseEnv, HMAC_KEY: 'segreto-troppo-corto' });
      expect.unreachable();
    } catch (e) {
      expect(String(e)).toContain('HMAC_KEY');
      expect(String(e)).not.toContain('segreto-troppo-corto');
    }
  });

  it('inoltra le credenziali solo via POST HTTPS, senza seguire redirect', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ active: true, firstName: 'Mario', lastName: 'Rossi' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const r = await provider().authenticate('mario.rossi', SECRET);
    expect(r).toEqual({ active: true, firstName: 'Mario', lastName: 'Rossi' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/^https:\/\//);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeDefined();
  });

  it('401 → credenziali non valide', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"bad"}', { status: 401 })));
    await expect(provider().authenticate('mario.rossi', SECRET)).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('errori di rete/timeout/5xx → servizio non disponibile, senza dettagli né password', async () => {
    const cases = [
      vi.fn().mockRejectedValue(Object.assign(new Error(`connect failed ${SECRET}`), { name: 'TypeError' })),
      vi.fn().mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError' })),
      vi.fn().mockResolvedValue(new Response(`errore interno ${SECRET}`, { status: 500 })),
      vi.fn().mockResolvedValue(new Response('non json', { status: 200 })),
      vi.fn().mockResolvedValue(new Response('{"unexpected":true}', { status: 200 })),
    ];
    for (const f of cases) {
      vi.stubGlobal('fetch', f);
      const err = await provider().authenticate('mario.rossi', SECRET).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(IdentityProviderUnavailableError);
      expect(String((err as Error).message) + String((err as Error).stack)).not.toContain(SECRET);
    }
  });

  it('nessun retry automatico: una sola chiamata anche in caso di errore', async () => {
    const f = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
    vi.stubGlobal('fetch', f);
    await provider().authenticate('mario.rossi', SECRET).catch(() => undefined);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('verifica senza password per il job notturno (se configurata)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"active":false}', { status: 200 })));
    const p = provider({ CORPORATE_CHECK_URL: 'https://idp.example.invalid/status' });
    expect(await p.checkActive('mario.rossi')).toBe(false);
  });
});
