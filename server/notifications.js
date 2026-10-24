// Nutikad SMS-teavitused: seadete valideerimine, reeglite hindamine ja saatmine.
// SMS-id käivad läbi valitud teenusepakkuja (KDE Connect, Twilio, MessageBird või üldine webhook).
// Võtmed ja telefoninumber hoitakse kohalikus andmebaasis; GET ei tagasta saladusi.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const NOTIFY_KEY = 'notifications';
export const NOTIFY_LOG_KEY = 'notificationLog';

export const DEFAULT_NOTIFICATIONS = Object.freeze({
  smsEnabled: false,
  pushEnabled: false,
  phone: '',
  provider: 'kdeconnect',
  twilioSid: '',
  twilioFrom: '',
  messagebirdFrom: 'Soojus',
  webhookUrl: '',
  kdeconnectDevice: '',
  rules: { pumpError: true, ventFilter: true, co2: true, legionella: true, stale: false },
  quietFrom: 22,
  quietTo: 7,
  cooldownMinutes: 360,
  dailyLimit: 10
});

export class NotificationError extends Error {}

const text = (value, fallback = '') => typeof value === 'string' ? value.trim() : fallback;
const bool = (value, fallback = false) => typeof value === 'boolean' ? value : fallback;
const integer = (value, fallback, min, max) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
};
const secret = (incoming, previous) => typeof incoming === 'string' && incoming.trim() ? incoming.trim() : (previous || '');

export function parseNotifications(input = {}, previous = null) {
  const base = previous ? { ...DEFAULT_NOTIFICATIONS, ...previous, rules: { ...DEFAULT_NOTIFICATIONS.rules, ...(previous.rules || {}) } } : { ...DEFAULT_NOTIFICATIONS };
  const merged = { ...base, ...input, rules: { ...base.rules, ...(input.rules || {}) } };
  const phone = text(merged.phone).replace(/[\s()-]/g, '');
  if (phone && !/^\+?\d{7,15}$/.test(phone)) throw new NotificationError('Telefoninumber peab olema kujul +372… ja 7–15 numbrit.');
  const provider = ['kdeconnect', 'twilio', 'messagebird', 'webhook'].includes(merged.provider) ? merged.provider : 'kdeconnect';
  return {
    smsEnabled: bool(merged.smsEnabled, false),
    pushEnabled: bool(merged.pushEnabled, false),
    phone,
    provider,
    twilioSid: text(merged.twilioSid),
    twilioToken: secret(input.twilioToken, base.twilioToken),
    twilioFrom: text(merged.twilioFrom),
    messagebirdKey: secret(input.messagebirdKey, base.messagebirdKey),
    messagebirdFrom: text(merged.messagebirdFrom) || 'Soojus',
    webhookUrl: text(merged.webhookUrl),
    kdeconnectDevice: text(merged.kdeconnectDevice),
    webhookToken: secret(input.webhookToken, base.webhookToken),
    rules: {
      pumpError: bool(merged.rules.pumpError, true),
      ventFilter: bool(merged.rules.ventFilter, true),
      co2: bool(merged.rules.co2, true),
      legionella: bool(merged.rules.legionella, true),
      stale: bool(merged.rules.stale, false)
    },
    quietFrom: integer(merged.quietFrom, DEFAULT_NOTIFICATIONS.quietFrom, 0, 23),
    quietTo: integer(merged.quietTo, DEFAULT_NOTIFICATIONS.quietTo, 0, 23),
    cooldownMinutes: integer(merged.cooldownMinutes, DEFAULT_NOTIFICATIONS.cooldownMinutes, 0, 1440),
    dailyLimit: integer(merged.dailyLimit, DEFAULT_NOTIFICATIONS.dailyLimit, 1, 100)
  };
}

export function publicNotifications(settings) {
  const config = parseNotifications(settings);
  const { twilioToken, messagebirdKey, webhookToken, ...rest } = config;
  return { ...rest, secrets: { twilioToken: Boolean(twilioToken), messagebirdKey: Boolean(messagebirdKey), webhookToken: Boolean(webhookToken) } };
}

