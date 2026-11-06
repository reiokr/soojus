// Vormingueelistused: kellaaeg (24/12), temperatuuriühik (°C/°F) ja kuupäeva järjekord.
// Hoitakse brauseri localStorage'is ja jagatakse kogu rakendusele; muudatus jõustub kohe.
const KEYS = { clock: 'soojus.clock', temp: 'soojus.temp', date: 'soojus.date' };
export const FORMAT_CHOICES = {
  clock: ['24', '12'],
  temp: ['c', 'f'],
  date: ['locale', 'iso']
};
const DEFAULTS = { clock: '24', temp: 'c', date: 'locale' };
const listeners = new Set();
const hasStorage = () => { try { return typeof localStorage !== 'undefined'; } catch { return false; } };

function load() {
  const out = { ...DEFAULTS };
  if (!hasStorage()) return out;
  for (const [key, storageKey] of Object.entries(KEYS)) {
    try { const value = localStorage.getItem(storageKey); if (FORMAT_CHOICES[key].includes(value)) out[key] = value; } catch { /* privaatne režiim */ }
  }
  return out;
}
let formats = load();

export const getFormats = () => formats;
export function setFormat(key, value) {
  if (!FORMAT_CHOICES[key]?.includes(value) || formats[key] === value) return;
  formats = { ...formats, [key]: value };
  try { if (hasStorage()) localStorage.setItem(KEYS[key], value); } catch { /* privaatne režiim */ }
  for (const fn of listeners) fn(formats);
}
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export const hour12 = () => formats.clock === '12';
export const isFahrenheit = () => formats.temp === 'f';
export const tempUnit = () => isFahrenheit() ? '°F' : '°C';
// Kõik temperatuurid on rakenduses ja API-s Celsiuse kraadides; ühik muudetakse alles kuvamisel.
export const toDisplayTemp = value => value == null || value === '' || !Number.isFinite(Number(value)) ? value : isFahrenheit() ? Number(value) * 9 / 5 + 32 : Number(value);
export const fromDisplayTemp = value => value == null || value === '' || !Number.isFinite(Number(value)) ? value : isFahrenheit() ? (Number(value) - 32) * 5 / 9 : Number(value);
export const displayUnit = unit => unit === '°C' ? tempUnit() : unit;
// Samm ja vahemik on temperatuurierinevused, mis skaleeruvad 9/5, mitte nihkega.
export const toDisplayStep = step => step == null || !Number.isFinite(Number(step)) ? step : isFahrenheit() ? Number(step) * 9 / 5 : Number(step);
