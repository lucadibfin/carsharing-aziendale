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
export function listToCsv(rows: ComuneRow[], refDate: string): string;
export function mergeRecodings(existingText: string, recoded: Recoding[], refDate: string): string;
