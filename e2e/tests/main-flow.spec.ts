import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

/** Password del provider mock (apps/api/src/auth/mock-identity.provider.ts), solo sviluppo/test. */
const MOCK_PASSWORD = 'demo';
const OUTBOX = join(import.meta.dirname, '../.run/mail-outbox');

/** Attende l'email per `to` nella outbox di sviluppo e ne estrae il codice a 6 cifre. */
async function codeFromOutbox(to: string): Promise<string> {
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

async function login(page: Page, username: string): Promise<void> {
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Username aziendale').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(MOCK_PASSWORD);
  await page.getByRole('button', { name: 'Accedi' }).click();
}

const visibleButton = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).filter({ visible: true });
/** Contenuto di uno step dello stepper (regione con il nome dello step). */
const step = (page: Page, label: string | RegExp) => page.getByRole('region', { name: label });

async function pickComune(page: Page, label: string, search: string, option: string): Promise<void> {
  await page.getByRole('combobox', { name: label }).fill(search);
  await page.getByRole('option', { name: option }).click();
}

/** Primo accesso: informativa, termini, email verificata con codice, consensi (lasciati spenti), sede e comune. */
async function completeOnboarding(page: Page, email: string, comune: { search: string; option: string }): Promise<void> {
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

test('flusso principale: login, primo accesso con verifica email, viaggio privato, invito via link, chat', async ({ browser }) => {
  // ---------- Conducente ----------
  const driverCtx = await browser.newContext();
  const driver = await driverCtx.newPage();
  await driver.goto('/');
  await login(driver, 'mario.rossi');
  await completeOnboarding(driver, 'mario.rossi@example.test', { search: 'Bergamo', option: 'Bergamo (BG)' });
  await expect(driver).toHaveURL('http://localhost:4300/');

  // Proposta di un viaggio privato per domani.
  await driver.goto('/proponi');
  await expect(driver.getByRole('combobox', { name: 'Sede di destinazione' })).toContainText('Sede di Milano');
  await pickComune(driver, 'Comune di partenza', 'Bergamo', 'Bergamo (BG)');
  await driver.getByRole('button', { name: 'Aggiungi comune di passaggio' }).click();
  await pickComune(driver, 'Comune di passaggio 1', 'Monza', 'Monza (MB)');
  await driver.getByLabel("Punto d'incontro (facoltativo)").fill('Parcheggio della stazione');
  await driver.getByRole('radio', { name: 'Privato' }).or(driver.getByRole('button', { name: 'Privato' })).click();
  await driver.getByRole('button', { name: 'Pubblica il viaggio' }).click();
  await expect(driver).toHaveURL(/\/viaggi\/[0-9a-f-]{36}$/);
  const tripUrl = driver.url();
  await expect(driver.getByText('Privato', { exact: true })).toBeVisible();

  // Link d'invito (il token è nel frammento #, non arriva mai al server).
  await driver.getByRole('button', { name: /Crea link d'invito/ }).click();
  const link = (await driver.locator('.link-box code').textContent())!.trim();
  expect(link).toMatch(/^http:\/\/localhost:4300\/invito#[A-Za-z0-9_-]{32,64}$/);

  // ---------- Collega invitato (non ancora registrato) ----------
  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();
  await guest.goto(link);
  await login(guest, 'laura.bianchi');
  await completeOnboarding(guest, 'laura.personale@example.test', { search: 'Monza', option: 'Monza (MB)' });

  // Dopo il primo accesso si torna all'invito.
  await expect(guest.getByRole('heading', { name: 'Invito a un viaggio' })).toBeVisible();
  await guest.getByRole('combobox', { name: 'Dove sali?' }).click();
  await guest.getByRole('option', { name: 'Monza' }).click();
  await guest.getByRole('button', { name: "Accetta l'invito" }).click();
  await expect(guest).toHaveURL(tripUrl);
  await expect(guest.getByText('Accettato', { exact: false }).first()).toBeVisible();

  // Il conducente vede il nuovo partecipante.
  await driver.reload();
  await expect(driver.getByText('Laura Bianchi')).toBeVisible();

  // ---------- Chat in tempo reale ----------
  await driver.getByRole('link', { name: 'Chat del viaggio' }).click();
  await guest.getByRole('link', { name: 'Chat del viaggio' }).click();
  await expect(driver.getByText('Nessun messaggio')).toBeVisible();

  await guest.getByPlaceholder('Scrivi un messaggio').fill('Ciao Mario, ci vediamo domani!');
  await guest.getByRole('button', { name: 'Invia' }).click();
  // Arriva al conducente via WebSocket, senza ricaricare la pagina.
  await expect(driver.getByText('Ciao Mario, ci vediamo domani!')).toBeVisible();
  await expect(driver.locator('.msg .who').first()).toHaveText('Laura Bianchi');

  await driver.getByText('Sto arrivando').click();
  await expect(guest.locator('.msg').filter({ hasText: 'Sto arrivando' })).toBeVisible();

  await driverCtx.close();
  await guestCtx.close();
});
