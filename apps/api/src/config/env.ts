import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const base64Key = z.string().refine((v) => {
  try {
    return Buffer.from(v, 'base64').length === 32;
  } catch {
    return false;
  }
}, 'deve essere una chiave di 32 byte in base64');

/** Variabili d'ambiente validate all'avvio: se manca un segreto l'app non parte. */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(3000),
    APP_ORIGIN: z.url(),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    DATABASE_URL: z.string().min(1),

    AUTH_PROVIDER: z.enum(['mock', 'corporate']).default('mock'),
    CORPORATE_AUTH_URL: z.string().optional().default(''),
    CORPORATE_CHECK_URL: z.string().optional().default(''),
    CORPORATE_AUTH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(8000),
    EMPLOYEE_CHECK_MODE: z.enum(['nightly', 'session-expiry', 'both']).default('session-expiry'),
    SESSION_MAX_DAYS: z.coerce.number().int().min(1).max(365).default(14),
    SESSION_IDLE_DAYS: z.coerce.number().int().min(1).max(365).default(7),
    INITIAL_GLOBAL_ADMIN: z.string().trim().toLowerCase().optional().default(''),

    LOGIN_MAX_FAILURES_PER_USER: z.coerce.number().int().min(1).max(20).default(3),
    LOGIN_MAX_FAILURES_PER_IP: z.coerce.number().int().min(1).max(1000).default(20),
    /** Durata del blocco temporaneo dopo troppi errori (si toglie da solo). */
    LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    /** Se maggiore di LOGIN_LOCK_MINUTES, il blocco raddoppia a ogni errore fino a questo massimo. */
    LOGIN_LOCK_MAX_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    /** Ore senza errori dopo cui il contatore degli errori si azzera. */
    LOGIN_FAILURES_RESET_HOURS: z.coerce.number().int().min(1).max(168).default(24),
    LOGIN_MIN_RESPONSE_MS: z.coerce.number().int().min(0).max(5000).default(800),

    DATA_ENCRYPTION_KEYS: z.string().min(1),
    HMAC_KEY: base64Key,

    VAPID_PUBLIC_KEY: z.string().optional().default(''),
    VAPID_PRIVATE_KEY: z.string().optional().default(''),
    VAPID_SUBJECT: z.string().optional().default('mailto:noreply@example.invalid'),

    SMTP_HOST: z.string().optional().default(''),
    SMTP_PORT: z.coerce.number().int().default(587),
    SMTP_SECURE: bool.default(false),
    SMTP_USER: z.string().optional().default(''),
    SMTP_PASSWORD: z.string().optional().default(''),
    MAIL_FROM: z.string().default('Car Sharing <noreply@example.invalid>'),
    MAIL_DOMAIN: z.string().default('example.invalid'),

    JOBS_ENABLED: bool.default(true),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (env.AUTH_PROVIDER === 'mock') {
        ctx.addIssue({ code: 'custom', path: ['AUTH_PROVIDER'], message: 'il provider mock non è ammesso in produzione' });
      }
      if (!env.APP_ORIGIN.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['APP_ORIGIN'], message: 'in produzione deve essere https://' });
      }
    }
    if (env.AUTH_PROVIDER === 'corporate' && !env.CORPORATE_AUTH_URL.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORPORATE_AUTH_URL'],
        message: 'obbligatorio e deve essere https:// (le credenziali non viaggiano mai in chiaro)',
      });
    }
    if (env.CORPORATE_CHECK_URL && !env.CORPORATE_CHECK_URL.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['CORPORATE_CHECK_URL'], message: 'deve essere https://' });
    }
    for (const part of env.DATA_ENCRYPTION_KEYS.split(',')) {
      const [ver, key] = part.split(':');
      if (!/^\d+$/.test(ver ?? '') || !base64Key.safeParse(key).success) {
        ctx.addIssue({
          code: 'custom',
          path: ['DATA_ENCRYPTION_KEYS'],
          message: 'formato atteso <versione>:<chiave base64 32 byte>[,…]',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const r = envSchema.safeParse(source);
  if (!r.success) {
    // Si riportano solo i nomi delle variabili, mai i valori (potrebbero essere segreti).
    const problems = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Configurazione non valida:\n  ${problems}`);
  }
  return r.data;
}
