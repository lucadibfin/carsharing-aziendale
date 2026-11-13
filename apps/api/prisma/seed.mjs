// Seed idempotente: comuni ISTAT, testi legali v1 (bozze), parametri di default
// e, solo fuori produzione, alcune sedi di esempio.
// Uso: npm run db:seed -w api
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

try {
  process.loadEnvFile(resolve(import.meta.dirname, '../.env'));
} catch {
  // variabili già presenti nell'ambiente
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  await client.query('BEGIN');

  // --- Comuni ISTAT ---
  const lines = readFileSync(resolve(import.meta.dirname, 'data/comuni.csv'), 'utf8')
    .trim()
    .split('\n')
    .slice(1);
  const BATCH = 1000;
  for (let i = 0; i < lines.length; i += BATCH) {
    const chunk = lines.slice(i, i + BATCH).map((l) => l.split(';'));
    const values = [];
    const params = [];
    chunk.forEach((c, j) => {
      values.push(`($${j * 4 + 1}, $${j * 4 + 2}, $${j * 4 + 3}, $${j * 4 + 4}, true)`);
      params.push(c[0], c[1], c[2], c[3]);
    });
    await client.query(
      `INSERT INTO "Comune" (istat, name, province, region, active) VALUES ${values.join(',')}
       ON CONFLICT (istat) DO UPDATE SET name = EXCLUDED.name, province = EXCLUDED.province,
         region = EXCLUDED.region, active = true`,
      params,
    );
  }
  // I comuni soppressi/fusi restano per i viaggi storici ma non sono più selezionabili.
  const codes = lines.map((l) => l.split(';')[0]);
  await client.query(`UPDATE "Comune" SET active = false WHERE NOT (istat = ANY($1))`, [codes]);
  console.log(`Comuni: ${lines.length}`);

  // --- Testi legali v1 (solo se assenti) ---
  const docs = [
    ['PRIVACY_NOTICE', 'Informativa privacy', 'informativa-BOZZA.md'],
    ['TERMS', 'Termini d’uso', 'termini-BOZZA.md'],
  ];
  for (const [type, title, file] of docs) {
    const content = readFileSync(resolve(import.meta.dirname, '../../../docs/legal', file), 'utf8');
    await client.query(
      `INSERT INTO "PolicyDocument" (id, type, version, title, content)
       VALUES (gen_random_uuid(), $1, 1, $2, $3) ON CONFLICT (type, version) DO NOTHING`,
      [type, title, content],
    );
  }

  // --- Sedi di esempio (solo sviluppo) ---
  if (process.env.NODE_ENV !== 'production') {
    const sites = [
      ['Sede di Milano', 'Via di Esempio 1, Milano', '015146'],
      ['Sede di Roma', 'Via di Esempio 2, Roma', '058091'],
      ['Sede di Torino', 'Via di Esempio 3, Torino', '001272'],
    ];
    for (const [name, address, istat] of sites) {
      await client.query(
        `INSERT INTO "Site" (id, name, address, "comuneIstat") VALUES (gen_random_uuid(), $1, $2, $3)
         ON CONFLICT (name) DO NOTHING`,
        [name, address, istat],
      );
    }
    console.log('Sedi di esempio create (solo sviluppo)');
  }

  await client.query('COMMIT');
  console.log('Seed completato.');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  await client.end();
}
