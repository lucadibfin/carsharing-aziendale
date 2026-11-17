import { z } from 'zod';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'colore esadecimale #rrggbb');
/** Percorso di un file dentro la cartella del marchio (niente percorsi assoluti o risalite). */
const brandFile = z.string().regex(/^(?!\/)(?!.*\.\.)[\w./-]+$/, 'percorso relativo alla cartella del marchio');
/** Raggio degli angoli in px, oppure "pill" (completamente arrotondato). */
const radius = z.union([z.number().min(0).max(48), z.literal('pill')]);

const colorSetSchema = z.object({
  /** Colore principale: pulsanti, link, elementi attivi. */
  primary: hex,
  /** Colore secondario: chip, avvisi, elementi di supporto. */
  secondary: hex,
  /** Colore d'accento: etichette e richiami (palette "tertiary" di Material). */
  accent: hex,
  /** Tinta delle superfici (sfondi, card). Se assente si usa il primario. */
  neutral: hex.optional(),
  /** Saturazione delle superfici: 0 = grigio puro, 6 = tinta leggera (default Material). */
  neutralChroma: z.number().min(0).max(16).default(6),
  /** Colore di errore. */
  error: hex.default('#b3261e'),
});

export const brandSchema = z.object({
  /** Identificativo: deve coincidere con il nome della cartella in brands/. */
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** Nome completo dell'app (titolo, manifest, email). */
  appName: z.string().min(1).max(60),
  /** Nome breve: icona sulla schermata Home (max 12 caratteri per non essere troncato). */
  shortName: z.string().min(1).max(12),
  /** Descrizione: manifest PWA e meta description. */
  description: z.string().min(1).max(200),
  /** Frase mostrata sotto il nome nella pagina di accesso. */
  tagline: z.string().max(200).default(''),
  /** Logo SVG orizzontale (pagina di accesso). */
  logo: brandFile,
  /** Simbolo SVG quadrato da cui si generano le icone; se assente si usa il logo. */
  logoMark: brandFile.optional(),
  /**
   * Simbolo per le icone monocromatiche (badge delle notifiche): conta solo la sagoma,
   * che diventa bianca. Se assente si usa la sagoma del simbolo.
   */
  logoMono: brandFile.optional(),
  colors: z.object({
    light: colorSetSchema,
    /** Riservato al futuro tema scuro: oggi non viene usato. */
    dark: colorSetSchema.partial().optional(),
  }),
  icons: z.object({
    /** Sfondo delle icone opache (maskable, apple-touch-icon). */
    background: hex,
    /** Margine attorno al simbolo nelle icone "any", in frazione del lato (0–0.3). */
    padding: z.number().min(0).max(0.3).default(0.06),
  }),
  font: z.object({
    family: z.string().min(1),
    /** Famiglia per i titoli; se assente la stessa del testo. */
    headingFamily: z.string().optional(),
    fallback: z.string().default("system-ui, -apple-system, 'Segoe UI', Arial, sans-serif"),
    weights: z
      .object({ regular: z.number().int(), medium: z.number().int(), bold: z.number().int() })
      .default({ regular: 400, medium: 500, bold: 700 }),
    files: z
      .array(z.object({ weight: z.number().int().min(100).max(900), style: z.enum(['normal', 'italic']).default('normal'), file: brandFile }))
      .min(1),
    /** File di licenza del carattere (obbligatorio: va distribuito insieme ai font). */
    license: brandFile,
  }),
  shape: z.object({
    button: radius,
    card: radius,
    field: radius,
    chip: radius,
    dialog: radius.default(28),
  }),
  /** Stile delle card: "outlined" (bordo sottile) o "shadow" (ombra, senza bordo). */
  card: z.enum(['outlined', 'shadow']).default('outlined'),
  /** Ombre: "soft" (Material) o "pronounced" (ombra spostata, più evidente). */
  elevation: z.enum(['soft', 'pronounced']).default('soft'),
  text: z
    .object({
      headingTransform: z.enum(['none', 'uppercase']).default('none'),
      headingTracking: z.string().default('normal'),
      buttonTransform: z.enum(['none', 'uppercase']).default('none'),
      buttonTracking: z.string().default('0.00625em'),
    })
    .prefault({}),
  email: z.object({
    /** Nome del mittente (l'indirizzo arriva da MAIL_FROM sull'API). */
    senderName: z.string().min(1).max(80),
    /** Firma in fondo a ogni email. */
    signature: z.string().max(500),
  }),
  /** Dati dell'organizzazione per informativa e termini. Vuoti = segnaposto da compilare. */
  legal: z
    .object({
      companyName: z.string().default(''),
      address: z.string().default(''),
      privacyContact: z.string().default(''),
      dpoContact: z.string().default(''),
      website: z.string().default(''),
    })
    .prefault({}),
  /** Stato dell'autorizzazione all'uso di logo e marchio. */
  usageApproval: z.object({ approved: z.boolean(), note: z.string() }),
});

export type BrandConfig = z.output<typeof brandSchema>;
export type BrandColorSet = z.output<typeof colorSetSchema>;
export type Radius = z.output<typeof radius>;
