import { Inject, Injectable, Logger } from '@nestjs/common';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../common/prisma.service.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { SettingsService } from '../settings/settings.service.js';

export interface Distance {
  km: number;
  estimated: boolean;
}

/** Una stima viene ricalcolata con OSRM al massimo una volta al giorno. */
const RETRY_ESTIMATE_MS = 24 * 3600_000;

/** Distanza ortodromica in km (formula dell'emisenoverso). */
export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371.0088;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Distanze stradali calcolate SOLO tra il centroide di un comune (dato ISTAT
 * pubblico) e una sede aziendale. Nessun indirizzo o posizione degli utenti.
 * - ROUTING_PROVIDER=osrm: OSRM self-hosted; se non risponde si usa la stima.
 * - ROUTING_PROVIDER=estimate: linea d'aria × coefficiente (impostazione admin).
 * I risultati sono salvati in DistanceCache.
 */
@Injectable()
export class RoutingService {
  private readonly logger = new Logger('Routing');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** null se mancano le coordinate del comune o della sede. */
  async comuneToSite(comuneIstat: string, siteId: string): Promise<Distance | null> {
    const cached = await this.prisma.distanceCache.findUnique({ where: { comuneIstat_siteId: { comuneIstat, siteId } } });
    const now = this.clock.now();
    const useOsrm = this.env.ROUTING_PROVIDER === 'osrm';
    if (cached && (cached.source === 'ROUTED' || !useOsrm || now.getTime() - cached.computedAt.getTime() < RETRY_ESTIMATE_MS)) {
      return { km: cached.meters / 1000, estimated: cached.source === 'ESTIMATED' };
    }

    const from = await this.prisma.comune.findUnique({ where: { istat: comuneIstat }, select: { lat: true, lon: true } });
    const to = await this.siteCoords(siteId);
    if (from?.lat == null || from.lon == null || !to) return null;
    const a = { lat: from.lat, lon: from.lon };

    let meters: number | null = useOsrm ? await this.osrmMeters(a, to) : null;
    const source = meters === null ? 'ESTIMATED' : 'ROUTED';
    if (meters === null) {
      const { estimatedRoadFactor } = await this.settings.get();
      meters = Math.round(haversineKm(a, to) * estimatedRoadFactor * 1000);
    }
    await this.prisma.distanceCache.upsert({
      where: { comuneIstat_siteId: { comuneIstat, siteId } },
      create: { comuneIstat, siteId, meters, source, computedAt: now },
      update: { meters, source, computedAt: now },
    });
    return { km: meters / 1000, estimated: source === 'ESTIMATED' };
  }

  /** Da chiamare quando cambiano le coordinate di una sede. */
  async invalidateSite(siteId: string): Promise<void> {
    await this.prisma.distanceCache.deleteMany({ where: { siteId } });
  }

  /** Coordinate della sede; in mancanza, quelle del suo comune. */
  private async siteCoords(siteId: string): Promise<{ lat: number; lon: number } | null> {
    const site = await this.prisma.site.findUnique({ where: { id: siteId }, select: { lat: true, lon: true, comuneIstat: true } });
    if (!site) return null;
    if (site.lat != null && site.lon != null) return { lat: site.lat, lon: site.lon };
    const c = await this.prisma.comune.findUnique({ where: { istat: site.comuneIstat }, select: { lat: true, lon: true } });
    return c?.lat != null && c.lon != null ? { lat: c.lat, lon: c.lon } : null;
  }

  private async osrmMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): Promise<number | null> {
    const url =
      `${this.env.OSRM_URL.replace(/\/$/, '')}/route/v1/driving/` +
      `${a.lon.toFixed(6)},${a.lat.toFixed(6)};${b.lon.toFixed(6)},${b.lat.toFixed(6)}?overview=false&alternatives=false&steps=false`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(this.env.ROUTING_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { code?: string; routes?: { distance?: number }[] };
      const d = body.routes?.[0]?.distance;
      if (body.code !== 'Ok' || typeof d !== 'number') throw new Error(`risposta ${body.code ?? 'non valida'}`);
      return Math.round(d);
    } catch (e) {
      this.logger.warn({ reason: e instanceof Error ? e.message : 'errore' }, 'OSRM non disponibile: uso la stima');
      return null;
    }
  }
}
