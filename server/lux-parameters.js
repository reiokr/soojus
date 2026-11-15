import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readLuxParametersRaw } from './luxtronik.js';

// Luxtronik 3003 seadete päevane snapshot. App ei salvesta neid automaatselt,
// seega hoiame iga päeva algseisundi JSON-failina ja muudatuste logi eraldi.
// Failid: data/lux-params/YYYY-MM-DD.json, latest.json, changes-YYYY-MM-DD.json
const DEFS = JSON.parse(readFileSync(new URL('./lux-parameter-defs.json', import.meta.url), 'utf8'));

// Eestikeelsed nimed olulisematele seadetele; ülejäänud jäävad Luxtroniku sisemiseks nimeks.
const LABELS = {
  1: 'Küttekõver (WK)',
  2: 'Tarbevee siht (BWS)',
  3: 'Kütte töörežiim',
  4: 'Tarbevee töörežiim',
  28: 'Menüüde nähtavus (Anlagenkonfig)',
  33: 'Ruumijaama ühendus (RFV)',
  35: 'Hüdrauliline ühendus (Einbindung: Rückl/Trennsp)',
  42: 'Mischkreis 1 tüüp',
  74: 'Tarbevee hüsterees',
  83: 'ZUP tüüp / Warmw. 3 (mit ZUP/ohne ZUP)',
  84: 'Kütte max pealevool (TLG max)',
  105: 'Tarbevee siht (Soll BWS)',
  116: 'Prioriteet: küte',
  117: 'Prioriteet: tarbevesi',
  118: 'Prioriteet: bassein',
  148: 'Tarbevesi: HUP / Warmw. 5 (mit HUP/ohne HUP)',
  149: 'Max pealevool',
  697: 'Tsirkulatsioon: sisse',
  698: 'Tsirkulatsioon: välja',
  973: 'Max tarbevee temperatuur',
  976: 'PV funktsioon',
  977: 'Mitme salvesti funktsioon (Multispeicher)',
  979: 'Min tagasivoolu siht',
  1030: 'Smart Grid',
  1051: 'PV tarbevee blokeering',
  1052: 'Lisatarbevesi (extra)'
};

export const KEY_PARAMETERS = [35, 116, 117, 118, 42, 83, 148, 977, 105, 74, 149, 973, 2, 4, 28, 33, 697, 698, 1030, 976, 1051, 1052];

// Salvestame seadete muudatused, mitte loendureid/aegu (need muutuvad iga päev ja tekitaksid müra).
const SETTING_NAME = /^ID_(Einst|Ba|Soll)/;
const NOISE_NAME = /(Zaehler|BetrZeit|Timer|Time_|_saved|Anzahl|Fehler|Switchoff|Waermemenge|Datum|Adresse|Passwort|Password|SoftStand|SerienNummer|WP_SN|SN[0-9]?_(DATUM|HEX|INDEX)|Zugangscode)/;
const SENSITIVE_NAME = /(Passwort|Password|Zugangscode|AdresseIP|SubNetMask|Broadcast|Gateway|SerienNummer|WP_SN|SN[0-9]?_(DATUM|HEX|INDEX))/;

// Osa temperatuuri/kelvini parameetreid on Luxtronikus tüübita (Unknown), aga skaala on 0.1.
// Ainult teadaolevad indeksid, et mitte ekslikult skaleerida loendureid.
const TEMP_INDICES = new Set([44, 47, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 84, 87, 88, 89, 91, 92, 93, 94, 95, 96, 98, 111, 122, 123, 124, 125, 126, 149, 862, 863, 973, 979]);

const DATE_FMT = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Tallinn', year: 'numeric', month: '2-digit', day: '2-digit' });

export function localDate(now = Date.now()) {
  return DATE_FMT.format(new Date(now));
}

export function decodeLuxParameter(index, raw) {
  const def = DEFS[index] || { name: `Unknown_Parameter_${index}`, type: 'Unknown' };
  const sensitive = SENSITIVE_NAME.test(def.name);
  let value = raw;
  if (sensitive) value = '***';
  else if (def.type === 'Celsius' || def.type === 'Kelvin' || TEMP_INDICES.has(index)) value = Math.round(raw) / 10;
  else if (def.type === 'Bool') value = raw === 1;
  else if (def.codes) value = def.codes[String(raw)] ?? raw;
  return {
    index,
    name: def.name,
    label: LABELS[index] || def.name,
    type: def.type,
    writeable: Boolean(def.writeable),
    value,
    raw: sensitive ? null : raw
  };
}

