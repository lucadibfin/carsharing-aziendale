import { Global, Module } from '@nestjs/common';
import { Clock } from './clock.js';
import { CryptoService } from './crypto.service.js';
import { PrismaService } from './prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

@Global()
@Module({
  providers: [Clock, CryptoService, PrismaService, SettingsService],
  exports: [Clock, CryptoService, PrismaService, SettingsService],
})
export class CommonModule {}
