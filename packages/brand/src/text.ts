import type { BrandConfig } from './schema.js';

/** Segnaposto disponibili nei testi (informativa, termini, email). */
export function brandPlaceholders(brand: BrandConfig): Record<string, string> {
  const todo = (what: string) => `[DA COMPILARE: ${what}]`;
  return {
    nomeApp: brand.appName,
    nomeBreve: brand.shortName,
    ragioneSociale: brand.legal.companyName || todo('ragione sociale'),
    indirizzo: brand.legal.address || todo('indirizzo della sede legale'),
    partitaIva: brand.legal.vatNumber || todo('partita IVA'),
    contattoPrivacy: brand.legal.privacyContact || todo('contatto privacy'),
    contattoDpo: brand.legal.dpoContact || todo('contatto del DPO'),
    sitoWeb: brand.legal.website || todo('sito web'),
  };
}

/** Sostituisce `{{nome}}` con i valori del marchio; i segnaposto sconosciuti restano invariati. */
export function fillPlaceholders(text: string, brand: BrandConfig): string {
  const values = brandPlaceholders(brand);
  return text.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (m, key: string) => values[key] ?? m);
}
