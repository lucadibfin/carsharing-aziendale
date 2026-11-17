// Rigenera apps/api/prisma/data/comuni.csv dal file ufficiale ISTAT
// "Elenco comuni italiani" (CSV, separatore ";", codifica Windows-1252 o UTF-8).
//
// Uso (dalla radice del repository):
//   npm run comuni:istat -w api -- <Elenco-comuni-italiani.csv>
//
// Fonte: ISTAT, licenza CC BY 4.0. Istruzioni complete: docs/distanze.md
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const target = resolve(import.meta.dirname, '../../prisma/data/comuni.csv');

/** Colonne cercate per nome (l'ordine e le note tra parentesi cambiano tra i rilasci). */
const COLUMNS = {
  istat: (h) => h.includes('codice comune formato alfanumerico'),
  name: (h) => h.includes('denominazione in italiano'),
  province: (h) => h.includes('sigla automobilistica'),
  region: (h) => h.startsWith('denominazione regione'),
};

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

/** @returns {{ istat: string, name: string, province: string, region: string }[]} */
export function parseElenco(buf) {
  const lines = decode(buf).split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = splitRow(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, ' '));
  const idx = Object.fromEntries(
    Object.entries(COLUMNS).map(([key, match]) => {
      const i = header.findIndex(match);
      if (i < 0) throw new Error(`Colonna non trovata nell'elenco ISTAT: ${key}`);
      return [key, i];
    }),
  );
  const rows = lines.slice(1).map((l) => {
    const c = splitRow(l);
    return { istat: c[idx.istat].padStart(6, '0'), name: c[idx.name], province: c[idx.province], region: c[idx.region] };
  });
  for (const r of rows) {
    if (!/^\d{6}$/.test(r.istat) || !r.name || !/^[A-Z]{2}$/.test(r.province)) throw new Error(`Riga non valida: ${JSON.stringify(r)}`);
  }
  return rows.sort((a, b) => a.istat.localeCompare(b.istat));
}

export function diffLists(before, after) {
  const old = new Map(before.map((r) => [r.istat, r]));
  const now = new Map(after.map((r) => [r.istat, r]));
  return {
    added: after.filter((r) => !old.has(r.istat)),
    removed: before.filter((r) => !now.has(r.istat)),
    renamed: after.filter((r) => old.has(r.istat) && old.get(r.istat).name !== r.name),
  };
}

const toCsv = (rows) => ['istat;name;province;region', ...rows.map((r) => `${r.istat};${r.name};${r.province};${r.region}`), ''].join('\n');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = process.argv[2];
  if (!input) {
    console.error('Uso: npm run comuni:istat -w api -- <Elenco-comuni-italiani.csv>');
    process.exit(1);
  }
  const rows = parseElenco(readFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), input)));
  const before = readFileSync(target, 'utf8')
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((l) => {
      const [istat, name, province, region] = l.split(';');
      return { istat, name, province, region };
    });
  const d = diffLists(before, rows);
  writeFileSync(target, toCsv(rows), 'utf8');
  console.log(`Comuni: ${rows.length} → ${target}`);
  console.log(`Nuovi: ${d.added.length}, soppressi o fusi: ${d.removed.length}, rinominati: ${d.renamed.length}`);
  for (const r of d.added) console.log(`  + ${r.istat} ${r.name}`);
  for (const r of d.removed) console.log(`  - ${r.istat} ${r.name} (resterà nel DB come non selezionabile)`);
  console.log('Poi: rigenerare le coordinate con i confini della stessa data (npm run coords:istat -w api -- …) e npm run db:seed -w api');
}
