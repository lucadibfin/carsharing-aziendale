import { Injectable } from '@nestjs/common';
import type { ExportQuery } from '@fcs/shared';
import { AuditService } from '../audit/audit.service.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../common/prisma.service.js';
import { dateOnly, todayInRome } from '../common/time.js';
import { buildXlsx, type Cell } from '../common/xlsx.js';
import type { TripStatFact } from '../generated/prisma/client.js';
import { SettingsService } from '../settings/settings.service.js';
import { AdminTripsService } from './admin-trips.service.js';
import { scopedSiteFilter, type SiteScope } from './admin.guard.js';

const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

export const EXPORT_COLUMNS = [
  'Sede',
  'Mese',
  'Viaggi proposti pubblici',
  'Viaggi proposti privati',
  'Viaggi completati',
  'Viaggi annullati',
  'Posti offerti nei viaggi completati',
  'Passeggeri trasportati',
  'Tasso di riempimento (%)',
  'Km in auto evitati',
  'CO2 risparmiata (kg)',
  'Benzina/gasolio/GPL risparmiati (L)',
  'Metano risparmiato (kg)',
  'Energia elettrica risparmiata (kWh)',
  'Spesa evitata (€)',
  'Viaggi con distanze stimate',
  'Viaggi senza metriche',
  'Note',
] as const;

export interface ExportFile {
  filename: string;
  contentType: string;
  body: Buffer;
}

/**
 * Report aggregati per il PSCL, in CSV ed Excel: una riga per sede e mese, solo
 * dai fatti anonimi (TripStatFact). Soglia minima: nelle righe con meno di
 * exportMinTrips viaggi completati i valori su passeggeri, km ed emissioni non si
 * pubblicano (restano i conteggi dei viaggi), così un report diffuso all'esterno
 * non permette di risalire ai pochi colleghi che hanno viaggiato in quel mese.
 * Non ci sono righe di totale: sottraendo le righe pubblicate da un totale si
 * otterrebbero i valori nascosti.
 */
