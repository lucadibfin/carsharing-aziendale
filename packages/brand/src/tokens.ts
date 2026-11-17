import { argbFromHex, DynamicScheme, Hct, hexFromArgb, TonalPalette } from '@material/material-color-utilities';
import { AA_NON_TEXT, AA_TEXT, contrastRatio, ensureContrast } from './contrast.js';
import type { BrandColorSet, BrandConfig, Radius } from './schema.js';

/** `Variant.TONAL_SPOT`: l'enum non è esportato dall'indice del pacchetto. */
const VARIANT_TONAL_SPOT = 2 as DynamicScheme['variant'];

/** Toni delle palette nel formato atteso da `mat.theme()` di Angular Material. */
export const PALETTE_TONES = [0, 4, 6, 10, 12, 17, 20, 22, 24, 25, 30, 35, 40, 50, 60, 70, 80, 87, 90, 92, 94, 95, 96, 98, 99, 100] as const;

export type PaletteName = 'primary' | 'secondary' | 'tertiary' | 'neutral' | 'neutral-variant' | 'error';
export type Palette = Record<number, string>;

/** Ruoli colore di Material 3, esposti come variabili CSS `--mat-sys-<ruolo>`. */
export const COLOR_ROLES = [
  'primary', 'on-primary', 'primary-container', 'on-primary-container', 'inverse-primary',
  'primary-fixed', 'primary-fixed-dim', 'on-primary-fixed', 'on-primary-fixed-variant',
  'secondary', 'on-secondary', 'secondary-container', 'on-secondary-container',
  'secondary-fixed', 'secondary-fixed-dim', 'on-secondary-fixed', 'on-secondary-fixed-variant',
  'tertiary', 'on-tertiary', 'tertiary-container', 'on-tertiary-container',
  'tertiary-fixed', 'tertiary-fixed-dim', 'on-tertiary-fixed', 'on-tertiary-fixed-variant',
  'error', 'on-error', 'error-container', 'on-error-container',
  'background', 'on-background', 'surface', 'on-surface', 'surface-variant', 'on-surface-variant',
  'surface-dim', 'surface-bright', 'surface-container-lowest', 'surface-container-low', 'surface-container',
  'surface-container-high', 'surface-container-highest', 'inverse-surface', 'inverse-on-surface',
  'outline', 'outline-variant', 'shadow', 'scrim', 'surface-tint',
] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];
export type ColorScheme = Record<ColorRole, string>;

export interface ContrastPair {
  fg: ColorRole;
  bg: ColorRole;
  min: number;
  /** Dove compare la coppia nell'interfaccia. */
  usage: string;
}

/**
 * Coppie di colori che l'interfaccia usa davvero, con la soglia WCAG 2.1 AA:
 * 4.5:1 per il testo, 3:1 per bordi dei controlli e indicatori.
 */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { fg: 'on-surface', bg: 'surface', min: AA_TEXT, usage: 'testo principale' },
  { fg: 'on-surface', bg: 'surface-container-lowest', min: AA_TEXT, usage: 'testo su card' },
  { fg: 'on-surface', bg: 'surface-container-low', min: AA_TEXT, usage: 'testo su card' },
  { fg: 'on-surface', bg: 'surface-container', min: AA_TEXT, usage: 'barra di navigazione' },
  { fg: 'on-surface', bg: 'surface-container-high', min: AA_TEXT, usage: 'messaggi chat ricevuti' },
  { fg: 'on-surface', bg: 'surface-container-highest', min: AA_TEXT, usage: 'campi compilati' },
  { fg: 'on-surface-variant', bg: 'surface', min: AA_TEXT, usage: 'testo secondario, etichette' },
  { fg: 'on-surface-variant', bg: 'surface-container', min: AA_TEXT, usage: 'voci di navigazione' },
  { fg: 'on-surface-variant', bg: 'surface-container-high', min: AA_TEXT, usage: 'testo secondario in chat' },
  { fg: 'primary', bg: 'surface', min: AA_TEXT, usage: 'link, pulsanti di testo' },
  { fg: 'primary', bg: 'surface-container', min: AA_TEXT, usage: 'voce di navigazione attiva' },
  { fg: 'primary', bg: 'surface-container-high', min: AA_TEXT, usage: 'nome del mittente in chat' },
  { fg: 'on-primary', bg: 'primary', min: AA_TEXT, usage: 'pulsante principale' },
  { fg: 'on-primary-container', bg: 'primary-container', min: AA_TEXT, usage: 'messaggi chat inviati' },
  { fg: 'secondary', bg: 'surface', min: AA_TEXT, usage: 'testo secondario colorato' },
  { fg: 'on-secondary', bg: 'secondary', min: AA_TEXT, usage: 'pulsante secondario' },
  { fg: 'on-secondary-container', bg: 'secondary-container', min: AA_TEXT, usage: 'chip, pulsante tonale, avvisi' },
  { fg: 'tertiary', bg: 'surface', min: AA_TEXT, usage: 'accento' },
  { fg: 'on-tertiary', bg: 'tertiary', min: AA_TEXT, usage: 'accento pieno' },
  { fg: 'on-tertiary-container', bg: 'tertiary-container', min: AA_TEXT, usage: 'chip "Privato"' },
  { fg: 'error', bg: 'surface', min: AA_TEXT, usage: 'messaggi di errore' },
  { fg: 'on-error', bg: 'error', min: AA_TEXT, usage: 'pulsante distruttivo' },
  { fg: 'on-error-container', bg: 'error-container', min: AA_TEXT, usage: 'chip di avviso' },
  { fg: 'inverse-on-surface', bg: 'inverse-surface', min: AA_TEXT, usage: 'notifiche (snackbar)' },
  { fg: 'inverse-primary', bg: 'inverse-surface', min: AA_TEXT, usage: 'azione nelle notifiche' },
  { fg: 'outline', bg: 'surface', min: AA_NON_TEXT, usage: 'bordo dei campi e dei controlli' },
  { fg: 'outline', bg: 'surface-container-low', min: AA_NON_TEXT, usage: 'bordo dei campi su card' },
  { fg: 'primary', bg: 'surface-container-highest', min: AA_NON_TEXT, usage: 'indicatore di focus, toggle attivo' },
];

