import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHeatingCurve } from '../server/heating-curve.js';
import { fitCurve } from '../src/next/curve-fit.js';

test('buildHeatingCurve bins target by outdoor and keeps only active compressor points in the scatter', () => {
  const rows = [
    { outdoor: 5, target: 30, return: 29, supply: 34, compressor: 1 },
    { outdoor: 5.2, target: 31, return: 30, supply: 35, compressor: 1 },
    { outdoor: 10, target: 27, return: 26, supply: 31, compressor: 0 },
    { outdoor: 10, target: 27, return: 26.5, supply: 31.5, compressor: 1 },
    { outdoor: 99, target: 20, return: 20, supply: 25, compressor: 1 },
    { outdoor: 5, target: 0, return: 29, supply: 34, compressor: 1 }
  ];
  const curve = buildHeatingCurve(rows);
  assert.equal(curve.points.length, 2);
  assert.deepEqual(curve.points[0].outdoor, 5);
  assert.equal(curve.points[0].target, 30.5);
  assert.equal(curve.points[1].target, 27);
  assert.equal(curve.count, 5);
  assert.equal(curve.scatter.length, 3);
});

test('fitCurve fits a quadratic through the target curve and predicts values', () => {
  const points = [];
  for (let x = -10; x <= 20; x += 1) points.push({ outdoor: x, target: 30 - 0.5 * x });
  const fit = fitCurve(points);
  assert.ok(fit);
  assert.ok(Math.abs(fit.predict(-10) - 35) < 1e-6);
  assert.ok(Math.abs(fit.predict(20) - 20) < 1e-6);
  assert.equal(fitCurve([{ outdoor: 1, target: 2 }]), null);
});
