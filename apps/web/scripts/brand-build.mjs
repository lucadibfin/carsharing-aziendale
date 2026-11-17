// Genera tema, manifest, index.html, icone e font del marchio scelto con BRAND.
//
//   BRAND=fincons node scripts/brand-build.mjs          (build: solo il marchio attivo)
//   BRAND=fincons node scripts/brand-build.mjs --all    (sviluppo: anche gli altri marchi per /dev/stile)
//
// Tutto finisce in src/generated/ (ignorata da git). Nessun nome di azienda è scritto
// nel codice: ogni valore arriva da brands/<id>/brand.json tramite @fcs/brand.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveTokens, formatRatio, listBrands, loadBrand } from '@fcs/brand';
import { generateIcons } from './brand-icons.mjs';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(webDir, 'src', 'generated');
const publicDir = join(outDir, 'public');
const brandId = process.env.BRAND || 'default';
const all = process.argv.includes('--all');

const HEADER = (id) =>
  `// FILE GENERATO da apps/web/scripts/brand-build.mjs (marchio "${id}"): non modificarlo.\n` +
  `// Per cambiare la grafica modifica brands/${id}/brand.json e rilancia la build.\n`;

const scssMap = (obj, indent = '  ') =>
  '(\n' +
  Object.entries(obj)
    .map(([k, v]) => `${indent}${k}: ${typeof v === 'object' ? scssMap(v, indent + '  ') : v},`)
    .join('\n') +
  `\n${indent.slice(2)})`;

function paletteMaps(tokens) {
  const p = tokens.palettes;
  return {
    primary: { ...p.primary, secondary: p.secondary, neutral: p.neutral, 'neutral-variant': p['neutral-variant'], error: p.error },
    tertiary: { ...p.tertiary, secondary: p.secondary, neutral: p.neutral, 'neutral-variant': p['neutral-variant'], error: p.error },
  };
}

function fontFaces(brand, base) {
  return brand.config.font.files
    .map(
      (f) => `  @font-face {
    font-family: '${brand.config.font.family}';
    font-style: ${f.style};
    font-weight: ${f.weight};
    font-display: swap;
    src: url('${base}/${basename(f.file)}') format('woff2');
  }`,
    )
    .join('\n');
}

