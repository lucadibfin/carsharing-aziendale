import { Conflict, NotFound } from '../common/errors.js';
import type { Tx } from '../common/prisma.service.js';

export const TRIP_FULL = () => Conflict('TRIP_FULL', 'Il viaggio è al completo');

/**
 * Blocca la riga del viaggio (SELECT … FOR UPDATE) e restituisce i posti liberi.
 * Chiamata dentro una transazione: due accettazioni concorrenti vengono
 * serializzate, quindi niente overbooking.
 */
export async function lockSeats(tx: Tx, tripId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ seats: number }[]>`SELECT seats FROM "Trip" WHERE id = ${tripId}::uuid FOR UPDATE`;
  if (rows.length === 0) throw NotFound('Viaggio');
  const accepted = await tx.tripParticipant.count({ where: { tripId, status: 'ACCEPTED' } });
  return rows[0]!.seats - accepted;
}

/** Come lockSeats, ma con errore TRIP_FULL se non c'è posto. */
export async function lockFreeSeat(tx: Tx, tripId: string): Promise<void> {
  if ((await lockSeats(tx, tripId)) <= 0) throw TRIP_FULL();
}
