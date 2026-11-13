import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

export interface SendOptions {
  /** Con la stessa chiave resta in coda al massimo un job (raggruppamento). */
  singletonKey?: string;
  startAfterSeconds?: number;
}

type Handler = (data: any) => Promise<void>;

/**
 * Coda di job persistente su PostgreSQL (pg-boss): nessun Redis da gestire.
 * Con JOBS_ENABLED=false (test) i job vengono eseguiti subito e in modo
 * sincrono, così i test possono verificarne gli effetti.
 */
@Injectable()
export class JobQueue implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Jobs');
  private readonly handlers = new Map<string, Handler>();
  private readonly schedules: { name: string; cron: string }[] = [];
  private boss: PgBoss | null = null;
  private started = false;

  constructor(@Inject(ENV) private readonly env: Env) {}

  /** Registra il gestore di un tipo di job (da chiamare in onModuleInit). */
  register(name: string, handler: Handler): void {
    this.handlers.set(name, handler);
  }

  /** Pianifica un job ricorrente (cron, fuso Europe/Rome). */
  schedule(name: string, cron: string): void {
    this.schedules.push({ name, cron });
  }

  async send(name: string, data: object, opts: SendOptions = {}): Promise<void> {
    if (!this.boss) {
      const h = this.handlers.get(name);
      if (h) await h(data);
      return;
    }
    await this.boss.send(name, data, {
      singletonKey: opts.singletonKey,
      startAfter: opts.startAfterSeconds,
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.env.JOBS_ENABLED || this.started) return;
    this.started = true;
    const boss = new PgBoss({ connectionString: this.env.DATABASE_URL, schema: 'pgboss' });
    boss.on('error', (e: Error) => this.logger.error({ errName: e.name, msg: e.message }, 'errore pg-boss'));
    await boss.start();
    for (const [name, handler] of this.handlers) {
      // 'stately': al massimo un job in attesa per singletonKey → raggruppamento.
      await boss.createQueue(name, { policy: 'stately' });
      await boss.work(name, async (jobs) => {
        for (const job of jobs) await handler(job.data);
      });
    }
    for (const s of this.schedules) {
      await boss.schedule(s.name, s.cron, null, { tz: 'Europe/Rome' });
    }
    this.boss = boss;
    this.logger.log(`coda avviata (${this.handlers.size} tipi di job)`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.boss?.stop();
  }
}
