import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service.js';

/** Parametri modificabili dagli admin (con valori di default). */
export const settingsSchema = z.object({
  /** Ore prima dell'arrivo in ufficio entro cui si può cancellare senza segnalazione. */
  cancellationDeadlineHours: z.number().int().min(0).max(72).default(2),
  /** Giorni di conservazione dei messaggi chat. */
  chatRetentionDays: z.number().int().min(1).max(365).default(30),
  /** Mesi di conservazione delle segnalazioni di assenza. */
  absenceReportRetentionMonths: z.number().int().min(1).max(60).default(12),
  /** Durata di default dei link d'invito (ore). */
  inviteLinkDefaultHours: z.number().int().min(1).max(720).default(72),
  /** Finestra di raggruppamento delle notifiche chat (secondi). */
  chatPushBatchSeconds: z.number().int().min(0).max(3600).default(120),
  /** Quanti giorni nel futuro si possono proporre viaggi. */
  maxDaysAhead: z.number().int().min(1).max(365).default(90),
  /** Giorni entro cui il conducente può chiudere un viaggio passato. */
  closureWindowDays: z.number().int().min(1).max(60).default(7),
});
export type Settings = z.infer<typeof settingsSchema>;

const CACHE_MS = 30_000;

@Injectable()
export class SettingsService {
  private cache: { value: Settings; at: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<Settings> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const rows = await this.prisma.setting.findMany();
    const raw = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    // Valori non validi in DB vengono ignorati a favore dei default.
    const parsed = settingsSchema.safeParse(raw);
    const value = parsed.success ? parsed.data : settingsSchema.parse({});
    this.cache = { value, at: Date.now() };
    return value;
  }

  invalidate(): void {
    this.cache = null;
  }
}
