import type { ParticipantStatus, TripStatus } from '@fcs/shared';

export const STATUS_LABELS: {
  participant: Record<ParticipantStatus, string>;
  trip: Record<TripStatus, string>;
} = {
  participant: {
    REQUESTED: 'Richiesta inviata',
    ACCEPTED: 'Confermato',
    REJECTED: 'Non accettato',
    CANCELLED: 'Annullato',
    WAITLISTED: 'In lista d’attesa',
    NOT_THERE: 'Assente',
  },
  trip: {
    SCHEDULED: 'Programmato',
    AWAITING_CLOSURE: 'Da chiudere',
    CLOSED: 'Concluso',
    CANCELLED: 'Annullato',
  },
};