/** Mixin SCSS di un marchio: palette, colori esatti, token --app-* e override dei componenti. */
function brandScss(brand, tokens, fontBase) {
  const c = brand.config;
  const { primary, tertiary } = paletteMaps(tokens);
  const q = (s) => `string.unquote("${s.replace(/"/g, '\\"')}")`;
  const shapes = ['filled', 'outlined', 'protected', 'text', 'tonal'];
  const button = Object.fromEntries(
    shapes.flatMap((s) => [
      [`${s}-container-shape`, 'var(--app-radius-button)'],
      [`${s}-label-text-transform`, 'var(--app-button-transform)'],
      [`${s}-label-text-tracking`, 'var(--app-button-tracking)'],
    ]),
  );
  const card = {
    'elevated-container-shape': 'var(--app-radius-card)',
    'filled-container-shape': 'var(--app-radius-card)',
    'outlined-container-shape': 'var(--app-radius-card)',
    ...(c.card === 'shadow'
      ? { 'outlined-outline-color': 'transparent', 'outlined-container-elevation': 'var(--app-shadow-1)', 'outlined-container-color': 'var(--mat-sys-surface-container-lowest)' }
      : {}),
  };
  return `${HEADER(c.id)}@use 'sass:string';
@use '@angular/material' as mat;

$primary-palette: ${scssMap(primary)};

$tertiary-palette: ${scssMap(tertiary)};

/// @font-face del carattere del marchio (file inclusi nell'app, mai da servizi esterni).
@mixin font-faces {
${fontFaces(brand, fontBase)}
}

/// Tutti i design token del marchio. $scheme: light (dark è predisposto ma non ancora attivo).
@mixin tokens($scheme: light) {
  @if $scheme != light {
    @error 'Tema scuro non ancora disponibile per il marchio ${c.id}';
  }
  color-scheme: light;
  @include mat.theme(
    (
      color: (primary: $primary-palette, tertiary: $tertiary-palette, theme-type: light),
      typography: (
        plain-family: ${q(tokens.app['font-body'])},
        brand-family: ${q(tokens.app['font-heading'])},
        bold-weight: ${c.font.weights.bold},
        medium-weight: ${c.font.weights.medium},
        regular-weight: ${c.font.weights.regular},
      ),
      density: 0,
    )
  );

  // Colori: ruoli Material 3 con i colori esatti del marchio, verificati WCAG AA.
${Object.entries(tokens.schemes.light)
  .map(([k, v]) => `  --mat-sys-${k}: ${v};`)
  .join('\n')}

  // Token dell'app: spazi, raggi, ombre, caratteri.
${Object.entries(tokens.app)
  .map(([k, v]) => `  --app-${k}: ${v};`)
  .join('\n')}

  // Colori semantici dell'app (alias dei ruoli Material).
  --app-color-link: var(--mat-sys-primary);
  --app-color-accent: var(--mat-sys-tertiary);
  --app-color-brand: ${c.colors.light.primary};

  @include mat.button-overrides(${scssMap(button, '    ')});
  @include mat.card-overrides(${scssMap(card, '    ')});
  @include mat.form-field-overrides(
    (filled-container-shape: var(--app-radius-field), outlined-container-shape: var(--app-radius-field))
  );
  @include mat.chips-overrides((container-shape-radius: var(--app-radius-chip)));
  @include mat.dialog-overrides((container-shape: var(--app-radius-dialog)));
  @include mat.snack-bar-overrides((container-shape: var(--app-radius-sm)));
}
`;
}

function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function copyBrandAssets(brand, dest) {
  const c = brand.config;
  mkdirSync(join(dest, 'fonts'), { recursive: true });
  copyFileSync(brand.file(c.logo), join(dest, 'logo.svg'));
  copyFileSync(brand.file(c.logoMark ?? c.logo), join(dest, 'logo-mark.svg'));
  for (const f of c.font.files) copyFileSync(brand.file(f.file), join(dest, 'fonts', basename(f.file)));
  copyFileSync(brand.file(c.font.license), join(dest, 'fonts', `LICENSE-${c.font.family.replace(/\W+/g, '')}.txt`));
}

