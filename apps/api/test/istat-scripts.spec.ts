import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parsePrj } from '../scripts/istat/boundaries.mjs';
import { diffLists, parseElenco } from '../scripts/istat/comuni-elenco.mjs';
import { compareWithList, computePoints, toCsv, vintageFromName } from '../scripts/istat/comuni-punti.mjs';
import { isInside, latLonToUtm, pointOnSurface, utmToLatLon } from '../scripts/istat/geo.mjs';

const UTM32_PRJ =
  'PROJCS["WGS_1984_UTM_Zone_32N",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],' +
  'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],' +
  'PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",9.0],PARAMETER["Scale_Factor",0.9996],' +
  'PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]';

type Ring = number[][];

/** Scrive uno shapefile minimale di poligoni (.shp, .dbf, .prj) come quelli ISTAT. */
function writeShapefile(base: string, features: { code: string; rings: Ring[] }[], prj = UTM32_PRJ): void {
  const records = features.map((f, i) => {
    const pts = f.rings.flat();
    const len = 44 + 4 * f.rings.length + 16 * pts.length;
    const b = Buffer.alloc(8 + len);
    b.writeInt32BE(i + 1, 0);
    b.writeInt32BE(len / 2, 4);
    b.writeInt32LE(5, 8);
    b.writeInt32LE(f.rings.length, 44);
    b.writeInt32LE(pts.length, 48);
    let start = 0;
    f.rings.forEach((r, k) => {
      b.writeInt32LE(start, 52 + k * 4);
      start += r.length;
    });
    const at = 52 + 4 * f.rings.length;
    pts.forEach(([x, y], k) => {
      b.writeDoubleLE(x!, at + k * 16);
      b.writeDoubleLE(y!, at + k * 16 + 8);
    });
    return b;
  });
  const body = Buffer.concat(records);
  const header = Buffer.alloc(100);
  header.writeInt32BE(9994, 0);
  header.writeInt32BE((100 + body.length) / 2, 24);
  header.writeInt32LE(1000, 28);
  header.writeInt32LE(5, 32);
  writeFileSync(base + '.shp', Buffer.concat([header, body]));

  // DBF con i campi COMUNE (nome, in Latin-1 come ISTAT) e PRO_COM_T (codice).
  const fields = [
    { name: 'COMUNE', len: 30 },
    { name: 'PRO_COM_T', len: 6 },
  ];
  const headerLen = 32 + 32 * fields.length + 1;
  const recordLen = 1 + fields.reduce((a, f) => a + f.len, 0);
  const dbf = Buffer.alloc(headerLen + recordLen * features.length + 1, 0x20);
  dbf.fill(0, 0, headerLen);
  dbf[0] = 0x03;
  dbf.writeUInt32LE(features.length, 4);
  dbf.writeUInt16LE(headerLen, 8);
  dbf.writeUInt16LE(recordLen, 10);
  fields.forEach((f, i) => {
    dbf.write(f.name, 32 + i * 32, 'latin1');
    dbf[32 + i * 32 + 11] = 'C'.charCodeAt(0);
    dbf[32 + i * 32 + 16] = f.len;
  });
  dbf[headerLen - 1] = 0x0d;
  features.forEach((f, r) => {
    const off = headerLen + r * recordLen + 1;
    dbf.write(`Comune ${f.code} àè`.padEnd(30), off, 'latin1');
    dbf.write(f.code, off + 30, 'latin1');
  });
  dbf[dbf.length - 1] = 0x1a;
  writeFileSync(base + '.dbf', dbf);
  writeFileSync(base + '.prj', prj);
}

/** Quadrato [x, y, x+s, y+s] in senso orario (come gli anelli esterni dello shapefile). */
const square = (x: number, y: number, s: number): Ring => [
  [x, y],
  [x, y + s],
  [x + s, y + s],
  [x + s, y],
  [x, y],
];

