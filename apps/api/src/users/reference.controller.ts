import { Controller, Get, Param, Query } from '@nestjs/common';
import { comuniQuerySchema, type ComuneDto, istatCode, type SiteDto } from '@fcs/shared';
import { AllowDuringOnboarding } from '../auth/decorators.js';
import { NotFound } from '../common/errors.js';
import { PrismaService } from '../common/prisma.service.js';

/** Dati di riferimento pubblici (sedi, comuni ISTAT): servono già durante l'onboarding. */
@AllowDuringOnboarding()
@Controller()
export class ReferenceController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('sites')
  async sites(): Promise<SiteDto[]> {
    const sites = await this.prisma.site.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
    return sites.map((s) => ({ id: s.id, name: s.name, address: s.address, comuneIstat: s.comuneIstat }));
  }

  @Get('comuni')
  async comuni(@Query({ schema: comuniQuerySchema }) q: { q: string }): Promise<ComuneDto[]> {
    const rows = await this.prisma.comune.findMany({
      where: { active: true, name: { startsWith: q.q, mode: 'insensitive' } },
      orderBy: { name: 'asc' },
      take: 20,
    });
    return rows.map((c) => ({ istat: c.istat, name: c.name, province: c.province }));
  }

  @Get('comuni/:istat')
  async comune(@Param('istat', { schema: istatCode }) istat: string): Promise<ComuneDto> {
    const c = await this.prisma.comune.findUnique({ where: { istat } });
    if (!c) throw NotFound('Comune');
    return { istat: c.istat, name: c.name, province: c.province };
  }
}
