import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TARIFF, parseTariff, nightHours, splitElectric, effectiveRates, dayCost, monthlyCost, totalCost } from '../src/next/tariff.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('night hours wrap over midnight and handle day-only windows', () => {
  assert.deepEqual(nightHours(22, 7), [22, 23, 0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(nightHours(7, 22), [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
  assert.deepEqual(nightHours(0, 0), []);
});

test('parseTariff validates type, prices and hours', () => {
  assert.deepEqual(parseTariff(null), { ...DEFAULT_TARIFF });
  const parsed = parseTariff({ type: 'dual', price: -1, dayPrice: '0.25', nightPrice: 0.1, nightStart: 23, nightEnd: 99 });
  assert.equal(parsed.type, 'dual');
  assert.equal(parsed.dayPrice, 0.25);
  assert.equal(parsed.nightPrice, 0.1);
  assert.equal(parsed.nightStart, 23);
  assert.equal(parsed.nightEnd, DEFAULT_TARIFF.nightEnd);
  assert.equal(parseTariff({ type: 'weird' }).type, 'single');
});

test('splitElectric uses hourly buckets and falls back to a proportional split', () => {
  const byHour = Array(24).fill(0);
  byHour[23] = 1; byHour[10] = 2; byHour[3] = 0.5;
  const split = splitElectric({ electricKwh: 3.5, electricByHour: byHour }, 22, 7);
  close(split.nightKwh, 1.5);
  close(split.dayKwh, 2);
  const fallback = splitElectric({ electricKwh: 24 }, 22, 7);
  close(fallback.nightKwh, 9);
  close(fallback.dayKwh, 15);
});

test('dayCost and totalCost support single and dual tariffs', () => {
  const single = { type: 'single', price: 0.2 };
  close(dayCost({ electricKwh: 10 }, single), 2);
  const dual = { type: 'dual', dayPrice: 0.25, nightPrice: 0.1, nightStart: 22, nightEnd: 7 };
  const byHour = Array(24).fill(0);
  byHour[12] = 8; byHour[2] = 2;
  close(dayCost({ electricKwh: 10, electricByHour: byHour }, dual), 2.2);
  close(totalCost([{ electricKwh: 10, electricByHour: byHour }, { electricKwh: null }], dual), 2.2);
  assert.equal(dayCost({ electricKwh: null }, dual), null);
});

test('detail tariff derives the real day/night price from the bill components', () => {
  const detail = {
    type: 'detail', energyPrice: 0.10398, networkDay: 0.0607, networkNight: 0.0351,
    security: 0.00758, excise: 0.0021, renewable: 0.0084, vat: 24,
    nightStart: 22, nightEnd: 7, monthlyNetwork: 8.34, monthlySeller: 1.54, includeMonthly: false
  };
  const rates = effectiveRates(detail);
  close(rates.day, 0.2266224);   // (0.10398 + 0.0607 + 0.00758 + 0.0021 + 0.0084) × 1.24
  close(rates.night, 0.1948784); // (0.10398 + 0.0351 + 0.00758 + 0.0021 + 0.0084) × 1.24
  close(rates.fixedMonthly, 0);

  const withFee = { ...detail, includeMonthly: true };
  close(effectiveRates(withFee).fixedMonthly, 12.2512); // (8.34 + 1.54) × 1.24
  close(monthlyCost(withFee, 30.44), 12.2512);
  close(monthlyCost(withFee, 15.22), 6.1256);
  close(monthlyCost(detail, 30), 0);

  const byHour = Array(24).fill(0); byHour[12] = 8; byHour[2] = 2;
  close(dayCost({ electricKwh: 10, electricByHour: byHour }, detail), 8 * 0.2266224 + 2 * 0.1948784);
  close(totalCost([{ electricKwh: 10, electricByHour: byHour }], withFee, 30.44), 8 * 0.2266224 + 2 * 0.1948784 + 12.2512);
});
