import { defineConfig } from 'prisma/config';

// Prisma 7 non carica più .env automaticamente.
try {
  process.loadEnvFile();
} catch {
  // nessun file .env: si usano le variabili d'ambiente del processo
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node prisma/seed.mjs',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
