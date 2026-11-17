// Calcola per ogni comune un punto INTERNO al territorio dai confini ISTAT e lo
// salva in apps/api/prisma/data/comuni-coordinate.csv (caricato dal seed).
//
// Uso (dalla radice del repository):
//   npm run coords:istat -w api -- <confini.shp | confini.geojson> [--out file.csv]
//
// Dati: ISTAT, "Confini delle unità amministrative a fini statistici", versione
// generalizzata, WGS84 UTM 32N. Licenza CC BY 4.0: va citata la fonte ("Fonte: ISTAT").
//
// Elenco dei comuni e confini possono avere date diverse (l'elenco può essere più
// recente): i comuni nati dopo la data dei confini sono descritti in
// prisma/data/comuni-variazioni.csv (fusioni: unione dei territori d'origine).
// Istruzioni complete: docs/distanze.md
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBoundaries } from './boundaries.mjs';
import { isInside, pointOnSurface, pointOnSurfaceOfUnion, utmToLatLon } from './geo.mjs';
import { readVariations } from './variazioni.mjs';

const dataDir = resolve(import.meta.dirname, '../../prisma/data');

/** Fessura massima tra comuni confinanti nei confini generalizzati, da considerare territorio continuo. */
const UNION_TOLERANCE = { utm: 50, geographic: 0.0005 };

function toLatLon(crs, p, code) {
  const { lat, lon } = crs.kind === 'utm' ? utmToLatLon(p.x, p.y, crs.zone) : { lat: p.y, lon: p.x };
  if (!(lat > 35 && lat < 48 && lon > 6 && lon < 19)) {
    throw new Error(`Coordinate fuori dall'Italia per il comune ${code}: controllare il sistema di riferimento del file`);
  }
  return { code, lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 };
}

export function computePoints(path) {
  const { crs, features } = readBoundaries(path);
  // Un comune può comparire in più elementi (parti separate): si uniscono gli anelli.
  const ringsByCode = new Map();
  for (const f of features) ringsByCode.set(f.code, [...(ringsByCode.get(f.code) ?? []), ...f.rings]);

  const points = [];
  const failed = [];
  for (const [code, rings] of ringsByCode) {
    const p = pointOnSurface(rings);
    if (!p || !isInside(rings, p.x, p.y)) {
      failed.push(code);
      continue;
    }
    points.push(toLatLon(crs, p, code));
  }
  points.sort((a, b) => a.code.localeCompare(b.code));
  return { points, failed, crs, ringsByCode };
}

/**
 * Coordinate dei comuni dell'elenco che non hanno un poligono nei confini,
 * secondo il registro delle variazioni.
 * @returns {{ derived: { code, lat, lon, variation }[], unresolved: { code: string, reason: string }[] }}
 */
export function derivePoints({ crs, ringsByCode }, variations, missingCodes) {
  const byCode = new Map(variations.map((v) => [v.code, v]));
  const derived = [];
  const unresolved = [];
  for (const code of missingCodes) {
    const v = byCode.get(code);
    if (!v) {
      unresolved.push({ code, reason: 'non presente nei confini e non descritto in comuni-variazioni.csv' });
      continue;
    }
    const absent = v.origins.filter((o) => !ringsByCode.has(o));
    if (absent.length) {
      unresolved.push({ code, reason: `comuni d'origine assenti dai confini: ${absent.join(', ')}` });
      continue;
    }
    const parts = (v.type === 'FUSIONE' ? v.origins : v.origins.slice(0, 1)).map((o) => ringsByCode.get(o));
    const p = pointOnSurfaceOfUnion(parts, UNION_TOLERANCE[crs.kind]);
    if (!p || !parts.some((rings) => isInside(rings, p.x, p.y))) {
      unresolved.push({ code, reason: 'impossibile calcolare un punto interno ai territori d\'origine' });
      continue;
    }
    derived.push({ ...toLatLon(crs, p, code), variation: v });
  }
  return { derived, unresolved };
}

/** "Com01012025_WGS84.shp" → "01/01/2025". */
export function vintageFromName(name) {
  const m = basename(name).match(/(\d{2})(\d{2})(\d{4})/);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : null;
}

