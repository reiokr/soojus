import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { dailyEnergy, energyReport } from '../server/energy.js';

const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('dailyEnergy integrates power over time and computes COP', () => {
  const rows = [
    { time: '2026-01-01T00:00:00.000Z', power_ac: 2, power_heat: 6 },
    { time: '2026-01-01T01:00:00.000Z', power_ac: 2, power_heat: 6 },
    { time: '2026-01-01T02:00:00.000Z', power_ac: 2, power_heat: 6 }
  ];
  const report = dailyEnergy(rows, { from: '2026-01-01T00:00:00.000Z', to: '2026-01-01T02:00:00.000Z', maxGap: 3600 });
  assert.equal(report.days.length, 1);
  close(report.totals.electricKwh, 4);
  close(report.totals.heatKwh, 12);
  close(report.totals.cop, 3);
  close(report.totals.hours, 2);
});

test('dailyEnergy splits an interval at midnight between days', () => {
  const rows = [
    { time: '2026-01-01T23:30:00.000Z', power_ac: 1, power_heat: 3 },
    { time: '2026-01-02T00:30:00.000Z', power_ac: 1, power_heat: 3 }
  ];
  const report = dailyEnergy(rows, { from: '2026-01-01T00:00:00.000Z', to: '2026-01-02T00:30:00.000Z', maxGap: 3600 });
  const [first, second] = report.days;
  close(first.electricKwh, 0.5); close(first.heatKwh, 1.5);
  close(second.electricKwh, 0.5); close(second.heatKwh, 1.5);
  close(report.totals.electricKwh, 1); close(report.totals.heatKwh, 3);
});

test('dailyEnergy caps long measurement gaps but keeps compacted daily rows', () => {
  const gap = dailyEnergy([
    { time: '2026-01-01T00:00:00.000Z', power_ac: 2, power_heat: 6 },
    { time: '2026-01-01T06:00:00.000Z', power_ac: 2, power_heat: 6 }
  ], { from: '2026-01-01T00:00:00.000Z', to: '2026-01-01T06:00:00.000Z' });
  close(gap.days[0].electricKwh, 0.5); // 15 min × 2 kW
  close(gap.days[0].heatKwh, 1.5);

  const compacted = dailyEnergy([
    { time: '2026-01-01T00:00:00.000Z', power_ac: 2, power_heat: 6 }
  ], { from: '2026-01-01T00:00:00.000Z', to: '2026-01-01T23:59:59.000Z' });
  close(compacted.days[0].electricKwh, 48); // päevakeskmine × 24 h
  close(compacted.days[0].heatKwh, 144);
});

test('dailyEnergy handles heat-only fallback without inventing electricity', () => {
  const report = dailyEnergy([
    { time: '2026-01-01T00:00:00.000Z', power_heat: 5 },
    { time: '2026-01-01T01:00:00.000Z', power_heat: 5 }
  ], { from: '2026-01-01T00:00:00.000Z', to: '2026-01-01T01:00:00.000Z', maxGap: 3600 });
  close(report.totals.heatKwh, 5);
  assert.equal(report.totals.electricKwh, 0);
  assert.equal(report.totals.cop, null);
});

test('energyReport reads direct power values and outdoor temperature', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE samples (device TEXT, point TEXT, time TEXT, value REAL, label TEXT, unit TEXT, PRIMARY KEY(device,point,time))');
  const insert = db.prepare('INSERT INTO samples VALUES(?,?,?,?,?,?)');
  for (const t of ['2026-01-01T00:00:00.000Z', '2026-01-01T01:00:00.000Z']) {
    insert.run('luxtronik', 'power_ac', t, 2, 'Elektrivõimsus', 'kW');
    insert.run('luxtronik', 'power_heat', t, 6, 'Soojusvõimsus', 'kW');
    insert.run('pump', '5', t, -3, 'Välisõhutemperatuur', '°C');
  }
  const report = energyReport(db, { deviceId: 'pump', from: '2026-01-01T00:00:00.000Z', to: '2026-01-01T01:00:00.000Z', maxGap: 3600 });
  assert.equal(report.source, 'lux');
  assert.equal(report.electricKnown, true);
  close(report.totals.electricKwh, 2);
  close(report.totals.heatKwh, 6);
  close(report.totals.cop, 3);
  close(report.days[0].outdoor, -3);
});

test('energyReport falls back to myUplink heat output when the local interface is absent', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE samples (device TEXT, point TEXT, time TEXT, value REAL, label TEXT, unit TEXT, PRIMARY KEY(device,point,time))');
  const insert = db.prepare('INSERT INTO samples VALUES(?,?,?,?,?,?)');
  for (const t of ['2026-01-01T00:00:00.000Z', '2026-01-01T01:00:00.000Z']) insert.run('pump', '21', t, 4, 'Hetkevõimsus', 'kW');
  const report = energyReport(db, { deviceId: 'pump', from: '2026-01-01T00:00:00.000Z', to: '2026-01-01T01:00:00.000Z', maxGap: 3600 });
  assert.equal(report.source, 'uplink');
  assert.equal(report.electricKnown, false);
  close(report.totals.heatKwh, 4);
  assert.equal(report.totals.electricKwh, null);
  assert.equal(report.totals.cop, null);
});
