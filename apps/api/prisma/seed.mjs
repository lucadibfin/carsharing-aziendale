// Seed idempotente: comuni ISTAT, testi legali v1 (bozze), parametri di default
// e, solo fuori produzione o in modalità demo (DEMO_MODE), alcune sedi di esempio.
// Uso: npm run db:seed -w api
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { readVariations } from '../scripts/istat/variazioni.mjs';
import { applyMerges, applyRecodings, readRecodings } from './comuni-recode.mjs';

try {
  process.loadEnvFile(resolve(import.meta.dirname, '../.env'));
} catch {
  // variabili già presenti nell'ambiente
}

// Cartella dei dati di riferimento; SEED_DATA_DIR serve solo ai test.
const DATA_DIR = process.env.SEED_DATA_DIR ?? resolve(import.meta.dirname, 'data');

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  await client.query('BEGIN');

  // --- Comuni ISTAT ---
  const lines = readFileSync(resolve(DATA_DIR, 'comuni.csv'), 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter((l) => !l.startsWith('#')) // righe di commento: fonte e data dell'elenco
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
  // Ricodifiche (stesso comune, codice nuovo): profili, sedi e viaggi passano al
  // nuovo codice e il vecchio sparisce. Vanno applicate prima della disattivazione.
  const recoded = await applyRecodings(client, readRecodings(resolve(DATA_DIR, 'comuni-ricodifiche.csv')));
  if (recoded.length) {
    const totals = {};
    for (const r of recoded) for (const [t, n] of Object.entries(r.moved)) totals[t] = (totals[t] ?? 0) + n;
    console.log(`Ricodifiche applicate: ${recoded.length} comuni; righe aggiornate: ${JSON.stringify(totals)}`);
  }
  // Fusioni e incorporazioni: come sopra, ma i comuni d'origine restano (non selezionabili)
  // e gli utenti spostati vedono un avviso al prossimo accesso.
  const merged = await applyMerges(client, readVariations(resolve(DATA_DIR, 'comuni-variazioni.csv')));
  for (const m of merged) {
    const label = m.type === 'FUSIONE' ? 'Fusione' : 'Incorporazione';
    console.log(`${label} applicata: ${m.from} → ${m.to} ${m.name}; righe aggiornate: ${JSON.stringify(m.moved)}`);
  }
  // I comuni soppressi/fusi restano per i viaggi storici ma non sono più selezionabili.
  const codes = lines.map((l) => l.split(';')[0]);
  await client.query(`UPDATE "Comune" SET active = false WHERE NOT (istat = ANY($1))`, [codes]);
  console.log(`Comuni: ${lines.length}`);

  // --- Coordinate dei comuni (Fonte: ISTAT, confini comunali, CC BY 4.0) ---
  // Generato con: npm run coords:istat -w api -- <confini> (vedi docs/distanze.md).
  // Si aggiornano solo i comuni il cui punto è cambiato, e per quelli si
  // invalidano le distanze già calcolate.
  const coordFile = resolve(DATA_DIR, 'comuni-coordinate.csv');
  if (existsSync(coordFile)) {
    const coords = readFileSync(coordFile, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#'))
      .slice(1)
      .map((l) => l.split(';'));
    let changed = 0;
    for (let i = 0; i < coords.length; i += BATCH) {
      const chunk = coords.slice(i, i + BATCH);
      const values = chunk.map((_, j) => `($${j * 3 + 1}, $${j * 3 + 2}::float8, $${j * 3 + 3}::float8)`).join(',');
      const r = await client.query(
        `UPDATE "Comune" c SET lat = v.lat, lon = v.lon FROM (VALUES ${values}) AS v(istat, lat, lon)
         WHERE c.istat = v.istat AND (c.lat IS DISTINCT FROM v.lat OR c.lon IS DISTINCT FROM v.lon)
         RETURNING c.istat`,
        chunk.flat(),
      );
      changed += r.rowCount ?? 0;
      if (r.rowCount) await client.query(`DELETE FROM "DistanceCache" WHERE "comuneIstat" = ANY($1)`, [r.rows.map((x) => x.istat)]);
    }
    const missing = await client.query('SELECT count(*)::int AS n FROM "Comune" WHERE active AND lat IS NULL');
    console.log(`Coordinate ISTAT: ${coords.length} comuni, ${changed} aggiornati; comuni attivi senza coordinate: ${missing.rows[0].n}`);
  }

  // --- Testi legali v1 ---
  // In produzione si inseriscono solo se assenti (una versione pubblicata non cambia mai:
  // le modifiche diventano una nuova versione). In sviluppo la bozza v1 si riallinea ai file.
  const docs = [
    ['PRIVACY_NOTICE', 'Informativa privacy', 'informativa-BOZZA.md'],
    ['TERMS', 'Termini d’uso', 'termini-BOZZA.md'],
  ];
  const onConflict =
    process.env.NODE_ENV === 'production' ? 'DO NOTHING' : 'DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content';
  for (const [type, title, file] of docs) {
    const content = readFileSync(resolve(import.meta.dirname, '../../../docs/legal', file), 'utf8');
    await client.query(
      `INSERT INTO "PolicyDocument" (id, type, version, title, content)
       VALUES (gen_random_uuid(), $1, 1, $2, $3) ON CONFLICT (type, version) ${onConflict}`,
      [type, title, content],
    );
  }

  // --- Sedi di esempio (solo sviluppo e demo; elenco uguale a DEMO_SITES in src/demo/demo-data.service.ts) ---
  const demoMode = ['true', '1'].includes(process.env.DEMO_MODE ?? '');
  if (process.env.NODE_ENV !== 'production' || demoMode) {
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
    console.log(demoMode ? 'Sedi di esempio create (demo)' : 'Sedi di esempio create (solo sviluppo)');

    // Ripiego per lo sviluppo finché non c'è comuni-coordinate.csv: coordinate
    // approssimative di alcuni comuni. Non sovrascrivono quelle già presenti.
    const devCoords = [
      ['015146', 45.4642, 9.19], // Milano
      ['108033', 45.5845, 9.2744], // Monza
      ['015209', 45.5358, 9.2386], // Sesto San Giovanni
      ['016024', 45.6983, 9.6773], // Bergamo
      ['058091', 41.9028, 12.4964], // Roma
      ['001272', 45.0703, 7.6869], // Torino
    ];
    for (const [istat, lat, lon] of devCoords) {
      await client.query(`UPDATE "Comune" SET lat = $2, lon = $3 WHERE istat = $1 AND lat IS NULL`, [istat, lat, lon]);
    }
  }

  await client.query('COMMIT');
  console.log('Seed completato.');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  await client.end();
}
