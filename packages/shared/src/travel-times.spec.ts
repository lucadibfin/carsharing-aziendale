import { describe, expect, it } from 'vitest';
import { estimatePassTimes, fromMinutes, suggestDeparture, toMinutes } from './travel-times.js';

describe('orari stimati lungo il percorso', () => {
  it('conversioni', () => {
    expect(toMinutes('07:05')).toBe(425);
    expect(fromMinutes(425)).toBe('07:05');
    expect(fromMinutes(-10)).toBe('00:00');
  });

  it('partenza proposta: arrivo meno il tempo di guida, arrotondata per difetto ai 5 minuti', () => {
    expect(suggestDeparture('08:30', 75)).toBe('07:15');
    expect(suggestDeparture('08:30', 73)).toBe('07:15');
    expect(suggestDeparture('08:30', 77)).toBe('07:10');
  });

  it('passaggi dalle distanze verso la sede, adattati alla partenza scelta', () => {
    // Bergamo 75 min dalla sede, Monza 25: con partenza 7:15 si passa da Monza circa alle 8:05.
    expect(estimatePassTimes('07:15', '08:30', [75, 25])).toEqual(['07:15', '08:05']);
    // Partenza anticipata alle 7:00 (90 minuti invece di 75): i passaggi si distribuiscono.
    expect(estimatePassTimes('07:00', '08:30', [75, 25])).toEqual(['07:00', '08:00']);
  });

  it('senza dati o con distanze incoerenti gli orari restano in ordine', () => {
    expect(estimatePassTimes('07:00', '08:00', [null, null, null])).toEqual(['07:00', '07:20', '07:40']);
    expect(estimatePassTimes('07:00', '08:00', [60, 70, 10])).toEqual(['07:00', '07:00', '07:50']);
  });
});
