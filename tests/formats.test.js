import test from 'node:test';
import assert from 'node:assert/strict';
import { setFormat, tempUnit, toDisplayTemp, fromDisplayTemp } from '../src/formats.js';
import { tempText, time, date, enhance } from '../src/lib.js';
import { setLocale } from '../src/i18n/index.js';

test('temperature unit converts displayed values, sentences and edit deltas', () => {
  setLocale('et');
  try {
    assert.equal(tempUnit(), '°C');
    assert.equal(tempText(21.5), '21,5 °C');
    setFormat('temp', 'f');
    assert.equal(tempUnit(), '°F');
    assert.equal(toDisplayTemp(0), 32);
    assert.equal(fromDisplayTemp(212), 100);
    assert.equal(tempText(0), '32 °F');

    // Punktid hoiavad API väärtust °C-s ja kuvavad teisendatud dv/du.
    const [p] = enhance([{ parameterId: '6', parameterName: 'Tarbevesi', value: 45, parameterUnit: '°C' }], '');
    assert.equal(p.value, 45);
    assert.equal(p.dv, 113);
    assert.equal(p.du, '°F');
    assert.equal(p.display, '113 °F');

    // 5001 on temperatuurinihe (vahe), mida ei nihutata 32° võrra.
    const [d] = enhance([{ parameterId: '5001', parameterName: 'Kütte temperatuurinihe', value: -0.5, parameterUnit: '°C' }], 'WZSV 92H3M');
    assert.equal(d.dv, -0.5);
    assert.equal(d.du, '°C');
  } finally {
    setFormat('temp', 'c');
  }
});

test('clock and date formats follow the chosen options', () => {
  setLocale('et');
  try {
    setFormat('clock', '12');
    assert.match(time('2026-11-06T19:15:00Z'), /PM/);
    setFormat('clock', '24');
    assert.equal(time('2026-11-06T19:15:00Z'), '21:15');

    setFormat('date', 'iso');
    assert.match(date('2026-11-06T19:15:00Z'), /^2026-11-06 21:15$/);
    setFormat('date', 'locale');
    assert.match(date('2026-11-06T19:15:00Z'), /^06\.11\.2026/);
  } finally {
    setFormat('clock', '24');
    setFormat('date', 'locale');
  }
});
