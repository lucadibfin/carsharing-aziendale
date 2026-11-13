import { describe, expect, it } from 'vitest';
import { createTripSchema, loginSchema, sendChatMessageSchema } from './schemas.js';

describe('loginSchema', () => {
  it('normalizza lo username', () => {
    const r = loginSchema.parse({ username: '  Mario.Rossi ', password: 'x' });
    expect(r.username).toBe('mario.rossi');
  });

  it('rifiuta caratteri anomali nello username', () => {
    expect(loginSchema.safeParse({ username: 'a*)(uid=*', password: 'x' }).success).toBe(false);
  });
});

describe('createTripSchema', () => {
  const base = {
    siteId: '6f1c2a5e-7d3b-4c8e-9a1f-2b3c4d5e6f70',
    date: '2026-12-01',
    arrivalTime: '08:30',
    returnTime: '17:30',
    departureComune: '015146',
    viaComuni: ['015077'],
    seats: 3,
    visibility: 'PUBLIC',
  };

  it('accetta un viaggio valido', () => {
    expect(createTripSchema.safeParse(base).success).toBe(true);
  });

  it('rifiuta ripartenza prima dell’arrivo', () => {
    expect(createTripSchema.safeParse({ ...base, returnTime: '07:00' }).success).toBe(false);
  });

  it('rifiuta comuni ripetuti nel percorso', () => {
    expect(createTripSchema.safeParse({ ...base, viaComuni: ['015146'] }).success).toBe(false);
  });
});

describe('sendChatMessageSchema', () => {
  const tripId = '6f1c2a5e-7d3b-4c8e-9a1f-2b3c4d5e6f70';
  it('richiede testo oppure messaggio rapido, non entrambi', () => {
    expect(sendChatMessageSchema.safeParse({ tripId, text: 'ciao' }).success).toBe(true);
    expect(sendChatMessageSchema.safeParse({ tripId, quickCode: 'LATE_5' }).success).toBe(true);
    expect(sendChatMessageSchema.safeParse({ tripId }).success).toBe(false);
    expect(sendChatMessageSchema.safeParse({ tripId, text: 'x', quickCode: 'LATE_5' }).success).toBe(false);
  });
});
