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

test('notification settings panel renders in both interfaces', async ({ page }) => {
  await page.goto('/?ui=classic&page=settings');
  await expect(page.getByRole('heading', { name: 'Nutikad teavitused' })).toBeVisible();
  await expect(page.locator('.notify-panel input[type="tel"]')).toBeVisible();
  await page.goto('/?ui=next&page=settings');
  await expect(page.getByRole('heading', { name: 'Nutikad teavitused' })).toBeVisible();
  await expect(page.locator('.notify-panel .notify-checks input')).toHaveCount(5);
});

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

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('a.brand')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('a.brand')).toContainText('soojus');
  } finally {
    await context.setOffline(false);
  }
});

test('push API issues a VAPID key and stores subscriptions', async ({ request }) => {
  const origin = (process.env.E2E_BASE_URL || 'http://localhost:3210').replace(/\/$/, '');
  const headers = { Origin: origin, 'X-Soojus-Request': '1' };
  const keyResponse = await request.get('/api/push/key');
  expect(keyResponse.ok()).toBe(true);
  const key = await keyResponse.json();
  expect(key.publicKey).toMatch(/^B[A-Za-z0-9_-]{80,}$/);

  const subscribe = await request.post('/api/push/subscribe', {
    headers,
    data: { subscription: { endpoint: 'https://e2e.invalid/push/1', keys: { p256dh: 'test-key', auth: 'test-auth' } }, label: 'e2e' }
  });
  expect(subscribe.ok()).toBe(true);
  expect((await subscribe.json()).count).toBe(key.count + 1);

  const unsubscribe = await request.post('/api/push/unsubscribe', { headers, data: { endpoint: 'https://e2e.invalid/push/1' } });
  expect(unsubscribe.ok()).toBe(true);
  expect((await unsubscribe.json()).count).toBe(key.count);
});

test('backup panel renders in both interfaces', async ({ page }) => {
  await page.goto('/?ui=classic&page=settings');
  await expect(page.getByRole('heading', { name: 'Varukoopia ja taastamine' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Loo varukoopia kohe' })).toBeVisible();
  await expect(page.getByText('Automaatne öine varukoopia')).toBeVisible();

  await page.goto('/?ui=next&page=settings');
  await expect(page.getByRole('heading', { name: 'Varukoopia ja taastamine' })).toBeVisible();
});

test('backup API creates, downloads and deletes a database snapshot', async ({ request }) => {
  const origin = (process.env.E2E_BASE_URL || 'http://localhost:3210').replace(/\/$/, '');
  const headers = { Origin: origin, 'X-Soojus-Request': '1' };
  const created = await request.post('/api/backups', { headers, data: {} });
  expect(created.ok()).toBe(true);
  const backup = await created.json();
  expect(backup.name).toMatch(/-manual\.sqlite$/);
  expect(backup.bytes).toBeGreaterThan(0);

  const listed = await (await request.get('/api/backups')).json();
  expect(listed.files.some(file => file.name === backup.name)).toBe(true);

  const download = await request.get(`/api/backups/${encodeURIComponent(backup.name)}`, { headers: { Range: 'bytes=0-15' } });
  expect(download.status()).toBe(206);
  expect((await download.body()).toString()).toBe('SQLite format 3\u0000');

  const removed = await request.delete(`/api/backups/${encodeURIComponent(backup.name)}`, { headers });
  expect(removed.ok()).toBe(true);
  const after = await (await request.get('/api/backups')).json();
  expect(after.files.some(file => file.name === backup.name)).toBe(false);
});
