import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TARIFF } from '../src/next/tariff.js';
import { spotMap, dualCost, exchangeCost } from '../src/next/prices.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

const detail = {
  type: 'detail', energyPrice: 0.10398, networkDay: 0.0607, networkNight: 0.0351,
  security: 0.00758, excise: 0.0021, renewable: 0.0084, vat: 24,
  nightStart: 22, nightEnd: 7, monthlyNetwork: 8.34, monthlySeller: 1.54, includeMonthly: false
};

test('spotMap keys prices by local day and hour', () => {
  const map = spotMap([{ day: '2026-10-20', hour: 3, price: 0.05 }, { day: '2026-10-20', hour: 4, price: 0.06 }]);
  assert.equal(map.get('2026-10-20:3'), 0.05);
  assert.equal(map.get('2026-10-20:4'), 0.06);
  assert.equal(map.get('2026-10-20:5'), undefined);
});

test('dualCost splits consumption into day and night prices', () => {
  const byHour = Array(24).fill(0); byHour[12] = 8; byHour[2] = 2;
  const result = dualCost([{ electricKwh: 10, electricByHour: byHour }], 0.25, 0.10, 22, 7);
  close(result.cost, 8 * 0.25 + 2 * 0.10);
  close(result.kwh, 10);
});

test('exchangeCost adds spot, margin, network, fees and VAT per hour', () => {
  const byHour = Array(24).fill(0); byHour[12] = 10; byHour[2] = 5;
  const day = { electricKwh: 15, electricByHour: byHour };
  const spot = new Map([['2026-10-20:12', 0.05], ['2026-10-20:2', 0.05]]);
  const result = exchangeCost([{ ...day, day: '2026-10-20' }], spot, detail, 0.01);
  const dayPrice = (0.05 + 0.01 + 0.0607 + 0.00758 + 0.0021 + 0.0084) * 1.24;
  const nightPrice = (0.05 + 0.01 + 0.0351 + 0.00758 + 0.0021 + 0.0084) * 1.24;
  close(result.cost, 10 * dayPrice + 5 * nightPrice);
  close(result.covered, 15);
  close(result.coverage, 1);
  close(result.average, result.cost / 15);
});

test('exchangeCost reports missing spot hours instead of guessing', () => {
  const byHour = Array(24).fill(0); byHour[12] = 10; byHour[13] = 10;
  const spot = new Map([['2026-10-20:12', 0.05]]);
  const result = exchangeCost([{ day: '2026-10-20', electricKwh: 20, electricByHour: byHour }], spot, detail, 0);
  close(result.covered, 10);
  close(result.missing, 10);
  close(result.coverage, 0.5);
});

test('exchangeCost falls back to the default V2 components for non-detail packages', () => {
  const byHour = Array(24).fill(0); byHour[12] = 1;
  const spot = new Map([['2026-10-20:12', 0.05]]);
  const result = exchangeCost([{ day: '2026-10-20', electricKwh: 1, electricByHour: byHour }], spot, { type: 'single', price: 0.19 }, 0);
  const expected = (0.05 + DEFAULT_TARIFF.networkDay + DEFAULT_TARIFF.security + DEFAULT_TARIFF.excise + DEFAULT_TARIFF.renewable) * 1.24;
  close(result.cost, expected);
});
