import EmbeddedPostgres from 'embedded-postgres';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/** Avvia un PostgreSQL embedded usa-e-getta, applica le migrazioni e il seed. */
export default async function setup(project: TestProject) {
  const dir = mkdtempSync(join(tmpdir(), 'fcs-test-pg-'));
  const port = 5434 + Math.floor(Math.random() * 500);
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    port,
    user: 'fcs_test',
    password: 'fcs_test',
    persistent: false,
    authMethod: 'scram-sha-256',
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: ['-c', 'listen_addresses=localhost', '-c', 'fsync=off'],
    onLog: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('fcs_test');
  const databaseUrl = `postgresql://fcs_test:fcs_test@localhost:${port}/fcs_test`;

  const cwd = resolve(import.meta.dirname, '..');
  const env = { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test' };
  const prismaCli = resolve(cwd, '../../node_modules/prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], { cwd, env, stdio: 'pipe' });
  execFileSync(process.execPath, ['prisma/seed.mjs'], { cwd, env, stdio: 'pipe' });

  project.provide('databaseUrl', databaseUrl);

  return async () => {
    await pg.stop();
    rmSync(dir, { recursive: true, force: true });
  };
}