function manifest(c, tokens) {
  const icon = (src, size, purpose) => ({ src, sizes: `${size}x${size}`, type: 'image/png', purpose });
  return {
    name: c.appName,
    short_name: c.shortName,
    description: c.description,
    lang: 'it',
    dir: 'ltr',
    display: 'standalone',
    orientation: 'portrait',
    background_color: tokens.schemes.light.surface,
    theme_color: c.colors.light.primary,
    scope: './',
    start_url: './',
    icons: [
      icon('icons/icon-192.png', 192, 'any'),
      icon('icons/icon-512.png', 512, 'any'),
      icon('icons/maskable-192.png', 192, 'maskable'),
      icon('icons/maskable-512.png', 512, 'maskable'),
      icon('icons/monochrome-512.png', 512, 'monochrome'),
    ],
  };
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

async function main() {
  const brand = loadBrand(brandId);
  const c = brand.config;
  const tokens = deriveTokens(c);
  const failing = tokens.contrast.filter((r) => !r.pass);
  if (failing.length) {
    throw new Error(
      `Marchio "${brandId}": contrasto insufficiente\n` +
        failing.map((r) => `  ${r.fg} su ${r.bg}: ${formatRatio(r.ratio)}:1 (min ${r.min}:1)`).join('\n'),
    );
  }

  rmSync(outDir, { recursive: true, force: true });

  // Tema SCSS del marchio attivo.
  writeFile(join(outDir, '_brand.scss'), brandScss(brand, tokens, '/brand/fonts'));

  // Costante TypeScript con i soli dati pubblici del marchio.
  const pub = { id: c.id, appName: c.appName, shortName: c.shortName, description: c.description, tagline: c.tagline, logo: '/brand/logo.svg' };
  writeFile(join(outDir, 'brand.ts'), `${HEADER(c.id)}export const BRAND = ${JSON.stringify(pub, null, 2)} as const;\n`);

  // index.html dal modello.
  const html = readFileSync(join(webDir, 'src', 'index.template.html'), 'utf8')
    .replaceAll('{{appName}}', esc(c.appName))
    .replaceAll('{{shortName}}', esc(c.shortName))
    .replaceAll('{{description}}', esc(c.description))
    .replaceAll('{{themeColor}}', c.colors.light.primary);
  writeFile(join(outDir, 'index.html'), html);

  // Asset pubblici: manifest, logo, font, icone.
  writeFile(join(publicDir, 'manifest.webmanifest'), JSON.stringify(manifest(c, tokens), null, 2) + '\n');
  copyBrandAssets(brand, join(publicDir, 'brand'));
  await generateIcons({
    mark: brand.file(c.logoMark ?? c.logo),
    mono: c.logoMono && brand.file(c.logoMono),
    background: c.icons.background,
    padding: c.icons.padding,
    outDir: publicDir,
  });

  // Guida di stile (solo sviluppo): token di tutti i marchi, confinati in [data-brand].
  const ids = all ? listBrands() : [brandId];
  const preview = [];
  let guide = `${HEADER(brandId)}// Usato solo dalla guida di stile /dev/stile.\n`;
  for (const id of ids) {
    const b = id === brandId ? brand : loadBrand(id);
    const t = id === brandId ? tokens : deriveTokens(b.config);
    const base = `/brands/${id}`;
    if (all) copyBrandAssets(b, join(publicDir, 'brands', id));
    writeFile(join(outDir, 'brands', `_${id}.scss`), brandScss(b, t, `${base}/fonts`));
    guide += `@use 'brands/${id}' as ${id.replace(/-/g, '_')};\n`;
    preview.push({
      id,
      appName: b.config.appName,
      logo: `${base}/logo.svg`,
      approved: b.config.usageApproval.approved,
      colors: b.config.colors.light,
      contrast: t.contrast.map((r) => ({ fg: r.fg, bg: r.bg, fgColor: r.fgColor, bgColor: r.bgColor, min: r.min, usage: r.usage, ratio: formatRatio(r.ratio), pass: r.pass })),
      adjustments: t.adjustments,
    });
  }
  for (const id of ids) {
    const ns = id.replace(/-/g, '_');
    guide += `\n@include ${ns}.font-faces;\n[data-brand='${id}'] {\n  @include ${ns}.tokens;\n  font-family: var(--app-font-body);\n  background: var(--mat-sys-surface);\n  color: var(--mat-sys-on-surface);\n}\n`;
  }
  writeFile(join(outDir, '_styleguide.scss'), guide);
  writeFile(
    join(outDir, 'brands-preview.ts'),
    `${HEADER(brandId)}export interface BrandPreview {
  id: string;
  appName: string;
  logo: string;
  approved: boolean;
  colors: Record<string, string | number | undefined>;
  contrast: { fg: string; bg: string; fgColor: string; bgColor: string; min: number; usage: string; ratio: string; pass: boolean }[];
  adjustments: { role: string; from: string; to: string; reason: string }[];
}

export const BRANDS_PREVIEW: BrandPreview[] = ${JSON.stringify(preview, null, 2)};
`,
  );

  console.log(`Marchio "${brandId}" generato in src/generated${all ? ` (+ anteprima di: ${ids.join(', ')})` : ''}.`);
  if (!c.usageApproval.approved) console.warn(`ATTENZIONE: uso del marchio "${brandId}" non ancora approvato. ${c.usageApproval.note}`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
