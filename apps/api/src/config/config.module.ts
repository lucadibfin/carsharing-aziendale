import { Global, Module } from '@nestjs/common';
import { type BrandConfig, loadBrand } from '@fcs/brand';
import { loadEnv, type Env } from './env.js';

export const ENV = Symbol('ENV');
/** Configurazione del marchio scelto con BRAND (brands/<id>/brand.json). */
export const BRAND = Symbol('BRAND');

@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: (): Env => loadEnv() },
    { provide: BRAND, useFactory: (env: Env): BrandConfig => loadBrand(env.BRAND).config, inject: [ENV] },
  ],
  exports: [ENV, BRAND],
})
export class ConfigModule {}
