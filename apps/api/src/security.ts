import type { INestApplication } from '@nestjs/common';
import { StandardSchemaValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import helmet from 'helmet';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Env } from './config/env.js';

export const XSRF_COOKIE = 'XSRF-TOKEN';
export const XSRF_HEADER = 'x-xsrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Protezione CSRF "double submit cookie", compatibile con il supporto XSRF
 * nativo di Angular HttpClient: il server imposta il cookie XSRF-TOKEN
 * (leggibile da JS), il client lo rimanda nell'header X-XSRF-TOKEN.
 * Si aggiunge al cookie di sessione SameSite=Lax.
 */
export function csrfMiddleware(env: Env) {
  const secure = env.APP_ORIGIN.startsWith('https://');
  return (req: Request, res: Response, next: NextFunction): void => {
    let token = (req.cookies as Record<string, string> | undefined)?.[XSRF_COOKIE];
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      token = randomBytes(32).toString('base64url');
      res.cookie(XSRF_COOKIE, token, { httpOnly: false, secure, sameSite: 'strict', path: '/' });
      // Un client senza cookie valido non può superare il controllo sotto.
      (req.cookies as Record<string, string>)[XSRF_COOKIE] = '';
    }
    if (SAFE_METHODS.has(req.method)) return next();
    const header = req.header(XSRF_HEADER) ?? '';
    const cookie = (req.cookies as Record<string, string>)[XSRF_COOKIE] ?? '';
    const ok =
      cookie.length > 0 &&
      header.length === cookie.length &&
      timingSafeEqual(Buffer.from(header), Buffer.from(cookie));
    if (!ok) {
      res.status(403).json({ statusCode: 403, code: 'CSRF', message: 'Richiesta non valida: ricarica la pagina' });
      return;
    }
    next();
  };
}

/** Configurazione di sicurezza comune ad app reale e test. */
export function configureApp(app: INestApplication, env: Env): void {
  const http = app.getHttpAdapter().getInstance() as express.Express;
  http.disable('x-powered-by');
  // Dietro il reverse proxy (Caddy) per ottenere l'IP reale del client.
  http.set('trust proxy', env.TRUST_PROXY);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      hsts: env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());
  app.use('/api', csrfMiddleware(env));
  app.use('/api', (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.enableShutdownHooks();
}
