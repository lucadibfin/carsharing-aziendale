// Server HTTPS SOLO PER I TEST SU DISPOSITIVI REALI (rete locale).
// Serve la build di PRODUZIONE della PWA (l'unica con service worker, quindi
// installabile e con notifiche push) e inoltra /api e /socket.io (WebSocket
// compreso) all'API di sviluppo su 127.0.0.1:3000.
// Istruzioni complete: docs/test-dispositivi.md
//
//   npm run build -w web
//   npm run serve:https            (HTTPS_PORT, HTTPS_CERT, HTTPS_KEY, API_TARGET)
//
// Nessuna dipendenza esterna: solo moduli di Node.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:https';
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const port = Number(process.env.HTTPS_PORT ?? 8443);
const certFile = resolve(root, process.env.HTTPS_CERT ?? 'certs/dev-cert.pem');
const keyFile = resolve(root, process.env.HTTPS_KEY ?? 'certs/dev-key.pem');
const api = new URL(process.env.API_TARGET ?? 'http://127.0.0.1:3000');
const webRoot = join(root, 'apps/web/dist/web/browser');

for (const [what, file, hint] of [
  ['Certificato', certFile, 'vedi docs/test-dispositivi.md (mkcert)'],
  ['Chiave', keyFile, 'vedi docs/test-dispositivi.md (mkcert)'],
  ['Build della PWA', join(webRoot, 'index.html'), 'eseguire prima: npm run build -w web'],
]) {
  if (!existsSync(file)) {
    console.error(`${what} non trovato: ${file}\n→ ${hint}`);
    process.exit(1);
  }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};

// Stessi header di sicurezza previsti per la produzione: così si verifica anche
// che la PWA funzioni con la CSP restrittiva.
const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; " +
    "connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; " +
    "form-action 'self'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
};

const isProxied = (url) => url.startsWith('/api/') || url === '/api' || url.startsWith('/socket.io/');

/** Header da inoltrare all'API: l'API vede l'IP reale e il protocollo https (TRUST_PROXY=1). */
function forwardHeaders(req) {
  const h = { ...req.headers };
  const prior = req.headers['x-forwarded-for'];
  h['x-forwarded-for'] = (prior ? `${prior}, ` : '') + (req.socket.remoteAddress ?? '');
  h['x-forwarded-proto'] = 'https';
  h['x-forwarded-host'] = req.headers.host ?? '';
  return h;
}

function proxy(req, res) {
  const upstream = httpRequest(
    { host: api.hostname, port: api.port, method: req.method, path: req.url, headers: forwardHeaders(req) },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('API non raggiungibile: è avviata con "npm run dev:api"?');
  });
  req.pipe(upstream);
}

function serveStatic(req, res) {
  const path = decodeURIComponent(new URL(req.url, 'https://x').pathname);
  let file = normalize(join(webRoot, path));
  if (!file.startsWith(webRoot + sep) && file !== webRoot) {
    res.writeHead(400).end();
    return;
  }
  const isFile = existsSync(file) && statSync(file).isFile();
  // Navigazione SPA: i percorsi senza file corrispondente ricevono index.html.
  if (!isFile) {
    if (extname(path)) {
      res.writeHead(404, SECURITY_HEADERS).end();
      return;
    }
    file = join(webRoot, 'index.html');
  }
  const name = file.slice(webRoot.length + 1);
  const hashed = /-[A-Za-z0-9_]{8}\.(js|css)$/.test(name) || name.startsWith('media' + sep);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    // index.html, service worker e manifest mai in cache, così gli aggiornamenti arrivano subito.
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') return void res.end();
  createReadStream(file).pipe(res);
}

const server = createServer({ cert: readFileSync(certFile), key: readFileSync(keyFile) }, (req, res) => {
  if (isProxied(req.url ?? '')) proxy(req, res);
  else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res);
  else res.writeHead(405).end();
});

// WebSocket della chat: si inoltra la richiesta di upgrade e poi i due socket.
server.on('upgrade', (req, socket, head) => {
  if (!(req.url ?? '').startsWith('/socket.io/')) return void socket.destroy();
  const up = connect(Number(api.port), api.hostname, () => {
    const headers = forwardHeaders(req);
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (const [k, v] of Object.entries(headers)) {
      for (const value of [].concat(v ?? [])) lines.push(`${k}: ${value}`);
    }
    up.write(lines.join('\r\n') + '\r\n\r\n');
    if (head?.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  const close = () => {
    up.destroy();
    socket.destroy();
  };
  up.on('error', close);
  socket.on('error', close);
});

server.listen(port, '0.0.0.0', () => {
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  console.log(`PWA in HTTPS sulla porta ${port} (API: ${api.origin})`);
  for (const ip of ips) console.log(`  https://${ip}:${port}`);
  console.log('Solo per test sulla rete locale. Ctrl+C per fermare.');
});
