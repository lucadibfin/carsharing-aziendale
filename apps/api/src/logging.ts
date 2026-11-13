import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import type { Env } from './config/env.js';

/** Destinazione alternativa dei log (usata dai test per verificarne il contenuto). */
let destinationOverride: DestinationStream | undefined;
export function setLogDestination(stream: DestinationStream | undefined): void {
  destinationOverride = stream;
}

/**
 * Percorso senza query string (può contenere nomi cercati) e con gli
 * identificativi lunghi oscurati (difesa in profondità per eventuali token).
 */
export function sanitizePath(url: string | undefined): string {
  const path = (url ?? '').split('?')[0] ?? '';
  return path.replace(/[A-Za-z0-9_-]{32,}/g, ':redacted');
}

/**
 * Log applicativi in JSON senza dati personali in chiaro e MAI con credenziali:
 *  - non si registrano corpo delle richieste, cookie, header di autorizzazione;
 *  - URL senza query string;
 *  - redazione difensiva di qualunque campo "password"/"token" ovunque si trovi;
 *  - gli utenti compaiono solo come pseudonimo HMAC (vedi AuthService).
 */
export function loggerOptions(env: Env): Params {
  return {
    pinoHttp: {
      level: env.NODE_ENV === 'test' && !destinationOverride ? 'silent' : env.LOG_LEVEL,
      stream: destinationOverride,
      transport:
        env.NODE_ENV === 'development' && !destinationOverride
          ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } }
          : undefined,
      redact: {
        paths: [
          'password',
          '*.password',
          '*.*.password',
          'token',
          '*.token',
          'req.headers.cookie',
          'req.headers.authorization',
          'req.headers["x-xsrf-token"]',
          'res.headers["set-cookie"]',
          'req.body',
        ],
        censor: '[REDACTED]',
      },
      serializers: {
        req: (req: IncomingMessage & { id?: unknown }) => ({ id: req.id, method: req.method, url: sanitizePath(req.url) }),
        res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
      },
      // Nessun IP nei log di accesso (dato personale): si conserva solo nei contatori anti brute-force, come HMAC.
      customProps: () => ({}),
      autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/api/health') },
    },
  };
}
