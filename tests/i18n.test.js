import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { t, setLocale, getLocale, dictKeys, LOCALES, DICTS, localeCoverage, missingTranslations } from '../src/i18n/index.js';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const sourceFiles = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : /\.(js|jsx)$/.test(entry.name) ? [join(dir, entry.name)] : []);
const hasKey = (dict, key) => key.split('.').reduce((node, part) => node == null ? undefined : node[part], dict) != null;

test('every locale has exactly the same keys as Estonian', () => {
  const base = dictKeys(DICTS.et).sort();
  for (const [code] of LOCALES) assert.deepEqual(dictKeys(DICTS[code]).sort(), base, `keys differ for ${code}`);
});

test('t translates, interpolates, pluralises and falls back to the key', () => {
  setLocale('et');
  assert.equal(t('nav.overview'), 'Kodu');
  assert.equal(t('common.minutesShort', { count: 30 }), '30 min');
  assert.equal(t('common.weeks', { count: 1 }), '1 nädal');
  assert.equal(t('common.weeks', { count: 4 }), '4 nädalat');
  setLocale('en');
  assert.equal(t('nav.overview'), 'Home');
  assert.equal(t('shell.online'), 'Online');
  assert.equal(t('common.weeks', { count: 1 }), '1 week');
  assert.equal(t('common.weeks', { count: 2 }), '2 weeks');
  assert.equal(t('missing.key'), 'missing.key');
  assert.equal(t('nav.overview', { unused: 1 }), 'Home');
  setLocale('et');
});

test('unknown locale is ignored', () => {
  setLocale('et');
  setLocale('xx');
  assert.equal(getLocale(), 'et');
});

test('coverage shows complete dictionaries and lists missing keys for unknown locales', () => {
  const en = localeCoverage('en');
  assert.equal(en.total, en.translated);
  assert.deepEqual(en.missing, []);
  const none = localeCoverage('xx');
  assert.equal(none.translated, 0);
  assert.equal(none.missing.length, none.total);
  assert.equal(Object.keys(missingTranslations('xx')).length, none.total);
});

test('every literal translation key used in the UI exists in every locale', () => {
  // Dünaamilised võtmed (nt t('nav.' + page) või mallikeeled) jäävad siit välja – neid katavad tüübistikontrollid ja käsitsi audit.
  const pattern = /\b(?:t|tr)\(\s*['"]([^'"]+)['"]\s*[,)]/g, keys = new Set();
  for (const file of sourceFiles(SRC).filter(file => !file.includes('/i18n/'))) {
    for (const match of readFileSync(file, 'utf8').matchAll(pattern)) keys.add(match[1]);
  }
  assert.ok(keys.size > 100, `expected to find translation keys, found ${keys.size}`);
  const missing = [];
  for (const key of keys) for (const [code] of LOCALES) if (!hasKey(DICTS[code], key)) missing.push(`${code}: ${key}`);
  assert.deepEqual(missing, []);
});
