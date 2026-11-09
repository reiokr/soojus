import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecentWrites } from '../server/recent-writes.js';

const points = [
  { parameterId: '5001', value: -0.5 },
  { parameterId: '5003', value: 0, enumValues: [{ value: 0, text: 'Auto' }, { value: 1, text: 'Käsitsi' }] },
  { parameterId: '5700', value: 15 }
];

test('värske kirjutus asendab vana väärtuse kohe', () => {
  const writes = createRecentWrites();
  writes.record('dev', { 5001: '-1' });
  const shown = writes.apply('dev', points);
  assert.equal(shown.find(p => p.parameterId === '5001').value, -1);
  assert.equal(shown.find(p => p.parameterId === '5700').value, 15);
  assert.equal(points[0].value, -0.5, 'sisendit ei muudeta kohapeal');
});

test('ülekate kaob, kui seade kinnitab sama väärtuse', () => {
  const writes = createRecentWrites();
  writes.record('dev', { 5001: '-1' });
  const upstream = points.map(p => p.parameterId === '5001' ? { ...p, value: -1 } : p);
  const shown = writes.apply('dev', upstream);
  assert.equal(shown.find(p => p.parameterId === '5001').value, -1);
  assert.equal(writes.get('dev', '5001'), undefined, 'kinnitus kustutab ülekatte');
});

test('enum-väärtus teisendatakse õnnestunud kirjutusest õigesse tüüpi', () => {
  const writes = createRecentWrites();
  writes.record('dev', { 5003: '1' });
  const shown = writes.apply('dev', points);
  assert.equal(shown.find(p => p.parameterId === '5003').value, 1);
});

test('aegunud ülekate ei jää igavesti ette', () => {
  let now = 1000;
  const writes = createRecentWrites({ ttlMs: 5000 });
  writes.record('dev', { 5001: '-1' }, now);
  assert.equal(writes.get('dev', '5001', now + 4000), '-1');
  assert.equal(writes.get('dev', '5001', now + 5001), undefined);
  const shown = writes.apply('dev', points, now + 5001);
  assert.equal(shown.find(p => p.parameterId === '5001').value, -0.5);
});

test('tundmatu seade ja tühi loend ei viska viga', () => {
  const writes = createRecentWrites();
  assert.deepEqual(writes.apply('dev', points), points);
  assert.equal(writes.apply('dev', null), null);
  assert.equal(writes.get('dev', '5001'), undefined);
});
