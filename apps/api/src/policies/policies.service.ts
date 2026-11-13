import { Injectable } from '@nestjs/common';
import type { PolicyDto } from '@fcs/shared';
import { PrismaService } from '../common/prisma.service.js';
import type { PolicyDocument } from '../generated/prisma/client.js';
import { AppException } from '../common/errors.js';

const CACHE_MS = 30_000;

/** Informativa e termini versionati: per ogni tipo vale l'ultima versione pubblicata. */
@Injectable()
export class PoliciesService {
  private cache: { docs: PolicyDocument[]; at: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async current(): Promise<PolicyDocument[]> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.docs;
    const docs = await this.prisma.policyDocument.findMany({
      distinct: ['type'],
      orderBy: [{ type: 'asc' }, { version: 'desc' }],
    });
    this.cache = { docs, at: Date.now() };
    return docs;
  }

  invalidate(): void {
    this.cache = null;
  }

  /** Id dei documenti correnti non ancora accettati dall'utente. */
  async pendingFor(userId: string): Promise<string[]> {
    const docs = await this.current();
    if (docs.length === 0) return [];
    const accepted = await this.prisma.policyAcceptance.findMany({
      where: { userId, documentId: { in: docs.map((d) => d.id) } },
      select: { documentId: true },
    });
    const done = new Set(accepted.map((a) => a.documentId));
    return docs.filter((d) => !done.has(d.id)).map((d) => d.id);
  }

  /** Registra l'accettazione (versione e data) dei documenti correnti indicati. */
  async accept(userId: string, policyIds: string[]): Promise<void> {
    const current = new Set((await this.current()).map((d) => d.id));
    if (policyIds.some((id) => !current.has(id))) {
      throw new AppException('POLICY_OUTDATED', 'Il documento non è più in vigore: ricarica la pagina');
    }
    await this.prisma.policyAcceptance.createMany({
      data: policyIds.map((documentId) => ({ userId, documentId })),
      skipDuplicates: true,
    });
  }

  toDto(d: PolicyDocument): PolicyDto {
    return {
      id: d.id,
      type: d.type,
      version: d.version,
      title: d.title,
      content: d.content,
      publishedAt: d.publishedAt.toISOString(),
    };
  }
}
