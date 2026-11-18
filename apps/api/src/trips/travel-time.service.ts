import { Injectable } from '@nestjs/common';
import { estimatePassTimes, type RouteEstimateDto, suggestDeparture } from '@fcs/shared';
import { RoutingService } from '../stats/routing.service.js';

/** Velocità media ipotizzata per stimare i tempi di guida verso la sede. */
export const AVG_SPEED_KMH = 45;
/** Tempo di guida ipotizzato dal comune di partenza quando mancano le coordinate (minuti). */
export const DEFAULT_DRIVE_MINUTES = 45;

/**
 * Tempi di guida tra i comuni del percorso e la sede: distanza (stradale con OSRM,
 * altrimenti stimata) a AVG_SPEED_KMH, arrotondata per eccesso ai 5 minuti.
 * Solo dati pubblici: centroide del comune e sede.
 */
@Injectable()
export class TravelTimeService {
  constructor(private readonly routing: RoutingService) {}

  /** null se mancano le coordinate del comune o della sede. */
  async driveMinutes(comuneIstat: string, siteId: string): Promise<number | null> {
    const d = await this.routing.comuneToSite(comuneIstat, siteId);
    if (!d) return null;
    return Math.max(5, Math.ceil(((d.km / AVG_SPEED_KMH) * 60) / 5) * 5);
  }

  async estimate(siteId: string, arrivalTime: string, stops: string[]): Promise<RouteEstimateDto> {
    const driveMinutes: (number | null)[] = [];
    for (const s of stops) driveMinutes.push(await this.driveMinutes(s, siteId));
    return { departureTime: suggestDeparture(arrivalTime, driveMinutes[0] ?? DEFAULT_DRIVE_MINUTES), driveMinutes };
  }

  /** Partenza (scelta o proposta) e orari stimati di passaggio per ogni comune. */
  async plan(siteId: string, arrivalTime: string, stops: string[], departureTime?: string): Promise<{ departureTime: string; passTimes: string[] }> {
    const est = await this.estimate(siteId, arrivalTime, stops);
    const dep = departureTime ?? est.departureTime;
    return { departureTime: dep, passTimes: estimatePassTimes(dep, arrivalTime, est.driveMinutes) };
  }
}
