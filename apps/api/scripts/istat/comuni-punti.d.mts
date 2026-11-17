import type { Crs } from './boundaries.mjs';
export interface ComunePoint {
  code: string;
  lat: number;
  lon: number;
}
export function computePoints(path: string): { points: ComunePoint[]; failed: string[]; crs: Crs };
export function vintageFromName(name: string): string | null;
export function toCsv(points: ComunePoint[], sourceName: string): string;
export function compareWithList(points: ComunePoint[], listPath?: string): { missing: string[]; extra: string[] };
