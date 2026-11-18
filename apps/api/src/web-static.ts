import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import type { Env } from './config/env.js';

/** File da rileggere sempre: aggiornano la PWA (service worker) o la descrivono. */
const NO_CACHE = new Set(['index.html', 'ngsw-worker.js', 'ngsw.json', 'safety-worker.js', 'worker-basic.min.js', 'manifest.webmanifest']);
/** File con hash nel nome generati dalla build (es. chunk-2CBRVWO4.js): non cambiano mai. */
const HASHED = /[-.][0-9A-Z]{8,}\.(js|css|woff2?)$/;

const isServerPath = (path: string) => path === '/api' || path.startsWith('/api/') || path.startsWith('/socket.io/');

/** Aggiunge il meta robots noindex subito dopo <head> (solo modalità demo). */
export function demoIndexHtml(html: string): string {
  return html.replace(/<head>/i, '<head>\n  <meta name="robots" content="noindex, nofollow">');
}

/**
 * Serve la build di produzione della PWA dalla stessa origine dell'API (un unico
 * servizio: cookie di sessione e WebSocket senza CORS). Attivo solo con
 * WEB_DIST_DIR; in sviluppo il frontend gira con ng serve e il proxy.
 * Regole di cache e fallback come nel reverse proxy di produzione.
 */
export function serveWeb(app: INestApplication, env: Env): void {
  if (!env.WEB_DIST_DIR) return;
  const root = resolve(env.WEB_DIST_DIR);
  const indexFile = join(root, 'index.html');
  if (!existsSync(indexFile)) {
    throw new Error(`WEB_DIST_DIR: build web non trovata (${indexFile}); eseguire prima npm run build`);
  }
  const raw = readFileSync(indexFile, 'utf8');
  const index = env.DEMO_MODE ? demoIndexHtml(raw) : raw;

  const staticFiles = express.static(root, {
    index: false,
    redirect: false,
    setHeaders: (res, file) => {
      const name = basename(file);
      if (NO_CACHE.has(name)) res.setHeader('Cache-Control', 'no-cache');
      else if (HASHED.test(name)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      else res.setHeader('Cache-Control', 'public, max-age=3600');
    },
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (isServerPath(req.path) || req.path === '/index.html') return next();
    return staticFiles(req, res, next);
  });

  // Fallback della SPA: ogni navigazione (percorso senza estensione) riceve index.html.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || isServerPath(req.path)) return next();
    if (req.path !== '/index.html' && extname(req.path) !== '') return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(index);
  });
}
