import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDhwCycles } from '../server/dhw-cycles.js';

const base = Date.UTC(2026, 9, 25, 8, 0);
const iso = minutes => new Date(base + minutes * 60000).toISOString();
const row = (minutes, water, { hw = 3, mode = 1, compressor = 1, target = 48, power = 4.5 } = {}) => ({ time: iso(minutes), water, target, hw, mode, compressor, power });

test('groups heating, pauses and target completion into DHW cycles', () => {
  const rows = [];
  for (let i = 0; i < 10; i++) rows.push(row(i, 44 + i * 0.4));
  for (let i = 10; i < 14; i++) rows.push(row(i, 48, { hw: 1, mode: 5, compressor: 0 }));
  for (let i = 0; i < 8; i++) rows.push(row(60 + i, 46 - i * 0.8));
  for (let i = 0; i < 13; i++) rows.push(row(68 + i, 39 - i * 0.04, { hw: 1, mode: 5, compressor: 0 }));
  for (let i = 0; i < 5; i++) rows.push(row(81 + i, 38.5 + i * 0.5));
  const last = iso(85);
  const result = buildDhwCycles(rows, { now: Date.parse(last) });
  assert.equal(result.cycles.length, 2);
  const first = result.cycles[0], second = result.cycles[1];
  assert.equal(first.reachedTarget, true);
  assert.equal(first.stopReason, 'target');
  assert.equal(first.pauseCount, 0);
  assert.equal(second.reachedTarget, false);
  assert.equal(second.ongoing, true);
  assert.equal(second.pauseCount, 1);
  assert.ok(second.pauseMinutes >= 12);
  assert.ok(second.heatingMinutes >= 12);
  assert.ok(second.minTemp < 40);
  assert.equal(result.summary.count, 2);
  assert.equal(result.summary.reached, 1);
  assert.equal(result.summary.ongoing, 1);
  assert.deepEqual(second.segments.map(segment => segment.type), ['heat', 'pause', 'heat']);
});

test('splits a new cycle after a long gap or a long pause', () => {
  const rows = [];
  for (let i = 0; i < 5; i++) rows.push(row(i, 44 + i * 0.5));
  for (let i = 0; i < 50; i++) rows.push(row(5 + i, 46, { hw: 1, mode: 5, compressor: 0 }));
  for (let i = 0; i < 5; i++) rows.push(row(55 + i, 44 + i));
  const result = buildDhwCycles(rows, { now: Date.parse(iso(59)) });
  assert.equal(result.cycles.length, 2);
  assert.equal(result.cycles[0].stopReason, 'pause');
  assert.equal(result.cycles[1].startTemp, 44);
});

test('returns an empty summary without measurements', () => {
  assert.deepEqual(buildDhwCycles([]), { cycles: [], summary: { count: 0, reached: 0, ongoing: 0, avgDurationMinutes: null, avgPauseMinutes: null, totalPauseMinutes: 0 } });
});
