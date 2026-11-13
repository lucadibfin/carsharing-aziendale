import type { Prisma } from '../generated/prisma/client.js';

/** Relazioni caricate per costruire il contesto di accesso e i DTO di un viaggio. */
export const tripInclude = {
  series: {
    include: {
      stops: { orderBy: { order: 'asc' }, include: { comune: { select: { name: true } } } },
      driver: {
        select: { id: true, firstName: true, lastName: true, phoneEnc: true, status: true, consent: { select: { phoneVisible: true } } },
      },
      site: { select: { id: true, name: true } },
    },
  },
  participants: {
    orderBy: { requestedAt: 'asc' },
    include: {
      user: {
        select: { id: true, firstName: true, lastName: true, phoneEnc: true, consent: { select: { phoneVisible: true } } },
      },
    },
  },
} satisfies Prisma.TripInclude;

export type LoadedTrip = Prisma.TripGetPayload<{ include: typeof tripInclude }>;
