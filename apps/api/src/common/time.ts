// Tutti gli orari dei viaggi sono espressi nel fuso delle sedi (Europe/Rome).
export const APP_TZ = 'Europe/Rome';

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function partsInTz(d: Date) {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return {
    y: Number(p['year']),
    m: Number(p['month']),
    d: Number(p['day']),
    h: Number(p['hour']),
    min: Number(p['minute']),
    s: Number(p['second']),
  };
}

/** Converte data (AAAA-MM-GG) e ora (HH:MM) locali di Roma nell'istante UTC corrispondente. */
export function romeToUtc(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [h, min] = time.split(':').map(Number) as [number, number];
  const target = Date.UTC(y, m - 1, d, h, min);
  let guess = target;
  // Due iterazioni bastano anche a cavallo dei cambi di ora legale.
  for (let i = 0; i < 2; i++) {
    const p = partsInTz(new Date(guess));
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
    guess += target - asUtc;
  }
  return new Date(guess);
}

/** Data odierna a Roma (AAAA-MM-GG). */
export function todayInRome(now = new Date()): string {
  const p = partsInTz(now);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** Converte una stringa AAAA-MM-GG in Date per colonne @db.Date (mezzanotte UTC). */
export function dateOnly(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** Converte un valore @db.Date in stringa AAAA-MM-GG. */
export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = dateOnly(date);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}
