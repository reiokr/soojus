import test from 'node:test';
import assert from 'node:assert/strict';
import { buildErrorReport, reportObservations } from '../src/next/error-report.js';

const data = {
  from: '2026-07-25T00:00:00.000Z', days: 90,
  params: [{ id: '21', label: 'Võimsus', unit: 'kW' }, { id: 'brine_in', label: 'Soojakandja maast', unit: '°C' }],
  codes: [{ code: 765, n: 2, last: '2026-10-17T20:45:10.000Z', name: 'Külmaaine ülekuumenemine liiga madal' }],
  errors: [{ time: '2026-10-17T20:45:10.000Z', code: 765, name: 'x', mode: 'Kütterežiim', ctx: { '21': 2, brine_in: 15 } }],
  compare: [{ code: 765, name: 'x', count: 2, last: '2026-10-17T20:45:10.000Z', params: { '21': { error: 2, base: 3.8, n: 2 }, brine_in: { error: 15, base: 10.8, n: 2 } } }],
  baseline: {}
};

test('error report contains the summary, context comparison, findings and error list', () => {
  const txt = buildErrorReport({ data, code: 765, device: { model: 'WZSV 92H3M', serial: '123', firmware: 'V3.92' }, now: new Date('2026-10-23T20:00:00Z') });
  assert.match(txt, /SOOJUSPUMPA VIGADE ANALÜÜS/);
  assert.match(txt, /WZSV 92H3M/);
  assert.match(txt, /765 × 2/);
  assert.match(txt, /VEA 765 KONTEKST/);
  assert.match(txt, /Võimsus/);
  assert.match(txt, /madalal koormusel/);
  assert.match(txt, /SOOVITUS:/);
  assert.match(txt, /VIGADE LOEND/);
  assert.match(txt, /METOODIKA/);
  assert.equal(buildErrorReport({ data: null }), '');
});

test('observations only mention clear differences', () => {
  assert.deepEqual(reportObservations({ params: { '21': { error: 3.7, base: 3.8, n: 2 } } }), []);
  const obs = reportObservations({ params: { '21': { error: 2, base: 3.8, n: 2 }, brine_in: { error: 15, base: 10.8, n: 2 } } });
  assert.equal(obs.length, 2);
  assert.match(obs[0], /madalal koormusel/);
  assert.match(obs[1], /soojem/);
});
