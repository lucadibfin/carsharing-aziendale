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
import { mergeVariations, VARIATIONS_PATH } from './variazioni.mjs';

const dataDir = resolve(import.meta.dirname, '../../prisma/data');
const listPath = resolve(dataDir, 'comuni.csv');
const recodingsPath = resolve(dataDir, 'comuni-ricodifiche.csv');

/**
 * Colonne cercate per nome. Formati supportati:
 * - "Elenco comuni italiani" (sito ISTAT): "Codice Comune formato alfanumerico",
 *   "Denominazione in italiano", "Denominazione Regione", "Codice Catastale del comune";
 * - estrazione SITUAS (situas.istat.it), UTF-8 con BOM: "Codice Comune (alfanumerico)",
 *   "Comune (dizione italiana)", "Regione", "Codice catasto".
 * In entrambi: "Sigla automobilistica". L'ordine delle colonne non conta.
 */
const COLUMNS = {
  istat: (h) => h.includes('codice comune formato alfanumerico') || h === 'codice comune (alfanumerico)',
  name: (h) => h.includes('denominazione in italiano') || h === 'comune (dizione italiana)',
  province: (h) => h.includes('sigla automobilistica'),
  region: (h) => h.startsWith('denominazione regione') || h === 'regione',
  catastale: (h) => h.includes('codice catastale') || h === 'codice catasto',
};
const OPTIONAL = new Set(['catastale']);

/** Nome della fonte da riportare nel CSV, riconosciuto dalle colonne. */
export function sourceName(buf) {
  const header = decode(buf).split(/\r?\n/)[0].toLowerCase();
  return header.includes('comune (dizione italiana)')
    ? 'ISTAT - SITUAS, elenco dei comuni'
    : 'ISTAT - Elenco comuni italiani';
}

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

const STOPWORDS = new Set(['e', 'ed', 'con', 'di', 'de', 'del', 'della', 'in', 'sul', 'sulla']);
const words = (s) => norm(s).split(' ').filter((w) => w && !STOPWORDS.has(w));

/**
 * Comuni nuovi nati da FUSIONE, riconosciuti quando il nome nuovo è composto
 * esattamente dai nomi di due o più comuni spariti della stessa provincia
 * (es. "Castegnero Nanto" = Castegnero + Nanto). Gli altri comuni nuovi
 * restano da classificare: per ciascuno si propongono come possibili origini i
 * comuni spariti della stessa provincia.
 */
export function detectFusions(added, removed) {
  const fusions = [];
  const unresolved = [];
  for (const a of added) {
    const target = new Set(words(a.name));
    const sameProvince = removed.filter((r) => r.region === a.region && (r.province === a.province || !r.province));
    const parts = sameProvince.filter((r) => {
      const w = words(r.name);
      return w.length > 0 && w.every((x) => target.has(x));
    });
    const covered = new Set(parts.flatMap((p) => words(p.name)));
    if (parts.length >= 2 && [...target].every((w) => covered.has(w))) {
      fusions.push({ comune: a, origins: parts });
    } else {
      unresolved.push({ comune: a, candidates: sameProvince });
    }
  }
  return { fusions, unresolved };
}

