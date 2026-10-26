import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_NOTIFICATIONS, parseNotifications, publicNotifications, inQuietHours, notificationAlerts, dueAlerts, dueNotifications, sendSms, kdeconnectDevices } from '../server/notifications.js';

test('parseNotifications normalises the phone, keeps secrets and validates values', () => {
  const config = parseNotifications({ smsEnabled: true, phone: '+372 5555 1234', provider: 'messagebird', messagebirdKey: 'key-1', quietFrom: 23, quietTo: 8, cooldownMinutes: 60, rules: { co2: false } });
  assert.equal(config.phone, '+37255551234');
  assert.equal(config.provider, 'messagebird');
  assert.equal(config.messagebirdKey, 'key-1');
  assert.equal(config.rules.co2, false);
  assert.equal(config.rules.pumpError, true);
  assert.equal(config.quietFrom, 23);
  assert.equal(config.quietTo, 8);
  assert.throws(() => parseNotifications({ phone: '123' }), /Telefoninumber/);
  const kept = parseNotifications({ phone: '+37255551234' }, config);
  assert.equal(kept.messagebirdKey, 'key-1');
  const telegram = parseNotifications({ provider: 'telegram', telegramToken: 'tok', telegramChat: '42' });
  assert.equal(telegram.provider, 'telegram');
  assert.equal(telegram.telegramToken, 'tok');
  assert.equal(telegram.telegramChat, '42');
});

test('publicNotifications never exposes secrets', () => {
  const publicConfig = publicNotifications({ phone: '+37255551234', twilioToken: 'secret', messagebirdKey: 'key', webhookToken: 'token' });
  assert.equal(publicConfig.twilioToken, undefined);
  assert.equal(publicConfig.messagebirdKey, undefined);
  assert.equal(publicConfig.telegramToken, undefined);
  assert.deepEqual(publicConfig.secrets, { twilioToken: true, telegramToken: false, messagebirdKey: true, webhookToken: true });
});

test('dueAlerts evaluates rules independently of SMS so push can reuse it', () => {
  const at = new Date(2026, 0, 1, 12, 0).getTime();
  const settings = { smsEnabled: false, pushEnabled: true, phone: '', quietFrom: 0, quietTo: 0, dailyLimit: 10, cooldownMinutes: 60, rules: { pumpError: true, ventFilter: true, co2: true, legionella: true, stale: false } };
  const due = dueAlerts({ settings, state: { ventFilter: true }, log: { lastSent: {}, sent: [] }, now: at });
  assert.equal(due.length, 1);
  assert.equal(due[0].key, 'vent:filter');
  assert.deepEqual(dueNotifications({ settings, state: { ventFilter: true }, log: { lastSent: {}, sent: [] }, now: at }), []);
});

test('quiet hours work across midnight and can be disabled', () => {
  const at = hour => new Date(2026, 0, 1, hour, 0);
  assert.equal(inQuietHours(at(23), 22, 7), true);
  assert.equal(inQuietHours(at(6), 22, 7), true);
  assert.equal(inQuietHours(at(12), 22, 7), false);
  assert.equal(inQuietHours(at(12), 12, 12), false);
});

test('notificationAlerts builds concise messages only for relevant state', () => {
  assert.deepEqual(notificationAlerts({}), []);
  const alerts = notificationAlerts({ pumpError: { code: 765, name: 'Külmaaine', time: '2026-01-01T10:00:00.000Z' }, ventFilter: true, co2: 1500, legionella: { error: 'Katse ebaõnnestus' } });
  assert.equal(alerts.length, 4);
  assert.match(alerts[0].text, /viga 765/);
  assert.match(alerts[2].text, /1500 ppm/);
  assert.equal(alerts[3].rule, 'legionella');
  assert.equal(notificationAlerts({ co2: 800 }).length, 0);
});

test('dueNotifications respects rules, cooldown, quiet hours and the daily limit', () => {
  const settings = { smsEnabled: true, phone: '+37255551234', cooldownMinutes: 60, dailyLimit: 2, quietFrom: 0, quietTo: 0, rules: { pumpError: true, ventFilter: true, co2: true, legionella: true, stale: true } };
  const now = new Date(2026, 0, 1, 12, 0).getTime();
  const state = { ventFilter: true, co2: 1500 };
  const first = dueNotifications({ settings, state, now, log: { lastSent: {} } });
  assert.deepEqual(first.map(a => a.rule), ['ventFilter', 'co2']);
  const cooled = dueNotifications({ settings, state, now, log: { lastSent: { 'vent:filter': new Date(now - 10 * 60000).toISOString() } } });
  assert.deepEqual(cooled.map(a => a.rule), ['co2']);
  const limited = dueNotifications({ settings: { ...settings, dailyLimit: 1 }, state, now, log: { lastSent: {}, sent: [{ ok: true, time: new Date(now - 3600000).toISOString() }] } });
  assert.deepEqual(limited, []);
  const quiet = dueNotifications({ settings: { ...settings, quietFrom: 22, quietTo: 7 }, state, now: new Date(2026, 0, 1, 23, 0).getTime(), log: { lastSent: {} } });
  assert.deepEqual(quiet, []);
});

