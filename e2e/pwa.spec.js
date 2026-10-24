import { test, expect } from '@playwright/test';

// PWA testid vajavad service workerit; ülejäänud testides on see blokeeritud,
// et Playwrighti API-mockid ei jääks SW vahemälu taha.
test.use({ serviceWorkers: 'allow' });

test('PWA manifest is served and the app shell loads offline', async ({ page, context }) => {
  const manifest = await page.request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  const data = await manifest.json();
  expect(data.short_name).toBe('Soojus');
  expect(data.display).toBe('standalone');
  expect(data.icons.some(icon => icon.purpose === 'maskable')).toBe(true);

  await page.goto('/?ui=classic&page=overview');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload({ waitUntil: 'networkidle' });
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  expect(await page.evaluate(async () => {
    const cache = await caches.open('soojus-api-v1');
    return (await cache.keys()).length;
  })).toBeGreaterThan(0);

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('a.brand')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('a.brand')).toContainText('soojus');
    await expect(page.locator('.offline-banner')).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
