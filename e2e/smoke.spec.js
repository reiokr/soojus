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
  await expect(page.locator('.notify-panel .notify-checks input')).toHaveCount(10);
  await expect(page.getByLabel('Tarbevesi alla, °C')).toBeVisible();
  await expect(page.getByLabel('Sisetemperatuur alla, °C')).toBeVisible();
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

test('a failed lazy chunk shows the recoverable error boundary', async ({ page }) => {
  // Uus liides on alati lazy chunk ja laetakse ka siis, kui seade pole ühendatud.
  await page.route('**/assets/NextUI-*.js', route => route.abort());
  await page.goto('/?ui=next&page=overview');
  await expect(page.getByRole('heading', { name: 'Midagi läks valesti' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Laadi leht uuesti' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Proovi uuesti' })).toBeVisible();
});