export function listToCsv(rows, refDate, source = 'ISTAT - Elenco comuni italiani') {
  return [
    `# Fonte: ${source} al ${refDate}. Licenza CC BY 4.0.`,
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
  const dryRun = args.includes('--dry-run');
  if (!input || !args.includes('--al') || !/^\d{2}\/\d{2}\/\d{4}$/.test(refDate ?? '')) {
    console.error('Uso: npm run comuni:istat -w api -- <elenco.csv> --al GG/MM/AAAA [--dry-run]');
    console.error('--al: data di riferimento dell\'elenco (per SITUAS, il giorno dell\'estrazione).');
    process.exit(1);
  }
  const buf = readFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), input));
  const rows = parseElenco(buf);
  const source = sourceName(buf);
  const d = diffLists(readList(), rows);
  const { fusions, unresolved } = detectFusions(d.added, d.removed);
  const fusedOrigins = new Set(fusions.flatMap((f) => f.origins.map((o) => o.istat)));

  console.log(`Fonte: ${source} al ${refDate}. Comuni: ${rows.length}`);
  console.log(
    `Ricodificati: ${d.recoded.length}, nuovi: ${d.added.length} (da fusione: ${fusions.length}), ` +
      `soppressi o fusi: ${d.removed.length}, rinominati: ${d.renamed.length}, ambigui: ${d.ambiguous.length}`,
  );
  const byProvince = {};
  for (const r of d.recoded) {
    const k = `${r.from.istat.slice(0, 3)}→${r.to.istat.slice(0, 3)}`;
    byProvince[k] = (byProvince[k] ?? 0) + 1;
  }
  if (d.recoded.length) console.log(`  ricodifiche per prefisso di codice: ${JSON.stringify(byProvince)}`);
  for (const f of fusions) {
    console.log(`  + ${f.comune.istat} ${f.comune.name} (${f.comune.province}): FUSIONE di ${f.origins.map((o) => `${o.istat} ${o.name}`).join(' + ')}`);
  }
  for (const u of unresolved) {
    console.warn(`  + ${u.comune.istat} ${u.comune.name} (${u.comune.province}): nuovo, origine NON riconosciuta.`);
    console.warn(
      `    Proposta: verificare su SITUAS (variazioni amministrative) e aggiungere a comuni-variazioni.csv una riga FUSIONE con i codici d'origine` +
        (u.candidates.length ? ` (comuni spariti della stessa provincia: ${u.candidates.map((c) => `${c.istat} ${c.name}`).join(', ')})` : '') +
        `, oppure APPROSSIMATO con il comune da cui si è staccato.`,
    );
  }
  for (const r of d.removed.filter((x) => !fusedOrigins.has(x.istat))) {
    console.warn(`  - ${r.istat} ${r.name} (${r.province}): non più nell'elenco e non confluito in un comune nuovo.`);
    console.warn('    Probabile incorporazione in un comune esistente: resterà nel DB come non selezionabile (profili e viaggi invariati).');
  }
  for (const r of d.renamed) console.log(`  ~ ${r.istat} ${r.name}`);
  for (const a of d.ambiguous) console.warn(`  ? corrispondenza ambigua ${a.key}: ${a.from.join(',')} → ${a.to.join(',')} (trattati come soppressi/nuovi)`);

  if (dryRun) {
    console.log('Prova a secco: nessun file modificato.');
  } else {
    writeFileSync(listPath, listToCsv(rows, refDate, source), 'utf8');
    if (d.recoded.length) {
      writeFileSync(recodingsPath, mergeRecodings(existsSync(recodingsPath) ? readFileSync(recodingsPath, 'utf8') : '', d.recoded, refDate), 'utf8');
    }
    if (fusions.length) {
      const entries = fusions.map((f) => ({
        code: f.comune.istat,
        name: f.comune.name,
        type: 'FUSIONE',
        origins: f.origins.map((o) => o.istat).sort(),
        detectedAt: refDate,
        note: `fusione di ${f.origins.map((o) => o.name).join(' e ')} (riconosciuta dal nome)`,
      }));
      writeFileSync(VARIATIONS_PATH, mergeVariations(existsSync(VARIATIONS_PATH) ? readFileSync(VARIATIONS_PATH, 'utf8') : '', entries), 'utf8');
    }
    console.log(`Scritti: ${listPath}${d.recoded.length ? ', comuni-ricodifiche.csv' : ''}${fusions.length ? ', comuni-variazioni.csv' : ''}`);
    console.log('Poi: npm run coords:istat -w api -- <confini.shp> e npm run db:seed');
  }
}
