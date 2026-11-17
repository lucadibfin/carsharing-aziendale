// Ricodifiche dei comuni ISTAT: stesso comune (stessa denominazione, stesso
// territorio), codice nuovo. Succede ad esempio quando cambia la provincia, come
// per la riorganizzazione delle province sarde: non è una soppressione seguita
// dalla nascita di un nuovo comune.
//
// Il registro è data/comuni-ricodifiche.csv (vecchio;nuovo;nome;dal), scritto da
// `npm run comuni:istat` e applicato dal seed: profili, sedi, tappe dei viaggi e
// comuni di salita passano al nuovo codice e il vecchio viene eliminato.
//
// Fusioni e incorporazioni (righe FUSIONE e INCORPORAZIONE di data/comuni-variazioni.csv)
// spostano i riferimenti allo stesso modo, ma i comuni d'origine restano nel DB, non
// selezionabili, e gli utenti spostati vedono un avviso (il nome del comune cambia).
// Le ricodifiche non danno avviso: cambia solo il codice.
import { existsSync, readFileSync } from 'node:fs';

/**
 * Colonne che contengono un codice comune. Il test "ricodifiche" verifica che
 * l'elenco coincida con lo schema: aggiungendo una colonna va aggiunta anche qui.
 */
export const COMUNE_COLUMNS = [
  { table: 'User', column: 'comuneIstat' },
  { table: 'Site', column: 'comuneIstat' },
  { table: 'TripStop', column: 'comuneIstat' },
  { table: 'TripParticipant', column: 'boardingComune' },
  { table: 'DistanceCache', column: 'comuneIstat' },
];

/** @returns {{ from: string, to: string, name: string, since: string }[]} */
export function readRecodings(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .replace(/^﻿/, '') // BOM aggiunto da alcuni editor di Windows
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith('#'))
    .slice(1)
    .map((l) => {
      const [from, to, name, since] = l.split(';');
      if (!/^\d{6}$/.test(from ?? '') || !/^\d{6}$/.test(to ?? '')) throw new Error(`Riga di ricodifica non valida: ${l}`);
      return { from, to, name: name ?? '', since: since ?? '' };
    });
}

/**
 * Applica le ricodifiche (in ordine: gestisce anche catene A→B→C). Idempotente:
 * un codice vecchio già assente dal DB viene saltato. Da eseguire dentro una
 * transazione, DOPO l'inserimento dei comuni dell'elenco corrente.
 * @param {import('pg').Client} client
 */
export async function applyRecodings(client, recodings) {
  const done = [];
  for (const r of recodings) {
    if (r.from === r.to) continue;
    const old = await client.query('SELECT lat, lon FROM "Comune" WHERE istat = $1', [r.from]);
    if (old.rowCount === 0) continue;
    const target = await client.query('SELECT 1 FROM "Comune" WHERE istat = $1', [r.to]);
    if (target.rowCount === 0) throw new Error(`Ricodifica ${r.from} → ${r.to}: il nuovo codice non è nell'elenco dei comuni`);

    const moved = await moveReferences(client, r.from, r.to);
    // Stesso territorio: se il nuovo codice non ha ancora coordinate, si tengono quelle del vecchio.
    await client.query('UPDATE "Comune" SET lat = $2, lon = $3 WHERE istat = $1 AND lat IS NULL', [r.to, old.rows[0].lat, old.rows[0].lon]);
    await client.query('DELETE FROM "Comune" WHERE istat = $1', [r.from]);
    done.push({ ...r, moved });
  }
  return done;
}

/**
 * Sposta profili, sedi, tappe e comuni di salita da un codice all'altro; le distanze
 * in cache si ricalcolano. Con `noticeFrom` (nome del comune di partenza) gli utenti
 * spostati vedono un avviso al prossimo accesso: se ne avevano già uno, resta il nome
 * originale (es. A fuso in B, poi B incorporato in C → "A è ora C").
 */
