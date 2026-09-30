import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { readAirobot, airobotValues, isPrivateIPv4, decodeErrors, ModbusTcp, effectiveMode, parseControl, applyControl, ControlError } from '../server/airobot.js';

function fakeUnit({ input = {}, holding = {}, coils = {}, exceptionFor = null } = {}) {
  const writes = [];
  const server = net.createServer(socket => {
    socket.on('data', buf => {
      const tid = buf.readUInt16BE(0), unit = buf[6], fc = buf[7], addr = buf.readUInt16BE(8), val = buf.readUInt16BE(10);
      const reply = pdu => { const h = Buffer.alloc(7); h.writeUInt16BE(tid, 0); h.writeUInt16BE(pdu.length + 1, 4); h[6] = unit; socket.write(Buffer.concat([h, pdu])); };
      if (exceptionFor === fc) return reply(Buffer.from([fc | 0x80, 2]));
      if (fc === 3 || fc === 4) { const src = fc === 3 ? holding : input, out = Buffer.alloc(2 + val * 2); out[0] = fc; out[1] = val * 2; for (let i = 0; i < val; i++) out.writeUInt16BE((src[addr + i] ?? 0) & 0xffff, 2 + i * 2); return reply(out); }
      if (fc === 1) { const out = Buffer.alloc(2 + Math.ceil(val / 8)); out[0] = 1; out[1] = Math.ceil(val / 8); for (let i = 0; i < val; i++) if (coils[addr + i]) out[2 + (i >> 3)] |= 1 << (i & 7); return reply(out); }
      if (fc === 5 || fc === 6) { writes.push([fc, addr, val]); return reply(buf.subarray(7, 12)); }
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, writes, close: () => server.close() })));
}

const registers = {
  input: { 1000: 544, 1001: 230, 1002: 212, 1003: 156, 1004: 32767, 1005: 32767, 1006: 543, 1007: 537, 1008: 711, 1009: 0xffff, 1010: 0xffff, 1011: 520,
    1014: 3, 1015: 3, 1016: 263, 1017: 189, 1018: 0x5678, 1019: 0x0001, 1026: 2048 | 2, 1027: 0, 1028: 1, 1029: 12, 1031: 5, 1034: 82, 1051: 100, 1052: 95 },
  holding: { 2000: 1, 2003: 600, 2004: 800, 2005: 3, 2007: 5, 2010: 1800, 2012: 900, 2017: 8760, 2018: 6462 },
  coils: { 4000: true, 4004: true, 4020: true }
};

test('reads and decodes an Airobot unit over Modbus TCP', async () => {
  const unit = await fakeUnit(registers);
  try {
    const d = await readAirobot({ host: '127.0.0.1', port: unit.port });
    assert.equal(d.temperatures.extract, 23); assert.equal(d.temperatures.supply, 21.2); assert.equal(d.temperatures.outside, 15.6);
    assert.equal(d.temperatures.exhaust, null); assert.equal(d.temperatures.extra, null);
    assert.equal(d.humidity.extract, 54.3); assert.equal(d.humidity.exhaust, null);
    assert.equal(d.co2, 520); assert.equal(d.voc, 12); assert.equal(d.pm25, 5);
    assert.deepEqual(d.fans, { supplyLevel: 3, extractLevel: 3, supplyRpm: 263, extractRpm: 189 });
    assert.deepEqual(d.airflow, { supply: 100, extract: 95 });
    assert.equal(d.heatRecovery, 82); assert.equal(d.errorFlags, 2050);
    assert.deepEqual(decodeErrors(d.errorFlags), ['Sissepuhke ventilaator', 'Filter']);
    assert.equal(d.settings.mode, 1); assert.equal(d.settings.humiditySetpoint, 60); assert.equal(d.settings.co2Setpoint, 800);
    assert.equal(d.settings.filterInterval, 8760); assert.equal(d.settings.filterElapsed, 6462);
    assert.deepEqual(d.switches, { power: true, bypass: false, boost: true, overpressure: false, filterAlert: true, humidityControl: false, vocControl: false, pmControl: false });
    assert.equal(d.uptimeHours, (1 * 65536 + 0x5678) / 3600000);
    const ids = airobotValues(d).map(v => v.id);
    assert.ok(ids.includes('co2') && ids.includes('supply_temp')); assert.ok(!ids.includes('exhaust_temp')); assert.ok(ids.includes('outside_hum'));
    assert.equal(unit.writes.length, 0, 'lugemine ei tohi midagi kirjutada');
  } finally { unit.close(); }
});

test('Modbus exception and refused connection become readable errors', async () => {
  const unit = await fakeUnit({ ...registers, exceptionFor: 4 });
  try { await assert.rejects(readAirobot({ host: '127.0.0.1', port: unit.port }), /Modbus vea/); } finally { unit.close(); }
  await assert.rejects(readAirobot({ host: '127.0.0.1', port: 1, timeout: 500 }), /Ühendus ebaõnnestus|aegus/);
});

test('writes use function codes 5 and 6 with the standard payload', async () => {
  const unit = await fakeUnit(registers), modbus = new ModbusTcp({ host: '127.0.0.1', port: unit.port });
  try {
    await modbus.connect(); await modbus.writeCoil(4004, true); await modbus.writeRegister(2005, 7);
    assert.deepEqual(unit.writes, [[5, 4004, 0xff00], [6, 2005, 7]]);
  } finally { modbus.close(); unit.close(); }
});

test('only private IPv4 addresses are accepted', () => {
  for (const ok of ['192.168.100.2', '10.0.0.5', '172.16.4.1', '172.31.255.1']) assert.equal(isPrivateIPv4(ok), true, ok);
  for (const bad of ['8.8.8.8', '127.0.0.1', '172.32.0.1', '192.169.1.1', '192.168.1.256', 'localhost', '192.168.1', '', '192.168.1.1:502', 'http://192.168.1.1']) assert.equal(isPrivateIPv4(bad), false, bad);
});

