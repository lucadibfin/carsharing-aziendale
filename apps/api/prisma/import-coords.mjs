// Importa le coordinate (centroide o sede municipale) dei comuni da un file CSV.
// Formato: intestazione "istat;lat;lon", separatore ";" e punto decimale. Es.:
//   istat;lat;lon
//   015146;45.4642;9.1900
// Uso: npm run db:import-coords -w api -- <percorso del file CSV>
// Vedi docs/distanze.md per le fonti dei dati e le licenze.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

try {
  process.loadEnvFile(resolve(import.meta.dirname, '../.env'));
} catch {
  // variabili già presenti nell'ambiente
}

const file = process.argv[2];
if (!file) {
  console.error('Uso: npm run db:import-coords -w api -- <file.csv>');
  process.exit(1);
}

const rows = readFileSync(resolve(process.cwd(), file), 'utf8')
  .replace(/^﻿/, '')
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .map((l, i) => {
    const [istat, lat, lon] = l.split(';').map((x) => x.trim());
    const la = Number(lat);
    const lo = Number(lon);
    // Controllo grossolano: coordinate dentro l'Italia.
    if (!/^\d{6}$/.test(istat ?? '') || !(la > 35 && la < 48) || !(lo > 6 && lo < 19)) {
      throw new Error(`Riga ${i + 2} non valida: ${l}`);
    }
    return [istat, la, lo];
  });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('BEGIN');
  let updated = 0;
  for (const [istat, lat, lon] of rows) {
    const r = await client.query('UPDATE "Comune" SET lat = $2, lon = $3 WHERE istat = $1', [istat, lat, lon]);
    updated += r.rowCount ?? 0;
  }
  // Le distanze stimate con le coordinate precedenti vanno ricalcolate.
  await client.query(`DELETE FROM "DistanceCache"`);
  await client.query('COMMIT');
  const missing = await client.query('SELECT count(*)::int AS n FROM "Comune" WHERE active AND (lat IS NULL OR lon IS NULL)');
  console.log(`Coordinate aggiornate: ${updated} comuni. Comuni attivi ancora senza coordinate: ${missing.rows[0].n}`);
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  await client.end();
}
