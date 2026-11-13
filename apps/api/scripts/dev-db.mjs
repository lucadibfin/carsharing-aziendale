// Avvia PostgreSQL embedded per lo sviluppo locale (nessun Docker richiesto).
// I dati restano in <repo>/.pgdata. Solo per sviluppo: in produzione si usa il
// container PostgreSQL definito in infra/docker-compose.prod.yml.
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const dataDir = resolve(import.meta.dirname, '../../../.pgdata');
const port = Number(process.env.DEV_DB_PORT ?? 5433);

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'fcs',
  password: process.env.DEV_DB_PASSWORD ?? 'fcs_dev_only',
  port,
  persistent: true,
  authMethod: 'scram-sha-256',
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  // Ascolta solo su localhost.
  postgresFlags: ['-c', 'listen_addresses=localhost'],
  onLog: () => {},
});

const fresh = !existsSync(dataDir);
if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase('fcs');

console.log(`PostgreSQL embedded in ascolto su localhost:${port} (db: fcs, dati: ${dataDir})`);
console.log('Ctrl+C per fermarlo.');

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
// Mantiene vivo il processo.
setInterval(() => {}, 1 << 30);
