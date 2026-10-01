import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLuxtronik, luxValues, errorName, LUX_ID, LUX_MAP, overlayDirect, verifyMapping, isUsable, votePower, updatePowerChoice } from './luxtronik.js';
import { createWeather, searchPlaces, WeatherError } from './weather.js';
import { validatePlace, DEFAULT_PLACE } from '../src/weather-logic.js';
import { readAirobot, airobotValues, isPrivateIPv4, decodeErrors, effectiveMode, MODE_TEXT, parseControl, applyControl, parseSettings, applySettings, ControlError } from './airobot.js';
import { listAudio } from './audio.js';
import { AppError, validatePoint, validateZone, pointResults, csvCell } from './domain.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 3210);
const origin = process.env.APP_ORIGIN || `http://localhost:${port}`;
const apiBase = 'https://api.myuplink.com';
mkdirSync(path.join(root, 'data'), { recursive: true, mode: 0o700 });
try { chmodSync(path.join(root, '.env'), 0o600); } catch {}
const db = new DatabaseSync(path.join(root, 'data/soojus.sqlite'));
chmodSync(path.join(root, 'data/soojus.sqlite'), 0o600);
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS samples (device TEXT, point TEXT, time TEXT, value REAL, label TEXT, unit TEXT, PRIMARY KEY(device,point,time));
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, time TEXT, device TEXT, action TEXT, detail TEXT);
CREATE INDEX IF NOT EXISTS samples_time ON samples(time);
CREATE TABLE IF NOT EXISTS pump_errors (time TEXT NOT NULL, code INTEGER NOT NULL, seen TEXT NOT NULL, PRIMARY KEY(time, code));`);
const getSetting = key => { const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key); return row ? JSON.parse(row.value) : null; };
const setSetting = (key, value) => db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run(key, JSON.stringify(value));
const audit = (device, action, detail) => db.prepare('INSERT INTO audit(time,device,action,detail) VALUES(?,?,?,?)').run(new Date().toISOString(), device, action, JSON.stringify(detail));
function credentials() { return getSetting('credentials') || { clientId: process.env.MYUPLINK_CLIENT_ID, clientSecret: process.env.MYUPLINK_CLIENT_SECRET }; }
let tokenFlight;
async function tokenRequest(params) {
  const c = credentials();
  if (!c.clientId || !c.clientSecret) throw new AppError('Ühendamiseks sisesta myUplinki rakenduse võtmed.', 401);
  const response = await fetch(`${apiBase}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, ...params }), signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new AppError('myUplink ei kinnitanud ühendust. Kontrolli rakenduse võtmeid või logi uuesti sisse.', 401);
  const value = await response.json();
  if (!value.access_token) throw new AppError('myUplink ei tagastanud ligipääsutõendit.', 502);
  const stored = { ...value, expiresAt: Date.now() + Number(value.expires_in || 3600) * 1000 };
  setSetting('token', stored);
  return stored;
}
async function accessToken() {
  if (getSetting('disconnected')) throw new AppError('Ühendus on katkestatud. Ühenda seadete vaates uuesti.', 401);
  const t = getSetting('token');
  if (t?.expiresAt > Date.now() + 60000) return t.access_token;
  if (!tokenFlight) tokenFlight = tokenRequest(t?.refresh_token ? { grant_type: 'refresh_token', refresh_token: t.refresh_token } : { grant_type: 'client_credentials', scope: 'READSYSTEM WRITESYSTEM' }).finally(() => { tokenFlight = null; });
  return (await tokenFlight).access_token;
}
let backoffUntil = 0;
async function upstream(url, options = {}) {
  if (Date.now() < backoffUntil) throw new AppError('myUplink palus päringutega oodata. Proovi minuti pärast.', 429);
  const response = await fetch(`${apiBase}${url}`, { ...options, headers: { Authorization: `Bearer ${await accessToken()}`, Accept: 'application/json', 'Accept-Language': 'et-EE', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }, signal: AbortSignal.timeout(25000) });
  if (!response.ok) {
    if (response.status === 429) backoffUntil = Date.now() + Math.min(300000, Math.max(60000, Number(response.headers.get('retry-after') || 60) * 1000));
    const messages = { 401: 'myUplinki sessioon vajab uuesti ühendamist.', 403: 'myUplink ei luba seda toimingut. Kontrolli õigusi ja Premium-teenust.', 404: 'Seade ei paku seda funktsiooni.', 409: 'Seadistus on vastuolus seadme praeguse olekuga.', 429: 'myUplinki päringulimiit on täis. Proovi minuti pärast.' };
    throw new AppError(messages[response.status] || `myUplink tagastas vea (${response.status}).`, response.status);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
const cache = new Map();
async function cached(url, ttl = 60000, force = false) {
  const old = cache.get(url);
  if (!force && old?.until > Date.now()) return old.value;
  if (old?.flight) return old.flight;
  const flight = upstream(url).then(value => { cache.set(url, { value, until: Date.now() + ttl }); return value; }).catch(error => { cache.delete(url); throw error; });
  cache.set(url, { ...old, flight });
  return flight;
}
const enc = encodeURIComponent;
let systemsSavedJson = '';
async function systems() {
  try {
    const all = [];
    let complete = false;
    for (let page = 1; page <= 50 && !complete; page++) {
      const data = await cached(`/v2/systems/me?page=${page}&itemsPerPage=100`, 300000);
      all.push(...(data.systems || []));
      if (!data.systems?.length || all.length >= data.numItems || data.systems.length < 100) complete = true;
    }
    if (!complete) throw new AppError('Süsteemide loend ületas toetatud mahu.', 502);
    const json = JSON.stringify(all);
    if (json !== systemsSavedJson) { systemsSavedJson = json; setSetting('systemsSnapshot', all); }
    return all;
  } catch (e) {
    // myUplink ei vasta: kasuta viimast head seadmete loendit, et otseandmetega pump töötaks edasi (ainult kui otseandmed on kasutatavad).
    const saved = getSetting('systemsSnapshot');
    if (Array.isArray(saved) && saved.length && !getSetting('disconnected') && isUsable(luxState)) { upstreamProblem = e.message; return saved; }
    throw e;
  }
}
async function ownedDevice(id) { for (const s of await systems()) if (s.devices?.some(d => d.id === id)) return s; throw new AppError('Seadet ei leitud sinu süsteemidest.', 404); }
async function ownedSystem(id) { const s = (await systems()).find(s => s.systemId === id); if (!s) throw new AppError('Süsteemi ei leitud.', 404); return s; }
function record(id, points) {
  const insert = db.prepare('INSERT OR IGNORE INTO samples VALUES(?,?,?,?,?,?)');
  db.exec('BEGIN');
  try {
    for (const p of points) if (p.value !== null && p.value !== '' && Number.isFinite(Number(p.value)) && p.timestamp && Number.isFinite(Date.parse(p.timestamp))) insert.run(id, String(p.parameterId), new Date(p.timestamp).toISOString(), Number(p.value), p.parameterName || p.parameterId, p.parameterUnit || '');
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
}
const AIROBOT_ID = 'airobot';
const airobotConfig = () => getSetting('airobot');
const airobotState = { data: null, values: [], time: null, error: null };
let airobotBusy = false;
async function pollAirobot({ wait = false } = {}) {
  const cfg = airobotConfig();
  if (!cfg?.host) return;
  for (let i = 0; wait && airobotBusy && i < 60; i++) await new Promise(r => setTimeout(r, 100));
  if (airobotBusy) return;
  airobotBusy = true;
  try {
    const data = await readAirobot({ host: cfg.host });
    const values = airobotValues(data), time = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
    record(AIROBOT_ID, values.map(v => ({ parameterId: v.id, parameterName: v.label, parameterUnit: v.unit, value: v.value, timestamp: time })));
    Object.assign(airobotState, { data, values, time, error: null });
  } catch (e) { airobotState.error = e.message; } finally { airobotBusy = false; }
}
const airobotView = () => {
  const cfg = airobotConfig(), d = airobotState.data;
  return { configured: Boolean(cfg?.host), host: cfg?.host || null, time: airobotState.time, error: airobotState.error, data: d,
    mode: d ? effectiveMode(d) : null, modeText: d ? MODE_TEXT[effectiveMode(d)] : null, errors: d ? decodeErrors(d.errorFlags) : [],
    points: airobotState.values.map(v => ({ parameterId: v.id, label: v.label, parameterUnit: v.unit, value: v.value })) };
};
// Soojuspumba kohtvõrguliides (Luxtronik, ainult lugemine): alkoholi temperatuurid, mida myUplinki API ei avalda.
const luxConfig = () => getSetting('luxtronik');
const luxState = { data: null, values: [], time: null, error: null, readAt: null, recordTime: null, verified: getSetting('luxVerified') && getSetting('luxVerified') === getSetting('luxtronik')?.host ? true : null };
let luxBusy = false;
const powerChoice = { source: getSetting('luxPowerSource') || null, votes: { acInput: 0, heatOutput: 0 }, strikes: 0 };
const savePowerChoice = () => { if ((getSetting('luxPowerSource') || null) !== powerChoice.source) setSetting('luxPowerSource', powerChoice.source); };
async function pollLux() {
  const cfg = luxConfig();
  if (!cfg?.host || luxBusy) return;
  luxBusy = true;
  try {
    const data = await readLuxtronik({ host: cfg.host }), values = luxValues(data), readAt = Date.now(), recordTime = new Date(Math.floor(readAt / 60000) * 60000).toISOString();
    Object.assign(luxState, { data, values, time: new Date(readAt).toISOString(), error: null, readAt, recordTime });
    const insertError = db.prepare('INSERT OR IGNORE INTO pump_errors(time, code, seen) VALUES(?,?,?)');
    for (const e of data.errors) insertError.run(e.time, e.code, new Date(readAt).toISOString());
    record(LUX_ID, values.map(v => ({ parameterId: v.id, parameterName: v.label, parameterUnit: v.unit, value: v.value, timestamp: recordTime })));
    // Sama minutiga pumba näidud ajalukku myUplinkist sõltumata, nii et ajalugu ei katke ka pilve katkestuse ajal.
    const pump = getSetting('pumpDevice'), snapshot = pump && snapshotFor(pump);
    if (pump && snapshot && isUsable(luxState)) record(pump, overlayDirect(snapshot, data, recordTime, { powerSource: powerChoice.source }).points.filter(p => p.source === 'direct'));
  } catch (e) { luxState.error = e.message; } finally { luxBusy = false; }
}
const pumpErrors = () => db.prepare('SELECT time, code FROM pump_errors ORDER BY time DESC LIMIT 30').all().map(e => ({ ...e, name: errorName(e.code) }));
const luxView = () => ({ errors: pumpErrors(), errorsAck: getSetting('pumpErrorsAck') || null, errors7d: db.prepare('SELECT COUNT(*) AS n FROM pump_errors WHERE time>=?').get(new Date(Date.now() - 7 * 86400000).toISOString()).n, configured: Boolean(luxConfig()?.host), host: luxConfig()?.host || null, time: luxState.time, error: luxState.error, data: luxState.data,
  primary: isUsable(luxState), verified: luxState.verified, powerSource: powerChoice.source, powerVotes: powerChoice.votes, mismatch: luxState.verified === false, upstreamProblem, mapped: LUX_MAP.length,
  points: luxState.values.map(v => ({ parameterId: v.id, label: v.label, parameterUnit: v.unit, value: v.value })) });
async function historyDevice(id) {
  if (id === LUX_ID) { if (!luxConfig()?.host) throw new AppError('Soojuspumba kohtvõrguliidest pole seadistatud.', 404); return; }
  if (id !== AIROBOT_ID) return ownedDevice(id);
  if (!airobotConfig()?.host) throw new AppError('Ventilatsiooniseadet pole seadistatud.', 404);
}
// Viimane hea myUplinki vastus: kui pilv ei vasta, saab otseandmeid sellele peale kanda ja pump töötab edasi.
const lastGood = new Map(); let snapshotSavedAt = 0, rememberedPump = null, upstreamProblem = null;
function rememberPoints(id, data) {
  lastGood.set(id, data);
  if (Date.now() - snapshotSavedAt > 600000) { snapshotSavedAt = Date.now(); setSetting('pointsSnapshot', { id, at: new Date().toISOString(), data }); }
  if (rememberedPump !== id) { rememberedPump = id; setSetting('pumpDevice', id); }
}
function snapshotFor(id) { const m = lastGood.get(id); if (m) return m; const saved = getSetting('pointsSnapshot'); return saved?.id === id && Array.isArray(saved.data) ? saved.data : null; }
async function points(id, force = false) {
  let data, fromSnapshot = false;
  try {
    data = await cached(`/v2/devices/${enc(id)}/points`, 60000, force);
    if (!Array.isArray(data)) throw new AppError('Seadme näitude vastus ei olnud loend.', 502);
    rememberPoints(id, data); upstreamProblem = null;
    if (luxState.data && luxState.readAt) {
      luxState.verified = verifyMapping(data, luxState.data).ok;
      const host = luxConfig()?.host;
      if (luxState.verified === true && host && getSetting('luxVerified') !== host) setSetting('luxVerified', host);
      if (isUsable(luxState)) { updatePowerChoice(powerChoice, votePower(data, luxState.data), data, luxState.data); savePowerChoice(); }
    }
  } catch (e) {
    const snapshot = snapshotFor(id);
    if (!snapshot || !isUsable(luxState)) throw e;
    data = snapshot; fromSnapshot = true; upstreamProblem = e.message;
  }
  if (isUsable(luxState)) data = overlayDirect(data, luxState.data, luxState.recordTime, { powerSource: powerChoice.source }).points;
  record(id, fromSnapshot ? data.filter(p => p.source === 'direct') : data);
  return data;
}
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  const host = req.headers.host;
  if (![new URL(origin).host, `127.0.0.1:${port}`].includes(host)) return res.status(403).json({ error: 'Lubamatu host.' });
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store' });
  if (req.path.startsWith('/api') && !['GET', 'HEAD'].includes(req.method) && (req.headers.origin !== origin || req.headers['x-soojus-request'] !== '1')) return res.status(403).json({ error: 'Päring peab tulema Soojuse rakendusest.' });
  if (req.headers['sec-fetch-site'] === 'cross-site' && req.path.startsWith('/api')) return res.status(403).json({ error: 'Ristsaidi päring ei ole lubatud.' });
  next();
});
app.use(express.json({ limit: '32kb' }));
app.get('/api/audio', (req, res) => res.json({ files: listAudio(path.join(root, process.argv.includes('--production') ? 'dist/audio' : 'public/audio')) }));
app.get('/api/status', (req, res) => { const c = credentials(); const t = getSetting('token'); res.json({ configured: Boolean(c.clientId && c.clientSecret), connected: Boolean(t && !getSetting('disconnected')), callbackUrl: `${origin}/auth/callback`, pollSeconds: 60, collectorError, lastCollected, appVersion: '1.0.0' }); });
app.post('/api/connect', async (req, res) => {
  if (req.body.clientId || req.body.clientSecret) {
    if (typeof req.body.clientId !== 'string' || typeof req.body.clientSecret !== 'string' || req.body.clientSecret.length < 8) throw new AppError('Sisesta mõlemad rakenduse võtmed.');
    setSetting('credentials', { clientId: req.body.clientId.trim(), clientSecret: req.body.clientSecret.trim() });
    setSetting('token', null); cache.clear();
  }
  setSetting('disconnected', false);
  await accessToken();
  res.json({ connected: true });
});
app.post('/api/disconnect', (req, res) => { setSetting('disconnected', true); setSetting('token', null); cache.clear(); res.json({ ok: true }); });
app.get('/auth/start', (req, res) => {
  if (!credentials().clientId) return res.redirect('/?page=settings&authError=missing');
  const state = randomBytes(32).toString('hex');
  setSetting('oauthState', { hash: createHash('sha256').update(state).digest('hex'), expiry: Date.now() + 600000 });
  res.cookie('soojus_oauth', state, { httpOnly: true, sameSite: 'lax', secure: origin.startsWith('https'), maxAge: 600000, path: '/auth' });
  res.redirect(`${apiBase}/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: credentials().clientId, scope: 'READSYSTEM WRITESYSTEM offline_access', redirect_uri: `${origin}/auth/callback`, state })}`);
});
app.get('/auth/callback', async (req, res) => {
  const saved = getSetting('oauthState'); const state = String(req.query.state || '');
  const cookie = req.headers.cookie?.split('; ').find(x => x.startsWith('soojus_oauth='))?.split('=')[1];
  if (!saved || saved.expiry < Date.now() || cookie !== state || !timingSafeEqual(Buffer.from(saved.hash), Buffer.from(createHash('sha256').update(state).digest('hex')))) return res.redirect('/?page=settings&authError=state');
  setSetting('oauthState', null); res.clearCookie('soojus_oauth', { path: '/auth' });
  if (req.query.error || typeof req.query.code !== 'string') return res.redirect('/?page=settings&authError=denied');
  try { await tokenRequest({ grant_type: 'authorization_code', code: req.query.code, redirect_uri: `${origin}/auth/callback` }); setSetting('disconnected', false); cache.clear(); res.redirect('/'); } catch { res.redirect('/?page=settings&authError=token'); }
});
app.get('/api/systems', async (req, res) => res.json(await systems()));
app.get('/api/devices/:id', async (req, res) => { await ownedDevice(req.params.id); res.json(await cached(`/v2/devices/${enc(req.params.id)}`, 300000)); });
app.get('/api/devices/:id/points', async (req, res) => { await ownedDevice(req.params.id); res.json(await points(req.params.id)); });
app.patch('/api/devices/:id/points', async (req, res) => {
  await ownedDevice(req.params.id);
  if (!req.body || Array.isArray(req.body) || Object.keys(req.body).length < 1 || Object.keys(req.body).length > 20) throw new AppError('Vali 1–20 parameetrit.');
  const current = await points(req.params.id, true); const patch = {};
  for (const [id, val] of Object.entries(req.body)) patch[id] = validatePoint(current.find(p => p.parameterId === id), val);
  // Zone temperature commands need the dedicated endpoint on some manufacturers.
  const result = {};
  const zoneCandidates = current.filter(p => Object.hasOwn(patch, p.parameterId) && p.zoneId && p.smartHomeCategories?.some(c => ['sh-indoorSpHeat', 'sh-indoorSpCool'].includes(c)));
  const zoneUrl = `/v2/devices/${enc(req.params.id)}/smart-home-zones`;
  const availableZones = zoneCandidates.length ? await cached(zoneUrl, 60000, true) : [];
  for (const p of zoneCandidates) {
    const field = p.smartHomeCategories.includes('sh-indoorSpCool') ? 'setpointCool' : 'setpointHeat';
    const zone = availableZones.find(z => z.zoneId === p.zoneId);
    if (!zone || zone[field] == null) continue;
    const body = validateZone(zone, { [field]: Number(patch[p.parameterId]) });
    const reply = await upstream(`/v2/devices/${enc(req.params.id)}/zones/${enc(p.zoneId)}`, { method: 'PATCH', body: JSON.stringify(body) });
    result[p.parameterId] = reply && Object.values(reply).length && Object.values(reply).every(v => String(v).toLowerCase() === 'modified') ? 'modified' : 'unknown';
    delete patch[p.parameterId]; cache.delete(zoneUrl);
  }
  if (Object.keys(patch).length) Object.assign(result, await upstream(`/v2/devices/${enc(req.params.id)}/points`, { method: 'PATCH', body: JSON.stringify(patch) }));
  const results = pointResults(result, Object.keys(req.body));
  audit(req.params.id, 'Parameetrite muutmine', { requested: req.body, results }); cache.delete(`/v2/devices/${enc(req.params.id)}/points`);
  res.json({ results, allModified: results.every(x => x.success) });
});
for (const name of ['smart-home-categories', 'smart-home-zones', 'firmware-info', 'aidMode']) app.get(`/api/devices/:id/${name}`, async (req, res) => { await ownedDevice(req.params.id); res.json(await cached(`/v2/devices/${enc(req.params.id)}/${name}`, 300000)); });
app.patch('/api/devices/:id/zones/:zone', async (req, res) => {
  await ownedDevice(req.params.id);
  const url = `/v2/devices/${enc(req.params.id)}/smart-home-zones`;
  const zones = await cached(url, 60000, true);
  const body = validateZone(zones.find(z => z.zoneId === req.params.zone), req.body);
  const result = await upstream(`/v2/devices/${enc(req.params.id)}/zones/${enc(req.params.zone)}`, { method: 'PATCH', body: JSON.stringify(body) });
  audit(req.params.id, 'Tsooni muutmine', { zone: req.params.zone, requested: body, result }); cache.delete(url);
  res.json({ result });
});
app.get('/api/systems/:id/mode', async (req, res) => { await ownedSystem(req.params.id); res.json(await cached(`/v2/systems/${enc(req.params.id)}/smart-home-mode`)); });
app.put('/api/systems/:id/mode', async (req, res) => {
  await ownedSystem(req.params.id);
  if (!['Default', 'Normal', 'Away', 'Vacation', 'Home'].includes(req.body.smartHomeMode)) throw new AppError('Tundmatu režiim.');
  const url = `/v2/systems/${enc(req.params.id)}/smart-home-mode`;
  await upstream(url, { method: 'PUT', body: JSON.stringify({ smartHomeMode: req.body.smartHomeMode }) }); cache.delete(url);
  audit(req.params.id, 'Kodurežiimi muutmine', req.body); res.json({ ok: true });
});
app.get('/api/systems/:id/subscriptions', async (req, res) => { await ownedSystem(req.params.id); res.json(await cached(`/v2/systems/${enc(req.params.id)}/subscriptions`, 300000)); });
app.get('/api/systems/:id/notifications', async (req, res) => {
  await ownedSystem(req.params.id);
  const page = Math.max(1, Math.min(10000, Number(req.query.page) || 1));
  res.json(await cached(`/v2/systems/${enc(req.params.id)}/notifications${req.query.active === 'true' ? '/active' : ''}?page=${Math.floor(page)}&itemsPerPage=20`));
});
// Ajavahemik: kas ?from=&to= (ISO, 1 min – 1 aasta) või ?hours= (viimased tunnid).
function historyWindow(query) {
  const from = Date.parse(query.from), to = Date.parse(query.to);
  if (Number.isFinite(from) && Number.isFinite(to) && to - from >= 60000 && to - from <= 365 * 86400000) return { since: new Date(from).toISOString(), until: new Date(to).toISOString(), hours: (to - from) / 3600000 };
  const hours = Math.min(24 * 365, Math.max(1, Number(query.hours) || 24));
  return { since: new Date(Date.now() - hours * 3600000).toISOString(), until: '9999-12-31T00:00:00.000Z', hours };
}
// Andmeta vahemikud: kohad, kus ühegi antud seadme näitu ei salvestatud (üle 30 min), sh perioodi alguse ja lõpu puudujäägid.
function dataGaps(devices, since, until) {
  const slot = 600, gapAfter = 30 * 60000;
  const times = db.prepare(`SELECT DISTINCT CAST(unixepoch(time)/? AS INTEGER)*? AS s FROM samples WHERE device IN (${devices.map(() => '?').join(',')}) AND time>=? AND time<? ORDER BY s`).all(slot, slot, ...devices, since, until).map(r => r.s * 1000);
  const gaps = [], edges = [Date.parse(since) - slot * 1000, ...times, Math.min(Date.parse(until), Date.now()) + slot * 1000];
  for (let i = 1; i < edges.length; i++) if (edges[i] - edges[i - 1] > gapAfter + slot * 1000) gaps.push({ from: new Date(edges[i - 1] + slot * 1000).toISOString(), to: new Date(edges[i] - (i === edges.length - 1 ? slot * 1000 : 0)).toISOString() });
  return gaps;
}
// Virtuaalne "toas vs väljas" ajalugu: välisõhk soojuspumbalt (?pump=&outdoor=) ja sisetemperatuur ventilatsiooni väljatõmbeõhult.
async function climateHistory(req, res) {
  const pump = String(req.query.pump || ''), outdoor = String(req.query.outdoor || '');
  await ownedDevice(pump);
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(outdoor)) throw new AppError('Vale välisõhu näit.', 400);
  if (!airobotConfig()?.host) throw new AppError('Ventilatsiooniseadet pole seadistatud.', 404);
  const { since, until, hours } = historyWindow(req.query), bucketSeconds = hours <= 24 ? 60 : hours <= 168 ? 600 : hours <= 720 ? 3600 : 86400;
  const query = db.prepare(`SELECT ? AS point, strftime('%Y-%m-%dT%H:%M:%fZ', CAST(unixepoch(time)/? AS INTEGER)*?, 'unixepoch') AS time, AVG(value) AS value FROM samples WHERE device=? AND point=? AND time>=? AND time<? GROUP BY CAST(unixepoch(time)/? AS INTEGER) ORDER BY time`);
  const rows = [['outdoor', pump, outdoor], ['indoor', AIROBOT_ID, 'extract_temp']].flatMap(([alias, device, point]) => query.all(alias, bucketSeconds, bucketSeconds, device, point, since, until, bucketSeconds));
  res.json({ rows, count: rows.length, limited: false, bucketSeconds, source: 'local', since, gaps: dataGaps([pump, AIROBOT_ID], since, until) });
}
// Ühendatud ajalugu: ?pump=<seadme id>&s=p:<näit>,a:<ventilatsiooni näit>,... (p = soojuspump, a = Airobot). Ühikute ühtsuse eest vastutab klient.
function parseMixSources(query) {
  const tokens = String(query.s || '').split(',').filter(Boolean);
  if (!tokens.length || tokens.length > 8) throw new AppError('Vali 1–8 näitu.', 400);
  return tokens.map(token => {
    const m = /^([pal]):([A-Za-z0-9_-]{1,40})$/.exec(token);
    if (!m) throw new AppError('Vale näit.', 400);
    return { token, kind: m[1], point: m[2] };
  });
}
async function mixHistory(req, res) {
  const sources = parseMixSources(req.query), pump = String(req.query.pump || '');
  const needPump = sources.some(x => x.kind === 'p'), needVent = sources.some(x => x.kind === 'a'), needLux = sources.some(x => x.kind === 'l');
  if (needPump) await ownedDevice(pump);
  if (needVent && !airobotConfig()?.host) throw new AppError('Ventilatsiooniseadet pole seadistatud.', 404);
  if (needLux && !luxConfig()?.host) throw new AppError('Soojuspumba kohtvõrguliidest pole seadistatud.', 404);
  const { since, until, hours } = historyWindow(req.query), deviceOf = x => x.kind === 'p' ? pump : x.kind === 'l' ? LUX_ID : AIROBOT_ID;
  if (req.query.format === 'csv') {
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="soojus-ajalugu.csv"' });
    const raw = db.prepare('SELECT time,value,label,unit FROM samples WHERE device=? AND point=? AND time>=? AND time<?');
    const all = sources.flatMap(x => raw.all(deviceOf(x), x.point, since, until).map(r => ({ ...r, point: x.token }))).sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0);
    const { Readable } = await import('node:stream'), { pipeline } = await import('node:stream/promises');
    async function* chunks() {
      yield '\uFEFFAeg;Parameeter;Nimetus;Väärtus;Ühik\n';
      for (let i = 0; i < all.length; i += 500) yield all.slice(i, i + 500).map(r => [r.time, r.point, r.label, r.value, r.unit].map(csvCell).join(';') + '\n').join('');
    }
    try { await pipeline(Readable.from(chunks()), res); } catch { /* klient katkestas */ }
    return;
  }
  const bucketSeconds = hours <= 24 ? 60 : hours <= 168 ? 600 : hours <= 720 ? 3600 : 86400;
  const query = db.prepare(`SELECT ? AS point, strftime('%Y-%m-%dT%H:%M:%fZ', CAST(unixepoch(time)/? AS INTEGER)*?, 'unixepoch') AS time, AVG(value) AS value FROM samples WHERE device=? AND point=? AND time>=? AND time<? GROUP BY CAST(unixepoch(time)/? AS INTEGER) ORDER BY time`);
  const rows = sources.flatMap(x => query.all(x.token, bucketSeconds, bucketSeconds, deviceOf(x), x.point, since, until, bucketSeconds));
  res.json({ rows, count: rows.length, limited: false, bucketSeconds, source: 'local', since, gaps: dataGaps([...new Set(sources.map(deviceOf))], since, until) });
}
app.get('/api/history/:id', async (req, res) => {
  if (req.params.id === 'climate') return climateHistory(req, res);
  if (req.params.id === 'mix') return mixHistory(req, res);
  await historyDevice(req.params.id);
  const { since, until, hours } = historyWindow(req.query);
  const params = [req.params.id, since, until, req.query.point || '', req.query.point || ''];
  if (req.query.format === 'csv') {
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="soojus-ajalugu.csv"' });
    // pipeline käsitleb vastusurvet ja kliendi katkestust; käsitsi 'drain'-ootus jäi suurte failide puhul seisma.
    const { Readable } = await import('node:stream'), { pipeline } = await import('node:stream/promises');
    const rows = db.prepare('SELECT point,time,value,label,unit FROM samples WHERE device=? AND time>=? AND time<? AND (?=\'\' OR point=?) ORDER BY time');
    async function* chunks() {
      yield '\uFEFFAeg;Parameeter;Nimetus;Väärtus;Ühik\n';
      let lines = [];
      for (const r of rows.iterate(...params)) { lines.push([r.time, r.point, r.label, r.value, r.unit].map(csvCell).join(';') + '\n'); if (lines.length >= 500) { yield lines.join(''); lines = []; } }
      if (lines.length) yield lines.join('');
    }
    try { await pipeline(Readable.from(chunks()), res); } catch { /* klient katkestas */ }
    return;
  }
  if (req.query.raw === '1' && req.query.point) {
    const prior = db.prepare('SELECT time,value FROM samples WHERE device=? AND point=? AND time<? ORDER BY time DESC LIMIT 1').get(req.params.id, req.query.point, since);
    const rows = db.prepare('SELECT time,value FROM samples WHERE device=? AND point=? AND time>=? AND time<? ORDER BY time LIMIT 20000').all(req.params.id, req.query.point, since, until);
    return res.json({ rows: prior ? [prior, ...rows] : rows, source: 'local', since });
  }
  const bucketSeconds = hours <= 24 ? 60 : hours <= 168 ? 600 : hours <= 720 ? 3600 : 86400;
  const rows = db.prepare(`SELECT point, strftime('%Y-%m-%dT%H:%M:%fZ', CAST(unixepoch(time)/? AS INTEGER)*?, 'unixepoch') AS time,
    AVG(value) AS value, label, unit FROM samples WHERE device=? AND time>=? AND time<? AND (?='' OR point=?) GROUP BY point, CAST(unixepoch(time)/? AS INTEGER) ORDER BY time`).all(bucketSeconds,bucketSeconds,...params,bucketSeconds);
  const gaps = dataGaps([req.params.id], since, until);
  res.json({ rows, count: rows.length, limited: false, bucketSeconds, source: 'local', since, gaps });
});
const weatherFor = createWeather();
const currentPlace = () => { const saved = getSetting('location'); try { return saved ? validatePlace(saved) : DEFAULT_PLACE; } catch { return DEFAULT_PLACE; } };
const placeView = () => ({ ...currentPlace(), isDefault: !getSetting('location') });
app.get('/api/location', (req, res) => res.json(placeView()));
app.post('/api/location', (req, res) => {
  let place;
  try { place = validatePlace(req.body); } catch (e) { throw new AppError(e.message, 400); }
  setSetting('location', place); audit('location', 'location-change', place);
  res.json(placeView());
});
app.delete('/api/location', (req, res) => { setSetting('location', null); audit('location', 'location-reset', {}); res.json(placeView()); });
app.get('/api/location/search', async (req, res) => {
  try { res.json({ results: await searchPlaces(req.query.q) }); } catch (e) { throw new AppError(e instanceof WeatherError ? e.message : 'Otsing ebaõnnestus.', e instanceof WeatherError && /märki/.test(e.message) ? 400 : 502); }
});
app.get('/api/weather', async (req, res) => { const place = placeView(); res.json({ location: place, source: 'Open-Meteo', ...await weatherFor(place) }); });
app.get('/api/luxtronik', (req, res) => res.json(luxView()));
app.post('/api/luxtronik', async (req, res) => {
  const host = String(req.body?.host || '').trim();
  if (!isPrivateIPv4(host)) throw new AppError('Sisesta kohtvõrgu IPv4 aadress, näiteks 192.168.1.20.', 400);
  try { await readLuxtronik({ host }); } catch (e) { throw new AppError(`Soojuspumbaga ei saanud ühendust: ${e.message} Kontrolli aadressi ja et pump kuulab porti 8889.`, 502); }
  setSetting('luxtronik', { host }); audit(LUX_ID, 'luxtronik-connect', { host });
  Object.assign(luxState, { data: null, values: [], time: null, error: null, readAt: null, recordTime: null, verified: getSetting('luxVerified') === host ? true : null });
  await pollLux();
  res.json(luxView());
});
// Esilehe veateate "Peida": märgib kõik praegu teadaolevad vead nähtuks. Logi ise jääb alles ja uus viga tõstab teate uuesti nähtavale.
app.post('/api/luxtronik/errors/ack', (req, res) => {
  const latest = db.prepare('SELECT MAX(time) AS t FROM pump_errors').get().t;
  if (latest) setSetting('pumpErrorsAck', latest);
  res.json(luxView());
});
app.delete('/api/luxtronik', (req, res) => {
  setSetting('luxtronik', null); audit(LUX_ID, 'luxtronik-disconnect', {});
  Object.assign(luxState, { data: null, values: [], time: null, error: null, readAt: null, recordTime: null, verified: null });
  res.json(luxView());
});
app.get('/api/airobot', (req, res) => res.json(airobotView()));
app.post('/api/airobot', async (req, res) => {
  const host = String(req.body?.host || '').trim();
  if (!isPrivateIPv4(host)) throw new AppError('Sisesta kohtvõrgu IPv4 aadress, näiteks 192.168.1.20.', 400);
  try { await readAirobot({ host }); } catch (e) { throw new AppError(`Seadmega ei saanud ühendust: ${e.message} Kontrolli, et seadmes on Modbus TCP sisse lülitatud.`, 502); }
  setSetting('airobot', { host }); audit(AIROBOT_ID, 'airobot-connect', { host });
  Object.assign(airobotState, { data: null, values: [], time: null, error: null });
  await pollAirobot();
  res.json(airobotView());
});
async function writeAirobot(req, res, parse, apply, action) {
  const cfg = airobotConfig();
  if (!cfg?.host) throw new AppError('Ventilatsiooniseadet pole seadistatud.', 404);
  let plan;
  try { plan = parse(req.body); } catch (e) { throw new AppError(e instanceof ControlError ? e.message : 'Vale sisend.', 400); }
  for (let i = 0; airobotBusy && i < 60; i++) await new Promise(r => setTimeout(r, 100));
  if (airobotBusy) throw new AppError('Seade on hõivatud, proovi hetke pärast uuesti.', 503);
  airobotBusy = true;
  try { await apply({ host: cfg.host }, plan); }
  catch (e) { throw new AppError(`Seadmesse ei õnnestunud kirjutada: ${e.message}`, 502); }
  finally { airobotBusy = false; }
  audit(AIROBOT_ID, action, req.body);
  await pollAirobot({ wait: true });
  res.json(airobotView());
}
app.post('/api/airobot/settings', (req, res) => writeAirobot(req, res, parseSettings, applySettings, 'airobot-settings'));
app.post('/api/airobot/control', (req, res) => writeAirobot(req, res, parseControl, applyControl, 'airobot-control'));
app.delete('/api/airobot', (req, res) => {
  setSetting('airobot', null); audit(AIROBOT_ID, 'airobot-disconnect', {});
  Object.assign(airobotState, { data: null, values: [], time: null, error: null });
  res.json(airobotView());
});
app.get('/api/audit', (req, res) => res.json(db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 100').all()));
app.get('/api/ping', async (req, res) => { await upstream('/v2/protected-ping'); res.json({ ok: true, time: new Date().toISOString() }); });
app.get('/api/firmware/:type/:version/download', async (req, res) => {
  await accessToken();
  const response = await fetch(`${apiBase}/v2/firmware/${enc(req.params.type)}/version/${enc(req.params.version)}/download`, { headers: { Authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new AppError('Püsivara allalaadimine ebaõnnestus.', response.status);
  res.set({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="soojus-firmware.bin"' });
  for await (const chunk of response.body) res.write(chunk);
  res.end();
});
app.use('/api', (req, res) => res.status(404).json({ error: 'Päringut ei leitud.' }));
let collectorError = null, lastCollected = null, collecting = false;
async function collect() {
  if (collecting || getSetting('disconnected') || !credentials().clientId) return;
  collecting = true;
  try {
    for (const s of await systems()) for (const d of s.devices || []) await points(d.id);
    lastCollected = new Date().toISOString(); collectorError = null;
    db.prepare('DELETE FROM samples WHERE time<?').run(new Date(Date.now() - 365 * 86400000).toISOString());
    db.prepare('DELETE FROM pump_errors WHERE time<?').run(new Date(Date.now() - 365 * 86400000).toISOString());
  } catch (e) { collectorError = e.message; } finally { collecting = false; }
}
if (process.argv.includes('--production')) { app.use(express.static(path.join(root, 'dist'))); app.get('/{*splat}', (req, res) => res.sendFile(path.join(root, 'dist/index.html'))); }
else { const { createServer } = await import('vite'); const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' }); app.use(vite.middlewares); }
app.use((err, req, res, next) => { if (res.headersSent) return next(err); res.status(err.status || 502).json({ error: err instanceof AppError ? err.message : 'Päring ebaõnnestus. Kontrolli võrguühendust ja proovi uuesti.' }); });
app.listen(port, process.env.HOST || '127.0.0.1', () => { console.log(`Soojus: ${origin}`); collect(); pollAirobot(); pollLux(); });
setInterval(collect, 60000).unref();
setInterval(pollLux, 10000).unref();
setInterval(pollAirobot, 60000).unref();
