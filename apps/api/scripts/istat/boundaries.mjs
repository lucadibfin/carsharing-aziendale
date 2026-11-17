// Lettura dei confini comunali ISTAT: shapefile (.shp + .dbf + .prj) oppure GeoJSON.
// Nessuna dipendenza esterna: i formati letti sono semplici e documentati
// (ESRI Shapefile Technical Description, 1998; dBase III; RFC 7946).
import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';

/** Campi che contengono il codice ISTAT del comune (6 cifre), nei vari rilasci. */
const CODE_FIELDS = ['PRO_COM_T', 'PRO_COM', 'COD_ISTAT', 'ISTAT'];

/**
 * Sistema di riferimento delle coordinate.
 * - { kind: 'geographic' }: gradi lon/lat (WGS84/ETRS89)
 * - { kind: 'utm', zone }: UTM emisfero nord, datum WGS84/ETRS89/RDN2008
 *   (differenze sotto il metro, irrilevanti per un punto del comune).
 */
export function parsePrj(wkt) {
  const text = wkt.toUpperCase();
  if (/(^|[^A-Z])ED_?(19)?50|EUROPEAN_(DATUM_)?1950|MONTE_?MARIO|ROMA_?40|GAUSS/.test(text)) {
    throw new Error(
      'Sistema di riferimento non supportato (ED50 o Monte Mario/Roma40). Scaricare la versione dei confini in WGS84 UTM 32N.',
    );
  }
  if (!text.includes('PROJCS')) return { kind: 'geographic' };
  const zone = text.match(/UTM[_ ]?ZONE[_ ]?(\d{1,2})\s*N/)?.[1] ?? text.match(/UTM\D{0,10}(\d{2})N/)?.[1];
  if (!zone) throw new Error('Proiezione non riconosciuta: attesa UTM emisfero nord (es. WGS84 UTM 32N)');
  return { kind: 'utm', zone: Number(zone) };
}

function readDbf(buf) {
  const count = buf.readUInt32LE(4);
  const headerLen = buf.readUInt16LE(8);
  const recordLen = buf.readUInt16LE(10);
  const fields = [];
  for (let off = 32; off < headerLen - 1 && buf[off] !== 0x0d; off += 32) {
    const name = buf.toString('latin1', off, off + 11).replace(/\0.*$/, '').trim();
    fields.push({ name: name.toUpperCase(), length: buf[off + 16] });
  }
  const records = [];
  for (let r = 0; r < count; r++) {
    let off = headerLen + r * recordLen + 1; // primo byte: marcatore di cancellazione
    const rec = {};
    for (const f of fields) {
      // Bastano i campi del codice (cifre): la codifica dei nomi è irrilevante.
      rec[f.name] = buf.toString('latin1', off, off + f.length).trim();
      off += f.length;
    }
    records.push(rec);
  }
  return records;
}

function readShp(buf) {
  const shapes = [];
  let off = 100;
  while (off + 8 <= buf.length) {
    const contentBytes = buf.readInt32BE(off + 4) * 2;
    const start = off + 8;
    const type = buf.readInt32LE(start);
    if (type === 0) {
      shapes.push([]);
    } else if (type === 5 || type === 15 || type === 25) {
      const numParts = buf.readInt32LE(start + 36);
      const numPoints = buf.readInt32LE(start + 40);
      const partsAt = start + 44;
      const pointsAt = partsAt + numParts * 4;
      const parts = Array.from({ length: numParts }, (_, i) => buf.readInt32LE(partsAt + i * 4));
      const rings = parts.map((p, i) => {
        const end = i + 1 < numParts ? parts[i + 1] : numPoints;
        const ring = [];
        for (let k = p; k < end; k++) ring.push([buf.readDoubleLE(pointsAt + k * 16), buf.readDoubleLE(pointsAt + k * 16 + 8)]);
        return ring;
      });
      shapes.push(rings);
    } else {
      throw new Error(`Tipo di geometria ${type} non supportato: attesi poligoni`);
    }
    off = start + contentBytes;
  }
  return shapes;
}

function codeOf(props) {
  const upper = Object.fromEntries(Object.entries(props ?? {}).map(([k, v]) => [k.toUpperCase(), v]));
  for (const f of CODE_FIELDS) {
    const v = upper[f];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim().padStart(6, '0');
  }
  return null;
}

/**
 * @returns {{ crs: { kind: 'geographic' } | { kind: 'utm', zone: number }, features: { code: string, rings: number[][][] }[] }}
 */
export function readBoundaries(path) {
  const ext = extname(path).toLowerCase();
  if (ext === '.shp') {
    const base = path.slice(0, -4);
    for (const e of ['.dbf', '.prj']) {
      if (!existsSync(base + e)) throw new Error(`Manca il file ${base + e} (va lasciato accanto al .shp)`);
    }
    const crs = parsePrj(readFileSync(base + '.prj', 'latin1'));
    const shapes = readShp(readFileSync(path));
    const records = readDbf(readFileSync(base + '.dbf'));
    if (shapes.length !== records.length) throw new Error('Il .shp e il .dbf hanno un numero diverso di elementi');
    const features = records.map((r, i) => ({ code: codeOf(r), rings: shapes[i] }));
    return { crs, features: features.filter((f) => f.code) };
  }
  if (ext === '.geojson' || ext === '.json') {
    const gj = JSON.parse(readFileSync(path, 'utf8'));
    const crsName = gj.crs?.properties?.name ?? '';
    const utm = String(crsName).match(/326(\d{2})|258(\d{2})/);
    const crs = utm ? { kind: 'utm', zone: Number(utm[1] ?? utm[2]) } : { kind: 'geographic' };
    const features = [];
    for (const f of gj.features ?? []) {
      const g = f.geometry;
      if (!g) continue;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      const code = codeOf(f.properties);
      if (code) features.push({ code, rings: polys.flat() });
    }
    return { crs, features };
  }
  throw new Error('Formato non riconosciuto: usare lo shapefile (.shp) oppure un GeoJSON (.geojson)');
}
