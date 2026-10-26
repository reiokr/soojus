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
  telegramToken: '',
  telegramChat: '',
  messagebirdFrom: 'Soojus',
  webhookUrl: '',
  kdeconnectDevice: '',
  rules: {
    pumpError: true, ventFilter: true, co2: true, legionella: true, stale: false,
    dhwLow: true, indoorLow: true, dhwTarget: true, humidity: true, ventStopped: true
  },
  thresholds: {
    dhwLow: 35, dhwLowMinutes: 30,
    indoorLow: 19, indoorLowMinutes: 60, indoorSeasonOutdoor: 15,
    dhwGap: 5, dhwGapMinutes: 60,
    humidity: 70, humidityMinutes: 120,
    ventStoppedMinutes: 30, ventStoppedCo2: 1000
  },
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
const decimal = (value, fallback, min, max) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : fallback;
};
const secret = (incoming, previous) => typeof incoming === 'string' && incoming.trim() ? incoming.trim() : (previous || '');

export function parseNotifications(input = {}, previous = null) {
  const base = previous ? {
    ...DEFAULT_NOTIFICATIONS, ...previous,
    rules: { ...DEFAULT_NOTIFICATIONS.rules, ...(previous.rules || {}) },
    thresholds: { ...DEFAULT_NOTIFICATIONS.thresholds, ...(previous.thresholds || {}) }
  } : { ...DEFAULT_NOTIFICATIONS };
  const merged = {
    ...base, ...input,
    rules: { ...base.rules, ...(input.rules || {}) },
    thresholds: { ...base.thresholds, ...(input.thresholds || {}) }
  };
  const phone = text(merged.phone).replace(/[\s()-]/g, '');
  if (phone && !/^\+?\d{7,15}$/.test(phone)) throw new NotificationError('Telefoninumber peab olema kujul +372… ja 7–15 numbrit.');
  const provider = ['kdeconnect', 'telegram', 'twilio', 'messagebird', 'webhook'].includes(merged.provider) ? merged.provider : 'kdeconnect';
  return {
    smsEnabled: bool(merged.smsEnabled, false),
    pushEnabled: bool(merged.pushEnabled, false),
    phone,
    provider,
    twilioSid: text(merged.twilioSid),
    twilioToken: secret(input.twilioToken, base.twilioToken),
    twilioFrom: text(merged.twilioFrom),
    telegramToken: secret(input.telegramToken, base.telegramToken),
    telegramChat: text(merged.telegramChat),
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
      stale: bool(merged.rules.stale, false),
      dhwLow: bool(merged.rules.dhwLow, true),
      indoorLow: bool(merged.rules.indoorLow, true),
      dhwTarget: bool(merged.rules.dhwTarget, true),
      humidity: bool(merged.rules.humidity, true),
      ventStopped: bool(merged.rules.ventStopped, true)
    },
    thresholds: {
      dhwLow: decimal(merged.thresholds.dhwLow, DEFAULT_NOTIFICATIONS.thresholds.dhwLow, 0, 80),
      dhwLowMinutes: integer(merged.thresholds.dhwLowMinutes, DEFAULT_NOTIFICATIONS.thresholds.dhwLowMinutes, 5, 1440),
      indoorLow: decimal(merged.thresholds.indoorLow, DEFAULT_NOTIFICATIONS.thresholds.indoorLow, -20, 40),
      indoorLowMinutes: integer(merged.thresholds.indoorLowMinutes, DEFAULT_NOTIFICATIONS.thresholds.indoorLowMinutes, 5, 1440),
      indoorSeasonOutdoor: decimal(merged.thresholds.indoorSeasonOutdoor, DEFAULT_NOTIFICATIONS.thresholds.indoorSeasonOutdoor, -30, 30),
      dhwGap: decimal(merged.thresholds.dhwGap, DEFAULT_NOTIFICATIONS.thresholds.dhwGap, 0, 30),
      dhwGapMinutes: integer(merged.thresholds.dhwGapMinutes, DEFAULT_NOTIFICATIONS.thresholds.dhwGapMinutes, 5, 1440),
      humidity: decimal(merged.thresholds.humidity, DEFAULT_NOTIFICATIONS.thresholds.humidity, 0, 100),
      humidityMinutes: integer(merged.thresholds.humidityMinutes, DEFAULT_NOTIFICATIONS.thresholds.humidityMinutes, 5, 1440),
      ventStoppedMinutes: integer(merged.thresholds.ventStoppedMinutes, DEFAULT_NOTIFICATIONS.thresholds.ventStoppedMinutes, 5, 1440),
      ventStoppedCo2: integer(merged.thresholds.ventStoppedCo2, DEFAULT_NOTIFICATIONS.thresholds.ventStoppedCo2, 400, 5000)
    },
    quietFrom: integer(merged.quietFrom, DEFAULT_NOTIFICATIONS.quietFrom, 0, 23),
    quietTo: integer(merged.quietTo, DEFAULT_NOTIFICATIONS.quietTo, 0, 23),
    cooldownMinutes: integer(merged.cooldownMinutes, DEFAULT_NOTIFICATIONS.cooldownMinutes, 0, 1440),
    dailyLimit: integer(merged.dailyLimit, DEFAULT_NOTIFICATIONS.dailyLimit, 1, 100)
  };
}