export interface ContrastResult extends ContrastPair {
  fgColor: string;
  bgColor: string;
  ratio: number;
  pass: boolean;
}

export interface Adjustment {
  role: ColorRole;
  from: string;
  to: string;
  reason: string;
}

export interface BrandTokens {
  palettes: Record<PaletteName, Palette>;
  /** Colori per schema. `dark` è predisposto ma oggi non viene generato. */
  schemes: { light: ColorScheme; dark?: ColorScheme };
  /** Token non legati al colore (spazi, raggi, ombre, caratteri): `--app-<nome>`. */
  app: Record<string, string>;
  /** Variazioni applicate ai colori per rispettare WCAG AA. */
  adjustments: Adjustment[];
  contrast: ContrastResult[];
}

function toPalette(p: TonalPalette): Palette {
  return Object.fromEntries(PALETTE_TONES.map((t) => [t, hexFromArgb(p.tone(t))]));
}

function camel(role: string): string {
  return role.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function buildScheme(colors: BrandColorSet, isDark: boolean) {
  const primaryHct = Hct.fromInt(argbFromHex(colors.primary));
  const neutralHct = Hct.fromInt(argbFromHex(colors.neutral ?? colors.primary));
  const neutralChroma = Math.min(neutralHct.chroma, colors.neutralChroma);
  const palettes = {
    primary: TonalPalette.fromInt(argbFromHex(colors.primary)),
    secondary: TonalPalette.fromInt(argbFromHex(colors.secondary)),
    tertiary: TonalPalette.fromInt(argbFromHex(colors.accent)),
    neutral: TonalPalette.fromHueAndChroma(neutralHct.hue, neutralChroma),
    'neutral-variant': TonalPalette.fromHueAndChroma(neutralHct.hue, neutralChroma + 2),
    error: TonalPalette.fromInt(argbFromHex(colors.error)),
  };
  const scheme = new DynamicScheme({
    sourceColorArgb: primaryHct.toInt(),
    variant: VARIANT_TONAL_SPOT,
    contrastLevel: 0,
    isDark,
    primaryPalette: palettes.primary,
    secondaryPalette: palettes.secondary,
    tertiaryPalette: palettes.tertiary,
    neutralPalette: palettes.neutral,
    neutralVariantPalette: palettes['neutral-variant'],
  });
  scheme.errorPalette = palettes.error;
  const values = scheme as unknown as Record<string, number>;
  const roles = Object.fromEntries(COLOR_ROLES.map((r) => [r, hexFromArgb(values[camel(r)]!)])) as ColorScheme;
  return { palettes, roles };
}

/**
 * Colori di uno schema: ruoli Material 3 calcolati dalle palette del marchio, con
 * i colori del marchio imposti esattamente su primary/secondary/tertiary, poi
 * corretti dove serve per rispettare le soglie di contrasto.
 */
export function deriveColorScheme(colors: BrandColorSet): { scheme: ColorScheme; adjustments: Adjustment[] } {
  const { roles } = buildScheme(colors, false);
  const scheme: ColorScheme = { ...roles };
  scheme.primary = colors.primary.toLowerCase();
  scheme['surface-tint'] = scheme.primary;
  scheme.secondary = colors.secondary.toLowerCase();
  scheme.tertiary = colors.accent.toLowerCase();
  scheme.error = colors.error.toLowerCase();

  const adjustments: Adjustment[] = [];
  // Due passate: una correzione del primo piano può riguardare più coppie.
  for (let pass = 0; pass < 2; pass++) {
    for (const p of CONTRAST_PAIRS) {
      const before = scheme[p.fg];
      const after = ensureContrast(before, scheme[p.bg], p.min);
      if (after !== before) {
        scheme[p.fg] = after;
        adjustments.push({ role: p.fg, from: before, to: after, reason: `contrasto ${p.min}:1 su ${p.bg} (${p.usage})` });
      }
    }
  }
  scheme['surface-tint'] = scheme.primary;
  return { scheme, adjustments };
}

export function checkContrast(scheme: ColorScheme): ContrastResult[] {
  return CONTRAST_PAIRS.map((p) => {
    const ratio = contrastRatio(scheme[p.fg], scheme[p.bg]);
    return { ...p, fgColor: scheme[p.fg], bgColor: scheme[p.bg], ratio, pass: ratio >= p.min };
  });
}

function px(r: Radius): string {
  return r === 'pill' ? '9999px' : `${r}px`;
}

function fontStack(family: string, fallback: string): string {
  return `${/[\s,]/.test(family) ? `'${family}'` : family}, ${fallback}`;
}

const SHADOWS = {
  soft: [
    '0 1px 2px 0 rgb(0 0 0 / 0.3), 0 1px 3px 1px rgb(0 0 0 / 0.15)',
    '0 1px 2px 0 rgb(0 0 0 / 0.3), 0 2px 6px 2px rgb(0 0 0 / 0.15)',
    '0 1px 3px 0 rgb(0 0 0 / 0.3), 0 4px 8px 3px rgb(0 0 0 / 0.15)',
  ],
  pronounced: [
    '2px 3px 6px 0 rgb(0 0 0 / 0.18)',
    '4px 7px 10px 0 rgb(0 0 0 / 0.25)',
    '6px 10px 18px 0 rgb(0 0 0 / 0.28)',
  ],
} as const;

/** Token non cromatici: identici per schema chiaro e scuro. */
export function deriveAppTokens(brand: BrandConfig): Record<string, string> {
  const body = fontStack(brand.font.family, brand.font.fallback);
  const heading = fontStack(brand.font.headingFamily ?? brand.font.family, brand.font.fallback);
  const spaces = [4, 8, 12, 16, 24, 32, 48, 64];
  const shadows = SHADOWS[brand.elevation];
  return {
    ...Object.fromEntries(spaces.map((v, i) => [`space-${i + 1}`, `${v}px`])),
    'radius-sm': '4px',
    'radius-md': px(brand.shape.card),
    'radius-lg': '16px',
    'radius-pill': '9999px',
    'radius-button': px(brand.shape.button),
    'radius-card': px(brand.shape.card),
    'radius-field': px(brand.shape.field),
    'radius-chip': px(brand.shape.chip),
    'radius-dialog': px(brand.shape.dialog),
    'shadow-1': shadows[0],
    'shadow-2': shadows[1],
    'shadow-3': shadows[2],
    'font-body': body,
    'font-heading': heading,
    'font-weight-regular': String(brand.font.weights.regular),
    'font-weight-medium': String(brand.font.weights.medium),
    'font-weight-bold': String(brand.font.weights.bold),
    'heading-transform': brand.text.headingTransform,
    'heading-tracking': brand.text.headingTracking,
    'button-transform': brand.text.buttonTransform,
    'button-tracking': brand.text.buttonTracking,
  };
}

export function deriveTokens(brand: BrandConfig): BrandTokens {
  const { palettes } = buildScheme(brand.colors.light, false);
  const { scheme, adjustments } = deriveColorScheme(brand.colors.light);
  return {
    palettes: Object.fromEntries(Object.entries(palettes).map(([k, p]) => [k, toPalette(p)])) as Record<PaletteName, Palette>,
    schemes: { light: scheme },
    app: deriveAppTokens(brand),
    adjustments,
    contrast: checkContrast(scheme),
  };
}
