// Orari stimati lungo il percorso, usati sia dall'API (al salvataggio) sia dal
// modulo "Proponi un viaggio" (anteprima mentre il conducente modifica la partenza).

/** "HH:MM" → minuti dalla mezzanotte. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** Minuti dalla mezzanotte → "HH:MM" (entro la giornata). */
export function fromMinutes(min: number): string {
  const m = Math.min(Math.max(Math.round(min), 0), 24 * 60 - 1);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const round5 = (x: number) => Math.round(x / 5) * 5;

/**
 * Orario di partenza proposto: arrivo − tempo di guida dal comune di partenza alla
 * sede, arrotondato ai 5 minuti (per difetto, per non arrivare tardi).
 */
export function suggestDeparture(arrivalTime: string, driveFromDeparture: number): string {
  return fromMinutes(Math.floor((toMinutes(arrivalTime) - driveFromDeparture) / 5) * 5);
}

/**
 * Orari di passaggio stimati per ogni comune del percorso (il primo è la partenza).
 * `driveToSite[i]` sono i minuti di guida dal comune i alla sede (null se ignoti).
 * Gli scarti tra comuni si ricavano dalle distanze verso la sede e si adattano al
 * tempo che il conducente si è dato (partenza → arrivo); dove mancano i dati si
 * distribuiscono in modo uniforme. Arrotondati ai 5 minuti, sempre in ordine.
 */
export function estimatePassTimes(departureTime: string, arrivalTime: string, driveToSite: (number | null)[]): string[] {
  const dep = toMinutes(departureTime);
  const total = Math.max(toMinutes(arrivalTime) - dep, 0);
  const n = driveToSite.length;
  const first = driveToSite[0];
  const known = first !== null && first !== undefined && first > 0;
  const out: string[] = [];
  let prev = 0;
  for (let i = 0; i < n; i++) {
    let offset: number;
    const d = driveToSite[i];
    if (i === 0) offset = 0;
    else if (known && d !== null && d !== undefined) offset = ((first - Math.min(d, first)) / first) * total;
    else offset = (i / n) * total; // nessun dato: passaggi distribuiti in modo uniforme
    const rounded = i === 0 ? 0 : Math.min(Math.max(round5(offset), prev), total);
    prev = rounded;
    out.push(fromMinutes(dep + rounded));
  }
  return out;
}
