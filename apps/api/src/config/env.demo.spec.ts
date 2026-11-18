import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const demo = {
  NODE_ENV: 'production',
  DEMO_MODE: 'true',
  APP_ORIGIN: 'https://demo.example.invalid',
  DATABASE_URL: 'postgresql://x',
  DATA_ENCRYPTION_KEYS: '1:' + Buffer.alloc(32, 1).toString('base64'),
  HMAC_KEY: Buffer.alloc(32, 2).toString('base64'),
};

describe('modalità demo', () => {
  it('in produzione ammette il login di prova, l’utenza admin e nessun SMTP; nessuna email esce', () => {
    const env = loadEnv({ ...demo, AUTH_PROVIDER: 'mock', INITIAL_GLOBAL_ADMIN: 'admin' });
    expect(env.DEMO_MODE).toBe(true);
    expect(env.AUTH_PROVIDER).toBe('mock');
    expect(env.MAIL_TRANSPORT).toBe('disabled');
  });

  it('l’integrazione aziendale non è attivabile', () => {
    expect(() => loadEnv({ ...demo, AUTH_PROVIDER: 'corporate', CORPORATE_AUTH_URL: 'https://idp.example.invalid/verify' })).toThrow(
      /AUTH_PROVIDER/,
    );
    expect(() => loadEnv({ ...demo, CORPORATE_AUTH_URL: 'https://idp.example.invalid/verify' })).toThrow(/CORPORATE_AUTH_URL/);
    expect(() => loadEnv({ ...demo, CORPORATE_CHECK_URL: 'https://idp.example.invalid/status' })).toThrow(/CORPORATE_CHECK_URL/);
  });

  it('l’invio di email non è attivabile', () => {
    expect(() => loadEnv({ ...demo, MAIL_TRANSPORT: 'smtp', SMTP_HOST: 'smtp.example.invalid' })).toThrow(/MAIL_TRANSPORT/);
  });

  it('richiede comunque https in produzione e chiavi valide', () => {
    expect(() => loadEnv({ ...demo, APP_ORIGIN: 'http://demo.example.invalid' })).toThrow(/APP_ORIGIN/);
    expect(() => loadEnv({ ...demo, DATA_ENCRYPTION_KEYS: 'x' })).toThrow(/DATA_ENCRYPTION_KEYS/);
  });

  it('fuori demo la produzione continua a rifiutare il login di prova', () => {
    expect(() => loadEnv({ ...demo, DEMO_MODE: 'false', AUTH_PROVIDER: 'mock' })).toThrow(/AUTH_PROVIDER/);
  });
});
