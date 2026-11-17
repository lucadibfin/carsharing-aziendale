import { expect, test } from '@playwright/test';
import { completeOnboarding, login, pickComune } from './helpers';

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