describe('Coordinate dei comuni dai confini ISTAT', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fcs-istat-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  describe('proiezione UTM', () => {
    it('meridiano centrale della zona 32 a 45° N: valori di riferimento', () => {
      const u = latLonToUtm(45, 9, 32);
      expect(u.easting).toBeCloseTo(500000, 3);
      expect(u.northing).toBeCloseTo(4982950.4, 1);
      const p = utmToLatLon(500000, u.northing, 32);
      expect(p.lat).toBeCloseTo(45, 9);
      expect(p.lon).toBeCloseTo(9, 9);
    });

    it('andata e ritorno precisi in tutta Italia, anche lontano dal meridiano centrale', () => {
      for (const [lat, lon] of [
        [45.4642, 9.19],
        [46.5, 11.35],
        [41.9028, 12.4964],
        [40.1, 18.5],
        [37.5, 15.08],
        [35.5, 12.6],
      ] as const) {
        const u = latLonToUtm(lat, lon, 32);
        const back = utmToLatLon(u.easting, u.northing, 32);
        expect(Math.abs(back.lat - lat)).toBeLessThan(1e-8);
        expect(Math.abs(back.lon - lon)).toBeLessThan(1e-8);
      }
    });
  });

  describe('punto interno (point on surface)', () => {
    it('comune a forma di "C": il baricentro cade fuori, il punto interno no', () => {
      const c: Ring = [
        [0, 0], [0, 10], [10, 10], [10, 8], [2, 8], [2, 2], [10, 2], [10, 0], [0, 0],
      ];
      const centroidX = 4.4; // circa: fuori, nella "bocca" della C
      expect(isInside([c], centroidX, 5)).toBe(false);
      const p = pointOnSurface([c])!;
      expect(isInside([c], p.x, p.y)).toBe(true);
    });

    it('esclude i buchi (enclavi di altri comuni)', () => {
      const rings = [square(0, 0, 10), square(3, 3, 4).reverse()];
      const p = pointOnSurface(rings)!;
      expect(isInside(rings, p.x, p.y)).toBe(true);
      expect(p.x > 3 && p.x < 7 && p.y > 3 && p.y < 7).toBe(false);
    });

    it('con più parti sceglie quella principale, anche se il riquadro complessivo cade nel vuoto', () => {
      const main = square(0, 0, 100);
      const islet = square(1000, 5000, 5);
      const p = pointOnSurface([main, islet])!;
      expect(isInside([main], p.x, p.y)).toBe(true);
    });

    it('linea di scansione che passa per un vertice', () => {
      const diamond: Ring = [[0, 5], [5, 10], [10, 5], [5, 0], [0, 5]];
      const p = pointOnSurface([diamond])!;
      expect(isInside([diamond], p.x, p.y)).toBe(true);
    });
  });

  describe('lettura dello shapefile e CSV', () => {
    const milano = latLonToUtm(45.4642, 9.19, 32);
    const monza = latLonToUtm(45.5845, 9.2744, 32);
    const base = join(dir, 'Com01012026_WGS84');
    writeShapefile(base, [
      // Milano: a "C" larga 6 km.
      {
        code: '015146',
        rings: [
          [
            [milano.easting - 3000, milano.northing - 3000],
            [milano.easting - 3000, milano.northing + 3000],
            [milano.easting + 3000, milano.northing + 3000],
            [milano.easting + 3000, milano.northing + 2000],
            [milano.easting - 2000, milano.northing + 2000],
            [milano.easting - 2000, milano.northing - 2000],
            [milano.easting + 3000, milano.northing - 2000],
            [milano.easting + 3000, milano.northing - 3000],
            [milano.easting - 3000, milano.northing - 3000],
          ],
        ],
      },
      // Monza in due elementi separati (succede in alcune esportazioni): vanno uniti.
      { code: '108033', rings: [square(monza.easting - 2000, monza.northing - 2000, 4000)] },
      { code: '108033', rings: [square(monza.easting + 10_000, monza.northing, 200)] },
    ]);

    it('calcola un punto per comune, dentro il territorio, in WGS84', () => {
      const { points, failed, crs } = computePoints(base + '.shp');
      expect(crs).toEqual({ kind: 'utm', zone: 32 });
      expect(failed).toEqual([]);
      expect(points.map((p) => p.code)).toEqual(['015146', '108033']);
      const [mi, mz] = points;
      // Milano: il punto è nella striscia occidentale della "C", non al centro.
      expect(mi!.lon).toBeLessThan(9.19 - 0.02);
      expect(Math.abs(mi!.lat - 45.4642)).toBeLessThan(0.03);
      expect(Math.abs(mz!.lat - 45.5845)).toBeLessThan(0.02);
      expect(Math.abs(mz!.lon - 9.2744)).toBeLessThan(0.03);
    });

    it('CSV con attribuzione della fonte e data dei confini', () => {
      const { points } = computePoints(base + '.shp');
      const csv = toCsv(points, base + '.shp');
      expect(csv.split('\n')[0]).toMatch(/^# Fonte: ISTAT .* al 01\/01\/2026 .*CC BY 4\.0/);
      expect(csv).toContain('istat;lat;lon\n015146;');
      expect(vintageFromName('Com01012025_WGS84.shp')).toBe('01/01/2025');
    });

    it('segnala i comuni dell’elenco senza confini e viceversa', () => {
      const listPath = join(dir, 'elenco.csv');
      writeFileSync(listPath, 'istat;name;province;region\n015146;Milano;MI;Lombardia\n016024;Bergamo;BG;Lombardia\n');
      const { points } = computePoints(base + '.shp');
      expect(compareWithList(points, listPath)).toEqual({ missing: ['016024'], extra: ['108033'] });
    });

    it('rifiuta sistemi di riferimento non supportati', () => {
      expect(() => parsePrj('PROJCS["ED_1950_UTM_Zone_32N",GEOGCS["GCS_European_1950"]]')).toThrow(/ED50/);
      expect(() => parsePrj('PROJCS["ED_1950_UTM_Zone_32N"]')).toThrow(/ED50/);
      expect(() => parsePrj('PROJCS["Monte_Mario_Italy_1",GEOGCS["GCS_Monte_Mario"]]')).toThrow(/Monte Mario/);
      expect(parsePrj('GEOGCS["GCS_WGS_1984"]')).toEqual({ kind: 'geographic' });
      expect(parsePrj('PROJCS["ETRS_1989_UTM_Zone_33N",GEOGCS["GCS_ETRS_1989"]]')).toEqual({ kind: 'utm', zone: 33 });
    });

    it('legge anche un GeoJSON in gradi', () => {
      const path = join(dir, 'confini.geojson');
      writeFileSync(
        path,
        JSON.stringify({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { pro_com_t: '016024' },
              geometry: { type: 'Polygon', coordinates: [[[9.6, 45.65], [9.75, 45.65], [9.75, 45.75], [9.6, 45.75], [9.6, 45.65]]] },
            },
          ],
        }),
      );
      const { points, crs } = computePoints(path);
      expect(crs.kind).toBe('geographic');
      expect(points).toEqual([{ code: '016024', lat: 45.7, lon: 9.675 }]);
    });
  });

  describe('elenco dei comuni ISTAT', () => {
    it('legge il CSV ufficiale in Windows-1252 trovando le colonne per nome', () => {
      const header =
        'Codice Regione;Codice Provincia (Storico)(1);Progressivo del Comune (2);Codice Comune formato alfanumerico;' +
        'Denominazione (Italiana e straniera);Denominazione in italiano;Denominazione altra lingua;Denominazione Regione;Sigla automobilistica';
      const rows = ['01;001;001;001001;Agliè;Agliè;;Piemonte;TO', '04;021;008;021008;Bolzano/Bozen;Bolzano;Bozen;Trentino-Alto Adige/Südtirol;BZ'];
      const buf = Buffer.from([header, ...rows].join('\r\n') + '\r\n', 'latin1');
      const parsed = parseElenco(buf);
      expect(parsed).toEqual([
        { istat: '001001', name: 'Agliè', province: 'TO', region: 'Piemonte' },
        { istat: '021008', name: 'Bolzano', province: 'BZ', region: 'Trentino-Alto Adige/Südtirol' },
      ]);
      const d = diffLists([{ istat: '001001', name: 'Aglie', province: 'TO', region: 'Piemonte' }, { istat: '099999', name: 'Soppresso', province: 'XX', region: 'X' }], parsed);
      expect(d.added.map((r) => r.istat)).toEqual(['021008']);
      expect(d.removed.map((r) => r.istat)).toEqual(['099999']);
      expect(d.renamed.map((r) => r.istat)).toEqual(['001001']);
    });
  });
});
