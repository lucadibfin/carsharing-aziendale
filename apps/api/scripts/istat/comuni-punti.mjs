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
// prisma/data/comuni-variazioni.csv (fusioni: unione dei territori d'origine). Anche
// un comune che ne ha incorporato un altro dopo la data dei confini prende il punto
// interno all'unione dei territori, finché i confini contengono ancora l'incorporato.
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
    const parts = (v.type === 'APPROSSIMATO' ? v.origins.slice(0, 1) : v.origins).map((o) => ringsByCode.get(o));
    const p = pointOnSurfaceOfUnion(parts, UNION_TOLERANCE[crs.kind]);
    if (!p || !parts.some((rings) => isInside(rings, p.x, p.y))) {
      unresolved.push({ code, reason: 'impossibile calcolare un punto interno ai territori d\'origine' });
      continue;
    }
    derived.push({ ...toLatLon(crs, p, code), variation: v });
  }
  return { derived, unresolved };
}

/**
 * Comuni che hanno incorporato altri comuni dopo la data dei confini: finché i
 * confini contengono ancora gli incorporati, il punto si calcola sull'unione dei
 * territori (incorporante + incorporati). Quando escono i confini successivi gli
 * incorporati spariscono e vale di nuovo il poligono dell'incorporante.
 * @returns {{ overrides: { code, lat, lon, variation }[], unresolved: { code: string, reason: string }[] }}
 */
export function incorporationPoints({ crs, ringsByCode }, variations) {
  const overrides = [];
  const unresolved = [];
  for (const v of variations.filter((x) => x.type === 'INCORPORAZIONE')) {
    if (!ringsByCode.has(v.code)) continue; // incorporante assente dai confini: lo segnala il confronto con l'elenco
    const present = v.origins.filter((o) => ringsByCode.has(o));
    if (present.length < 2) continue; // confini già aggiornati
    const parts = present.map((o) => ringsByCode.get(o));
    const p = pointOnSurfaceOfUnion(parts, UNION_TOLERANCE[crs.kind]);
    if (!p || !parts.some((rings) => isInside(rings, p.x, p.y))) {
      unresolved.push({ code: v.code, reason: 'impossibile calcolare un punto interno all\'unione dei territori' });
      continue;
    }
    overrides.push({ ...toLatLon(crs, p, v.code), variation: { ...v, origins: present } });
  }
  return { overrides, unresolved };
}

/** Comuni confinanti (vertici in comune, entro la tolleranza) nei confini: proposta di incorporante. */
export function neighbours({ crs, ringsByCode }, code) {
  const tol = UNION_TOLERANCE[crs.kind];
  const bbox = (rings) => {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const r of rings) for (const [x, y] of r) {
      b[0] = Math.min(b[0], x);
      b[1] = Math.min(b[1], y);
      b[2] = Math.max(b[2], x);
      b[3] = Math.max(b[3], y);
    }
    return b;
  };
  const target = ringsByCode.get(code);
  if (!target) return [];
  const tb = bbox(target);
  const cell = (x, y) => `${Math.floor(x / tol)},${Math.floor(y / tol)}`;
  const grid = new Set(target.flat().map(([x, y]) => cell(x, y)));
  const near = (x, y) => {
    const cx = Math.floor(x / tol);
    const cy = Math.floor(y / tol);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (grid.has(`${cx + dx},${cy + dy}`)) return true;
    return false;
  };
  const found = [];
  for (const [other, rings] of ringsByCode) {
    if (other === code) continue;
    const b = bbox(rings);
    if (b[0] > tb[2] + tol || b[2] < tb[0] - tol || b[1] > tb[3] + tol || b[3] < tb[1] - tol) continue;
    const shared = rings.flat().filter(([x, y]) => near(x, y)).length;
    if (shared > 0) found.push({ code: other, shared });
  }
  return found.sort((a, b) => b.shared - a.shared).map((f) => f.code);
}

/** "Com01012025_WGS84.shp" → "01/01/2025". */
export function vintageFromName(name) {
  const m = basename(name).match(/(\d{2})(\d{2})(\d{4})/);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : null;
}

function describeDerivation(v) {
  if (v.type === 'FUSIONE') return `punto interno all'unione dei territori di ${v.origins.join('+')}, comune successivo alla data dei confini`;
  if (v.type === 'INCORPORAZIONE') return `punto interno all'unione dei territori di ${v.origins.join('+')}, incorporazione successiva alla data dei confini`;
  return `punto del comune d'origine ${v.origins[0]} (stima), comune successivo alla data dei confini`;
}

