import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Clock } from '../common/clock.js';
import { PrismaService, type Tx } from '../common/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';

/** Azioni registrate. I codici sono stabili: compaiono nel registro e nei documenti per il DPO. */
export const AUDIT_ACTIONS = [
  // area amministrativa: accessi
  'ADMIN_TRIPS_LIST',
  'ADMIN_DASHBOARD_VIEW',
  'ADMIN_REPORT_EXPORT',
  'ADMIN_REPORTS_LIST',
  'ADMIN_REPORT_VIEW',
  'ADMIN_USER_SEARCH',
  'ADMIN_AUDIT_VIEW',
  'ADMIN_AUDIT_VERIFY',
  // area amministrativa: modifiche
  'ADMIN_REPORT_DECISION',
  'ADMIN_SETTINGS_UPDATE',
  'ADMIN_ROLE_GRANT',
  'ADMIN_ROLE_REVOKE',
  'ADMIN_POLICY_PUBLISH',
  'ADMIN_SITE_CREATE',
  'ADMIN_SITE_UPDATE',
  'DEMO_RESET',
  // diritti dell'interessato e ciclo di vita dell'account
  'USER_DATA_EXPORT',
  'USER_ACCOUNT_DELETED',
  'USER_DEACTIVATED',
  'USER_PURGED',
  // job di sistema
  'EMPLOYEE_CHECK_RUN',
  'RETENTION_RUN',
  'AUDIT_LOG_PURGED',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEntry {
  actorId: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  /** Solo dati NON personali: filtri, nomi dei campi modificati, conteggi. */
  meta?: Record<string, unknown>;
}

const GENESIS = '0'.repeat(64);
/** Chiave dell'advisory lock che serializza le scritture (catena di hash lineare). */
const LOCK_KEY = 0x4155_4449; // "AUDI"

/** JSON con chiavi ordinate: lo stesso contenuto produce sempre lo stesso hash. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(',')}}`;
}

export function auditHash(
  prevHash: string,
  e: { at: Date; actorId: string | null; action: string; targetType: string | null; targetId: string | null; meta: unknown },
): string {
  const body = canonical({
    at: e.at.toISOString(),
    actorId: e.actorId,
    action: e.action,
    targetType: e.targetType,
    targetId: e.targetId,
    meta: e.meta ?? null,
  });
  return createHash('sha256').update(prevHash).update(body).digest('hex');
}

export interface AuditVerifyResult {
  ok: boolean;
  checked: number;
  /** Primo record non coerente con la catena (manomissione o cancellazione). */
  brokenAtId: string | null;
}

/**
 * Audit log immutabile. Le righe sono solo aggiunte (trigger nel DB) e legate
 * da una catena di hash: modificare o togliere una riga rende la catena
 * non verificabile da quel punto in poi.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  /** Registra un evento. Se passata, usa la transazione del chiamante (l'evento segue l'esito dell'operazione). */
  async record(entry: AuditEntry, tx?: Tx): Promise<void> {
    const write = async (t: Tx) => {
      await t.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_KEY})`;
      const last = await t.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { hash: true } });
      const prevHash = last?.hash ?? GENESIS;
      const row = {
        at: this.clock.now(),
        actorId: entry.actorId,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        meta: (entry.meta ?? null) as Prisma.InputJsonValue | null,
      };
      await t.auditLog.create({
        data: { ...row, meta: row.meta ?? undefined, prevHash, hash: auditHash(prevHash, row) },
      });
    };
    if (tx) await write(tx);
    else await this.prisma.$transaction(write);
  }

  /**
   * Cancellazione per scadenza (job di conservazione): elimina in blocco le righe
   * più vecchie di `months` mesi tramite la funzione del database audit_log_purge,
   * unica eccezione all'append-only. Registra poi l'hash dell'ultima riga eliminata
   * (ancora), da cui riparte la verifica della catena.
   */
  async purgeExpired(months: number): Promise<number> {
    const [r] = await this.prisma.$queryRaw<{ deleted: bigint; last_deleted_id: bigint | null; anchor_hash: string | null }[]>`
      SELECT * FROM audit_log_purge(${months}::int)`;
    const deleted = Number(r?.deleted ?? 0);
    if (deleted > 0) {
      await this.record({
        actorId: null,
        action: 'AUDIT_LOG_PURGED',
        meta: { deleted, lastDeletedId: r!.last_deleted_id!.toString(), anchorHash: r!.anchor_hash, months },
      });
    }
    return deleted;
  }

  /**
   * Ricalcola l'intera catena. Se le righe iniziali sono state cancellate per
   * scadenza, la prima rimasta deve agganciarsi all'ancora registrata dalla purga.
   */
  async verify(): Promise<AuditVerifyResult> {
    let prev = GENESIS;
    const first = await this.prisma.auditLog.findFirst({ orderBy: { id: 'asc' }, select: { prevHash: true } });
    if (first && first.prevHash !== GENESIS) {
      const anchor = await this.prisma.auditLog.findFirst({
        where: { action: 'AUDIT_LOG_PURGED', meta: { path: ['anchorHash'], equals: first.prevHash } },
        select: { id: true },
      });
      if (anchor) prev = first.prevHash;
    }
    let checked = 0;
    let cursor: bigint | undefined;
    for (;;) {
      const rows = await this.prisma.auditLog.findMany({
        where: cursor === undefined ? {} : { id: { gt: cursor } },
        orderBy: { id: 'asc' },
        take: 1000,
      });
      if (rows.length === 0) break;
      for (const r of rows) {
        const expected = auditHash(prev, r);
        if (r.prevHash !== prev || r.hash !== expected) {
          this.logger.error({ id: r.id.toString() }, 'catena dell’audit log non coerente');
          return { ok: false, checked, brokenAtId: r.id.toString() };
        }
        prev = r.hash;
        checked++;
      }
      cursor = rows.at(-1)!.id;
    }
    return { ok: true, checked, brokenAtId: null };
  }
}