test('effective mode prefers overpressure, then boost, then the working mode', () => {
  const d = (mode, boost, overpressure) => ({ settings: { mode }, switches: { boost, overpressure } });
  assert.equal(effectiveMode(d(1, false, false)), 'auto'); assert.equal(effectiveMode(d(2, false, false)), 'manual');
  assert.equal(effectiveMode(d(1, true, false)), 'boost'); assert.equal(effectiveMode(d(2, true, true)), 'overpressure');
});

test('control input is validated against the device limits', () => {
  assert.deepEqual(parseControl({ mode: 'auto', co2Setpoint: 900 }), { mode: 'auto', co2Setpoint: 900 });
  assert.deepEqual(parseControl({ mode: 'auto' }), { mode: 'auto', co2Setpoint: null });
  assert.deepEqual(parseControl({ mode: 'manual', fanLevel: '4' }), { mode: 'manual', fanLevel: 4 });
  assert.deepEqual(parseControl({ mode: 'boost', minutes: 20 }), { mode: 'boost', minutes: 20 });
  for (const bad of [{ mode: 'turbo' }, { mode: 'auto', co2Setpoint: 300 }, { mode: 'auto', co2Setpoint: 2500 }, { mode: 'manual', fanLevel: 0 }, { mode: 'manual', fanLevel: 11 }, { mode: 'manual', fanLevel: 2.5 }, { mode: 'manual' }, { mode: 'boost', minutes: 2 }, { mode: 'overpressure', minutes: 61 }, { mode: 'boost', minutes: 'abc' }, null])
    assert.throws(() => parseControl(bad), ControlError, JSON.stringify(bad));
});

test('each mode writes settings first, clears the other temporary mode and sets the switch last', async () => {
  const run = async (control, coils) => {
    const unit = await fakeUnit({ ...registers, coils });
    try { await applyControl({ host: '127.0.0.1', port: unit.port }, control); return unit.writes; } finally { unit.close(); }
  };
  assert.deepEqual(await run({ mode: 'auto', co2Setpoint: 900 }, { 4004: true, 4005: true }), [[5, 4004, 0], [5, 4005, 0], [6, 2004, 900], [6, 2000, 1]]);
  assert.deepEqual(await run({ mode: 'auto', co2Setpoint: null }, {}), [[6, 2000, 1]]);
  assert.deepEqual(await run({ mode: 'manual', fanLevel: 6 }, { 4005: true }), [[5, 4005, 0], [6, 2005, 6], [6, 2000, 2]]);
  assert.deepEqual(await run({ mode: 'boost', minutes: 20 }, { 4005: true }), [[5, 4005, 0], [6, 2011, 0], [6, 2010, 1200], [5, 4004, 0xff00]]);
  assert.deepEqual(await run({ mode: 'overpressure', minutes: 5 }, { 4004: true }), [[5, 4004, 0], [6, 2013, 0], [6, 2012, 300], [5, 4005, 0xff00]]);
});

import { parseSettings, applySettings } from '../server/airobot.js';

test('extra settings are validated and mapped to the documented coils and registers', () => {
  assert.deepEqual(parseSettings({ bypass: true }), [['coil', 4003, true]]);
  assert.deepEqual(parseSettings({ bypass: false, power: true, humidityControl: true, vocControl: false, pmControl: true }), [['coil', 4003, false], ['coil', 4000, true], ['coil', 4027, true], ['coil', 4030, false], ['coil', 4031, true]]);
  assert.deepEqual(parseSettings({ humiditySetpoint: 47.5, vocSetpoint: 120, pmSetpoint: 25, overpressureFanLevel: 7, filterInterval: 4380 }), [['reg', 2003, 475], ['reg', 2034, 120], ['reg', 2064, 25], ['reg', 2007, 7], ['reg', 2017, 4380]]);
  assert.deepEqual(parseSettings({ resetFilter: true }), [['reg', 2018, 0]]);
  for (const bad of [{}, null, { bypass: 'yes' }, { power: 1 }, { humiditySetpoint: 4 }, { humiditySetpoint: 96 }, { vocSetpoint: 501 }, { pmSetpoint: -1 }, { overpressureFanLevel: 0 }, { filterInterval: 100 }, { filterInterval: 9000 }, { resetFilter: false }, { reboot: true }, { bypass: true, unknown: 1 }])
    assert.throws(() => parseSettings(bad), ControlError, JSON.stringify(bad));
});

test('settings are written in the given order and unknown optional registers do not break reading', async () => {
  const unit = await fakeUnit({ ...registers, exceptionFor: null });
  try {
    await applySettings({ host: '127.0.0.1', port: unit.port }, parseSettings({ humiditySetpoint: 50, humidityControl: true, bypass: true }));
    assert.deepEqual(unit.writes, [[5, 4003, 0xff00], [5, 4027, 0xff00], [6, 2003, 500]]);
  } finally { unit.close(); }
});

test('reading reports the extra switches and setpoints', async () => {
  const unit = await fakeUnit({ ...registers, holding: { ...registers.holding, 2034: 150, 2064: 30 }, coils: { ...registers.coils, 4003: true, 4027: true, 4031: true } });
  try {
    const d = await readAirobot({ host: '127.0.0.1', port: unit.port });
    assert.equal(d.switches.bypass, true); assert.equal(d.switches.humidityControl, true); assert.equal(d.switches.vocControl, false); assert.equal(d.switches.pmControl, true);
    assert.equal(d.settings.vocSetpoint, 150); assert.equal(d.settings.pmSetpoint, 30);
  } finally { unit.close(); }
});
