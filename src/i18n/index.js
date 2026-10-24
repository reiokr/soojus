// Kergekaaluline i18n: sõnastikud + t() + lokaadi hoidja.
// Ei sõltu Reactist, et sama moodulit saaks hiljem kasutada ka serveris.
import et from './et.js';
import en from './en.js';

export const DICTS = { et, en };
export const LOCALES = [['et', 'Eesti'], ['en', 'English']];
const STORAGE_KEY = 'soojus.lang';
const listeners = new Set();
let locale = 'et';

const hasStorage = () => { try { return typeof localStorage !== 'undefined'; } catch { return false; } };

export function detectLocale() {
  try {
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('lang') : null;
    if (q && DICTS[q]) { if (hasStorage()) localStorage.setItem(STORAGE_KEY, q); return q; }
    const saved = hasStorage() ? localStorage.getItem(STORAGE_KEY) : null;
    if (saved && DICTS[saved]) return saved;
    const nav = (typeof navigator !== 'undefined' ? navigator.language || '' : '').slice(0, 2);
    if (DICTS[nav]) return nav;
  } catch { /* privaatne režiim või puuduv API */ }
  return 'et';
}

export const getLocale = () => locale;

export function setLocale(next) {
  if (!DICTS[next] || next === locale) return;
  locale = next;
  try { if (hasStorage()) localStorage.setItem(STORAGE_KEY, next); } catch { /* privaatne režiim */ }
  try { if (typeof document !== 'undefined') document.documentElement.lang = next; } catch { /* SSR */ }
  // Kui keel tuli ?lang= parameetriga, eemaldame selle, muidu naaseks reload'il vana keel.
  try {
    if (typeof location !== 'undefined' && location.search.includes('lang=')) {
      const u = new URL(location.href); u.searchParams.delete('lang'); history.replaceState({}, '', u);
    }
  } catch { /* ajaloo API puudub */ }
  for (const fn of listeners) fn(next);
}

export function initLocale() {
  locale = detectLocale();
  try { if (typeof document !== 'undefined') document.documentElement.lang = locale; } catch { /* SSR */ }
  return locale;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const lookup = (dict, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), dict);
const interpolate = (text, vars) => vars ? String(text).replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? m : String(vars[k]))) : String(text);

// t('nav.overview') → 'Kodu'; t('water.target', { temp: 60 }) → 'Tarbevee siht 60 °C'.
// Kui võti puudub, proovitakse eesti sõnastikku ja lõpuks tagastatakse võti ise.
export function t(key, vars) {
  let value = lookup(DICTS[locale], key);
  if (value == null) value = lookup(DICTS.et, key);
  if (value == null) {
    if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) console.warn(`[i18n] puudub võti: ${key}`);
    return key;
  }
  if (typeof value === 'object') {
    const count = Number(vars?.count ?? 0);
    const rule = new Intl.PluralRules(locale).select(count);
    value = value[rule] ?? value.other ?? value.one ?? '';
  }
  return interpolate(value, vars);
}

// Tõlkekate: mitu baaskeelse (eesti) sõnastiku võtit on selles keeles olemas.
export function localeCoverage(code) {
  const dict = DICTS[code];
  const base = dictKeys(DICTS.et);
  if (!dict) return { total: base.length, translated: 0, missing: base };
  const missing = base.filter(key => lookup(dict, key) == null);
  return { total: base.length, translated: base.length - missing.length, missing };
}

// Puuduvad tõlked koos eestikeelse lähtetekstiga – saab alla laadida ja tõlkijale saata.
export function missingTranslations(code) {
  const dict = DICTS[code] || {};
  const out = {};
  for (const key of dictKeys(DICTS.et)) if (lookup(dict, key) == null) out[key] = lookup(DICTS.et, key);
  return out;
}

// Sõnastiku võtmete loend (testidele ja puuduvate tõlgete kontrolliks).
export function dictKeys(dict, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(dict)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') out.push(...dictKeys(v, key));
    else out.push(key);
  }
  return out;
}
