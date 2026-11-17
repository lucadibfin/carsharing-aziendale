import { expect, test } from '@playwright/test';
import { completeOnboarding, login } from './helpers';

test('area amministrativa: l’admin globale apre tutte le sezioni senza errori', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Errori HTTP attesi (401 prima del login, 400 del codice sbagliato) non contano: si controllano le chiamate admin.
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
  });
  page.on('response', (r) => {
    if (r.url().includes('/api/admin') && r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });

  await page.goto('/admin');
  await login(page, 'admin');
  await completeOnboarding(page, 'admin@example.test', { search: 'Milano', option: 'Milano (MI)' });

  await page.goto('/profilo');
  await page.getByRole('link', { name: 'Area amministrativa' }).click();
  await expect(page.getByRole('heading', { name: 'Area amministrativa' })).toBeVisible();
  await expect(page.getByText('utenti registrati')).toBeVisible();

  const sections: [string, string, string | RegExp][] = [
    ['Viaggi', 'viaggi', /viaggi\b/],
    ['Segnalazioni', 'segnalazioni', 'Nessuna segnalazione.'],
    ['Parametri', 'parametri', 'Alimentazione di default'],
    ['Ruoli', 'ruoli', 'Ruoli assegnati'],
    ['Sedi', 'sedi', 'Nuova sede'],
    ['Testi legali', 'testi', 'Versioni pubblicate'],
    ['Audit log', 'audit', 'Registro immutabile'],
  ];
  for (const [tab, path, text] of sections) {
    // Su schermo stretto la barra delle schede scorre: si ripete il clic finché la pagina cambia.
    await expect(async () => {
      await page.getByRole('tab', { name: tab }).click();
      await expect(page).toHaveURL(new RegExp(`/admin/${path}$`), { timeout: 1000 });
    }).toPass();
    await expect(page.getByText(text).first()).toBeVisible();
  }

  // L'audit log riporta le consultazioni appena fatte; la catena è integra.
  await expect(page.getByRole('cell', { name: 'Consultazione dashboard' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Verifica integrità' }).click();
  await expect(page.getByText(/Catena integra/)).toBeVisible();

  expect(errors).toEqual([]);
});
