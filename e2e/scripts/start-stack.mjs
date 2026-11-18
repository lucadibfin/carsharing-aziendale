// Stack per i test end-to-end, isolato dall'ambiente di sviluppo:
// PostgreSQL embedded usa-e-getta (porta E2E_DB_PORT), migrazioni, seed e
// API compilata (apps/api/dist) su E2E_API_PORT con provider di login mock ed
// email scritte nella outbox e2e/.run/mail-outbox (da cui il test legge i codici).
//
// Avvio e arresto sono gestiti da Playwright con globalSetup/teardown (e2e/global-setup.mjs),
// non come webServer: su Windows Playwright termina i webServer in modo forzato
// (taskkill) e PostgreSQL non può chiudersi in modo ordinato, lasciando processi
// orfani che tengono occupata la porta. Da riga di comando: node scripts/start-stack.mjs
import EmbeddedPostgres from 'embedded-postgres';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '../..');
const apiDir = join(root, 'apps/api');
const runDir = join(root, 'e2e/.run');
const dbPort = Number(process.env.E2E_DB_PORT ?? 5440);
const apiPort = Number(process.env.E2E_API_PORT ?? 3100);
const webPort = Number(process.env.E2E_WEB_PORT ?? 4300);

const portInUse = (port) =>
  new Promise((done) => {
    const s = connect(port, '127.0.0.1');
    s.once('connect', () => (s.destroy(), done(true)));
    s.once('error', () => done(false));
  });

async function waitForApi(timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const r = await fetch(`http://127.0.0.1:${apiPort}/api/policies/current`);
      if (r.ok) return;
    } catch {
      // non ancora in ascolto
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`API e2e non raggiungibile su ${apiPort}`);
}

/** Avvia DB e API; restituisce la funzione che li ferma (in modo ordinato). */
export async function startStack() {
  if (!existsSync(join(apiDir, 'dist/main.js'))) {
    throw new Error('API non compilata: eseguire "npm run e2e" dalla radice (compila shared e api).');
  }
  for (const port of [dbPort, apiPort]) {
    if (await portInUse(port)) throw new Error(`Porta ${port} già in uso: chiudere il processo che la occupa (stack e2e precedente?)`);
  }
  rmSync(runDir, { recursive: true, force: true });
  mkdirSync(runDir, { recursive: true });

  const pg = new EmbeddedPostgres({
    databaseDir: join(runDir, 'pg'),
    port: dbPort,
    user: 'fcs_e2e',
    password: 'fcs_e2e_only',
    persistent: false,
    authMethod: 'scram-sha-256',
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    // io_method=sync: niente processi io_worker (PostgreSQL 18), che il postmaster
    // rilancia anche durante un arresto forzato e possono restare orfani.
    postgresFlags: ['-c', 'listen_addresses=localhost', '-c', 'fsync=off', '-c', 'io_method=sync'],
    onLog: () => {},
  });
  await pg.initialise();
  await pg.start();

  let api = null;
  const stop = async () => {
    if (api && api.exitCode === null) {
      const exited = new Promise((r) => api.once('exit', r));
      api.kill();
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
    }
    await pg.stop().catch(() => {});
  };

  try {
    await pg.createDatabase('fcs_e2e');
    const DATABASE_URL = `postgresql://fcs_e2e:fcs_e2e_only@localhost:${dbPort}/fcs_e2e`;
    const prismaCli = join(root, 'node_modules/prisma/build/index.js');
    const setupEnv = { ...process.env, DATABASE_URL, NODE_ENV: 'development' };
    execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], { cwd: apiDir, env: setupEnv, stdio: 'pipe' });
    execFileSync(process.execPath, ['prisma/seed.mjs'], { cwd: apiDir, env: setupEnv, stdio: 'pipe' });

    // Segreti generati a ogni esecuzione: nessun valore riutilizzabile nel repository.
    const key = () => randomBytes(32).toString('base64');
    api = spawn(process.execPath, [join(apiDir, 'dist/main.js')], {
      // cwd senza .env: l'API usa solo le variabili qui sotto.
      cwd: runDir,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        NODE_ENV: 'development',
        PORT: String(apiPort),
        APP_ORIGIN: `http://localhost:${webPort}`,
        DATABASE_URL,
        AUTH_PROVIDER: 'mock',
        INITIAL_GLOBAL_ADMIN: 'admin',
        DATA_ENCRYPTION_KEYS: `1:${key()}`,
        HMAC_KEY: key(),
        LOGIN_MIN_RESPONSE_MS: '0',
        MAIL_TRANSPORT: 'outbox',
        MAIL_OUTBOX_DIR: join(runDir, 'mail-outbox'),
        JOBS_ENABLED: 'false',
        LOG_LEVEL: 'warn',
      },
    });
    await waitForApi();
  } catch (e) {
    await stop();
    throw e;
  }
  console.log(`Stack e2e pronto: API http://127.0.0.1:${apiPort}, DB localhost:${dbPort}`);
  return stop;
}

// Uso da riga di comando (debug manuale): Ctrl+C ferma tutto.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const stop = await startStack();
  let stopping = false;
  const quit = async () => {
    if (stopping) return;
    stopping = true;
    await stop();
    process.exit(0);
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => void quit());
  setInterval(() => {}, 1 << 30);
}
