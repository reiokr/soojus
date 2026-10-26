import test from 'node:test';
import assert from 'node:assert/strict';
import { pumpState, systemDiagnostics } from '../src/next/logic.js';

test('diagnostics explain DHW heating with a stagnant buffer sensor above target', () => {
  const state = pumpState({ workMode: { value: 1 }, heatingState: { value: 1 }, hwState: { value: 3 }, compressor: { value: 1 } });
  const items = systemDiagnostics({
    state, supply: 54.8, returnT: 48.7, returnTarget: 26.7, buffer: 31.3,
    water: 46.8, waterTarget: 48, power: 4.39,
    compressor: true, heatingPump: false, hotWaterPump: true
  });
  const keys = items.map(item => item.key);
  assert.ok(keys.includes('diag.dhwOn'));
  assert.ok(keys.includes('diag.bufferStagnant'));
  assert.ok(keys.includes('diag.bufferAboveTarget'));
  assert.ok(!keys.includes('diag.returnAboveTarget'), 'return is high during DHW heating and must not be flagged');
});

test('diagnostics flag a heating-mode compressor with the heating pump off', () => {
  const state = pumpState({ workMode: { value: 0 }, heatingState: { value: 3 }, hwState: { value: 0 }, compressor: { value: 1 } });
  const items = systemDiagnostics({
    state, supply: 41.9, returnT: 37.7, returnTarget: 27.7, buffer: 29.3,
    water: 45.3, waterTarget: 48, power: 2.59,
    compressor: true, heatingPump: false, hotWaterPump: false
  });
  const keys = items.map(item => item.key);
  assert.ok(keys.includes('diag.compressorNoHeatingPump'));
  assert.ok(keys.includes('diag.returnAboveTarget'));
});
