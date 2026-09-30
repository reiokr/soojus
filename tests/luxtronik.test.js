import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { readLuxtronik, readLuxCalculations, decodeLuxtronik, luxValues, LuxtronikError } from '../server/luxtronik.js';

function values(over = {}) {
  const v = Array(275).fill(0);
  Object.assign(v, { 10: 248, 11: 241, 12: 243, 13: 240, 14: 367, 15: 141, 16: 147, 17: 445, 18: 450, 19: 191, 20: 185, 31: 1, 33: 1, 35: 1, 39: 0, 43: 1, 44: 1, 57: 4006 }, over);
  return v;
}
function fake({ vals = values(), status = 0, cmd = 3004, count = vals.length, chunks = 1, silent = false } = {}) {
  const received = [];
  const server = net.createServer(socket => {
    socket.on('data', d => {
      received.push(d);
      if (silent) return;
      const body = Buffer.alloc(12 + vals.length * 4); body.writeInt32BE(cmd, 0); body.writeInt32BE(status, 4); body.writeInt32BE(count, 8);
      vals.forEach((x, i) => body.writeInt32BE(x, 12 + i * 4));
      const size = Math.ceil(body.length / chunks);
      for (let i = 0; i < body.length; i += size) setTimeout(() => socket.write(body.subarray(i, i + size)), (i / size) * 5);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, received, close: () => server.close() })));
}

test('reads calculations with the read-only command and decodes temperatures and states', async () => {
  const dev = await fake({ chunks: 4 });
  try {
    const d = await readLuxtronik({ host: '127.0.0.1', port: dev.port });
    assert.deepEqual(d.temperatures, { flow: 24.8, return: 24.1, returnSet: 24.3, buffer: 24, hotGas: 36.7, outdoor: 14.1, outdoorAverage: 14.7, hotWater: 44.5, hotWaterSet: 45, brineIn: 19.1, brineOut: 18.5 });
    assert.deepEqual(d.inputs, { evu: true, motorProtection: true, brineFlow: true });
    assert.deepEqual(d.outputs, { hotWaterPump: false, heatingPump: false, brinePump: true, compressor: true });
    assert.equal(d.compressorImpulses, 4006);
    assert.equal(dev.received.length, 1); assert.equal(dev.received[0].length, 8);
    assert.equal(dev.received[0].readInt32BE(0), 3004, 'ainult lugemiskäsk 3004');
    assert.equal(dev.received[0].readInt32BE(4), 0);
  } finally { dev.close(); }
});

test('missing sensors become null and are not stored', () => {
  const d = decodeLuxtronik(values({ 19: -2000, 20: 2000, 14: 32767 }));
  assert.equal(d.temperatures.brineIn, null); assert.equal(d.temperatures.brineOut, null); assert.equal(d.temperatures.hotGas, null);
  const ids = luxValues(d).map(v => v.id);
  assert.deepEqual(ids, ['suction_comp', 'pressure_high', 'pressure_low', 'brine_spread', 'brine_spread_set', 'power_ac', 'power_heat'], 'temperatuurid puuduvad, diagnostika ja võimsus (0) on kehtivad väärtused');
  assert.deepEqual(luxValues(decodeLuxtronik(values())).map(v => [v.id, v.value]), [['brine_in', 19.1], ['brine_out', 18.5], ['hot_gas', 36.7], ['suction_comp', 0], ['pressure_high', 0], ['pressure_low', 0], ['brine_spread', 0], ['brine_spread_set', 0], ['power_ac', 0], ['power_heat', 0]]);
  assert.equal(decodeLuxtronik(values({ 19: -25 })).temperatures.brineIn, -2.5, 'miinuskraadid sobivad');
});

test('unexpected devices and failures give readable errors', async () => {
  for (const [opts, pattern] of [[{ cmd: 1234 }, /ei paista olevat Luxtronik/], [{ status: 7 }, /keeldus/], [{ vals: [1, 2, 3], count: 3 }, /ootamatu pikkusega/]]) {
    const dev = await fake(opts);
    try { await assert.rejects(readLuxCalculations({ host: '127.0.0.1', port: dev.port, timeout: 1500 }), pattern); } finally { dev.close(); }
  }
  const quiet = await fake({ silent: true });
  try { await assert.rejects(readLuxCalculations({ host: '127.0.0.1', port: quiet.port, timeout: 300 }), LuxtronikError); } finally { quiet.close(); }
  await assert.rejects(readLuxCalculations({ host: '127.0.0.1', port: 1, timeout: 500 }), /Ühendus ebaõnnestus|ei vastanud/);
});

