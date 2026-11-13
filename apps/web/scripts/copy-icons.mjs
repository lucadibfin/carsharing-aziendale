// Copia in public/icons/ms solo le icone Material Symbols usate dall'app
// (elenco in src/app/core/icons.ts). Uso: npm run icons -w web
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const src = resolve(root, '../../node_modules/@material-symbols/svg-400/outlined');
const dst = resolve(root, 'public/icons/ms');
const list = readFileSync(resolve(root, 'src/app/core/icons.ts'), 'utf8');
const names = [...list.matchAll(/'([a-z0-9_-]+)'/g)].map((m) => m[1]);

mkdirSync(dst, { recursive: true });
for (const n of names) copyFileSync(resolve(src, `${n}.svg`), resolve(dst, `${n}.svg`));
copyFileSync(resolve(src, '../LICENSE'), resolve(dst, 'LICENSE'));
console.log(`${names.length} icone copiate in ${dst}`);
