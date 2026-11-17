export interface ComuneRow {
  istat: string;
  name: string;
  province: string;
  region: string;
  catastale: string;
}
export interface Recoding {
  from: ComuneRow;
  to: ComuneRow;
}
export function parseElenco(buf: Buffer): ComuneRow[];
export function readList(path?: string): ComuneRow[];
export function diffLists(
  before: ComuneRow[],
  after: ComuneRow[],
): {
  added: ComuneRow[];
  removed: ComuneRow[];
  recoded: Recoding[];
  ambiguous: { key: string; from: string[]; to: string[] }[];
  renamed: ComuneRow[];
};
export function listToCsv(rows: ComuneRow[], refDate: string, source?: string): string;
export function sourceName(buf: Buffer): string;
export function detectFusions(
  added: ComuneRow[],
  removed: ComuneRow[],
): { fusions: { comune: ComuneRow; origins: ComuneRow[] }[]; unresolved: { comune: ComuneRow; candidates: ComuneRow[] }[] };
export interface Incorporation {
  comune: ComuneRow;
  into: ComuneRow;
  registered: boolean;
}
export function parseIncorporationArgs(args: string[]): { from: string; to: string }[];
export function classifyIncorporations(
  removed: ComuneRow[],
  before: ComuneRow[],
  after: ComuneRow[],
  added: ComuneRow[],
  variations: import('./variazioni.mjs').Variation[],
  requested: { from: string; to: string }[],
): { incorporations: Incorporation[]; pending: ComuneRow[]; errors: string[] };
export function incorporationEntries(incorporations: Incorporation[], refDate: string): import('./variazioni.mjs').Variation[];
export function mergeRecodings(existingText: string, recoded: Recoding[], refDate: string): string;
