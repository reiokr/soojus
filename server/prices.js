// Börsihinna ajalugu: Eleringi avalik Nord Pooli API (15 min hinnad, EUR/MWh, ilma KM-ta).
// Salvestame tunnikeskmised kohalikus ajas tabelisse power_prices, et energiaaruande
// tunnijaotusega saaks börsipaketi kulu arvutada.
import { DAY_MS } from './store.js';

const API = 'https://dashboard.elering.ee/api/nps/price';
const CHUNK_DAYS = 90;
const TIMEOUT_MS = 20000;
const pad = value => String(value).padStart(2, '0');
const localDay = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const round = (value, digits = 5) => Math.round(value * 10 ** digits) / 10 ** digits;

export function ensurePriceTable(db) {
  db.exec('CREATE TABLE IF NOT EXISTS power_prices (day TEXT NOT NULL, hour INTEGER NOT NULL, price REAL NOT NULL, PRIMARY KEY(day,hour))');
}

// Elering: { data: { ee: [{ timestamp: seconds, price: EUR/MWh }] } } → [{day, hour, price: EUR/kWh}].
export function normalizeElering(payload) {
  const rows = payload?.data?.ee;
  if (!Array.isArray(rows)) return [];
  const map = new Map();
  for (const row of rows) {
    const price = Number(row?.price), timestamp = Number(row?.timestamp) * 1000;
    if (!Number.isFinite(price) || !Number.isFinite(timestamp)) continue;
    const date = new Date(timestamp), day = localDay(date), hour = date.getHours();
    const key = `${day}:${hour}`, entry = map.get(key) ?? { day, hour, sum: 0, count: 0 };
    entry.sum += price / 1000; // EUR/MWh → EUR/kWh
    entry.count += 1;
    map.set(key, entry);
  }
  return [...map.values()]
    .map(entry => ({ day: entry.day, hour: entry.hour, price: round(entry.sum / entry.count) }))
    .sort((a, b) => a.day === b.day ? a.hour - b.hour : a.day < b.day ? -1 : 1);
}

async function fetchRange(from, to) {
  const url = `${API}?start=${encodeURIComponent(from.toISOString())}&end=${encodeURIComponent(to.toISOString())}`;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Elering ${response.status}`);
    return normalizeElering(await response.json());
  } finally { clearTimeout(timer); }
}

// Tagab, et soovitud vahemik on andmebaasis. Vanemad andmed jäävad alles.
export async function syncPrices(db, { from, to } = {}) {
  ensurePriceTable(db);
  const start = from ? new Date(from) : new Date(Date.now() - 365 * DAY_MS);
  const end = to ? new Date(to) : new Date();
  const wantedFrom = localDay(start), wantedTo = localDay(end);
  const min = db.prepare('SELECT MIN(day) AS day FROM power_prices').get()?.day;
  const max = db.prepare('SELECT MAX(day) AS day FROM power_prices').get()?.day;
  if (min && max && min <= wantedFrom && max >= wantedTo) return { ok: true, fetched: 0, error: null };

  const insert = db.prepare('INSERT OR REPLACE INTO power_prices VALUES(?,?,?)');
  let fetched = 0;
  try {
    for (let cursor = start.getTime(); cursor < end.getTime(); cursor += CHUNK_DAYS * DAY_MS) {
      const chunkEnd = Math.min(end.getTime(), cursor + CHUNK_DAYS * DAY_MS);
      const rows = await fetchRange(new Date(cursor), new Date(chunkEnd));
      // Kirjutame väikeste pakkidena ja anname event loop'ile vahepeal aega,
      // et suur ajaloo täitmine ei blokeeriks teisi lehepäringuid.
      for (let i = 0; i < rows.length; i += 2000) {
        const part = rows.slice(i, i + 2000);
        db.exec('BEGIN');
        try { for (const row of part) { insert.run(row.day, row.hour, row.price); fetched++; } db.exec('COMMIT'); }
        catch (error) { db.exec('ROLLBACK'); throw error; }
        await new Promise(resolve => setImmediate(resolve));
      }
    }
    return { ok: true, fetched, error: null };
  } catch (error) {
    return { ok: false, fetched, error: error?.message || 'Börsihinna laadimine ebaõnnestus.' };
  }
}

export function pricesFor(db, { from, to } = {}) {
  ensurePriceTable(db);
  const start = localDay(from ? new Date(from) : new Date(Date.now() - 365 * DAY_MS));
  const end = localDay(to ? new Date(to) : new Date());
  return db.prepare('SELECT day, hour, price FROM power_prices WHERE day>=? AND day<=? ORDER BY day, hour').all(start, end);
}
