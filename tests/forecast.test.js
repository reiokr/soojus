import test from 'node:test';
import assert from 'node:assert/strict';
import { fitElectricModel, forecastMonth, predictDaily } from '../src/next/forecast.js';
import { DEFAULT_TARIFF } from '../src/next/tariff.js';

const pad = value => String(value).padStart(2, '0');
const day = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const at = (year, month, date, hour = 12) => new Date(year, month - 1, date, hour);

function historyUntil(end) {
  const rows = [];
  for (const cursor = new Date(2026, 8, 1); cursor < end; cursor.setDate(cursor.getDate() + 1)) {
    const outdoor = 5 + (cursor.getDate() % 10);
    rows.push({
      day: day(cursor), outdoor, electricKwh: 2 + 0.4 * Math.max(0, 15 - outdoor), coverage: 1,
      electricByHour: Array.from({ length: 24 }, (_, hour) => hour >= 22 || hour < 7 ? 0.1 : 0.2)
    });
  }
  return rows;
}

test('fits daily compressor electricity against heating degree days', () => {
  const rows = Array.from({ length: 12 }, (_, index) => {
    const outdoor = 20 - index;
    return { day: `2026-09-${pad(index + 1)}`, outdoor, electricKwh: 2 + 0.4 * Math.max(0, 15 - outdoor), coverage: 1 };
  });
  const model = fitElectricModel(rows);
  assert.ok(model);
  assert.ok(Math.abs(model.a - 2) < 1e-9);
  assert.ok(Math.abs(model.b - 0.4) < 1e-9);
  assert.ok(Math.abs(predictDaily(model, 10) - 4) < 1e-9);
});

test('forecasts the rest of the current month from history and weather', () => {
  const now = at(2026, 10, 15);
  const rows = historyUntil(now);
  const actual = rows.filter(row => row.day.startsWith('2026-10')).reduce((sum, row) => sum + row.electricKwh, 0);
  const result = forecastMonth({
    historyDays: rows,
    forecastDays: [
      { date: '2026-10-16', max: 10, min: 2 },
      { date: '2026-10-17', max: 8, min: 0 },
      { date: '2026-10-18', max: 6, min: -2 }
    ],
    tariff: { type: 'single', price: 0.2 },
    now
  });
  assert.equal(result.available, true);
  assert.equal(result.daysRemaining, 16);
  assert.equal(result.forecastDaysUsed, 3);
  assert.equal(result.climateDaysUsed, 13);
  assert.ok(Math.abs(result.actualKwh - actual) < 0.05);
  assert.ok(result.forecastKwh > 0);
  assert.ok(result.totalCost > result.actualCost);
  assert.ok(result.lowCost <= result.totalCost && result.totalCost <= result.highCost);
  assert.ok(Math.abs(result.model.a - 2) < 0.05);
  assert.ok(Math.abs(result.model.b - 0.4) < 0.02);
});

test('adds the full monthly fee once and handles missing electricity', () => {
  const now = at(2026, 10, 15);
  const rows = historyUntil(now);
  const withFee = forecastMonth({
    historyDays: rows,
    forecastDays: [],
    tariff: { ...DEFAULT_TARIFF, type: 'detail', includeMonthly: true },
    now
  });
  assert.equal(withFee.available, true);
  assert.ok(Math.abs(withFee.fixedCost - (8.34 + 1.54) * 1.24) < 0.01);
  assert.ok(withFee.totalCost >= withFee.fixedCost);

  const noElectric = forecastMonth({ historyDays: rows.map(row => ({ ...row, electricKwh: null })), forecastDays: [], tariff: { type: 'single', price: 0.2 }, now });
  assert.equal(noElectric.available, false);
  assert.equal(noElectric.reason, 'noElectric');
});

test('last day of the month returns actuals without a future forecast', () => {
  const now = at(2026, 10, 31);
  const rows = historyUntil(now);
  const result = forecastMonth({ historyDays: rows, forecastDays: [], tariff: { type: 'single', price: 0.2 }, now });
  assert.equal(result.available, true);
  assert.equal(result.daysRemaining, 0);
  assert.equal(result.forecastKwh, 0);
  assert.equal(result.totalCost, result.actualCost);
});

test('accounts for measurement gaps instead of treating them as zero consumption', () => {
  const now = at(2026, 10, 15);
  const rows = historyUntil(now);
  const partial = rows.map(row => row.day.startsWith('2026-10') ? { ...row, coverage: 0.5, electricKwh: row.electricKwh / 2 } : row);
  const full = forecastMonth({ historyDays: rows, forecastDays: [], tariff: { type: 'single', price: 0.2 }, now });
  const estimated = forecastMonth({ historyDays: partial, forecastDays: [], tariff: { type: 'single', price: 0.2 }, now });
  assert.equal(estimated.available, true);
  assert.ok(estimated.actualCoverage <= 0.51);
  assert.ok(estimated.imputedKwh > 0);
  assert.ok(Math.abs(estimated.actualKwh - full.actualKwh) < full.actualKwh * 0.2);
  assert.ok(Math.abs(estimated.actualCost - full.actualCost) < full.actualCost * 0.2);
  assert.equal(estimated.confident, false);
});

test('forecast cost uses the selected day and night tariff', () => {
  const now = at(2026, 10, 15);
  const rows = historyUntil(now);
  const result = forecastMonth({
    historyDays: rows,
    forecastDays: [],
    tariff: { type: 'dual', dayPrice: 0.30, nightPrice: 0.10, nightStart: 22, nightEnd: 7 },
    now
  });
  assert.equal(result.available, true);
  assert.ok(result.nightShare > 0 && result.nightShare < 1);
  const expectedRate = (1 - result.nightShare) * 0.30 + result.nightShare * 0.10;
  assert.ok(Math.abs(result.averageRate - expectedRate) < 0.0002);
  assert.ok(Math.abs(result.forecastCost - result.forecastKwh * result.averageRate) < 0.05);
});
