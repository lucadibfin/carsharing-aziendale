// Funzioni condivise dai test end-to-end.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';

/** Password del provider mock (apps/api/src/auth/mock-identity.provider.ts), solo sviluppo/test. */
const MOCK_PASSWORD = 'demo';
const OUTBOX = join(import.meta.dirname, '../.run/mail-outbox');

/** Attende l'email per `to` nella outbox di sviluppo e ne estrae il codice a 6 cifre. */
export async function codeFromOutbox(to: string): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(
      () => {
        let files: string[] = [];
        try {
          files = readdirSync(OUTBOX).sort();
        } catch {
          return undefined;
        }
        for (const f of files.reverse()) {
          const m = JSON.parse(readFileSync(join(OUTBOX, f), 'utf8')) as { to: string; text: string };
          if (m.to === to) return (code = m.text.match(/\b(\d{6})\b/)?.[1]);
        }
        return undefined;
      },
      { message: `codice di verifica per ${to}`, timeout: 10_000 },
    )
    .toBeTruthy();
  return code!;
}

export async function login(page: Page, username: string): Promise<void> {
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Username aziendale').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(MOCK_PASSWORD);
  await page.getByRole('button', { name: 'Accedi' }).click();
}

export const visibleButton = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).filter({ visible: true });
/** Contenuto di uno step dello stepper (regione con il nome dello step). */
export const step = (page: Page, label: string | RegExp) => page.getByRole('region', { name: label });

export async function pickComune(page: Page, label: string, search: string, option: string): Promise<void> {
  await page.getByRole('combobox', { name: label }).fill(search);
  await page.getByRole('option', { name: option }).click();
}

/** Primo accesso: informativa, termini, email verificata con codice, consensi (lasciati spenti), sede e comune. */
export async function completeOnboarding(page: Page, email: string, comune: { search: string; option: string }): Promise<void> {
  await expect(page).toHaveURL(/\/benvenuto/);
  await expect(page.getByText('BOZZA').first()).toBeVisible();
  const notice = step(page, /^Informativa privacy/);
  await notice.getByRole('checkbox').check();
  await notice.getByRole('button', { name: 'Continua' }).click();
  const terms = step(page, /^Termini/);
  await terms.getByRole('checkbox').check();
  await terms.getByRole('button', { name: 'Continua' }).click();

  // Email per le notifiche: codice inviato all'indirizzo stesso.
  const mail = step(page, 'Email per le notifiche');
  await mail.getByRole('textbox', { name: 'Email' }).fill(email);
  await mail.getByRole('button', { name: 'Invia codice' }).click();
  await expect(mail.getByText('Abbiamo inviato un codice')).toBeVisible();
  const code = await codeFromOutbox(email);
  const wrong = String((Number(code[0]) + 1) % 10) + code.slice(1);
  await mail.getByRole('textbox', { name: 'Codice' }).fill(wrong);
  await mail.getByRole('button', { name: 'Conferma' }).click();
  await expect(page.getByText('Codice non corretto')).toBeVisible();
  await mail.getByRole('textbox', { name: 'Codice' }).fill(code);
  await mail.getByRole('button', { name: 'Conferma' }).click();
  await expect(mail.getByTestId('verified-email')).toHaveText(email);
  await mail.getByRole('button', { name: 'Continua' }).click();

  // Consensi facoltativi: tutti spenti di default (privacy by default).
  const consents = step(page, 'Consensi facoltativi');
  const toggles = consents.getByRole('switch');
  await expect(toggles).toHaveCount(3);
  for (const toggle of await toggles.all()) await expect(toggle).not.toBeChecked();
  await consents.getByRole('button', { name: 'Continua' }).click();
  await page.getByRole('combobox', { name: 'Sede di riferimento' }).click();
  await page.getByRole('option', { name: 'Sede di Milano' }).click();
  await pickComune(page, 'Comune di residenza', comune.search, comune.option);
  await step(page, 'Sede e comune').getByRole('button', { name: /Inizia a usare/ }).click();
}
