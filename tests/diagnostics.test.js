import test from 'node:test';
import assert from 'node:assert/strict';
import { pumpState, stateSentence, systemDiagnostics } from '../src/next/logic.js';

test('diagnostics explain DHW heating without blaming the buffer or the return', () => {
  const state = pumpState({ workMode: { value: 1 }, heatingState: { value: 1 }, hwState: { value: 3 }, compressor: { value: 1 } });
  const items = systemDiagnostics({
    state, supply: 54.8, returnT: 48.7, returnTarget: 26.7, buffer: 31.3,
    water: 46.8, waterTarget: 48, power: 4.39,
    compressor: true, heatingPump: false, hotWaterPump: true
  });
  const keys = items.map(item => item.key);
  assert.ok(keys.includes('diag.dhwOn'));
  assert.ok(!keys.includes('diag.returnAboveTarget'), 'return is high during DHW heating and must not be flagged');
});

test('diagnostics report DHW demand while the compressor is off but the target is not reached', () => {
  const state = pumpState({ workMode: { value: 1 }, heatingState: { value: 1 }, hwState: { value: 3 }, compressor: { value: 0 }, water: { value: 45 }, waterTarget: { value: 48 } });
  const items = systemDiagnostics({
    state, supply: 51, returnT: 51.2, returnTarget: 29.5, buffer: 30,
    water: 45, waterTarget: 48, power: 0,
    compressor: false, heatingPump: true, hotWaterPump: true
  });
  const keys = items.map(item => item.key);
  assert.ok(keys.includes('diag.dhwDemand'));
});

test('a stopped compressor is not stalled when the DHW target is already reached', () => {
  const state = pumpState({
    workMode: { value: 1 }, heatingState: { value: 1 }, hwState: { value: 3 }, compressor: { value: 0 },
    water: { value: 49.1 }, waterTarget: { value: 48 }, returnT: { value: 47.7 }, returnTarget: { value: 29.5 }
  });
  const items = systemDiagnostics({
    state, supply: 51, returnT: 47.7, returnTarget: 29.5, buffer: 30,
    water: 49.1, waterTarget: 48, power: 0,
    compressor: false, heatingPump: true, hotWaterPump: true
  });
  const keys = items.map(item => item.key);
  assert.ok(!keys.includes('diag.stalled'));
  assert.ok(!keys.includes('diag.hwDemand'));
  assert.ok(keys.includes('diag.normal'));
  assert.match(stateSentence(state, true), /puhkab/);
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
