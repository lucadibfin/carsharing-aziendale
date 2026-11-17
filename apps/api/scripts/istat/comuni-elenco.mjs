// Rigenera apps/api/prisma/data/comuni.csv dal file ufficiale ISTAT
// "Elenco comuni italiani" (CSV, separatore ";", codifica Windows-1252 o UTF-8).
//
// Uso (dalla radice del repository):
//   npm run comuni:istat -w api -- <Elenco-comuni-italiani.csv> --al 01/01/2026
//
// --al = data di riferimento dell'elenco: deve coincidere con quella dei confini
// usati per le coordinate (es. Com01012026 → 01/01/2026).
//
// I cambi di codice di un comune che resta lo stesso (stessa denominazione) sono
// RICODIFICHE, non soppressioni: vengono aggiunte a data/comuni-ricodifiche.csv e
// il seed sposta profili e viaggi sul nuovo codice.
// Fonte: ISTAT, licenza CC BY 4.0. Istruzioni complete: docs/distanze.md
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const dataDir = resolve(import.meta.dirname, '../../prisma/data');
const listPath = resolve(dataDir, 'comuni.csv');
const recodingsPath = resolve(dataDir, 'comuni-ricodifiche.csv');

/** Colonne cercate per nome (l'ordine e le note tra parentesi cambiano tra i rilasci). */
const COLUMNS = {
  istat: (h) => h.includes('codice comune formato alfanumerico'),
  name: (h) => h.includes('denominazione in italiano'),
  province: (h) => h.includes('sigla automobilistica'),
  region: (h) => h.startsWith('denominazione regione'),
  catastale: (h) => h.includes('codice catastale'),
};
const OPTIONAL = new Set(['catastale']);

function decode(buf) {
  const utf8 = new TextDecoder('utf-8').decode(buf);
  // Caratteri non validi in UTF-8: il file è in Windows-1252 (formato abituale di ISTAT).
  return (utf8.includes('�') ? new TextDecoder('windows-1252').decode(buf) : utf8).replace(/^﻿/, '');
}

function splitRow(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === ';' && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** @returns {{ istat: string, name: string, province: string, region: string, catastale: string }[]} */
export function parseElenco(buf) {
  const lines = decode(buf).split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = splitRow(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, ' '));
  const idx = Object.fromEntries(
    Object.entries(COLUMNS).map(([key, match]) => {
      const i = header.findIndex(match);
      if (i < 0 && !OPTIONAL.has(key)) throw new Error(`Colonna non trovata nell'elenco ISTAT: ${key}`);
      return [key, i];
    }),
  );
  const rows = lines.slice(1).map((l) => {
    const c = splitRow(l);
    return {
      istat: c[idx.istat].padStart(6, '0'),
      name: c[idx.name],
      province: c[idx.province],
      region: c[idx.region],
      catastale: idx.catastale >= 0 ? (c[idx.catastale] ?? '').toUpperCase() : '',
    };
  });
  for (const r of rows) {
    if (!/^\d{6}$/.test(r.istat) || !r.name || !/^[A-Z]{2}$/.test(r.province)) throw new Error(`Riga non valida: ${JSON.stringify(r)}`);
  }
  return rows.sort((a, b) => a.istat.localeCompare(b.istat));
}

/** Legge comuni.csv (con o senza colonna catastale e righe di commento). */
export function readList(path = listPath) {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith('#'))
    .slice(1)
    .map((l) => {
      const [istat, name, province, region, catastale] = l.split(';');
      return { istat, name, province, region, catastale: catastale ?? '' };
    });
}

const norm = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Confronto tra elenco precedente e nuovo.
 * Ricodifica = codice sparito e codice nuovo che indicano lo stesso comune:
 * stesso codice catastale (se presente in entrambi gli elenchi), altrimenti
 * stessa denominazione nella stessa regione, con corrispondenza univoca.
 * I casi ambigui restano tra soppressi e nuovi e vengono segnalati.
 */