test('sendSms builds Telegram, Twilio, MessageBird and webhook requests', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200 }; };
  await sendSms({ phone: '+37255551234', provider: 'twilio', twilioSid: 'AC1', twilioToken: 'tok', twilioFrom: '+15550001111' }, 'Tere', { fetchImpl });
  assert.match(calls[0].url, /Accounts\/AC1\/Messages\.json/);
  assert.match(calls[0].options.headers.Authorization, /^Basic /);
  assert.equal(calls[0].options.body.get('To'), '+37255551234');
  assert.equal(calls[0].options.body.get('Body'), 'Tere');

  await sendSms({ phone: '+37255551234', provider: 'messagebird', messagebirdKey: 'mb', messagebirdFrom: 'Soojus' }, 'Tere', { fetchImpl });
  assert.equal(calls[1].url, 'https://rest.messagebird.com/messages');
  assert.equal(JSON.parse(calls[1].options.body).recipients[0], '+37255551234');

  await sendSms({ phone: '+37255551234', provider: 'telegram', telegramToken: '123:abc', telegramChat: '42' }, 'Tere', { fetchImpl });
  assert.equal(calls[2].url, 'https://api.telegram.org/bot123:abc/sendMessage');
  assert.deepEqual(JSON.parse(calls[2].options.body), { chat_id: '42', text: 'Tere', disable_web_page_preview: true });

  await sendSms({ phone: '+37255551234', provider: 'webhook', webhookUrl: 'https://example.test/sms', webhookToken: 'x' }, 'Tere', { fetchImpl });
  assert.equal(calls[3].url, 'https://example.test/sms');
  assert.equal(JSON.parse(calls[3].options.body).to, '+37255551234');
  assert.equal(calls[3].options.headers.Authorization, 'Bearer x');
  await assert.rejects(sendSms({ phone: '+37255551234', provider: 'telegram' }, 'x', { fetchImpl }), /Telegram/);
  await assert.rejects(sendSms({ phone: '+37255551234', provider: 'twilio' }, 'x', { fetchImpl }), /Twilio/);
});

test('kdeconnectDevices parses paired phones and ignores the empty result line', async () => {
  const empty = await kdeconnectDevices({ execFileImpl: async () => ({ stdout: 'Leiti 0 seadet\n' }) });
  assert.deepEqual(empty.devices, []);
  const paired = await kdeconnectDevices({ execFileImpl: async (command, args) => ({ stdout: args.includes('--list-devices') ? 'abc123: Pixel 8\nxyz123 Phone\n' : 'abc123: Pixel 8\n' }) });
  assert.deepEqual(paired.devices, [{ id: 'abc123', name: 'Pixel 8', available: true }, { id: 'xyz123', name: 'Phone', available: false }]);
});

test('sendSms via KDE Connect selects the paired phone and passes the message', async () => {
  const calls = [];
  const execFileImpl = async (command, args) => {
    calls.push([command, args]);
    if (args.includes('--list-devices') || args.includes('--list-available')) return { stdout: 'abc123: Pixel 8\n' };
    return { stdout: '' };
  };
  await sendSms({ phone: '+37255551234', provider: 'kdeconnect', kdeconnectDevice: 'abc123' }, 'Tere', { execFileImpl });
  assert.equal(calls.at(-1)[0], 'kdeconnect-cli');
  assert.deepEqual(calls.at(-1)[1], ['--device', 'abc123', '--send-sms', 'Tere', '--destination', '+37255551234']);
  await assert.rejects(
    sendSms({ phone: '+37255551234', provider: 'kdeconnect', kdeconnectDevice: 'abc123' }, 'Tere', {
      execFileImpl: async (command, args) => args.includes('--list-devices') ? { stdout: 'abc123: Pixel 8\n' } : { stdout: 'Leiti 0 seadet\n' }
    }),
    /ei ole võrgus/
  );
});

test('Telegram notifications do not require a phone number', () => {
  const now = new Date(2026, 0, 1, 12, 0).getTime();
  const settings = {
    smsEnabled: true, provider: 'telegram', phone: '', telegramToken: '123:abc', telegramChat: '42',
    quietFrom: 0, quietTo: 0, cooldownMinutes: 60, dailyLimit: 10, rules: { ventFilter: true }
  };
  const log = { lastSent: {}, sent: [] };
  assert.equal(dueNotifications({ settings, state: { ventFilter: true }, log, now }).length, 1);
  assert.equal(dueNotifications({ settings: { ...settings, telegramToken: '' }, state: { ventFilter: true }, log, now }).length, 0);
  assert.equal(dueNotifications({ settings: { ...settings, telegramChat: '' }, state: { ventFilter: true }, log, now }).length, 0);
});