export function inQuietHours(date, from, to) {
  const start = integer(from, 22, 0, 23), end = integer(to, 7, 0, 23);
  if (start === end) return false;
  const hour = date.getHours();
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

const clock = date => {
  const d = new Date(date);
  return Number.isFinite(d.getTime()) ? `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '—';
};

// state: { pumpError, ventFilter, co2, legionella, staleSince } – server kogub selle enne hindamist.
export function notificationAlerts(state = {}) {
  const alerts = [];
  if (state.pumpError?.code != null) alerts.push({
    rule: 'pumpError', key: `pump:${state.pumpError.code}:${state.pumpError.time || ''}`,
    text: `Soojuspump: viga ${state.pumpError.code}${state.pumpError.name ? ` (${state.pumpError.name})` : ''} kell ${clock(state.pumpError.time)}.`
  });
  if (state.ventFilter) alerts.push({ rule: 'ventFilter', key: 'vent:filter', text: 'Ventilatsiooni filter vajab vahetust.' });
  if (Number(state.co2) > 1400) alerts.push({ rule: 'co2', key: 'co2:high', text: `CO₂ on kõrge: ${Math.round(Number(state.co2))} ppm.` });
  if (state.legionella?.error) alerts.push({
    rule: 'legionella', key: `legionella:${state.legionella.time || state.legionella.error}`,
    text: `Legionella programm ebaõnnestus: ${state.legionella.error}`
  });
  if (state.staleSince) alerts.push({ rule: 'stale', key: 'stale', text: `Soojuse andmed on vananenud (viimane ${clock(state.staleSince)}).` });
  return alerts;
}

const recentSent = (log, now) => (log?.sent || []).filter(entry => entry.ok && now - Date.parse(entry.time) < 86400000);

// Kanalist sõltumatu hindamine: reeglid, vaikne aeg, cooldown ja päevapiir.
// SMS ja push saavad sama nimekirja, et mõlemad kanalid järgiksid samu seadeid.
export function dueAlerts({ settings, state, log, now = Date.now() }) {
  const config = parseNotifications(settings);
  const date = new Date(now);
  if (inQuietHours(date, config.quietFrom, config.quietTo)) return [];
  const sent = recentSent(log, now);
  if (sent.length >= config.dailyLimit) return [];
  const due = [];
  for (const alert of notificationAlerts(state)) {
    if (!config.rules[alert.rule]) continue;
    const previous = log?.lastSent?.[alert.key];
    if (previous && now - Date.parse(previous) < config.cooldownMinutes * 60000) continue;
    if (due.length + sent.length >= config.dailyLimit) break;
    due.push(alert);
  }
  return due;
}

export function dueNotifications({ settings, state, log, now = Date.now() }) {
  const config = parseNotifications(settings);
  if (!config.smsEnabled || !config.phone) return [];
  return dueAlerts({ settings: config, state, log, now });
}

// KDE Connecti paardunud seadmed (telefonid). Kasutab kasutaja D-Busi (systemd user-teenusel on see olemas).
export async function kdeconnectDevices({ execFileImpl = run } = {}) {
  try {
    const { stdout } = await execFileImpl('kdeconnect-cli', ['--list-devices', '--id-name-only'], { timeout: 5000 });
    return {
      devices: String(stdout).split('\n').map(line => line.trim()).filter(Boolean)
        .filter(line => !/^(Leiti|Found)\s+0\s+seadet|device/i.test(line))
        .map(line => {
          const colon = /^([^:\s]+):\s*(.*)$/.exec(line);
          const space = colon ? null : /^(\S+)\s+(.*)$/.exec(line);
          const id = colon?.[1] || space?.[1] || line;
          return { id, name: colon?.[2] || space?.[2] || id };
        })
    };
  } catch (e) { return { devices: [], error: e.message }; }
}

export async function sendSms(settings, message, { fetchImpl = fetch, execFileImpl = run } = {}) {
  const config = parseNotifications(settings);
  if (!config.phone) throw new NotificationError('Sisesta telefoninumber.');
  const timeout = () => AbortSignal.timeout(15000);
  if (config.provider === 'kdeconnect') {
    const list = await kdeconnectDevices({ execFileImpl });
    const device = config.kdeconnectDevice || list.devices?.[0]?.id;
    if (!device) throw new NotificationError('KDE Connecti seadet pole paaris. Paarista telefon ja luba SMS-plugin.');
    try {
      await execFileImpl('kdeconnect-cli', ['--device', device, '--send-sms', message, '--destination', config.phone], { timeout: 30000 });
    } catch (e) { throw new NotificationError(`KDE Connect: ${e.message}`); }
    return { ok: true };
  }
  if (config.provider === 'twilio') {
    if (!config.twilioSid || !config.twilioToken || !config.twilioFrom) throw new NotificationError('Twilio SID, token ja saatja number on puudu.');
    const auth = Buffer.from(`${config.twilioSid}:${config.twilioToken}`).toString('base64');
    const response = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.twilioSid)}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: config.phone, From: config.twilioFrom, Body: message }),
      signal: timeout()
    });
    if (!response.ok) throw new NotificationError(`Twilio vastas veaga (${response.status}).`);
    return { ok: true };
  }
  if (config.provider === 'messagebird') {
    if (!config.messagebirdKey || !config.messagebirdFrom) throw new NotificationError('MessageBirdi võti ja saatja on puudu.');
    const response = await fetchImpl('https://rest.messagebird.com/messages', {
      method: 'POST',
      headers: { Authorization: `AccessKey ${config.messagebirdKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ originator: config.messagebirdFrom, recipients: [config.phone], body: message }),
      signal: timeout()
    });
    if (!response.ok) throw new NotificationError(`MessageBird vastas veaga (${response.status}).`);
    return { ok: true };
  }
  if (!config.webhookUrl) throw new NotificationError('Webhook’i aadress on puudu.');
  const response = await fetchImpl(config.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(config.webhookToken ? { Authorization: `Bearer ${config.webhookToken}` } : {}) },
    body: JSON.stringify({ to: config.phone, text: message }),
    signal: timeout()
  });
  if (!response.ok) throw new NotificationError(`Webhook vastas veaga (${response.status}).`);
  return { ok: true };
}
