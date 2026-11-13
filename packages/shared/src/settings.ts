// Parametri configurabili dagli admin globali (tabella Setting), con i default.
// Lo stesso schema valida i valori nell'API e il form dell'area amministrativa.
import { z } from 'zod';
import { FuelType } from './enums.js';

/** Unità del carburante per alimentazione. */
export const FUEL_UNITS: Record<FuelType, 'L' | 'kg' | 'kWh'> = {
  PETROL: 'L',
  DIESEL: 'L',
  LPG: 'L',
  METHANE: 'kg',
  HYBRID: 'L',
  ELECTRIC: 'kWh',
};

const fuelProfile = z.object({
  /** Consumo medio (unità ogni 100 km) usato se il conducente non ha indicato il suo. */
  consumptionPer100km: z.number().positive().max(100),
  /** kg di CO2 per unità di carburante (L, kg o kWh). */
  co2KgPerUnit: z.number().min(0).max(10),
  /** Prezzo in euro per unità. */
  pricePerUnit: z.number().min(0).max(20),
});
export type FuelProfile = z.infer<typeof fuelProfile>;

/**
 * Valori di partenza indicativi, DA VERIFICARE con il Mobility Manager prima
 * dell'uso nel PSCL (fattori di emissione allo scarico e prezzi medi).
 */
export const DEFAULT_FUEL_PROFILES: Record<FuelType, FuelProfile> = {
  PETROL: { consumptionPer100km: 6.5, co2KgPerUnit: 2.32, pricePerUnit: 1.8 },
  DIESEL: { consumptionPer100km: 5.5, co2KgPerUnit: 2.65, pricePerUnit: 1.7 },
  LPG: { consumptionPer100km: 8.5, co2KgPerUnit: 1.66, pricePerUnit: 0.75 },
  METHANE: { consumptionPer100km: 4.5, co2KgPerUnit: 2.75, pricePerUnit: 1.5 },
  HYBRID: { consumptionPer100km: 4.5, co2KgPerUnit: 2.32, pricePerUnit: 1.8 },
  ELECTRIC: { consumptionPer100km: 16, co2KgPerUnit: 0.25, pricePerUnit: 0.3 },
};

export const settingsSchema = z.object({
  /** Ore prima dell'arrivo in ufficio entro cui si può cancellare senza segnalazione. */
  cancellationDeadlineHours: z.number().int().min(0).max(72).default(2),
  /** Giorni di conservazione dei messaggi chat. */
  chatRetentionDays: z.number().int().min(1).max(365).default(30),
  /** Mesi di conservazione delle segnalazioni di assenza. */
  absenceReportRetentionMonths: z.number().int().min(1).max(60).default(12),
  /** Durata di default dei link d'invito (ore). */
  inviteLinkDefaultHours: z.number().int().min(1).max(720).default(72),
  /** Finestra di raggruppamento delle notifiche chat (secondi). */
  chatPushBatchSeconds: z.number().int().min(0).max(3600).default(120),
  /** Quanti giorni nel futuro si possono proporre viaggi. */
  maxDaysAhead: z.number().int().min(1).max(365).default(90),
  /** Giorni entro cui il conducente può chiudere un viaggio passato (e si possono inviare segnalazioni). */
  closureWindowDays: z.number().int().min(1).max(60).default(7),
  /** Giorni tra la disattivazione di un ex dipendente e la cancellazione definitiva dei suoi dati. */
  deactivatedPurgeDays: z.number().int().min(0).max(90).default(30),
  /** Alimentazione ipotizzata quando il conducente non ha indicato i dati dell'auto. */
  defaultFuelType: z.enum(FuelType).default('PETROL'),
  fuelProfiles: z
    .object({
      PETROL: fuelProfile,
      DIESEL: fuelProfile,
      LPG: fuelProfile,
      METHANE: fuelProfile,
      HYBRID: fuelProfile,
      ELECTRIC: fuelProfile,
    })
    .default(DEFAULT_FUEL_PROFILES),
  /** Coefficiente per stimare la distanza stradale dalla linea d'aria (se il routing non è disponibile). */
  estimatedRoadFactor: z.number().min(1).max(3).default(1.3),
});
export type Settings = z.infer<typeof settingsSchema>;
