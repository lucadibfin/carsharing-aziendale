export interface Variation {
  code: string;
  name: string;
  type: string;
  origins: string[];
  detectedAt: string;
  note: string;
}
export const VARIATIONS_PATH: string;
export const VARIATION_TYPES: string[];
export function parseVariations(text: string): Variation[];
export function readVariations(path?: string): Variation[];
export function mergeVariations(existingText: string, entries: Variation[]): string;
