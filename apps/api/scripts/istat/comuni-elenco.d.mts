export interface ComuneRow {
  istat: string;
  name: string;
  province: string;
  region: string;
}
export function parseElenco(buf: Buffer): ComuneRow[];
export function diffLists(before: ComuneRow[], after: ComuneRow[]): { added: ComuneRow[]; removed: ComuneRow[]; renamed: ComuneRow[] };