export function toCsv(points, sourceName, derived = []) {
  const vintage = vintageFromName(sourceName);
  const all = [...points, ...derived].sort((a, b) => a.code.localeCompare(b.code));
  return [
    `# Fonte: ISTAT - Confini delle unità amministrative a fini statistici${vintage ? ` al ${vintage}` : ''} (${basename(sourceName)}). Licenza CC BY 4.0.`,
    '# Punto interno al territorio comunale (point on surface), WGS84, calcolato con apps/api/scripts/istat/comuni-punti.mjs',
    ...derived.map((d) => `# ${d.code} ${d.variation.name}: ${describeDerivation(d.variation)}`),
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
  const fromVariations = derivePoints(computed, variations, missing);
  const incorporated = incorporationPoints(computed, variations);
  const derived = [...fromVariations.derived, ...incorporated.overrides];
  const unresolved = [...fromVariations.unresolved, ...incorporated.unresolved];
  // Il punto calcolato sull'unione sostituisce quello del solo territorio dell'incorporante.
  const overridden = new Set(incorporated.overrides.map((o) => o.code));
  writeFileSync(out, toCsv(points.filter((p) => !overridden.has(p.code)), path, derived), 'utf8');

  console.log(`Sistema di riferimento: ${crs.kind === 'utm' ? `UTM ${crs.zone}N` : 'geografico (lon/lat)'}`);
  console.log(`Confini: ${points.length} comuni (al ${vintageFromName(path) ?? 'data non indicata nel nome'}). Elenco: ${list.length} comuni.`);
  if (failed.length) console.warn(`Geometrie non valide (nessun punto): ${failed.join(', ')}`);
  const how = (v) =>
    v.type === 'FUSIONE'
      ? `unione di ${v.origins.join(' + ')}`
      : v.type === 'INCORPORAZIONE'
        ? `incorporazione, unione di ${v.origins.join(' + ')}`
        : `stima dal comune ${v.origins[0]}`;
  for (const d of derived) console.log(`  ${d.code} ${d.variation.name}: ${how(d.variation)} → ${d.lat}, ${d.lon}`);
  for (const u of unresolved) {
    console.warn(`  SENZA COORDINATE ${u.code} ${names.get(u.code) ?? ''}: ${u.reason}.`);
    console.warn('    Proposta: se è nato da fusione, aggiungere a comuni-variazioni.csv una riga FUSIONE con i codici d\'origine;');
    console.warn('    se è nato da un distacco di territorio, una riga APPROSSIMATO con il comune d\'origine (stima, da sostituire con i confini successivi);');
    console.warn('    se è un cambio di codice, aggiornare l\'elenco con comuni:istat, che registra le ricodifiche.');
  }
  // Codici dei confini che non sono più nell'elenco: confluiti in fusioni oppure soppressi/incorporati/ricodificati.
  const origins = new Map(variations.flatMap((v) => v.origins.filter((o) => o !== v.code).map((o) => [o, v])));
  const others = extra.filter((c) => !origins.has(c));
  for (const c of extra.filter((x) => origins.has(x))) console.log(`  ${c}: confluito in ${origins.get(c).code} ${origins.get(c).name} (coordinate conservate per i viaggi storici)`);
  if (others.length) {
    console.warn(`  Codici nei confini ma non nell'elenco (${others.length}): ${others.slice(0, 20).join(', ')}${others.length > 20 ? '…' : ''}`);
    console.warn('    Soppressi, incorporati o ricodificati dopo la data dei confini: coordinate conservate per i viaggi storici.');
    if (others.length > 20) console.warn('    Molti codici: l\'elenco potrebbe essere più vecchio dei confini (ricodifiche). Aggiornarlo con comuni:istat.');
    else {
      for (const c of others) {
        const near = neighbours(computed, c).filter((n) => names.has(n));
        console.warn(`    ${c}: se è stato incorporato, l'incorporante è probabilmente uno dei comuni confinanti:`);
        console.warn(`      ${near.length ? near.map((n) => `${n} ${names.get(n)}`).join(', ') : 'nessun confinante trovato'}`);
        console.warn(`      Indicarlo con: npm run comuni:istat -w api -- <elenco.csv> --al GG/MM/AAAA --incorporazione ${c}=<codice>`);
      }
    }
  }
  console.log(`Comuni dell'elenco senza coordinate: ${unresolved.length}`);
  console.log(`Scritto: ${out}. Per caricarlo nel database: npm run db:seed`);
}
