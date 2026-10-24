import test from 'node:test';
import assert from 'node:assert/strict';
import { ANALYSIS_PARAMS, MODE_NAMES, errorWindow, mean } from '../server/analysis.js';

test('error context window looks at 35 to 5 minutes before the error', () => {
  const w = errorWindow('2026-10-17T20:45:10.000Z');
  assert.equal(w.from, '2026-10-17T20:10:10.000Z');
  assert.equal(w.to, '2026-10-17T20:40:10.000Z');
  assert.equal(errorWindow('pole-aeg'), null);
  assert.equal(errorWindow(null), null);
});

test('mean ignores missing values and returns null when there is nothing to average', () => {
  assert.equal(mean([1, 2, 3]), 2);
  assert.equal(mean([1, null, 3]), 2);
  assert.equal(mean([]), null);
  assert.equal(mean([null, undefined]), null);
});

test('analysis parameters and mode names cover the diagnostics we store', () => {
  const ids = ANALYSIS_PARAMS.map(p => p[0]);
  for (const id of ['brine_in', 'brine_spread', 'suction_comp', 'pressure_low', 'pressure_high', 'hot_gas', '21', '5', '6']) assert.ok(ids.includes(id), id);
  assert.equal(MODE_NAMES[1], 'Soe tarbevesi');
  assert.equal(MODE_NAMES[5], 'Puudub vajadus');
});
