// Dati di esempio per provare l'app.
//
//   npm run db:demo        (dalla radice; con l'API ferma)
//
// ATTENZIONE: cancella utenti, viaggi, chat, segnalazioni, statistiche e
// parametri e li ricrea (restano comuni e audit log; sedi e testi legali
// tornano quelli iniziali). Logica in src/demo/demo-data.service.ts.
//
// Ammesso in sviluppo con AUTH_PROVIDER=mock oppure in modalità demo
// (DEMO_MODE=true, vedi docs/demo.md); mai in produzione reale.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { loadEnv } from '../config/env.js';
import { DEMO_ACCOUNTS, DemoDataService } from '../demo/demo-data.service.js';

async function main(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    // variabili già nell'ambiente
  }
  // I job in coda verrebbero eseguiti: qui non servono (nessuna notifica viene inviata).
  process.env['JOBS_ENABLED'] = 'false';
  const env = loadEnv();
  const allowed = env.DEMO_MODE || (env.NODE_ENV !== 'production' && env.AUTH_PROVIDER === 'mock');
  if (!allowed) {
    throw new Error('Dati di esempio ammessi solo in sviluppo con AUTH_PROVIDER=mock o con DEMO_MODE=true');
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    // In modalità demo il primo avvio li ha già caricati se il DB era vuoto: si riparte comunque da zero.
    await app.get(DemoDataService).reset();
    console.log('Dati di esempio creati (password di tutte le utenze: demo):');
    for (const a of DEMO_ACCOUNTS) console.log(`  ${a.username.padEnd(16)} ${a.label}`);
  } finally {
    await app.close();
  }
}

await main();
