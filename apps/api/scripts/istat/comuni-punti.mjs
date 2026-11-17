// Calcola per ogni comune un punto INTERNO al territorio dai confini ISTAT e lo
// salva in apps/api/prisma/data/comuni-coordinate.csv (caricato dal seed).
//
// Uso (dalla radice del repository):
//   npm run coords:istat -w api -- <confini.shp | confini.geojson> [--out file.csv]
//
// Dati: ISTAT, "Confini delle unità amministrative a fini statistici", versione
// generalizzata, WGS84 UTM 32N. Licenza CC BY 4.0: va citata la fonte ("Fonte: ISTAT").
// Istruzioni complete: docs/distanze.md
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBoundaries } from './boundaries.mjs';
import { isInside, pointOnSurface, utmToLatLon } from './geo.mjs';

const dataDir = resolve(import.meta.dirname, '../../prisma/data');

export function computePoints(path) {
  const { crs, features } = readBoundaries(path);
  // Un comune può comparire in più elementi (parti separate): si uniscono gli anelli.
  const byCode = new Map();
  for (const f of features) byCode.set(f.code, [...(byCode.get(f.code) ?? []), ...f.rings]);

  const points = [];
  const failed = [];
  for (const [code, rings] of byCode) {
    const p = pointOnSurface(rings);
    if (!p || !isInside(rings, p.x, p.y)) {
      failed.push(code);
      continue;
    }
    const { lat, lon } = crs.kind === 'utm' ? utmToLatLon(p.x, p.y, crs.zone) : { lat: p.y, lon: p.x };
    if (!(lat > 35 && lat < 48 && lon > 6 && lon < 19)) {
      throw new Error(`Coordinate fuori dall'Italia per il comune ${code}: controllare il sistema di riferimento del file`);
    }
    points.push({ code, lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 });
  }
  points.sort((a, b) => a.code.localeCompare(b.code));
  return { points, failed, crs };
}

/** "Com01012025_WGS84.shp" → "01/01/2025". */
export function vintageFromName(name) {
  const m = basename(name).match(/(\d{2})(\d{2})(\d{4})/);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : null;
}

export function toCsv(points, sourceName) {
  const vintage = vintageFromName(sourceName);
  return [
    `# Fonte: ISTAT - Confini delle unità amministrative a fini statistici${vintage ? ` al ${vintage}` : ''} (${basename(sourceName)}). Licenza CC BY 4.0.`,
    '# Punto interno al territorio comunale (point on surface), WGS84, calcolato con apps/api/scripts/istat/comuni-punti.mjs',
    'istat;lat;lon',
    ...points.map((p) => `${p.code};${p.lat.toFixed(6)};${p.lon.toFixed(6)}`),
    '',
  ].join('\n');
}

/** Confronto con l'elenco dei comuni usato dall'app (apps/api/prisma/data/comuni.csv). */
export function compareWithList(points, listPath = resolve(dataDir, 'comuni.csv')) {
  const list = readFileSync(listPath, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter((l) => !l.startsWith('#'))
    .slice(1)
    .map((l) => l.split(';')[0]);
  const have = new Set(points.map((p) => p.code));
  const listed = new Set(list);
  return { missing: list.filter((c) => !have.has(c)), extra: [...have].filter((c) => !listed.has(c)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const input = args.find((a) => !a.startsWith('--'));
  const outIdx = args.indexOf('--out');
  if (!input) {
    console.error('Uso: npm run coords:istat -w api -- <confini.shp | confini.geojson> [--out file.csv]');
    process.exit(1);
  }
  const out = outIdx >= 0 ? resolve(process.env.INIT_CWD ?? process.cwd(), args[outIdx + 1]) : resolve(dataDir, 'comuni-coordinate.csv');
  const path = resolve(process.env.INIT_CWD ?? process.cwd(), input);
  const { points, failed, crs } = computePoints(path);
  writeFileSync(out, toCsv(points, path), 'utf8');
  console.log(`Sistema di riferimento: ${crs.kind === 'utm' ? `UTM ${crs.zone}N` : 'geografico (lon/lat)'}`);
  console.log(`Punti calcolati: ${points.length} → ${out}`);
  if (failed.length) console.warn(`Geometrie non valide (nessun punto): ${failed.join(', ')}`);
  const { missing, extra } = compareWithList(points);
  if (missing.length) {
    console.warn(`Comuni dell'elenco senza confini (${missing.length}): ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? '…' : ''}`);
    console.warn('→ elenco e confini devono riferirsi alla stessa data (vedi docs/distanze.md).');
    if (extra.length) {
      console.warn('→ ci sono anche codici sconosciuti: probabili ricodifiche. Aggiornare l\'elenco con npm run comuni:istat -w api -- <elenco> --al <data dei confini>.');
    }
  }
  if (extra.length) console.warn(`Codici nei confini ma non nell'elenco (${extra.length}): ${extra.slice(0, 20).join(', ')}${extra.length > 20 ? '…' : ''}`);
  console.log('Per caricarli nel database: npm run db:seed -w api');
}
