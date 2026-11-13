// Messaggi rapidi predefiniti della chat. Si salva solo il codice, mai testo libero.
export const QUICK_MESSAGES = {
  LATE_5: 'Sono in ritardo di qualche minuto',
  LATE_15: 'Sono in ritardo di circa 15 minuti',
  AT_MEETING_POINT: 'Sono al punto d’incontro',
  ON_MY_WAY: 'Sto arrivando',
  LEAVING_NOW: 'Parto adesso',
  CANT_COME: 'Oggi non riesco a esserci',
  THANKS: 'Grazie!',
} as const;

export type QuickMessageCode = keyof typeof QUICK_MESSAGES;
export const QUICK_MESSAGE_CODES = Object.keys(QUICK_MESSAGES) as QuickMessageCode[];
