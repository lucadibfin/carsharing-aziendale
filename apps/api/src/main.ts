import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { loadEnv } from './config/env.js';
import { configureApp } from './security.js';
import { serveWeb } from './web-static.js';

async function bootstrap() {
  try {
    process.loadEnvFile();
  } catch {
    // nessun .env nella cartella corrente: le variabili arrivano dall'ambiente del processo
  }
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });
  app.useLogger(app.get(Logger));
  configureApp(app, env);
  serveWeb(app, env);
  await app.listen(env.PORT, env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
}
await bootstrap();