export function diffLists(before, after) {
  const old = new Map(before.map((r) => [r.istat, r]));
  const now = new Map(after.map((r) => [r.istat, r]));
  let removed = before.filter((r) => !now.has(r.istat));
  let added = after.filter((r) => !old.has(r.istat));
  const recoded = [];
  const ambiguous = [];

  const match = (keyOf) => {
    const byKey = new Map();
    for (const r of added) {
      const k = keyOf(r);
      if (k) byKey.set(k, [...(byKey.get(k) ?? []), r]);
    }
    const oldByKey = new Map();
    for (const r of removed) {
      const k = keyOf(r);
      if (k) oldByKey.set(k, [...(oldByKey.get(k) ?? []), r]);
    }
    for (const [k, olds] of oldByKey) {
      const news = byKey.get(k) ?? [];
      if (olds.length === 1 && news.length === 1) recoded.push({ from: olds[0], to: news[0] });
      else if (news.length) ambiguous.push({ key: k, from: olds.map((r) => r.istat), to: news.map((r) => r.istat) });
    }
    const fromSet = new Set(recoded.map((r) => r.from.istat));
    const toSet = new Set(recoded.map((r) => r.to.istat));
    removed = removed.filter((r) => !fromSet.has(r.istat));
    added = added.filter((r) => !toSet.has(r.istat));
  };
  match((r) => r.catastale || null);
  match((r) => `${norm(r.region)}|${norm(r.name)}`);

  return {
    added,
    removed,
    recoded,
    ambiguous,
    renamed: after.filter((r) => old.has(r.istat) && old.get(r.istat).name !== r.name),
  };
}

export function listToCsv(rows, refDate) {
  return [
    `# Fonte: ISTAT - Elenco comuni italiani al ${refDate}. Licenza CC BY 4.0.`,
    'istat;name;province;region;catastale',
    ...rows.map((r) => `${r.istat};${r.name};${r.province};${r.region};${r.catastale}`),
    '',
  ].join('\n');
}

/** Aggiunge le ricodifiche al registro (senza duplicati), mantenendo lo storico. */
export function mergeRecodings(existingText, recoded, refDate) {
  const header = ['# Ricodifiche dei comuni ISTAT (stesso comune, nuovo codice), applicate dal seed in ordine.', 'vecchio;nuovo;nome;dal'];
  const lines = (existingText ?? '').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#') && !l.startsWith('vecchio;'));
  const seen = new Set(lines.map((l) => l.split(';').slice(0, 2).join(';')));
  for (const r of recoded) {
    const key = `${r.from.istat};${r.to.istat}`;
    if (!seen.has(key)) lines.push(`${key};${r.to.name};${refDate}`);
  }
  return [...header, ...lines, ''].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const input = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--al');
  const refDate = args[args.indexOf('--al') + 1];
  if (!input || !args.includes('--al') || !/^\d{2}\/\d{2}\/\d{4}$/.test(refDate ?? '')) {
    console.error('Uso: npm run comuni:istat -w api -- <Elenco-comuni-italiani.csv> --al GG/MM/AAAA');
    console.error('La data è quella di riferimento dell\'elenco e deve coincidere con quella dei confini.');
    process.exit(1);
  }
  const rows = parseElenco(readFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), input)));
  const d = diffLists(readList(), rows);
  writeFileSync(listPath, listToCsv(rows, refDate), 'utf8');
  if (d.recoded.length) {
    writeFileSync(recodingsPath, mergeRecodings(existsSync(recodingsPath) ? readFileSync(recodingsPath, 'utf8') : '', d.recoded, refDate), 'utf8');
  }
  console.log(`Comuni: ${rows.length} (elenco al ${refDate}) → ${listPath}`);
  console.log(
    `Ricodificati: ${d.recoded.length}, nuovi: ${d.added.length}, soppressi o fusi: ${d.removed.length}, rinominati: ${d.renamed.length}`,
  );
  const byProvince = {};
  for (const r of d.recoded) {
    const k = `${r.from.province}→${r.to.province}`;
    byProvince[k] = (byProvince[k] ?? 0) + 1;
  }
  if (d.recoded.length) console.log(`  ricodifiche per provincia: ${JSON.stringify(byProvince)} → ${recodingsPath}`);
  for (const r of d.added) console.log(`  + ${r.istat} ${r.name} (${r.province})`);
  for (const r of d.removed) console.log(`  - ${r.istat} ${r.name} (${r.province}): resterà nel DB come non selezionabile`);
  for (const r of d.renamed) console.log(`  ~ ${r.istat} ${r.name}`);
  for (const a of d.ambiguous) console.warn(`  ? corrispondenza ambigua ${a.key}: ${a.from.join(',')} → ${a.to.join(',')} (trattati come soppressi/nuovi)`);
  console.log('Poi: rigenerare le coordinate con i confini della stessa data (npm run coords:istat -w api -- …) e npm run db:seed -w api');
}
