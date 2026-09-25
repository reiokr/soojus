import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
CREATE INDEX IF NOT EXISTS samples_time ON samples(time);`);
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
async function systems() {
  const all = [];
  for (let page = 1; page <= 50; page++) {
    const data = await cached(`/v2/systems/me?page=${page}&itemsPerPage=100`, 300000);
    all.push(...(data.systems || []));
    if (!data.systems?.length || all.length >= data.numItems || data.systems.length < 100) return all;
  }
  throw new AppError('Süsteemide loend ületas toetatud mahu.', 502);
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
async function points(id, force = false) { const data = await cached(`/v2/devices/${enc(id)}/points`, 60000, force); if (!Array.isArray(data)) throw new AppError('Seadme näitude vastus ei olnud loend.', 502); record(id, data); return data; }
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
app.get('/api/history/:id', async (req, res) => {
  await ownedDevice(req.params.id);
  const hours = Math.min(24 * 365, Math.max(1, Number(req.query.hours) || 24));
  const since = new Date(Date.now() - hours * 3600000).toISOString();
  const params = [req.params.id, since, req.query.point || '', req.query.point || ''];
  if (req.query.format === 'csv') {
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="soojus-ajalugu.csv"' });
    res.write('\uFEFFAeg;Parameeter;Nimetus;Väärtus;Ühik\n');
    const { once } = await import('node:events');
    for (const r of db.prepare('SELECT point,time,value,label,unit FROM samples WHERE device=? AND time>=? AND (?=\'\' OR point=?) ORDER BY time').iterate(...params)) {
      if (res.destroyed) break;
      if (!res.write([r.time,r.point,r.label,r.value,r.unit].map(csvCell).join(';') + '\n')) await once(res, 'drain');
    }
    return res.end();
  }
  const bucketSeconds = hours <= 24 ? 60 : hours <= 168 ? 600 : hours <= 720 ? 3600 : 86400;
  const rows = db.prepare(`SELECT point, strftime('%Y-%m-%dT%H:%M:%fZ', CAST(unixepoch(time)/? AS INTEGER)*?, 'unixepoch') AS time,
    AVG(value) AS value, label, unit FROM samples WHERE device=? AND time>=? AND (?='' OR point=?) GROUP BY point, CAST(unixepoch(time)/? AS INTEGER) ORDER BY time`).all(bucketSeconds,bucketSeconds,...params,bucketSeconds);
  res.json({ rows, count: rows.length, limited: false, bucketSeconds, source: 'local', since });
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
  } catch (e) { collectorError = e.message; } finally { collecting = false; }
}
if (process.argv.includes('--production')) { app.use(express.static(path.join(root, 'dist'))); app.get('/{*splat}', (req, res) => res.sendFile(path.join(root, 'dist/index.html'))); }
else { const { createServer } = await import('vite'); const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' }); app.use(vite.middlewares); }
app.use((err, req, res, next) => { if (res.headersSent) return next(err); res.status(err.status || 502).json({ error: err instanceof AppError ? err.message : 'Päring ebaõnnestus. Kontrolli võrguühendust ja proovi uuesti.' }); });
app.listen(port, '127.0.0.1', () => { console.log(`Soojus: ${origin}`); collect(); });
setInterval(collect, 60000).unref();
