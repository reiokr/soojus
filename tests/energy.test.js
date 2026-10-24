import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { dailyEnergy, energyReport } from '../server/energy.js';

const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
// Testid jooksevad Europe/Tallinn ajavööndis (vt package.json "test"), seega kohalikud ajad on deterministlikud.
const at = (year, month, day, hour = 0, minute = 0) => new Date(year, month - 1, day, hour, minute).toISOString();

test('dailyEnergy integrates power over time and computes COP', () => {
  const rows = [
    { time: at(2026, 1, 1, 0), power_ac: 2, power_heat: 6 },
    { time: at(2026, 1, 1, 1), power_ac: 2, power_heat: 6 },
    { time: at(2026, 1, 1, 2), power_ac: 2, power_heat: 6 }
  ];
  const report = dailyEnergy(rows, { from: at(2026, 1, 1, 0), to: at(2026, 1, 1, 2), maxGap: 3600 });
  assert.equal(report.days.length, 1);
  close(report.totals.electricKwh, 4);
  close(report.totals.heatKwh, 12);
  close(report.totals.cop, 3);
  close(report.totals.hours, 2);
});

test('dailyEnergy splits an interval at local midnight between days', () => {
  const rows = [
    { time: at(2026, 1, 1, 23, 30), power_ac: 1, power_heat: 3 },
    { time: at(2026, 1, 2, 0, 30), power_ac: 1, power_heat: 3 }
  ];
  const report = dailyEnergy(rows, { from: at(2026, 1, 1, 0), to: at(2026, 1, 2, 0, 30), maxGap: 3600 });
  const [first, second] = report.days;
  close(first.electricKwh, 0.5); close(first.heatKwh, 1.5);
  close(second.electricKwh, 0.5); close(second.heatKwh, 1.5);
  close(report.totals.electricKwh, 1); close(report.totals.heatKwh, 3);
});

test('dailyEnergy caps long measurement gaps but keeps compacted daily rows', () => {
  const gap = dailyEnergy([
    { time: at(2026, 1, 1, 0), power_ac: 2, power_heat: 6 },
    { time: at(2026, 1, 1, 6), power_ac: 2, power_heat: 6 }
  ], { from: at(2026, 1, 1, 0), to: at(2026, 1, 1, 6) });
  close(gap.days[0].electricKwh, 0.5); // 15 min × 2 kW
  close(gap.days[0].heatKwh, 1.5);

  // Kokkusurutud rida on salvestatud UTC keskööl (kohalikus ajas 02:00/03:00).
  const compacted = dailyEnergy([
    { time: new Date(Date.UTC(2025, 11, 31)).toISOString(), power_ac: 2, power_heat: 6 }
  ], { from: at(2025, 12, 31, 0), to: at(2026, 1, 1, 2) });
  // UTC keskööl salvestatud päevakeskmine katab kohalikus ajas 02:00 → järgmine 02:00,
  // seega jaguneb kahe kohaliku päeva vahel, aga kogusumma jääb 24 h peale.
  close(compacted.totals.electricKwh, 48);
  close(compacted.totals.heatKwh, 144);
  close(compacted.days[0].electricKwh, 44);
  close(compacted.days[1].electricKwh, 4);
  const byHour = compacted.days[0].electricByHour;
  assert.equal(byHour.length, 24);
  close(byHour[2], 2); close(byHour[23], 2); close(byHour[0], 0);
  close(byHour.reduce((sum, value) => sum + value, 0), 44);
});

test('dailyEnergy records electricity by local hour for tariff splits', () => {
  const report = dailyEnergy([
    { time: at(2026, 1, 1, 21, 30), power_ac: 1, power_heat: 3 },
    { time: at(2026, 1, 1, 23, 30), power_ac: 1, power_heat: 3 }
  ], { from: at(2026, 1, 1, 0), to: at(2026, 1, 1, 23, 30), maxGap: 7200 });
  const byHour = report.days[0].electricByHour;
  assert.equal(byHour.length, 24);
  close(byHour[21], 0.5);
  close(byHour[22], 1);
  close(byHour[23], 0.5);
  close(byHour.reduce((sum, value) => sum + value, 0), 2);
});

test('dailyEnergy handles heat-only fallback without inventing electricity', () => {
  const report = dailyEnergy([
    { time: at(2026, 1, 1, 0), power_heat: 5 },
    { time: at(2026, 1, 1, 1), power_heat: 5 }
  ], { from: at(2026, 1, 1, 0), to: at(2026, 1, 1, 1), maxGap: 3600 });
  close(report.totals.heatKwh, 5);
  assert.equal(report.totals.electricKwh, 0);
  assert.equal(report.totals.cop, null);
});

test('energyReport reads direct power values and outdoor temperature', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE samples (device TEXT, point TEXT, time TEXT, value REAL, label TEXT, unit TEXT, PRIMARY KEY(device,point,time))');
  const insert = db.prepare('INSERT INTO samples VALUES(?,?,?,?,?,?)');
  for (const time of [at(2026, 1, 1, 0), at(2026, 1, 1, 1)]) {
    insert.run('luxtronik', 'power_ac', time, 2, 'Elektrivõimsus', 'kW');
    insert.run('luxtronik', 'power_heat', time, 6, 'Soojusvõimsus', 'kW');
    insert.run('pump', '5', time, -3, 'Välisõhutemperatuur', '°C');
  }
  const report = energyReport(db, { deviceId: 'pump', from: at(2026, 1, 1, 0), to: at(2026, 1, 1, 1), maxGap: 3600 });
  assert.equal(report.source, 'lux');
  assert.equal(report.electricKnown, true);
  close(report.totals.electricKwh, 2);
  close(report.totals.heatKwh, 6);
  close(report.totals.cop, 3);
  close(report.days[0].outdoor, -3);
  assert.equal(report.days[0].day, '2026-01-01');
});

test('energyReport falls back to myUplink heat output when the local interface is absent', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE samples (device TEXT, point TEXT, time TEXT, value REAL, label TEXT, unit TEXT, PRIMARY KEY(device,point,time))');
  const insert = db.prepare('INSERT INTO samples VALUES(?,?,?,?,?,?)');
  for (const time of [at(2026, 1, 1, 0), at(2026, 1, 1, 1)]) insert.run('pump', '21', time, 4, 'Soojusvõimsus', 'kW');
  const report = energyReport(db, { deviceId: 'pump', from: at(2026, 1, 1, 0), to: at(2026, 1, 1, 1), maxGap: 3600 });
  assert.equal(report.source, 'uplink');
  assert.equal(report.electricKnown, false);
  close(report.totals.heatKwh, 4);
  assert.equal(report.totals.electricKwh, null);
  assert.equal(report.totals.cop, null);
});
