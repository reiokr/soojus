import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decodeLuxParameter, diffLuxParameterSnapshots, isSettingParameter, keyLuxParameters, localDate, saveLuxParameterSnapshot } from '../server/lux-parameters.js';

test('decodes the Luxtronik parameter types used by the settings snapshot', () => {
  assert.equal(decodeLuxParameter(2, 750).value, 75);          // Celsius
  assert.equal(decodeLuxParameter(74, 20).value, 2);           // Kelvin
  assert.equal(decodeLuxParameter(4, 0).value, 'Automatic');   // HotWaterMode
  assert.equal(decodeLuxParameter(35, 0).value, 0);            // Unknown (Einbindung)
  assert.equal(decodeLuxParameter(149, 640).value, 64);        // Unknown, but 0.1 °C scale
  assert.equal(decodeLuxParameter(107, 1234).value, '***');    // access code is never stored
  assert.equal(decodeLuxParameter(107, 1234).raw, null);
});

test('diffs only settings and ignores counters', () => {
  const before = {
    parameters: [
      { index: 35, name: 'ID_Einst_HREinb_akt', label: 'Einbindung', value: 0, raw: 0 },
      { index: 116, name: 'ID_Einst_AnlPrio_Hzakt', label: 'Prioriteet: küte', value: 2, raw: 2 },
      { index: 668, name: 'ID_Zaehler_BetrZeitWP', label: 'Töötunnid', value: 7163, raw: 7163 }
    ]
  };
  const after = {
    parameters: [
      { index: 35, name: 'ID_Einst_HREinb_akt', label: 'Einbindung', value: 1, raw: 1 },
      { index: 116, name: 'ID_Einst_AnlPrio_Hzakt', label: 'Prioriteet: küte', value: 2, raw: 2 },
      { index: 668, name: 'ID_Zaehler_BetrZeitWP', label: 'Töötunnid', value: 7164, raw: 7164 }
    ]
  };
  const changes = diffLuxParameterSnapshots(before, after);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].index, 35);
  assert.equal(changes[0].from, 0);
  assert.equal(changes[0].to, 1);
  assert.equal(isSettingParameter(after.parameters[0]), true);
  assert.equal(isSettingParameter(after.parameters[2]), false);
});

test('writes a daily snapshot and a change log without overwriting the daily baseline', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lux-params-'));
  const time = Date.parse('2026-11-15T10:00:00Z');
  const base = { time: new Date(time).toISOString(), host: '192.168.1.20', count: 2, parameters: [
    { index: 35, name: 'ID_Einst_HREinb_akt', label: 'Einbindung', value: 0, raw: 0 },
    { index: 116, name: 'ID_Einst_AnlPrio_Hzakt', label: 'Prioriteet: küte', value: 2, raw: 2 }
  ] };
  try {
    const first = saveLuxParameterSnapshot(base, dir);
    assert.equal(first.changes.length, 0);
    assert.equal(path.basename(first.file), '2026-11-15.json');
    const changed = { ...base, time: new Date(time + 3600000).toISOString(), parameters: base.parameters.map(p => p.index === 35 ? { ...p, value: 1, raw: 1 } : p) };
    const second = saveLuxParameterSnapshot(changed, dir);
    assert.equal(second.changes.length, 1);
    const daily = JSON.parse(readFileSync(path.join(dir, '2026-11-15.json'), 'utf8'));
    assert.equal(daily.parameters.find(p => p.index === 35).raw, 0); // hommikune algseis jääb alles
    const latest = JSON.parse(readFileSync(path.join(dir, 'latest.json'), 'utf8'));
    assert.equal(latest.parameters.find(p => p.index === 35).raw, 1);
    const log = JSON.parse(readFileSync(path.join(dir, 'changes-2026-11-15.json'), 'utf8'));
    assert.equal(log.length, 1);
    assert.equal(log[0].changes[0].index, 35);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('uses the Tallinn date for the daily file', () => {
  assert.equal(localDate(Date.parse('2026-11-15T22:30:00Z')), '2026-11-16');
  assert.equal(localDate(Date.parse('2026-11-15T21:30:00Z')), '2026-11-15');
});

test('exposes the key parameters used by the technician brief', () => {
  const snapshot = { parameters: [
    { index: 35, name: 'ID_Einst_HREinb_akt', label: 'Einbindung', value: 0, raw: 0 },
    { index: 117, name: 'ID_Einst_AnlPrio_Bwakt', label: 'Prioriteet: tarbevesi', value: 1, raw: 1 }
  ] };
  const key = keyLuxParameters(snapshot);
  assert.equal(key[35].value, 0);
  assert.equal(key[117].value, 1);
  assert.equal(key[116], null);
});