async function moveReferences(client, from, to, noticeFrom = null) {
  const moved = {};
  for (const { table, column } of COMUNE_COLUMNS) {
    if (table === 'DistanceCache') {
      // Chiave diversa (e, per fusioni e incorporazioni, punto diverso): si ricalcola al primo uso.
      await client.query(`DELETE FROM "DistanceCache" WHERE "comuneIstat" = $1`, [from]);
      continue;
    }
    const u =
      table === 'User' && noticeFrom
        ? await client.query(
            `UPDATE "User" SET "comuneIstat" = $2, "comuneChangedFrom" = COALESCE("comuneChangedFrom", $3) WHERE "comuneIstat" = $1`,
            [from, to, noticeFrom],
          )
        : await client.query(`UPDATE "${table}" SET "${column}" = $2 WHERE "${column}" = $1`, [from, to]);
    if (u.rowCount) moved[table] = u.rowCount;
  }
  if (moved.TripStop) await mergeDuplicateStops(client, to);
  return moved;
}

/**
 * Dopo una fusione un percorso può passare due volte dallo stesso comune
 * (Castegnero → Nanto diventa Castegnero Nanto → Castegnero Nanto): si tiene la
 * prima tappa e si rinumerano le altre senza buchi.
 */
async function mergeDuplicateStops(client, comune) {
  const del = await client.query(
    `DELETE FROM "TripStop" a USING "TripStop" b
     WHERE a."seriesId" = b."seriesId" AND a."comuneIstat" = $1 AND b."comuneIstat" = $1 AND a."order" > b."order"
     RETURNING a."seriesId"`,
    [comune],
  );
  const series = [...new Set(del.rows.map((r) => r.seriesId))];
  if (!series.length) return;
  // Due passaggi per non violare l'unicità (seriesId, order) durante la rinumerazione.
  await client.query(
    `UPDATE "TripStop" t SET "order" = -1 - r.rn FROM (
       SELECT id, (row_number() OVER (PARTITION BY "seriesId" ORDER BY "order") - 1)::int AS rn
       FROM "TripStop" WHERE "seriesId" = ANY($1::uuid[])
     ) r WHERE t.id = r.id`,
    [series],
  );
  await client.query(`UPDATE "TripStop" SET "order" = -1 - "order" WHERE "seriesId" = ANY($1::uuid[])`, [series]);
}

/**
 * Fusioni e incorporazioni (righe FUSIONE e INCORPORAZIONE di comuni-variazioni.csv):
 * profili, sedi, tappe e comuni di salita passano dai comuni d'origine al comune
 * risultante, come per le ricodifiche, e gli utenti spostati ricevono un avviso.
 * A differenza delle ricodifiche i comuni d'origine NON vengono eliminati: restano
 * nel DB, con le loro coordinate, e il seed li rende non selezionabili perché non
 * sono più nell'elenco. Idempotente.
 * Restituisce gli spostamenti applicati per la prima volta (comune d'origine ancora
 * attivo) o che hanno spostato qualche riga.
 * @param {import('pg').Client} client
 */
export async function applyMerges(client, variations) {
  const done = [];
  for (const v of variations.filter((x) => x.type === 'FUSIONE' || x.type === 'INCORPORAZIONE')) {
    for (const from of v.origins.filter((o) => o !== v.code)) {
      const old = await client.query('SELECT name, active FROM "Comune" WHERE istat = $1', [from]);
      if (old.rowCount === 0) continue;
      const target = await client.query('SELECT 1 FROM "Comune" WHERE istat = $1', [v.code]);
      if (target.rowCount === 0) throw new Error(`${v.type} ${from} → ${v.code}: il comune risultante non è nell'elenco dei comuni`);
      const moved = await moveReferences(client, from, v.code, old.rows[0].name);
      if (old.rows[0].active || Object.keys(moved).length) done.push({ type: v.type, from, to: v.code, name: v.name, moved });
    }
  }
  return done;
}
