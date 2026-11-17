import { type ParticipantStatus, type TripStatus, type TripSummaryDto, WEEKDAY_LABELS } from '@fcs/shared';

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
    NOT_THERE: 'Non c’è',
  },
  trip: {
    SCHEDULED: 'Programmato',
    AWAITING_CLOSURE: 'Da chiudere',
    CLOSED: 'Concluso',
    CANCELLED: 'Annullato',
  },
};

/** "Ogni lun, mer, ven" con l'eventuale data di fine ("fino al 18/12/2026"). */
export function recurrenceLabel(r: TripSummaryDto['recurrence']): string {
  if (!r) return '';
  const days = r.weekdays.map((d) => WEEKDAY_LABELS[d]).join(', ');
  const end = r.endDate ? ` fino al ${r.endDate.slice(8, 10)}/${r.endDate.slice(5, 7)}/${r.endDate.slice(0, 4)}` : '';
  return `Ogni ${days}${end}`;
}
