// Genera le icone PWA dal simbolo SVG del marchio (elenco e requisiti in docs/icone.md).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pngToIco from 'png-to-ico';
import sharp from 'sharp';

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

/** Simbolo SVG rasterizzato e centrato in un quadrato `size` (lato utile `inner`). */
async function renderMark(svg, size, inner, background = TRANSPARENT) {
  // Densità scelta per rasterizzare al doppio del lato finale, qualunque sia il viewBox.
  const { width = 100, height = 100 } = await sharp(svg).metadata();
  const density = Math.min(2400, Math.max(1, (72 * 2 * inner) / Math.max(width, height)));
  const mark = await sharp(svg, { density })
    .resize(Math.round(inner), Math.round(inner), { fit: 'contain', background: TRANSPARENT })
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: mark, gravity: 'center' }])
    .png()
    .toBuffer();
}

/** Silhouette bianca su trasparente (badge delle notifiche, icona monocromatica). */
async function silhouette(svg, size, inner) {
  const rendered = await renderMark(svg, size, inner);
  const alpha = await sharp(rendered).extractChannel('alpha').png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 3, background: '#ffffff' } })
    .joinChannel(alpha)
    .png()
    .toBuffer();
}

/**
 * @param {{ mark: string, mono?: string, background: string, padding: number, outDir: string }} opts
 */
export async function generateIcons({ mark, mono, background, padding, outDir }) {
  const svg = readFileSync(mark);
  const monoSvg = mono ? readFileSync(mono) : svg;
  const icons = join(outDir, 'icons');
  mkdirSync(icons, { recursive: true });
  const write = (name, buf) => writeFileSync(join(icons, name), buf);
  const any = (size) => renderMark(svg, size, size * (1 - 2 * padding));

  // "any": simbolo su sfondo trasparente.
  for (const size of [192, 512]) write(`icon-${size}.png`, await any(size));
  // "maskable": sfondo pieno, simbolo dentro la zona sicura (cerchio dell'80% centrale).
  for (const size of [192, 512]) write(`maskable-${size}.png`, await renderMark(svg, size, size * 0.62, background));
  // iOS: icona opaca (iOS riempie di nero la trasparenza), angoli arrotondati dal sistema.
  for (const size of [180, 167]) write(`apple-touch-icon-${size}.png`, await renderMark(svg, size, size * 0.8, background));
  // Monocromatica e badge delle notifiche: bianco su trasparente.
  write('monochrome-512.png', await silhouette(monoSvg, 512, 512 * 0.8));
  write('badge-96.png', await silhouette(monoSvg, 96, 96 * 0.84));

  // Favicon: .ico multi-dimensione e SVG.
  const ico = await pngToIco(await Promise.all([16, 32, 48].map((s) => renderMark(svg, s, s))));
  writeFileSync(join(outDir, 'favicon.ico'), ico);
  writeFileSync(join(outDir, 'favicon.svg'), svg);
}
