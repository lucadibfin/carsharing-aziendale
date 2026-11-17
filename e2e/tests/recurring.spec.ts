import { expect, test } from '@playwright/test';
import { completeOnboarding, login, pickComune } from './helpers';

test('viaggio ricorrente: gruppo fisso via link, "non ci sono", data resa pubblica, lista d’attesa', async ({ browser }) => {
  const errors: string[] = [];
  const watch = (p: import('@playwright/test').Page) => p.on('pageerror', (e) => errors.push(e.message));

  // ---------- Conducente: viaggio ricorrente privato, 1 posto ----------
  const driverCtx = await browser.newContext();
  const driver = await driverCtx.newPage();
  watch(driver);
  await driver.goto('/');
  await login(driver, 'giuseppe.verdi');
  await completeOnboarding(driver, 'giuseppe.verdi@example.test', { search: 'Bergamo', option: 'Bergamo (BG)' });

  await driver.goto('/proponi');
  await expect(driver.getByRole('combobox', { name: 'Sede di destinazione' })).toContainText('Sede di Milano');
  await driver.getByRole('switch', { name: 'Si ripete ogni settimana' }).click();
  // Tutti i giorni: le date esistono qualunque sia il giorno in cui gira il test.
  for (const d of ['sab', 'dom']) await driver.getByRole('checkbox', { name: d, exact: true }).check();
  await pickComune(driver, 'Comune di partenza', 'Bergamo', 'Bergamo (BG)');
  await driver.getByRole('button', { name: 'Aggiungi comune di passaggio' }).click();
  await pickComune(driver, 'Comune di passaggio 1', 'Monza', 'Monza (MB)');
  await driver.getByRole('combobox', { name: 'Posti disponibili per i passeggeri' }).click();
  await driver.getByRole('option', { name: '1', exact: true }).click();
  await driver.getByRole('radio', { name: 'Privato' }).or(driver.getByRole('button', { name: 'Privato' })).click();
  await driver.getByRole('button', { name: 'Pubblica il viaggio' }).click();
  await expect(driver).toHaveURL(/\/viaggi\/[0-9a-f-]{36}$/);
  const firstDateUrl = driver.url();
  await expect(driver.getByText('Ogni lun, mar, mer, gio, ven, sab, dom').first()).toBeVisible();
  await expect(driver.getByRole('heading', { name: 'Prossime date' })).toBeVisible();

  // Link d'invito al gruppo fisso (opzione predefinita per i viaggi ricorrenti).
  await expect(driver.getByRole('radio', { name: 'Gruppo fisso (tutte le date)' }).or(driver.getByRole('button', { name: 'Gruppo fisso (tutte le date)' }))).toBeVisible();
  await driver.getByRole('button', { name: /Crea link d'invito/ }).click();
  const link = (await driver.locator('.link-box code').textContent())!.trim();

  // ---------- Membro del gruppo fisso ----------
  const memberCtx = await browser.newContext();
  const member = await memberCtx.newPage();
  watch(member);
  await member.goto(link);
  await login(member, 'anna.neri');
  await completeOnboarding(member, 'anna.neri@example.test', { search: 'Monza', option: 'Monza (MB)' });
  await expect(member.getByText('Sei invitato nel gruppo fisso')).toBeVisible();
  await member.getByRole('combobox', { name: 'Dove sali?' }).click();
  await member.getByRole('option', { name: 'Monza' }).click();
  await member.getByRole('button', { name: "Accetta l'invito" }).click();
  await expect(member.getByText('Per questa data sei')).toBeVisible();

  // Seconda data: "non ci sono".
  const secondDate = member.locator('.date-row').nth(1);
  await secondDate.click();
  await expect(member.locator('.date-row.current')).toHaveCount(1);
  const secondUrl = member.url();
  expect(secondUrl).not.toBe(firstDateUrl);
  await member.getByRole('button', { name: 'Non ci sono per questa data' }).click();
  await expect(member.getByText('hai detto "non ci sono"')).toBeVisible();

  // ---------- Il conducente rende pubblica solo quella data ----------
  await driver.goto(secondUrl);
  await expect(driver.getByText('1 posti liberi su 1')).toBeVisible();
  await driver.getByRole('button', { name: 'Rendi pubblica solo questa data' }).click();
  await expect(driver.getByText('Ora questa data è pubblica')).toBeVisible();
  // La prima data resta privata.
  await driver.goto(firstDateUrl);
  await expect(driver.getByText('Privato', { exact: true })).toBeVisible();

  // ---------- Un collega chiede il posto; un altro va in lista d'attesa ----------
  const otherCtx = await browser.newContext();
  const other = await otherCtx.newPage();
  watch(other);
  await other.goto(secondUrl);
  await login(other, 'paolo.gialli');
  await completeOnboarding(other, 'paolo.gialli@example.test', { search: 'Monza', option: 'Monza (MB)' });
  await other.goto(secondUrl);
  await other.getByRole('button', { name: 'Chiedi di partecipare' }).click();
  await expect(other.getByText('Richiesta inviata', { exact: true }).first()).toBeVisible();

  await driver.goto(secondUrl);
  await driver.getByRole('button', { name: 'Accetta' }).click();
  await expect(driver.getByText('Paolo Gialli')).toBeVisible();

  // Il membro ci ripensa, ma il posto è preso: va in lista d'attesa.
  await member.reload();
  await member.getByRole('button', { name: 'Ci sono' }).click();
  await expect(member.getByText('in lista d\'attesa', { exact: false }).first()).toBeVisible();
  await driver.reload();
  await expect(driver.getByRole('heading', { name: "Lista d'attesa" })).toBeVisible();

  expect(errors).toEqual([]);
  await driverCtx.close();
  await memberCtx.close();
  await otherCtx.close();
});
