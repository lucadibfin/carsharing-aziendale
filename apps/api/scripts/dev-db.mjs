// Avvia PostgreSQL embedded per lo sviluppo locale (nessun Docker richiesto).
// I dati restano in <repo>/.pgdata. Solo per sviluppo: in produzione si usa il
// PostgreSQL gestito dall'infrastruttura aziendale.
import { existsSync } from 'node:fs';
import { connect } from 'node:net';
import { resolve } from 'node:path';

const dataDir = resolve(import.meta.dirname, '../../../.pgdata');
const port = Number(process.env.DEV_DB_PORT ?? 5433);

// Già avviato (in un altro terminale o rimasto attivo): messaggio chiaro invece di un errore criptico.
const inUse = await new Promise((done) => {
  const s = connect(port, '127.0.0.1');
  s.once('connect', () => (s.destroy(), done(true)));
  s.once('error', () => done(false));
});
if (inUse) {
  console.log(`La porta ${port} è già in uso: PostgreSQL di sviluppo probabilmente è già avviato. Nulla da fare.`);
  console.log('Per fermarlo: Ctrl+C nel terminale in cui è stato avviato (oppure chiudere il processo "postgres").');
  process.exit(0);
}

// Import dopo il controllo: la libreria registra hook di uscita che disturberebbero il messaggio sopra.
const { default: EmbeddedPostgres } = await import('embedded-postgres');
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