import { errorName, overlayDirect, verifyMapping, isUsable, LUX_MAP, votePower, updatePowerChoice } from '../server/luxtronik.js';

const direct = decodeLuxtronik(values());
const upstream = () => [
  { parameterId: '0', parameterName: 'Pealev.', value: 24.7, strVal: '24.7°C', parameterUnit: '°C', timestamp: 'old' }, { parameterId: '1', value: 24.1, parameterUnit: '°C', timestamp: 'old' },
  { parameterId: '2', value: 24.3, parameterUnit: '°C', timestamp: 'old' }, { parameterId: '3', value: 24, parameterUnit: '°C', timestamp: 'old' },
  { parameterId: '5', value: 14.1, parameterUnit: '°C', timestamp: 'old' }, { parameterId: '6', value: 44.5, parameterUnit: '°C', timestamp: 'old' },
  { parameterId: '70', value: 0, strVal: 'Väljas', enumValues: [{ value: '0', text: 'Väljas' }, { value: '1', text: 'Sees' }], timestamp: 'old' },
  { parameterId: '21', value: 0, strVal: '0kW', parameterUnit: 'kW', timestamp: 'old' }, { parameterId: '5001', value: 0, writable: true, parameterUnit: '°C', timestamp: 'old' }
];

test('direct values overwrite only the verified parameters and mark them', () => {
  const { points, overlaid } = overlayDirect(upstream(), direct, '2026-09-30T19:00:00.000Z');
  const by = id => points.find(p => p.parameterId === id);
  assert.equal(overlaid, 7);
  assert.equal(by('0').value, 24.8); assert.equal(by('0').strVal, '24.8°C'); assert.equal(by('0').source, 'direct'); assert.equal(by('0').timestamp, '2026-09-30T19:00:00.000Z'); assert.equal(by('0').parameterName, 'Pealev.');
  assert.equal(by('70').value, 1); assert.equal(by('70').strVal, 'Sees', 'enum-tekst tuleb myUplinki metaandmetest');
  assert.equal(by('21').timestamp, 'old'); assert.equal(by('21').source, undefined, 'võimsust ei kirjutata üle');
  assert.equal(by('5001').value, 0, 'muudetavaid seadeid ei kirjutata üle');
  assert.equal(upstream()[0].value, 24.7, 'sisend jääb muutmata');
  const missing = overlayDirect(upstream(), decodeLuxtronik(values({ 10: 32767 })), 'x');
  assert.equal(missing.points.find(p => p.parameterId === '0').value, 24.7, 'andurita väärtus jätab myUplinki väärtuse');
  assert.equal(overlayDirect([{ parameterId: '0', value: 5, parameterUnit: '°F' }], direct, 'x').overlaid, 0, 'võõras ühik jäetakse');
  assert.ok(LUX_MAP.every(([id]) => typeof id === 'string'));
});

test('mapping is verified against myUplink before direct data is trusted', () => {
  const ok = verifyMapping(upstream(), direct);
  assert.equal(ok.ok, true); assert.ok(ok.checked >= 5);
  const shifted = decodeLuxtronik(values({ 10: 550, 11: 600, 12: 400, 13: 80, 15: 380, 17: 100 }));
  assert.equal(verifyMapping(upstream(), shifted).ok, false, 'valed väljad lükatakse tagasi');
  const oneTransient = decodeLuxtronik(values({ 10: 520 }));
  assert.equal(verifyMapping(upstream(), oneTransient).ok, true, 'üks kiire muutus ei keela allikat');
  assert.equal(verifyMapping([{ parameterId: '0', value: 24 }], direct).ok, null, 'liiga vähe võrreldavat');
  assert.equal(verifyMapping([], direct).ok, null);
});

test('direct data counts as usable only while fresh and not refuted', () => {
  const now = 1_000_000;
  assert.equal(isUsable({ data: {}, readAt: now - 60000, verified: null }, now), true);
  assert.equal(isUsable({ data: {}, readAt: now - 60000, verified: true }, now), true);
  assert.equal(isUsable({ data: {}, readAt: now - 200000, verified: true }, now), false, 'liiga vana');
  assert.equal(isUsable({ data: {}, readAt: now - 1000, verified: false }, now), false, 'ümber lükatud');
  assert.equal(isUsable({ data: null, readAt: now }, now), false);
  assert.equal(isUsable(null, now), false);
});

const running = (ac, heat) => decodeLuxtronik(values({ 44: 1, 268: ac, 257: heat }));
const up21 = kw => [{ parameterId: '21', value: kw, parameterUnit: 'kW', strVal: `${kw}kW` }];

