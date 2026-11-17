import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BrandConfig, brandSchema } from './schema.js';

export interface LoadedBrand {
  config: BrandConfig;
  /** Cartella del marchio (percorso assoluto). */
  dir: string;
  /** Percorso assoluto di un file del marchio. */
  file(rel: string): string;
}

/**
 * Cartella che contiene i marchi: `BRANDS_DIR` se impostata, altrimenti `brands/`
 * alla radice del repository (risalendo da questo pacchetto).
 */
export function brandsDir(): string {
  if (process.env['BRANDS_DIR']) return resolve(process.env['BRANDS_DIR']);
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'brands');
    if (existsSync(join(candidate, 'default', 'brand.json'))) return candidate;
    dir = dirname(dir);
  }
  throw new Error('Cartella brands/ non trovata: impostare BRANDS_DIR');
}

export function listBrands(dir = brandsDir()): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'brand.json')))
    .map((d) => d.name)
    .sort();
}

export function loadBrand(id: string, dir = brandsDir()): LoadedBrand {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`Marchio non valido: "${id}"`);
  const brandDir = join(dir, id);
  const path = join(brandDir, 'brand.json');
  if (!existsSync(path)) throw new Error(`Marchio "${id}" non trovato (${path}). Disponibili: ${listBrands(dir).join(', ')}`);
  const parsed = brandSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`brands/${id}/brand.json non valido:\n${issues}`);
  }
  if (parsed.data.id !== id) throw new Error(`brands/${id}/brand.json: "id" deve essere "${id}"`);
  const file = (rel: string) => {
    const p = join(brandDir, rel);
    if (!existsSync(p)) throw new Error(`brands/${id}: file mancante ${rel}`);
    return p;
  };
  // Verifica subito che tutti i file dichiarati esistano.
  const c = parsed.data;
  [c.logo, c.logoMark, c.logoMono, c.font.license, ...c.font.files.map((f) => f.file)].forEach((f) => f && file(f));
  return { config: c, dir: brandDir, file };
}
