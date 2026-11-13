// Avvia lo stack per i test end-to-end, isolato dall'ambiente di sviluppo:
// PostgreSQL embedded usa-e-getta (porta E2E_DB_PORT), migrazioni, seed e
// API compilata (apps/api/dist) su E2E_API_PORT con provider di login mock ed
// email scritte nella outbox e2e/.run/mail-outbox (da cui il test legge i codici).
// Lanciato da Playwright (webServer), che lo termina a fine test.
import EmbeddedPostgres from 'embedded-postgres';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const apiDir = join(root, 'apps/api');
const runDir = join(root, 'e2e/.run');
const dbPort = Number(process.env.E2E_DB_PORT ?? 5440);
const apiPort = Number(process.env.E2E_API_PORT ?? 3100);
const webPort = Number(process.env.E2E_WEB_PORT ?? 4300);

if (!existsSync(join(apiDir, 'dist/main.js'))) {
  console.error('API non compilata: eseguire "npm run e2e" dalla radice (compila shared e api).');
  process.exit(1);
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
  postgresFlags: ['-c', 'listen_addresses=localhost', '-c', 'fsync=off'],
  onLog: () => {},
});
await pg.initialise();
await pg.start();
await pg.createDatabase('fcs_e2e');
const DATABASE_URL = `postgresql://fcs_e2e:fcs_e2e_only@localhost:${dbPort}/fcs_e2e`;

const prismaCli = join(root, 'node_modules/prisma/build/index.js');
const setupEnv = { ...process.env, DATABASE_URL, NODE_ENV: 'development' };
execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], { cwd: apiDir, env: setupEnv, stdio: 'pipe' });
execFileSync(process.execPath, ['prisma/seed.mjs'], { cwd: apiDir, env: setupEnv, stdio: 'pipe' });

// Segreti generati a ogni esecuzione: nessun valore riutilizzabile nel repository.
const key = () => randomBytes(32).toString('base64');
const api = spawn(process.execPath, [join(apiDir, 'dist/main.js')], {
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

let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  api.kill();
  await pg.stop().catch(() => {});
  process.exit(code);
}
api.on('exit', (code) => {
  if (!stopping) {
    console.error(`API terminata inaspettatamente (codice ${code})`);
    void stop(1);
  }
});
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => void stop(0));
console.log(`Stack e2e pronto: API http://127.0.0.1:${apiPort}, DB localhost:${dbPort}`);