export function isSettingParameter(parameter) {
  return SETTING_NAME.test(parameter.name || '') && !NOISE_NAME.test(parameter.name || '');
}

export function diffLuxParameterSnapshots(previous, current) {
  if (!previous?.parameters?.length || !current?.parameters?.length) return [];
  const before = new Map(previous.parameters.map(p => [p.index, p]));
  const changes = [];
  for (const parameter of current.parameters) {
    if (!isSettingParameter(parameter)) continue;
    const old = before.get(parameter.index);
    if (old && old.raw === parameter.raw) continue;
    changes.push({
      index: parameter.index,
      name: parameter.name,
      label: parameter.label,
      from: old?.value ?? null,
      to: parameter.value,
      fromRaw: old?.raw ?? null,
      toRaw: parameter.raw
    });
  }
  return changes;
}

export function keyLuxParameters(snapshot) {
  const byIndex = new Map((snapshot?.parameters || []).map(p => [p.index, p]));
  return Object.fromEntries(KEY_PARAMETERS.map(index => {
    const p = byIndex.get(index);
    return [index, p ? { name: p.name, label: p.label, value: p.value, raw: p.raw } : null];
  }));
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 1));
  renameSync(tmp, file);
}

export function saveLuxParameterSnapshot(snapshot, dir) {
  mkdirSync(dir, { recursive: true });
  const date = localDate(Date.parse(snapshot.time));
  const latestPath = path.join(dir, 'latest.json');
  const dailyPath = path.join(dir, `${date}.json`);
  const changesPath = path.join(dir, `changes-${date}.json`);
  let previous = null;
  try { previous = JSON.parse(readFileSync(latestPath, 'utf8')); } catch { /* esimene snapshot */ }
  const changes = previous ? diffLuxParameterSnapshots(previous, snapshot) : [];
  const record = { ...snapshot, changes };
  writeJsonAtomic(latestPath, record);
  if (!existsSync(dailyPath)) writeJsonAtomic(dailyPath, record);
  if (changes.length) {
    let log = [];
    try { log = JSON.parse(readFileSync(changesPath, 'utf8')); if (!Array.isArray(log)) log = []; } catch { /* uus logi */ }
    log.push({ time: snapshot.time, changes });
    writeJsonAtomic(changesPath, log);
  }
  return { file: dailyPath, latest: latestPath, changes };
}

export async function buildLuxParameterSnapshot({ host, now = Date.now(), read = readLuxParametersRaw } = {}) {
  const raw = await read({ host });
  return {
    time: new Date(now).toISOString(),
    host,
    count: raw.length,
    parameters: raw.map((value, index) => decodeLuxParameter(index, value))
  };
}

let busy = false;
export async function snapshotLuxParametersIfDue({ host, dir, now = Date.now() } = {}) {
  if (!host) return { created: false, skipped: 'not-configured' };
  const file = path.join(dir, `${localDate(now)}.json`);
  if (existsSync(file)) return { created: false, file };
  if (busy) return { created: false, skipped: 'busy' };
  busy = true;
  try {
    const snapshot = await buildLuxParameterSnapshot({ host, now });
    return { created: true, ...saveLuxParameterSnapshot(snapshot, dir) };
  } finally {
    busy = false;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function listLuxParameterSnapshots(dir) {
  try {
    return readdirSync(dir)
      .filter(name => DATE_RE.test(name.replace(/\.json$/, '')) || name === 'latest.json' || /^changes-\d{4}-\d{2}-\d{2}\.json$/.test(name))
      .map(name => {
        const s = statSync(path.join(dir, name));
        return { name, bytes: s.size, modified: s.mtime.toISOString() };
      })
      .sort((a, b) => a.name < b.name ? 1 : -1);
  } catch { return []; }
}

export function readLuxParameterSnapshot(dir, date = 'latest') {
  const name = date === 'latest' ? 'latest.json' : `${date}.json`;
  if (!DATE_RE.test(date) && date !== 'latest') throw new Error('Vale kuupäev.');
  const file = path.join(dir, name);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function readLuxParameterChanges(dir, date = 'latest') {
  if (date !== 'latest' && !DATE_RE.test(date)) throw new Error('Vale kuupäev.');
  const file = path.join(dir, `changes-${date === 'latest' ? localDate() : date}.json`);
  if (!existsSync(file)) return [];
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return []; }
}
