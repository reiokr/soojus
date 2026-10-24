import { test, expect } from '@playwright/test';

// Suitsutestid, mis ei vaja seadet ega myUplinki kontot: töötavad ka CI-s tühja andmebaasiga.
// Täistestid (e2e/app.spec.js) eeldavad töötavat rakendust koos päris seadmega.

test('settings page switches the entire UI between Estonian and English', async ({ page }) => {
  await page.goto('/?ui=classic&page=settings');
  await expect(page.getByRole('heading', { name: 'Seaded ja ühendus', exact: true })).toBeVisible();

  await page.locator('.lang-card', { hasText: 'English' }).getByRole('button').click();
  await expect(page.getByRole('heading', { name: 'Settings & connection', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('aside.sidebar').getByRole('button', { name: 'Home', exact: true })).toBeVisible();

  // Valik peab säilima ka pärast lehe uuestilaadimist.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings & connection', exact: true })).toBeVisible();
});

test('switching back to Estonian works from the English UI', async ({ page }) => {
  await page.goto('/?ui=classic&page=settings');
  await page.locator('.lang-card', { hasText: 'English' }).getByRole('button').click();
  await expect(page.getByRole('heading', { name: 'Settings & connection', exact: true })).toBeVisible();

  await page.locator('.lang-card', { hasText: 'Eesti' }).getByRole('button').click();
  await expect(page.getByRole('heading', { name: 'Seaded ja ühendus', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'et');
});

test('both interfaces load without uncaught browser errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('/?ui=classic&page=overview');
  await page.waitForTimeout(1000);
  await page.goto('/?ui=next&page=overview');
  await page.waitForTimeout(1500);

  expect(errors).toEqual([]);
});
