import { argbFromHex, Hct, hexFromArgb } from '@material/material-color-utilities';

/** Soglie WCAG 2.1 livello AA. */
export const AA_TEXT = 4.5;
export const AA_NON_TEXT = 3;

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Luminanza relativa WCAG 2.1 di un colore `#rrggbb`. */
export function luminance(hex: string): number {
  const argb = argbFromHex(hex);
  const r = (argb >> 16) & 0xff;
  const g = (argb >> 8) & 0xff;
  const b = argb & 0xff;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Rapporto di contrasto WCAG 2.1 tra due colori (da 1 a 21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Restituisce `fg` invariato se ha già contrasto `min` su `bg`; altrimenti lo
 * scurisce (su sfondi chiari) o lo schiarisce (su sfondi scuri) mantenendo tinta
 * e saturazione (spazio HCT), fermandosi al primo tono che raggiunge la soglia.
 */
export function ensureContrast(fg: string, bg: string, min: number): string {
  if (contrastRatio(fg, bg) >= min) return fg.toLowerCase();
  const hct = Hct.fromInt(argbFromHex(fg));
  const darker = luminance(bg) > 0.18;
  for (let tone = hct.tone; tone >= 0 && tone <= 100; tone += darker ? -0.5 : 0.5) {
    const candidate = hexFromArgb(Hct.from(hct.hue, hct.chroma, tone).toInt());
    if (contrastRatio(candidate, bg) >= min) return candidate;
  }
  return darker ? '#000000' : '#ffffff';
}

/** Arrotonda un rapporto per la visualizzazione (per difetto: 4.499 non diventa 4.5). */
export function formatRatio(r: number): string {
  return (Math.floor(r * 100) / 100).toFixed(2);
}
