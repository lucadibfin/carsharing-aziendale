export type Crs = { kind: 'geographic' } | { kind: 'utm'; zone: number };
export function parsePrj(wkt: string): Crs;
export function readBoundaries(path: string): { crs: Crs; features: { code: string; rings: number[][][] }[] };
