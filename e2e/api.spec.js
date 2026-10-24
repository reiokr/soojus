import { test, expect } from '@playwright/test';

// Mutation-endpointite lepingud: CSRF/Origin, valideerimine, JSON-vigade kuju ja
// seadete puutumatus pärast tagasilükatud päringut. Testid ei muuda püsivaid seadeid
// (v.a ajutine varukoopia-seadete muudatus, mis taastatakse).
const origin = (process.env.E2E_BASE_URL || 'http://localhost:3210').replace(/\/$/, '');
const headers = { Origin: origin, 'X-Soojus-Request': '1' };

test('mutation endpoints reject missing or foreign origin/request headers', async ({ request }) => {
  const attempts = [
    ['POST', '/api/archive', {}],
    ['POST', '/api/backups/settings', {}],
    ['POST', '/api/notifications/settings', {}],
    ['POST', '/api/luxtronik', {}],
    ['POST', '/api/airobot', {}],
    ['POST', '/api/push/subscribe', {}],
    ['PATCH', '/api/devices/x/points', {}],
    ['PUT', '/api/systems/x/mode', {}],
    ['DELETE', '/api/backups/nope.sqlite', undefined]
  ];
  for (const [method, path, data] of attempts) {
    const response = await request.fetch(path, { method, data });
    expect(response.status(), `${method} ${path}`).toBe(403);
  }
  const foreign = await request.post('/api/archive', { headers: { Origin: 'http://evil.example', 'X-Soojus-Request': '1' }, data: {} });
  expect(foreign.status()).toBe(403);
  const missingHeader = await request.post('/api/archive', { headers: { Origin: origin }, data: {} });
  expect(missingHeader.status()).toBe(403);
});

test('mutation validation returns JSON errors and leaves settings intact', async ({ request }) => {
  const beforeNotifications = await (await request.get('/api/notifications/settings')).json();
  const badPhone = await request.post('/api/notifications/settings', { headers, data: { ...beforeNotifications, phone: '123' } });
  expect(badPhone.status()).toBe(400);
  expect((await badPhone.json()).error).toMatch(/Telefoninumber/);
  const afterNotifications = await (await request.get('/api/notifications/settings')).json();
  expect(afterNotifications.phone).toBe(beforeNotifications.phone);

  const backupBefore = (await (await request.get('/api/backups')).json()).settings;
  try {
    const saved = await request.post('/api/backups/settings', { headers, data: { ...backupBefore, hour: 99, retentionDays: 0 } });
    expect(saved.ok()).toBe(true);
    expect(await saved.json()).toMatchObject({ enabled: backupBefore.enabled, hour: 3, retentionDays: 7 });
  } finally {
    const restore = await request.post('/api/backups/settings', { headers, data: backupBefore });
    expect(restore.ok()).toBe(true);
  }

  for (const data of [{}, { before: new Date().toISOString() }]) {
    const response = await request.post('/api/archive', { headers, data });
    expect(response.status()).toBe(400);
    expect(typeof (await response.json()).error).toBe('string');
  }

  const badPush = await request.post('/api/push/subscribe', { headers, data: { subscription: { endpoint: 'http://not-https', keys: { p256dh: 'a', auth: 'b' } } } });
  expect(badPush.status()).toBe(400);

  const badUpload = await request.post('/api/backups/upload', { headers: { ...headers, 'Content-Type': 'application/octet-stream' }, data: Buffer.from('not a sqlite database') });
  expect(badUpload.status()).toBe(400);

  const missingRestore = await request.post('/api/backups/restore', { headers, data: { name: 'missing.sqlite' } });
  expect(missingRestore.status()).toBe(400);

  for (const path of ['/api/luxtronik', '/api/airobot']) {
    const response = await request.post(path, { headers, data: { host: '8.8.8.8' } });
    expect(response.status(), path).toBe(400);
  }

  const badLocation = await request.post('/api/location', { headers, data: {} });
  expect(badLocation.status()).toBe(400);
});

test('health and metrics expose operational status without secrets', async ({ request }) => {
  const healthResponse = await request.get('/api/health');
  expect(healthResponse.ok()).toBe(true);
  const health = await healthResponse.json();
  expect(['ok', 'degraded']).toContain(health.status);
  expect(health.db.bytes).toBeGreaterThan(0);
  expect(health.db.samples).toBeGreaterThanOrEqual(0);
  expect(health.devices.total).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(health)).not.toMatch(/privateKey|twilioToken|messagebirdKey|webhookToken/i);

  const metricsResponse = await request.get('/api/metrics');
  expect(metricsResponse.ok()).toBe(true);
  expect(metricsResponse.headers()['content-type']).toContain('text/plain');
  const text = await metricsResponse.text();
  for (const metric of ['soojus_up 1', 'soojus_uptime_seconds', 'soojus_db_bytes', 'soojus_samples_total', 'soojus_push_subscriptions', 'soojus_backup_automatic_enabled']) {
    expect(text).toContain(metric);
  }
  expect(text).not.toMatch(/privateKey|twilioToken|messagebirdKey|webhookToken/i);
});
