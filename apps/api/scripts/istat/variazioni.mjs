// Registro dei comuni dell'elenco che NON hanno ancora un poligono nei confini
// ISTAT usati per le coordinate, perché nati dopo la data dei confini.
// File: apps/api/prisma/data/comuni-variazioni.csv (versionato).
//
//   codice;nome;tipo;origini;rilevato_al;nota
//   024129;Castegnero Nanto;FUSIONE;024027+024071;17/11/2026;fusione di Castegnero e Nanto
//
// tipo FUSIONE      → coordinate = punto interno all'unione dei territori d'origine
// tipo APPROSSIMATO → coordinate = punto del (primo) comune d'origine, ad esempio per
//                     un comune nato da distacco di territorio. È una stima, da
//                     sostituire quando i confini dell'anno successivo lo includono.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const VARIATIONS_PATH = resolve(import.meta.dirname, '../../prisma/data/comuni-variazioni.csv');
export const VARIATION_TYPES = ['FUSIONE', 'APPROSSIMATO'];

const HEADER = [
  '# Comuni nati dopo la data dei confini ISTAT usati per le coordinate (vedi docs/distanze.md).',
  '# FUSIONE: punto interno all\'unione dei territori d\'origine. APPROSSIMATO: punto del comune d\'origine (stima).',
  'codice;nome;tipo;origini;rilevato_al;nota',
];

/** @returns {{ code: string, name: string, type: string, origins: string[], detectedAt: string, note: string }[]} */
export function parseVariations(text) {
  return (text ?? '')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith('#') && !l.startsWith('codice;'))
    .map((l) => {
      const [code, name, type, origins, detectedAt, note] = l.split(';');
      const list = (origins ?? '').split('+').filter(Boolean);
      if (!/^\d{6}$/.test(code ?? '') || !VARIATION_TYPES.includes(type) || list.length === 0 || list.some((o) => !/^\d{6}$/.test(o))) {
        throw new Error(`Riga non valida in comuni-variazioni.csv: ${l}`);
      }
      return { code, name: name ?? '', type, origins: list, detectedAt: detectedAt ?? '', note: note ?? '' };
    });
}

export function readVariations(path = VARIATIONS_PATH) {
  return existsSync(path) ? parseVariations(readFileSync(path, 'utf8')) : [];
}

/** Aggiunge voci nuove (per codice) senza toccare quelle esistenti, che possono essere state corrette a mano. */
export function mergeVariations(existingText, entries) {
  const current = parseVariations(existingText);
  const known = new Set(current.map((v) => v.code));
  const all = [...current, ...entries.filter((e) => !known.has(e.code))];
  return [
    ...HEADER,
    ...all.map((v) => [v.code, v.name, v.type, v.origins.join('+'), v.detectedAt, v.note.replace(/;/g, ',')].join(';')),
    '',
  ].join('\n');
}
