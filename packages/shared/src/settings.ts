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
 * Valori di partenza INDICATIVI, da sostituire dall'area admin prima dell'uso nel PSCL.
 * Fonti di riferimento (vedi docs/distanze.md):
 * - CO2 per unità e consumi medi: ISPRA (parametri standard nazionali dei combustibili,
 *   fattori di emissione del trasporto stradale e dell'energia elettrica);
 * - prezzi dei carburanti: prezzi medi pubblicati dal Ministero delle Imprese e del Made in Italy.
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
  /** Viaggi ricorrenti: per quanti giorni in avanti si generano le date (job notturno). */
  recurringHorizonDays: z.number().int().min(7).max(90).default(28),
  /** Promemoria della sera prima: ora (Europe/Rome) da cui parte l'invio. */
  reminderEveningHour: z.number().int().min(12).max(23).default(20),
  /** Promemoria prima della partenza: minuti di anticipo rispetto alla partenza stimata. */
  reminderBeforeDepartureMinutes: z.number().int().min(15).max(180).default(60),
  /** Mesi di conservazione dei viaggi conclusi (dalla data del viaggio). Restano i fatti anonimi. */
  tripRetentionMonths: z.number().int().min(1).max(60).default(12),
  /** Giorni di conservazione degli inviti scaduti, revocati o già usati. */
  inviteRetentionDays: z.number().int().min(1).max(365).default(30),
  /** Mesi di conservazione dell'audit log (minimo 6, imposto anche dal database). */
  auditRetentionMonths: z.number().int().min(6).max(120).default(24),
  /** Report esportati: sotto questo numero di viaggi completati i valori di una riga non si pubblicano. */
  exportMinTrips: z.number().int().min(1).max(50).default(5),
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
