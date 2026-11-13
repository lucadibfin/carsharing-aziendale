import { defineConfig, devices } from '@playwright/test';

/**
 * Test end-to-end del flusso principale. Avvia uno stack isolato (DB embedded
 * usa-e-getta + API compilata, porte 5440/3100) e la PWA con ng serve (4300).
 *
 * Browser: di default Google Chrome già installato (channel "chrome"), così non
 * serve scaricare i browser di Playwright. In alternativa:
 *   npx playwright install chromium   e   E2E_BROWSER_CHANNEL=chromium
 */
const channel = process.env.E2E_BROWSER_CHANNEL ?? 'chrome';

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '.run/report' }]],
  outputDir: '.run/results',
  use: {
    baseURL: 'http://localhost:4300',
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'], channel: channel === 'chromium' ? undefined : channel },
    },
  ],
  webServer: [
    {
      command: 'node scripts/start-stack.mjs',
      url: 'http://127.0.0.1:3100/api/policies/current',
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: 'pipe',
    },
    {
      command: 'npm start -w web -- --port 4300 --proxy-config ../../e2e/proxy.conf.json',
      cwd: '..',
      url: 'http://localhost:4300',
      timeout: 180_000,
      reuseExistingServer: false,
    },
  ],
});
