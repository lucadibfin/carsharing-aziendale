// Registro delle variazioni dei comuni successive alla data dei confini ISTAT usati
// per le coordinate. File: apps/api/prisma/data/comuni-variazioni.csv (versionato).
//
//   codice;nome;tipo;origini;rilevato_al;nota
//   024129;Castegnero Nanto;FUSIONE;024027+024071;17/11/2026;fusione di Castegnero e Nanto
//   018094;Montalto Pavese;INCORPORAZIONE;018082+018094;17/11/2026;incorporazione di Lirio
//
// tipo FUSIONE        → comune NUOVO (codice nuovo): coordinate = punto interno
//                       all'unione dei territori d'origine.
// tipo INCORPORAZIONE → comune ESISTENTE che ne incorpora altri: codice = incorporante,
//                       origini = incorporante + incorporati. Finché i confini contengono
//                       ancora gli incorporati, coordinate = punto interno all'unione dei
//                       territori; il seed sposta profili, sedi e viaggi dagli incorporati
//                       all'incorporante.
// tipo APPROSSIMATO   → coordinate = punto del (primo) comune d'origine, ad esempio per
//                       un comune nato da distacco di territorio. È una stima, da
//                       sostituire quando i confini dell'anno successivo lo includono.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const VARIATIONS_PATH = resolve(import.meta.dirname, '../../prisma/data/comuni-variazioni.csv');
export const VARIATION_TYPES = ['FUSIONE', 'INCORPORAZIONE', 'APPROSSIMATO'];

const HEADER = [
  '# Variazioni dei comuni successive alla data dei confini ISTAT usati per le coordinate (vedi docs/distanze.md).',
  '# FUSIONE: comune nuovo, punto interno all\'unione dei territori d\'origine.',
  '# INCORPORAZIONE: codice = comune che incorpora, origini = incorporante + incorporati; il seed sposta profili e viaggi.',
  '# APPROSSIMATO: punto del comune d\'origine (stima).',
  'codice;nome;tipo;origini;rilevato_al;nota',
];

/** @returns {{ code: string, name: string, type: string, origins: string[], detectedAt: string, note: string }[]} */
export function parseVariations(text) {
  return (text ?? '')
    .replace(/^﻿/, '') // BOM aggiunto da alcuni editor di Windows quando si corregge a mano
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith('#') && !l.startsWith('codice;'))
    .map((l) => {
      const [code, name, type, origins, detectedAt, note] = l.split(';');
      const list = (origins ?? '').split('+').filter(Boolean);
      const valid =
        /^\d{6}$/.test(code ?? '') &&
        VARIATION_TYPES.includes(type) &&
        list.length > 0 &&
        list.every((o) => /^\d{6}$/.test(o)) &&
        // Un'incorporazione ha come origini l'incorporante stesso e almeno un incorporato.
        (type !== 'INCORPORAZIONE' || (list.includes(code) && list.length >= 2));
      if (!valid) throw new Error(`Riga non valida in comuni-variazioni.csv: ${l}`);
      return { code, name: name ?? '', type, origins: list, detectedAt: detectedAt ?? '', note: note ?? '' };
    });
}

export function readVariations(path = VARIATIONS_PATH) {
  return existsSync(path) ? parseVariations(readFileSync(path, 'utf8')) : [];
}

/** Comuni soppressi per incorporazione → variazione che li descrive. */
export function incorporatedCodes(variations) {
  return new Map(
    variations.filter((v) => v.type === 'INCORPORAZIONE').flatMap((v) => v.origins.filter((o) => o !== v.code).map((o) => [o, v])),
  );
}

/**
 * Aggiunge voci nuove (per codice) senza toccare quelle esistenti, che possono essere
 * state corrette a mano. Un comune che incorpora altri comuni in momenti diversi resta
 * su una sola riga: gli incorporati nuovi si aggiungono alle origini.
 */
export function mergeVariations(existingText, entries) {
  const all = parseVariations(existingText);
  for (const e of entries) {
    const known = all.find((v) => v.code === e.code);
    if (!known) all.push(e);
    else if (known.type === 'INCORPORAZIONE' && e.type === 'INCORPORAZIONE') {
      const added = e.origins.filter((o) => !known.origins.includes(o));
      if (added.length) {
        known.origins = [...known.origins, ...added].sort();
        known.note = [known.note, e.note].filter(Boolean).join(', ');
      }
    }
  }
  return [
    ...HEADER,
    ...all.map((v) => [v.code, v.name, v.type, v.origins.join('+'), v.detectedAt, v.note.replace(/;/g, ',')].join(';')),
    '',
  ].join('\n');
}