test('power is decoded from watts and impossible values are dropped', () => {
  assert.deepEqual(running(2310, 9450).power, { acInput: 2.31, heatOutput: 9.45 });
  assert.equal(decodeLuxtronik(values({ 268: -5 })).power.acInput, null);
  assert.equal(decodeLuxtronik(values({ 268: 99999 })).power.acInput, null);
});

test('the power source is chosen by comparing with myUplink while the compressor runs', () => {
  const d = running(3480, 9450);
  assert.equal(votePower(up21(3.51), d), 'acInput');
  assert.equal(votePower(up21(9.3), d), 'heatOutput');
  assert.equal(votePower(up21(6), d), null, 'kumbki ei klapi');
  assert.equal(votePower(up21(3.51), decodeLuxtronik(values({ 44: 0, 268: 3510 }))), null, 'kompressor seisab');
  assert.equal(votePower(up21(0.1), running(100, 100)), null, 'liiga väike võrdlemiseks');
  assert.equal(votePower(up21(3.4), running(3300, 3500)), null, 'mõlemad klapivad: hääl puudub');
  const state = { source: null, votes: { acInput: 0, heatOutput: 0 }, strikes: 0 };
  for (let i = 0; i < 2; i++) updatePowerChoice(state, 'acInput', up21(3.5), d);
  assert.equal(state.source, null, '2 häält ei piisa');
  updatePowerChoice(state, 'acInput', up21(3.5), d); assert.equal(state.source, 'acInput');
  const split = { source: null, votes: { acInput: 2, heatOutput: 0 }, strikes: 0 };
  updatePowerChoice(split, 'heatOutput', up21(9), d); updatePowerChoice(split, 'acInput', up21(3.5), d);
  assert.equal(split.source, null, 'vastuhääl takistab valiku');
  for (let i = 0; i < 5; i++) updatePowerChoice(state, null, up21(9.0), d);
  assert.equal(state.source, null, '5 eksimust järjest lükkab valiku tagasi'); assert.equal(state.votes.acInput, 0);
  const recovering = { source: 'acInput', votes: { acInput: 3, heatOutput: 0 }, strikes: 3 };
  updatePowerChoice(recovering, null, up21(3.5), d); assert.equal(recovering.strikes, 0, 'õige väärtus nullib eksimused');
});

test('direct power replaces the myUplink value only after a source has been confirmed', () => {
  const d = running(3480, 9450), points = [{ parameterId: '21', value: 3.51, strVal: '3.51kW', parameterUnit: 'kW', timestamp: 'old' }];
  const off = overlayDirect(points, d, 'now').points[0];
  assert.equal(off.value, 3.51); assert.equal(off.source, undefined, 'kinnitamata allikas ei kirjuta üle');
  const on = overlayDirect(points, d, 'now', { powerSource: 'acInput' }).points[0];
  assert.equal(on.value, 3.48); assert.equal(on.strVal, '3.48kW'); assert.equal(on.source, 'direct'); assert.equal(on.timestamp, 'now');
  const idle = overlayDirect(points, decodeLuxtronik(values({ 268: 0 })), 'now', { powerSource: 'acInput' }).points[0];
  assert.equal(idle.value, 0, 'seisev pump näitab kohe 0 kW');
  assert.equal(overlayDirect(points, decodeLuxtronik(values({ 268: 99999 })), 'now', { powerSource: 'acInput' }).points[0].value, 3.51, 'võimatu väärtus jätab myUplinki numbri');
});

test('pump diagnostics and the error memory are decoded', () => {
  const t0 = Date.parse('2026-09-30T17:32:00Z') / 1000;
  const d = decodeLuxtronik(values({ 176: 239, 180: 1140, 181: 500, 240: 15, 239: 48, 95: t0, 100: 765, 96: t0 - 172800, 101: 765, 97: 0, 102: 0, 98: 0, 103: 0 }));
  assert.deepEqual(d.diagnostics, { suctionCompressor: 23.9, highPressure: 11.4, lowPressure: 5, spread: 1.5, spreadSet: 4.8 });
  assert.deepEqual(d.errors, [{ code: 765, time: '2026-09-30T17:32:00.000Z' }, { code: 765, time: '2026-09-28T17:32:00.000Z' }], 'tühjad kirjed jäetakse välja');
  assert.deepEqual(decodeLuxtronik(values({ 100: 765, 95: 0 })).errors, [], 'kood ilma ajata ei ole kehtiv kirje');
  assert.equal(decodeLuxtronik(values({ 180: -1 })).diagnostics.highPressure, null);
  assert.match(errorName(765), /ülekuumenemine/); assert.equal(errorName(999), 'Veakood 999');
});
