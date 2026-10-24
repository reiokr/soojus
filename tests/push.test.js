import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { createPushStore } from '../server/push.js';

function setup({ send } = {}) {
  const db = new DatabaseSync(':memory:');
  const settings = new Map();
  const calls = { generated: 0, sent: [] };
  const webpushImpl = {
    generateVAPIDKeys() { calls.generated += 1; return { publicKey: 'public-key', privateKey: 'private-key' }; },
    setVapidDetails(subject, publicKey, privateKey) { calls.subject = subject; calls.keys = [publicKey, privateKey]; },
    async sendNotification(subscription, payload) {
      calls.sent.push({ subscription, payload: JSON.parse(payload) });
      if (send) return send(subscription, payload);
    }
  };
  const store = createPushStore(db, key => settings.get(key) ?? null, (key, value) => settings.set(key, value), { webpushImpl });
  return { db, store, settings, calls };
}

test('push store generates VAPID keys once and exposes only the public key', () => {
  const { store, settings, calls } = setup();
  const first = store.publicKey();
  const second = store.publicKey();
  assert.equal(first, 'public-key');
  assert.equal(second, 'public-key');
  assert.equal(calls.generated, 1);
  assert.equal(settings.get('pushVapid').privateKey, 'private-key');
});

test('push store validates and stores subscriptions', () => {
  const { store } = setup();
  assert.throws(() => store.subscribe({ endpoint: 'http://example.com/x', keys: { p256dh: 'a', auth: 'b' } }), /Vigane/);
  assert.throws(() => store.subscribe({ endpoint: 'https://example.com/x', keys: {} }), /Vigane/);
  const count = store.subscribe({ endpoint: 'https://example.com/x', keys: { p256dh: 'a', auth: 'b' } }, 'telefon');
  assert.equal(count, 1);
  assert.equal(store.count(), 1);
  assert.equal(store.unsubscribe('https://example.com/x'), 0);
});

test('push send delivers to every subscription and removes expired endpoints', async () => {
  const { store, calls } = setup({
    send(subscription) {
      if (subscription.endpoint.includes('expired')) throw Object.assign(new Error('Gone'), { statusCode: 410 });
    }
  });
  store.subscribe({ endpoint: 'https://example.com/ok', keys: { p256dh: 'a', auth: 'b' } });
  store.subscribe({ endpoint: 'https://example.com/expired', keys: { p256dh: 'c', auth: 'd' } });
  const result = await store.send({ title: 'Soojus', body: 'Test' });
  assert.deepEqual(result, { sent: 1, failed: 1, removed: 1, total: 2 });
  assert.equal(store.count(), 1);
  assert.equal(calls.sent.length, 2);
  assert.equal(calls.sent[0].payload.body, 'Test');
  assert.equal(calls.subject, 'mailto:soojus@localhost');
});
