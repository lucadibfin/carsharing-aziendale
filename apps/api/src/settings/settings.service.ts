import { Injectable } from '@nestjs/common';
import { type Settings, settingsSchema } from '@fcs/shared';
import { PrismaService } from '../common/prisma.service.js';

export { settingsSchema, type Settings };

const CACHE_MS = 30_000;

/** Parametri modificabili dagli admin globali (schema e default in @fcs/shared). */
@Injectable()
export class SettingsService {
  private cache: { value: Settings; at: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<Settings> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const rows = await this.prisma.setting.findMany();
    const raw = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    // Un valore non valido in DB viene ignorato a favore del default (chiave per chiave).
    const value = settingsSchema.parse({});
    for (const [k, v] of Object.entries(raw)) {
      const single = settingsSchema.shape[k as keyof Settings]?.safeParse(v);
      if (single?.success) (value as Record<string, unknown>)[k] = single.data;
    }
    this.cache = { value, at: Date.now() };
    return value;
  }

  invalidate(): void {
    this.cache = null;
  }
}
