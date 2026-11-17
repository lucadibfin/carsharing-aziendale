// Funzioni geometriche senza dipendenze esterne, usate per ricavare dai confini
// ISTAT un punto rappresentativo di ogni comune.

// ---------------------------------------------------------------------------
// Proiezione UTM ↔ coordinate geografiche (WGS84 / ETRS89), serie di Krüger
// (precisione sub-millimetrica nella fascia UTM).
// ---------------------------------------------------------------------------
const A_AXIS = 6378137;
const F = 1 / 298.257223563;
const N = F / (2 - F);
const K0 = 0.9996;
const FALSE_EASTING = 500000;
const n2 = N * N;
const n3 = n2 * N;
const n4 = n3 * N;
const RECT_A = (A_AXIS / (1 + N)) * (1 + n2 / 4 + n4 / 64);
const ALPHA = [N / 2 - (2 * n2) / 3 + (5 * n3) / 16 + (41 * n4) / 180, (13 * n2) / 48 - (3 * n3) / 5 + (557 * n4) / 1440, (61 * n3) / 240 - (103 * n4) / 140, (49561 * n4) / 161280];
const BETA = [N / 2 - (2 * n2) / 3 + (37 * n3) / 96 - n4 / 360, n2 / 48 + n3 / 15 - (437 * n4) / 1440, (17 * n3) / 480 - (37 * n4) / 840, (4397 * n4) / 161280];
const DELTA = [2 * N - (2 * n2) / 3 - 2 * n3 + (116 * n4) / 45, (7 * n2) / 3 - (8 * n3) / 5 - (227 * n4) / 45, (56 * n3) / 15 - (136 * n4) / 35, (4279 * n4) / 630];
const deg = (r) => (r * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;
const centralMeridian = (zone) => rad(zone * 6 - 183);

/** UTM emisfero nord → { lat, lon } in gradi. */
export function utmToLatLon(easting, northing, zone) {
  const xi = northing / (K0 * RECT_A);
  const eta = (easting - FALSE_EASTING) / (K0 * RECT_A);
  let xiP = xi;
  let etaP = eta;
  BETA.forEach((b, i) => {
    const j = 2 * (i + 1);
    xiP -= b * Math.sin(j * xi) * Math.cosh(j * eta);
    etaP -= b * Math.cos(j * xi) * Math.sinh(j * eta);
  });
  const chi = Math.asin(Math.sin(xiP) / Math.cosh(etaP));
  let phi = chi;
  DELTA.forEach((d, i) => {
    phi += d * Math.sin(2 * (i + 1) * chi);
  });
  const lambda = centralMeridian(zone) + Math.atan2(Math.sinh(etaP), Math.cos(xiP));
  return { lat: deg(phi), lon: deg(lambda) };
}

/** { lat, lon } in gradi → UTM emisfero nord (usata nei test di andata e ritorno). */
export function latLonToUtm(lat, lon, zone) {
  const phi = rad(lat);
  const dl = rad(lon) - centralMeridian(zone);
  const c = (2 * Math.sqrt(N)) / (1 + N);
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - c * Math.atanh(c * Math.sin(phi)));
  const xiP = Math.atan2(t, Math.cos(dl));
  const etaP = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
  let xi = xiP;
  let eta = etaP;
  ALPHA.forEach((a, i) => {
    const j = 2 * (i + 1);
    xi += a * Math.sin(j * xiP) * Math.cosh(j * etaP);
    eta += a * Math.cos(j * xiP) * Math.sinh(j * etaP);
  });
  return { easting: FALSE_EASTING + K0 * RECT_A * eta, northing: K0 * RECT_A * xi };
}

// ---------------------------------------------------------------------------
// Punto interno ("point on surface")
// ---------------------------------------------------------------------------

/**
 * Punto garantito DENTRO il territorio (a differenza del baricentro, che per un
 * comune a forma di "C" o con exclavi può cadere fuori), con lo stesso metodo di
 * JTS/PostGIS ST_PointOnSurface: si traccia una linea orizzontale, si calcolano gli
 * intervalli interni (regola pari-dispari, quindi i buchi sono esclusi) e si prende
 * il centro dell'intervallo più largo.
 * Linee provate: il centro verticale del riquadro di ogni anello esterno e
 * dell'insieme, così anche le isole e le exclavi vengono considerate.
 *
 * @param {number[][][]} rings anelli (esterni e buchi) come liste di [x, y]
 * @returns {{ x: number, y: number } | null}
 */
export function pointOnSurface(rings) {
  return pointOnSurfaceOfUnion([rings], 0);
}

/**
 * Punto interno all'UNIONE di più territori (es. comune nato dalla fusione di due
 * comuni presenti nei confini). Sulla linea di scansione si calcolano gli
 * intervalli interni di ciascun territorio, si uniscono, e si fondono i tratti
 * separati da meno di `tolerance` (i confini generalizzati di comuni confinanti
 * possono lasciare sottili fessure o sovrapposizioni). Si prende il centro del
 * tratto più largo.
 *
 * @param {number[][][][]} parts un insieme di anelli per ciascun territorio
 * @param {number} tolerance distanza massima (unità delle coordinate) tra tratti da fondere
 */
export function pointOnSurfaceOfUnion(parts, tolerance) {
  const sets = parts.map((rings) => rings.filter((r) => r.length >= 3)).filter((s) => s.length > 0);
  const valid = sets.flat();
  if (valid.length === 0) return null;
  const bbox = (pts) => {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of pts) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { minY, maxY };
  };
  const all = bbox(valid.flat());
  const candidates = new Set([(all.minY + all.maxY) / 2]);
  for (const r of valid) {
    const b = bbox(r);
    candidates.add((b.minY + b.maxY) / 2);
  }
  // Evita di passare esattamente per un vertice (intersezioni ambigue).
  const vertexY = new Set(valid.flat().map((p) => p[1]));
  const eps = Math.max(all.maxY - all.minY, 1e-9) * 1e-7;

  let best = null;
  for (let y of candidates) {
    while (vertexY.has(y)) y += eps;
    // Intervalli interni di ciascun territorio (regola pari-dispari al suo interno).
    const intervals = [];
    for (const rings of sets) {
      const xs = [];
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
          const [x1, y1] = ring[i];
          const [x2, y2] = ring[(i + 1) % ring.length];
          if (y1 === y2) continue;
          // Intervallo semiaperto [min, max): ogni attraversamento contato una volta.
          if (y >= Math.min(y1, y2) && y < Math.max(y1, y2)) {
            xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
          }
        }
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] > xs[i]) intervals.push([xs[i], xs[i + 1]]);
    }
    // Unione degli intervalli, fondendo quelli che si toccano o quasi.
    intervals.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const iv of intervals) {
      const last = merged.at(-1);
      if (last && iv[0] <= last[1] + tolerance) last[1] = Math.max(last[1], iv[1]);
      else merged.push([...iv]);
    }
    for (const [a, b] of merged) {
      if (!best || b - a > best.width) best = { width: b - a, x: (a + b) / 2, y };
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}

/** true se il punto è dentro (regola pari-dispari). Usata per verificare il risultato. */
export function isInside(rings, x, y) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
