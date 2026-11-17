import { argbFromHex, Hct } from '@material/material-color-utilities';
import { describe, expect, it } from 'vitest';
import { AA_TEXT, contrastRatio, ensureContrast, formatRatio } from './contrast.js';
import { listBrands, loadBrand } from './load.js';
import { fillPlaceholders } from './text.js';
import { deriveTokens } from './tokens.js';

describe('calcolo del contrasto WCAG 2.1', () => {
  it('riproduce i valori di riferimento', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // #767676 è il grigio più chiaro che supera 4.5:1 su bianco.
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.5);
  });

  it('ensureContrast scurisce o schiarisce solo quanto basta', () => {
    expect(ensureContrast('#b10135', '#ffffff', AA_TEXT)).toBe('#b10135');
    const fixed = ensureContrast('#ff8a80', '#ffffff', AA_TEXT);
    expect(contrastRatio(fixed, '#ffffff')).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(fixed, '#ffffff')).toBeLessThan(5);
    const light = ensureContrast('#5d5d5f', '#121212', AA_TEXT);
    expect(contrastRatio(light, '#121212')).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe.each(listBrands())('marchio "%s"', (id) => {
  const brand = loadBrand(id);
  const tokens = deriveTokens(brand.config);

  it.each(tokens.contrast.map((c) => [`${c.fg} su ${c.bg} (${c.usage})`, c] as const))('%s rispetta WCAG AA', (_, c) => {
    expect(
      c.ratio,
      `${c.fgColor} su ${c.bgColor}: ${formatRatio(c.ratio)}:1, minimo ${c.min}:1 (mancano ${formatRatio(c.min - c.ratio)})`,
    ).toBeGreaterThanOrEqual(c.min);
  });

  it('usa esattamente i colori principali del marchio, se accessibili', () => {
    const light = brand.config.colors.light;
    for (const [role, color] of [['primary', light.primary], ['secondary', light.secondary], ['tertiary', light.accent]] as const) {
      const adjusted = tokens.adjustments.find((a) => a.role === role);
      if (!adjusted) expect(tokens.schemes.light[role]).toBe(color.toLowerCase());
    }
  });

  it('ha un colore di errore ben distinguibile dal colore principale', () => {
    const primary = Hct.fromInt(argbFromHex(tokens.schemes.light.primary));
    const error = Hct.fromInt(argbFromHex(tokens.schemes.light.error));
    const hueDistance = Math.min(Math.abs(primary.hue - error.hue), 360 - Math.abs(primary.hue - error.hue));
    // Un primario quasi grigio non si confonde con l'errore; altrimenti servono almeno 20° di tinta.
    if (primary.chroma >= 16) expect(hueDistance, `tinta primario ${primary.hue.toFixed(0)}°, errore ${error.hue.toFixed(0)}°`).toBeGreaterThanOrEqual(20);
  });

  it('ha un nome breve adatto alla schermata Home', () => {
    expect(brand.config.shortName.length).toBeLessThanOrEqual(12);
  });

  it('sostituisce i segnaposto nei testi', () => {
    expect(fillPlaceholders('App {{nomeApp}} ({{ sconosciuto }})', brand.config)).toBe(`App ${brand.config.appName} ({{ sconosciuto }})`);
  });
});
