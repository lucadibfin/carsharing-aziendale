import type { Crs } from './boundaries.mjs';
import type { Variation } from './variazioni.mjs';
export interface ComunePoint {
  code: string;
  lat: number;
  lon: number;
}
export function computePoints(path: string): { points: ComunePoint[]; failed: string[]; crs: Crs; ringsByCode: Map<string, number[][][]> };
export function derivePoints(
  computed: { crs: Crs; ringsByCode: Map<string, number[][][]> },
  variations: Variation[],
  missingCodes: string[],
): { derived: (ComunePoint & { variation: Variation })[]; unresolved: { code: string; reason: string }[] };
export function incorporationPoints(
  computed: { crs: Crs; ringsByCode: Map<string, number[][][]> },
  variations: Variation[],
): { overrides: (ComunePoint & { variation: Variation })[]; unresolved: { code: string; reason: string }[] };
export function neighbours(computed: { crs: Crs; ringsByCode: Map<string, number[][][]> }, code: string): string[];
export function vintageFromName(name: string): string | null;
export function toCsv(points: ComunePoint[], sourceName: string, derived?: (ComunePoint & { variation: Variation })[]): string;
export function compareWithList(points: ComunePoint[], listPath?: string): { missing: string[]; extra: string[] };
