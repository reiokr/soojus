// Web Push: VAPID-võtmed, brauserite tellimused ja teavituste saatmine.
// Tellimused on brauseripõhised; server hoiab neid SQLite'is ja eemaldab aegunud (404/410).
import webpush from 'web-push';

export const PUSH_VAPID_KEY = 'pushVapid';
const SUBJECT = 'mailto:soojus@localhost';

export class PushError extends Error {}

const endpointOf = subscription => typeof subscription?.endpoint === 'string' ? subscription.endpoint.trim() : '';

export function createPushStore(db, getSetting, setSetting, { webpushImpl = webpush } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    created TEXT NOT NULL
  )`);

  function vapid() {
    let keys = getSetting(PUSH_VAPID_KEY);
    if (!keys?.publicKey || !keys?.privateKey) {
      keys = webpushImpl.generateVAPIDKeys();
      setSetting(PUSH_VAPID_KEY, keys);
    }
    return keys;
  }

  const count = () => Number(db.prepare('SELECT COUNT(*) AS count FROM push_subscriptions').get()?.count || 0);
  const list = () => db.prepare('SELECT label, created FROM push_subscriptions ORDER BY created DESC').all();

  function subscribe(subscription, label = '') {
    const endpoint = endpointOf(subscription);
    const p256dh = typeof subscription?.keys?.p256dh === 'string' ? subscription.keys.p256dh.trim() : '';
    const auth = typeof subscription?.keys?.auth === 'string' ? subscription.keys.auth.trim() : '';
    if (!endpoint || !/^https:\/\//i.test(endpoint) || !p256dh || !auth) throw new PushError('Vigane push-tellimus.');
    db.prepare('INSERT OR REPLACE INTO push_subscriptions (endpoint, p256dh, auth, label, created) VALUES (?, ?, ?, ?, ?)')
      .run(endpoint, p256dh, auth, String(label || '').slice(0, 160), new Date().toISOString());
    return count();
  }

  function unsubscribe(endpoint) {
    const value = typeof endpoint === 'string' ? endpoint.trim() : '';
    if (value) db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(value);
    return count();
  }

  async function send(payload) {
    const keys = vapid();
    webpushImpl.setVapidDetails(SUBJECT, keys.publicKey, keys.privateKey);
    const rows = db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions').all();
    let sent = 0, failed = 0, removed = 0;
    for (const row of rows) {
      try {
        await webpushImpl.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          JSON.stringify(payload)
        );
        sent += 1;
      } catch (e) {
        failed += 1;
        // Brauser on tellimuse tühistanud või see on aegunud – ei tasu alles hoida.
        if (e?.statusCode === 404 || e?.statusCode === 410) {
          db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(row.endpoint);
          removed += 1;
        }
      }
    }
    return { sent, failed, removed, total: rows.length };
  }

  return { publicKey: () => vapid().publicKey, count, list, subscribe, unsubscribe, send };
}