@Injectable()
export class ReportExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly adminTrips: AdminTripsService,
  ) {}

  async export(actorId: string, scope: SiteScope, q: ExportQuery): Promise<ExportFile> {
    const { from, to } = this.adminTrips.period(q);
    const siteFilter = scopedSiteFilter(scope, q.siteId);
    const s = await this.settings.get();
    const facts = await this.prisma.tripStatFact.findMany({
      where: { siteId: siteFilter, date: { gte: dateOnly(from), lte: dateOnly(to) } },
      orderBy: { date: 'asc' },
    });
    const sites = await this.prisma.site.findMany({ where: { id: siteFilter }, select: { id: true, name: true }, orderBy: { name: 'asc' } });

    const groups = new Map<string, TripStatFact[]>();
    for (const f of facts) {
      const key = `${f.siteId}|${f.date.toISOString().slice(0, 7)}`;
      groups.set(key, [...(groups.get(key) ?? []), f]);
    }
    const rows: Cell[][] = [];
    let suppressed = 0;
    for (const site of sites) {
      const months = [...groups.keys()].filter((k) => k.startsWith(site.id + '|')).map((k) => k.split('|')[1]!).sort();
      for (const month of months) {
        const row = this.row(site.name, month, groups.get(`${site.id}|${month}`)!, s.exportMinTrips);
        if (row.suppressed) suppressed++;
        rows.push(row.cells);
      }
    }

    const generatedAt = this.clock.now();
    const scopeLabel = q.siteId ? (sites[0]?.name ?? '') : scope === null ? 'tutte le sedi' : sites.map((x) => x.name).join(', ');
    const notes: string[] = [
      `Report aggregato per il PSCL. Periodo: dal ${it(from)} al ${it(to)}. Sedi: ${scopeLabel}.`,
      `Generato il ${generatedAt.toISOString().slice(0, 10)} (${todayInRome(generatedAt)} ora italiana).`,
      'Dati anonimi: conteggi e somme per sede e mese, nessun dato riconducibile ai singoli colleghi. Contano solo i viaggi chiusi dal conducente.',
      `Soglia minima: nelle righe con meno di ${s.exportMinTrips} viaggi completati passeggeri, km, emissioni, carburante e spesa non sono pubblicati.` +
        (suppressed ? ` Righe interessate: ${suppressed}.` : ''),
      'Km evitati: distanza stradale dal comune di salita di ogni passeggero alla sede (andata, più il ritorno se previsto).',
      'Carburante, CO2 e spesa: auto del conducente se indicata, altrimenti valori medi configurati dagli amministratori (fonti indicate: ISPRA; prezzi medi del Ministero delle Imprese e del Made in Italy).',
      'Distanze calcolate tra comuni e sedi a partire dai confini comunali. Fonte: ISTAT, licenza CC BY 4.0.',
    ];

    await this.audit.record({
      actorId,
      action: 'ADMIN_REPORT_EXPORT',
      meta: { siteId: q.siteId ?? null, from, to, format: q.format, rows: rows.length, suppressed },
    });

    const base = `report-pscl_${from}_${to}`;
    if (q.format === 'xlsx') {
      return {
        filename: `${base}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        body: buildXlsx([
          {
            name: 'Report',
            rows: [[...EXPORT_COLUMNS], ...rows],
            boldRows: [0],
            widths: [24, 9, 12, 12, 12, 12, 14, 14, 14, 14, 14, 16, 14, 16, 12, 14, 12, 50],
          },
          { name: 'Note', rows: notes.map((n) => [n]), widths: [140] },
        ]),
      };
    }
    // CSV per Excel in italiano: separatore ";", virgola decimale, BOM UTF-8. Note in fondo.
    const lines = [[...EXPORT_COLUMNS], ...rows].map((r) => r.map(csvCell).join(';'));
    lines.push('', ...notes.map((n) => csvCell(n)));
    return { filename: `${base}.csv`, contentType: 'text/csv; charset=utf-8', body: Buffer.from('﻿' + lines.join('\r\n') + '\r\n', 'utf8') };
  }

  private row(siteName: string, month: string, facts: TripStatFact[], minTrips: number): { cells: Cell[]; suppressed: boolean } {
    const completed = facts.filter((f) => f.status === 'COMPLETED');
    const proposed = (v: 'PUBLIC' | 'PRIVATE') => facts.filter((f) => f.visibility === v).length;
    const sum = (fn: (f: TripStatFact) => number | null) => completed.reduce((a, f) => a + (fn(f) ?? 0), 0);
    const fuel = (units: string[]) => round(sum((f) => (f.fuelUnit && units.includes(f.fuelUnit) ? f.fuelSaved : 0)));
    const seats = sum((f) => f.seats);
    const passengers = sum((f) => f.passengers);
    const suppressed = completed.length < minTrips;
    const hidden = (v: number | null): Cell => (suppressed ? null : v);
    return {
      suppressed,
      cells: [
        siteName,
        month,
        proposed('PUBLIC'),
        proposed('PRIVATE'),
        completed.length,
        facts.filter((f) => f.status === 'CANCELLED').length,
        hidden(seats),
        hidden(passengers),
        hidden(seats > 0 ? round((passengers / seats) * 100) : null),
        hidden(round(sum((f) => f.kmAvoided))),
        hidden(round(sum((f) => f.co2SavedKg))),
        hidden(fuel(['L'])),
        hidden(fuel(['kg'])),
        hidden(fuel(['kWh'])),
        hidden(round(sum((f) => f.eurSaved), 2)),
        completed.filter((f) => f.estimated).length,
        completed.filter((f) => !f.complete).length,
        suppressed ? `Meno di ${minTrips} viaggi completati: valori non pubblicati` : null,
      ],
    };
  }
}

const it = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Cella CSV: numeri con la virgola, testo tra virgolette se serve, protezione dalle formule. */
export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v).replace('.', ',');
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
