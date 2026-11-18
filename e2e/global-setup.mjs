// Avvia lo stack e2e (DB embedded + API) prima dei test e lo ferma in modo
// ordinato alla fine: la funzione restituita è il teardown globale di Playwright.
import { startStack } from './scripts/start-stack.mjs';

export default async function globalSetup() {
  const stop = await startStack();
  return async () => {
    await stop();
  };
}
