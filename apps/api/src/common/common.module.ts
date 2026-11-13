import { Global, Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { Clock } from './clock.js';
import { CryptoService } from './crypto.service.js';
import { PrismaService } from './prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

@Global()
@Module({
  providers: [Clock, CryptoService, PrismaService, SettingsService, AuditService],
  exports: [Clock, CryptoService, PrismaService, SettingsService, AuditService],
})
export class CommonModule {}
