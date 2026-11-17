import { addDays, dateOnly } from '../common/time.js';

/** Giorno ISO della settimana (1 = lunedì … 7 = domenica) di una data AAAA-MM-GG. */
export function isoWeekday(date: string): number {
  const d = dateOnly(date).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Date (AAAA-MM-GG, estremi inclusi) che cadono nei giorni indicati. */
export function seriesDates(weekdays: number[], from: string, to: string): string[] {
  const days = new Set(weekdays);
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (days.has(isoWeekday(d))) out.push(d);
  return out;
}

/** Prima data, a partire da `from`, che cade in uno dei giorni indicati (entro 7 giorni). */
export function firstOccurrence(weekdays: number[], from: string): string | null {
  return seriesDates(weekdays, from, addDays(from, 6))[0] ?? null;
}
