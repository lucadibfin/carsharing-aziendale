import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    // PostgreSQL embedded dedicato ai test (porta e dati temporanei separati da quelli di sviluppo).
    globalSetup: ['test/global-setup.ts'],
    // I test di integrazione condividono il DB di test: si eseguono un file alla volta.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