export function toCsv(points, sourceName, derived = []) {
  const vintage = vintageFromName(sourceName);
  const all = [...points, ...derived].sort((a, b) => a.code.localeCompare(b.code));
  return [
    `# Fonte: ISTAT - Confini delle unità amministrative a fini statistici${vintage ? ` al ${vintage}` : ''} (${basename(sourceName)}). Licenza CC BY 4.0.`,
    '# Punto interno al territorio comunale (point on surface), WGS84, calcolato con apps/api/scripts/istat/comuni-punti.mjs',
    ...derived.map(
      (d) =>
        `# ${d.code} ${d.variation.name}: ${d.variation.type === 'FUSIONE' ? `punto interno all'unione dei territori di ${d.variation.origins.join('+')}` : `punto del comune d'origine ${d.variation.origins[0]} (stima)`}, comune successivo alla data dei confini`,
    ),
    'istat;lat;lon',
    ...all.map((p) => `${p.code};${p.lat.toFixed(6)};${p.lon.toFixed(6)}`),
    '',
  ].join('\n');
}

function readList(listPath) {
  return readFileSync(listPath, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter((l) => !l.startsWith('#'))
    .slice(1)
    .map((l) => {
      const [code, name, province] = l.split(';');
      return { code, name, province };
    });
}

/** Confronto con l'elenco dei comuni usato dall'app (apps/api/prisma/data/comuni.csv). */
export function compareWithList(points, listPath = resolve(dataDir, 'comuni.csv')) {
  const list = readList(listPath).map((r) => r.code);
  const have = new Set(points.map((p) => p.code));
  const listed = new Set(list);
  return { missing: list.filter((c) => !have.has(c)), extra: [...have].filter((c) => !listed.has(c)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const input = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
  const outIdx = args.indexOf('--out');
  if (!input) {
    console.error('Uso: npm run coords:istat -w api -- <confini.shp | confini.geojson> [--out file.csv]');
    process.exit(1);
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const out = outIdx >= 0 ? resolve(cwd, args[outIdx + 1]) : resolve(dataDir, 'comuni-coordinate.csv');
  const path = resolve(cwd, input);
  const listPath = resolve(dataDir, 'comuni.csv');
  const list = readList(listPath);
  const names = new Map(list.map((r) => [r.code, `${r.name} (${r.province})`]));

  const computed = computePoints(path);
  const { points, failed, crs } = computed;
  const { missing, extra } = compareWithList(points, listPath);
  const variations = readVariations();
  const { derived, unresolved } = derivePoints(computed, variations, missing);
  writeFileSync(out, toCsv(points, path, derived), 'utf8');

  console.log(`Sistema di riferimento: ${crs.kind === 'utm' ? `UTM ${crs.zone}N` : 'geografico (lon/lat)'}`);
  console.log(`Confini: ${points.length} comuni (al ${vintageFromName(path) ?? 'data non indicata nel nome'}). Elenco: ${list.length} comuni.`);
  if (failed.length) console.warn(`Geometrie non valide (nessun punto): ${failed.join(', ')}`);
  for (const d of derived) {
    console.log(
      `  ${d.code} ${d.variation.name}: ${d.variation.type === 'FUSIONE' ? `unione di ${d.variation.origins.join(' + ')}` : `stima dal comune ${d.variation.origins[0]}`} → ${d.lat}, ${d.lon}`,
    );
  }
  for (const u of unresolved) {
    console.warn(`  SENZA COORDINATE ${u.code} ${names.get(u.code) ?? ''}: ${u.reason}.`);
    console.warn('    Proposta: se è nato da fusione, aggiungere a comuni-variazioni.csv una riga FUSIONE con i codici d\'origine;');
    console.warn('    se è nato da un distacco di territorio, una riga APPROSSIMATO con il comune d\'origine (stima, da sostituire con i confini successivi);');
    console.warn('    se è un cambio di codice, aggiornare l\'elenco con comuni:istat, che registra le ricodifiche.');
  }
  // Codici dei confini che non sono più nell'elenco: confluiti in fusioni oppure soppressi/incorporati/ricodificati.
  const origins = new Map(variations.flatMap((v) => v.origins.map((o) => [o, v])));
  const others = extra.filter((c) => !origins.has(c));
  for (const c of extra.filter((x) => origins.has(x))) console.log(`  ${c}: confluito in ${origins.get(c).code} ${origins.get(c).name} (coordinate conservate per i viaggi storici)`);
  if (others.length) {
    console.warn(`  Codici nei confini ma non nell'elenco (${others.length}): ${others.slice(0, 20).join(', ')}${others.length > 20 ? '…' : ''}`);
    console.warn('    Soppressi, incorporati o ricodificati dopo la data dei confini: coordinate conservate per i viaggi storici.');
    if (others.length > 20) console.warn('    Molti codici: l\'elenco potrebbe essere più vecchio dei confini (ricodifiche). Aggiornarlo con comuni:istat.');
  }
  console.log(`Comuni dell'elenco senza coordinate: ${unresolved.length}`);
  console.log(`Scritto: ${out}. Per caricarlo nel database: npm run db:seed`);
}
