import { test } from 'node:test';
import assert from 'node:assert/strict';
import { date, enhance } from '../src/lib.js';

test('chart timestamps render as dates instead of raw Unix milliseconds',()=>{
  const ms = Date.parse('2026-09-24T10:00:00Z');
  assert.match(date(ms),/24\.09\.2026/);
  assert.equal(date('2026-09-24T10:00:00+0'),date('2026-09-24T10:00:00Z'));
});
test('WZSV water sensor is never presented as indoor air temperature',()=>{
  const [p] = enhance([{parameterId:'6',parameterName:'Tarbevesi- on',value:45,parameterUnit:'°C',scaleValue:'0.1',smartHomeCategories:['sh-hwTemp','sh-indoorTemp']}],'WZSV 92H3M');
  assert.equal(p.group,'Tarbevesi'); assert.equal(p.label,'Tarbevee temperatuur');
});