export function publicNotifications(settings) {
  const config = parseNotifications(settings);
  const { twilioToken, telegramToken, messagebirdKey, webhookToken, ...rest } = config;
  return { ...rest, secrets: { twilioToken: Boolean(twilioToken), telegramToken: Boolean(telegramToken), messagebirdKey: Boolean(messagebirdKey), webhookToken: Boolean(webhookToken) } };
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

// Ajapõhised reeglid: tingimus peab püsima N minutit. `since` on serveri mälus hoitav
// algusaegade kaart; kui tingimus kaob, algus kustutatakse.
export function durationAlerts(state = {}, settings, since = {}, now = Date.now()) {
  const config = parseNotifications(settings), t = config.thresholds;
  const alerts = [];
  const num = value => value == null || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
  const fmt = value => Math.round(Number(value) * 10) / 10;
  const evaluate = (rule, active, minutes, text, key = rule) => {
    if (!config.rules[rule] || !active) { delete since[rule]; return; }
    if (!Number.isFinite(since[rule])) since[rule] = now;
    if (now - since[rule] >= minutes * 60000) alerts.push({ rule, key, text });
  };
  const dhw = num(state.dhw), dhwTarget = num(state.dhwTarget);
  const indoor = num(state.indoor), outdoor = num(state.outdoor);
  const humidity = num(state.humidity), co2 = num(state.ventCo2);
  evaluate('dhwLow', dhw != null && dhw < t.dhwLow, t.dhwLowMinutes,
    `Tarbevesi on liiga madal: ${fmt(dhw)} °C (alla ${fmt(t.dhwLow)} °C ${t.dhwLowMinutes} min).`, 'dhw:low');
  evaluate('indoorLow', indoor != null && outdoor != null && indoor < t.indoorLow && outdoor < t.indoorSeasonOutdoor, t.indoorLowMinutes,
    `Sisetemperatuur on liiga madal: ${fmt(indoor)} °C (alla ${fmt(t.indoorLow)} °C ${t.indoorLowMinutes} min, väljas ${fmt(outdoor)} °C).`, 'indoor:low');
  evaluate('dhwTarget', dhw != null && dhwTarget != null && state.compressor === true && dhw < dhwTarget - t.dhwGap, t.dhwGapMinutes,
    `Tarbevesi ei jõua sihini: ${fmt(dhw)} °C, siht ${fmt(dhwTarget)} °C (üle ${t.dhwGapMinutes} min).`, 'dhw:target');
  evaluate('humidity', humidity != null && humidity > t.humidity, t.humidityMinutes,
    `Niiskus on liiga kõrge: ${Math.round(humidity)}% (üle ${fmt(t.humidity)}% ${t.humidityMinutes} min).`, 'humidity:high');
  evaluate('ventStopped', state.ventRunning === false && co2 != null && co2 > t.ventStoppedCo2, t.ventStoppedMinutes,
    `Ventilatsioon ei tööta: CO₂ ${Math.round(co2)} ppm (üle ${t.ventStoppedMinutes} min).`, 'vent:stopped');
  return alerts;
}

const recentSent = (log, now) => (log?.sent || []).filter(entry => entry.ok && now - Date.parse(entry.time) < 86400000);

// Kanalist sõltumatu hindamine: reeglid, vaikne aeg, cooldown ja päevapiir.
// SMS ja push saavad sama nimekirja, et mõlemad kanalid järgiksid samu seadeid.
export function dueAlerts({ settings, state = {}, log, now = Date.now(), since = null }) {
  const config = parseNotifications(settings);
  const date = new Date(now);
  if (inQuietHours(date, config.quietFrom, config.quietTo)) return [];
  const sent = recentSent(log, now);
  if (sent.length >= config.dailyLimit) return [];
  const candidates = notificationAlerts(state);
  if (since) candidates.push(...durationAlerts(state, config, since, now));
  const due = [];
  for (const alert of candidates) {
    if (!config.rules[alert.rule]) continue;
    const previous = log?.lastSent?.[alert.key];
    if (previous && now - Date.parse(previous) < config.cooldownMinutes * 60000) continue;
    if (due.length + sent.length >= config.dailyLimit) break;
    due.push(alert);
  }
  return due;
}

export const notificationChannelReady = config => config.provider === 'telegram'
  ? Boolean(config.telegramToken && config.telegramChat)
  : Boolean(config.phone);

export function dueNotifications({ settings, state, log, now = Date.now(), since = null }) {
  const config = parseNotifications(settings);
  if (!config.smsEnabled || !notificationChannelReady(config)) return [];
  return dueAlerts({ settings: config, state, log, now, since });
}

// KDE Connecti paardunud seadmed (telefonid). Kasutab kasutaja D-Busi (systemd user-teenusel on see olemas).
const parseKdeDevices = output => String(output || '').split('\n').map(line => line.trim()).filter(Boolean)
  .filter(line => !/^(Leiti|Found)\s+0\s+seadet|device/i.test(line))
  .map(line => {
    const colon = /^([^:\s]+):\s*(.*)$/.exec(line);
    const space = colon ? null : /^(\S+)\s+(.*)$/.exec(line);
    const id = colon?.[1] || space?.[1] || line;
    return { id, name: colon?.[2] || space?.[2] || id };
  });

// Paardunud seadmed + kas seade on praegu võrgus (KDE Connecti "available" loend).
export async function kdeconnectDevices({ execFileImpl = run } = {}) {
  try {
    const [paired, availableResult] = await Promise.all([
      execFileImpl('kdeconnect-cli', ['--list-devices', '--id-name-only'], { timeout: 5000 }),
      execFileImpl('kdeconnect-cli', ['--list-available', '--id-name-only'], { timeout: 5000 }).catch(() => ({ stdout: '' }))
    ]);
    const reachable = new Set(parseKdeDevices(availableResult.stdout).map(device => device.id));
    return { devices: parseKdeDevices(paired.stdout).map(device => ({ ...device, available: reachable.has(device.id) })) };
  } catch (e) { return { devices: [], error: e.message }; }
}

export async function sendSms(settings, message, { fetchImpl = fetch, execFileImpl = run } = {}) {
  const config = parseNotifications(settings);
  if (config.provider !== 'telegram' && !config.phone) throw new NotificationError('Sisesta telefoninumber.');
  const timeout = () => AbortSignal.timeout(15000);
  if (config.provider === 'kdeconnect') {
    const list = await kdeconnectDevices({ execFileImpl });
    const device = config.kdeconnectDevice || list.devices?.find(item => item.available)?.id || list.devices?.[0]?.id;
    if (!device) throw new NotificationError('KDE Connecti seadet pole paaris. Paarista telefon ja luba SMS-plugin.');
    const chosen = list.devices?.find(item => item.id === device);
    if (!chosen?.available) throw new NotificationError(`KDE Connecti seade ${chosen?.name || device} ei ole võrgus saadaval. Ava telefonis KDE Connect ja kontrolli, et telefon on samas Wi-Fi võrgus.`);
    try {
      await execFileImpl('kdeconnect-cli', ['--device', device, '--send-sms', message, '--destination', config.phone], { timeout: 30000 });
    } catch (e) { throw new NotificationError(`KDE Connect: ${e.message}`); }
    return { ok: true };
  }
  if (config.provider === 'telegram') {
    if (!config.telegramToken || !config.telegramChat) throw new NotificationError('Telegrami boti token ja chat ID on puudu.');
    const response = await fetchImpl(`https://api.telegram.org/bot${config.telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.telegramChat, text: message, disable_web_page_preview: true }),
      signal: timeout()
    });
    if (!response.ok) {
      let detail = '';
      try { const body = await response.json(); detail = body?.description ? `: ${body.description}` : ''; } catch { /* vastus ei olnud JSON */ }
      throw new NotificationError(`Telegram vastas veaga (${response.status})${detail}.`);
    }
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
