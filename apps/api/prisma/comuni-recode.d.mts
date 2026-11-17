import type { Client } from 'pg';
export interface RecodingEntry {
  from: string;
  to: string;
  name: string;
  since: string;
}
export const COMUNE_COLUMNS: { table: string; column: string }[];
export function readRecodings(path: string): RecodingEntry[];
export function applyIncorporations(
  client: Client,
  variations: { code: string; name: string; type: string; origins: string[] }[],
): Promise<{ from: string; to: string; name: string; moved: Record<string, number> }[]>;
export function applyRecodings(client: Client, recodings: RecodingEntry[]): Promise<(RecodingEntry & { moved: Record<string, number> })[]>;
