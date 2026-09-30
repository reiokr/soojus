import net from 'node:net';

// Airobot ventilatsiooniseadme Modbus TCP klient (register-kaart: Airobot VU Modbus spetsifikatsioon).
// Lugemine: FC01 (coil), FC03 (holding), FC04 (input). Kirjutamine: FC05 (coil), FC06 (register).
export class ModbusError extends Error {}

const FC = { coils: 1, holding: 3, input: 4, writeCoil: 5, writeRegister: 6 };

export class ModbusTcp {
  constructor({ host, port = 502, unit = 1, timeout = 4000 }) { Object.assign(this, { host, port, unit, timeout }); this.tid = 0; this.socket = null; this.pending = null; this.buffer = Buffer.alloc(0); }

  connect() {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: this.host, port: this.port });
      const timer = setTimeout(() => { socket.destroy(); reject(new ModbusError(`Ühendus aegus (${this.host}:${this.port}).`)); }, this.timeout);
      socket.once('connect', () => { clearTimeout(timer); this.socket = socket; resolve(); });
      socket.once('error', e => { clearTimeout(timer); reject(new ModbusError(`Ühendus ebaõnnestus: ${e.code || e.message}.`)); });
      socket.on('data', d => this.onData(d));
      socket.on('close', () => { if (this.pending) this.pending.reject(new ModbusError('Ühendus suleti.')); this.socket = null; });
    });
  }

  close() { this.socket?.destroy(); this.socket = null; }

  onData(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    while (this.buffer.length >= 7) {
      const length = this.buffer.readUInt16BE(4);
      if (this.buffer.length < 6 + length) return;
      const frame = this.buffer.subarray(0, 6 + length);
      this.buffer = this.buffer.subarray(6 + length);
      const p = this.pending;
      if (p && frame.readUInt16BE(0) === p.tid) { clearTimeout(p.timer); this.pending = null; p.resolve(frame); }
    }
  }

  request(fc, body) {
    if (!this.socket) return Promise.reject(new ModbusError('Pole ühendatud.'));
    if (this.pending) return Promise.reject(new ModbusError('Eelmine päring on pooleli.'));
    return new Promise((resolve, reject) => {
      this.tid = (this.tid + 1) & 0xffff;
      const pdu = Buffer.concat([Buffer.from([fc]), body]);
      const header = Buffer.alloc(7); header.writeUInt16BE(this.tid, 0); header.writeUInt16BE(0, 2); header.writeUInt16BE(pdu.length + 1, 4); header[6] = this.unit;
      const timer = setTimeout(() => { this.pending = null; reject(new ModbusError('Seade ei vastanud õigel ajal.')); }, this.timeout);
      this.pending = { tid: this.tid, resolve, reject, timer };
      this.socket.write(Buffer.concat([header, pdu]));
    }).then(frame => {
      const rfc = frame[7];
      if (rfc === (fc | 0x80)) throw new ModbusError(`Seade tagastas Modbus vea (kood ${frame[8]}).`);
      if (rfc !== fc) throw new ModbusError('Ootamatu Modbus vastus.');
      return frame.subarray(8);
    });
  }

  async readRegisters(kind, address, count) {
    const body = Buffer.alloc(4); body.writeUInt16BE(address, 0); body.writeUInt16BE(count, 2);
    const data = await this.request(FC[kind], body);
    if (data[0] !== count * 2) throw new ModbusError(`Vale registrite arv aadressil ${address}.`);
    return Array.from({ length: count }, (_, i) => data.readUInt16BE(1 + i * 2));
  }

  async readCoils(address, count) {
    const body = Buffer.alloc(4); body.writeUInt16BE(address, 0); body.writeUInt16BE(count, 2);
    const data = await this.request(FC.coils, body);
    return Array.from({ length: count }, (_, i) => Boolean((data[1 + (i >> 3)] >> (i & 7)) & 1));
  }

  async writeRegister(address, value) {
    const body = Buffer.alloc(4); body.writeUInt16BE(address, 0); body.writeUInt16BE(value & 0xffff, 2);
    await this.request(FC.writeRegister, body);
  }

  async writeCoil(address, on) {
    const body = Buffer.alloc(4); body.writeUInt16BE(address, 0); body.writeUInt16BE(on ? 0xff00 : 0, 2);
    await this.request(FC.writeCoil, body);
  }
}

const s16 = v => v >= 0x8000 ? v - 0x10000 : v;
const u32 = (regs, i) => regs[i + 1] * 65536 + regs[i];

export const MODES = { 1: 'Automaatne', 2: 'Manuaalne' };
export const MODE_TEXT = { auto: 'Automaatne', manual: 'Manuaalne', boost: 'Õhutus', overpressure: 'Ülerõhk' };

// Tegelik režiim: boost ja ülerõhk on eraldi lülitid, mis ajutiselt tähtsustavad automaat-/manuaalrežiimi.
export function effectiveMode(d) {
  if (d.switches.overpressure) return 'overpressure';
  if (d.switches.boost) return 'boost';
  return d.settings.mode === 2 ? 'manual' : 'auto';
}
export const ERROR_FLAGS = { 1: 'Tulekahjualarm', 2: 'Sissepuhke ventilaator', 4: 'Väljatõmbe ventilaator', 8: 'Andur 1', 16: 'Andur 2', 32: 'Andur 3', 64: 'Andur 4', 128: 'Andur 5', 256: 'CO₂ andur', 512: 'Küttekeha', 1024: 'Madal sissepuhe', 2048: 'Filter' };

export function decodeErrors(flags) {
  return Object.entries(ERROR_FLAGS).filter(([bit]) => flags & Number(bit)).map(([, label]) => label);
}

// Ainult kohtvõrgu IPv4 (10/8, 172.16/12, 192.168/16): Modbus-il pole autentimist ja server ei tohi avalikku aadressi pärida.
export function isPrivateIPv4(value) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(value));
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some(n => n > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export const AIROBOT_POINTS = [
  ['co2', 'CO₂', 'ppm', d => d.co2],
  ['supply_temp', 'Sissepuhke temperatuur', '°C', d => d.temperatures.supply],
  ['extract_temp', 'Väljatõmbe temperatuur', '°C', d => d.temperatures.extract],
  ['outside_temp', 'Välisõhu temperatuur (ventilatsioon)', '°C', d => d.temperatures.outside],
  ['exhaust_temp', 'Väljutusõhu temperatuur', '°C', d => d.temperatures.exhaust],
  ['supply_hum', 'Sissepuhke niiskus', '%', d => d.humidity.supply],
  ['extract_hum', 'Väljatõmbe niiskus', '%', d => d.humidity.extract],
  ['outside_hum', 'Välisõhu niiskus', '%', d => d.humidity.outside],
  ['voc', 'VOC indeks', '', d => d.voc],
  ['pm25', 'PM2,5', 'µg/m³', d => d.pm25],
  ['supply_rpm', 'Sissepuhke ventilaator', 'p/min', d => d.fans.supplyRpm],
  ['extract_rpm', 'Väljatõmbe ventilaator', 'p/min', d => d.fans.extractRpm],
  ['supply_flow', 'Sissepuhke õhuvool', 'm³/h', d => d.airflow.supply],
  ['extract_flow', 'Väljatõmbe õhuvool', 'm³/h', d => d.airflow.extract],
  ['heat_recovery', 'Soojustagastus', '%', d => d.heatRecovery]
];

export function airobotValues(data) {
  return AIROBOT_POINTS.map(([id, label, unit, get]) => ({ id, label, unit, value: get(data) })).filter(v => v.value != null && Number.isFinite(v.value));
}

// Loeb kõik sensorid, seaded ja lülitid. Valikulised andurid (lisatemperatuur, PM2,5) on null, kui neid pole.
export async function readAirobot(options) {
  const modbus = new ModbusTcp(options);
  await modbus.connect();
  try {
    const s1 = await modbus.readRegisters('input', 1000, 12), s2 = await modbus.readRegisters('input', 1014, 6);
    const s3 = await modbus.readRegisters('input', 1026, 4), s4 = await modbus.readRegisters('input', 1031, 4);
    const s5 = await modbus.readRegisters('input', 1051, 2);
    const r1 = await modbus.readRegisters('holding', 2000, 1), r2 = await modbus.readRegisters('holding', 2003, 6);
    const r3 = await modbus.readRegisters('holding', 2009, 6), r4 = await modbus.readRegisters('holding', 2015, 4);
    const c1 = await modbus.readCoils(4000, 7), c2 = await modbus.readCoils(4020, 1);
    // Valikulised lisasätted: kui seadme tarkvara mõnda ei tunne, jääb väärtus null ja ülejäänud lugemine jätkub.
    const optional = async fn => { try { return await fn(); } catch { return null; } };
    const c3 = await optional(() => modbus.readCoils(4027, 1)), c4 = await optional(() => modbus.readCoils(4030, 7));
    const v1 = await optional(() => modbus.readRegisters('holding', 2034, 1)), p1 = await optional(() => modbus.readRegisters('holding', 2064, 1));
    const t = i => s16(s1[i]) === 32767 ? null : s16(s1[i]) / 10, h = i => s16(s1[i]) === -1 ? null : s16(s1[i]) / 10;
    return {
      firmware: s1[0],
      temperatures: { extract: t(1), supply: t(2), outside: t(3), exhaust: t(4), extra: t(5) },
      humidity: { extract: h(6), supply: h(7), outside: h(8), exhaust: h(9), extra: h(10) },
      co2: s1[11], voc: s3[3], pm25: s4[0],
      fans: { supplyLevel: s2[0], extractLevel: s2[1], supplyRpm: s2[2], extractRpm: s2[3] },
      airflow: { supply: s5[0], extract: s5[1] },
      heatRecovery: s4[3], uptimeHours: u32(s2, 4) / 3600000, errorFlags: u32(s3, 0), serverConnected: Boolean(s3[2]),
      settings: { mode: r1[0], humiditySetpoint: r2[0] / 10, co2Setpoint: r2[1], manualFanLevel: r2[2], overpressureFanLevel: r2[4], boostTimeout: u32(r3, 1), overpressureTimeout: u32(r3, 3), filterInterval: r4[2], filterElapsed: r4[3], vocSetpoint: v1?.[0] ?? null, pmSetpoint: p1?.[0] ?? null },
      switches: { power: c1[0], bypass: c1[3], boost: c1[4], overpressure: c1[5], filterAlert: c2[0], humidityControl: c3?.[0] ?? null, vocControl: c4?.[0] ?? null, pmControl: c4?.[1] ?? null }
    };
  } finally { modbus.close(); }
}

export class ControlError extends Error {}
const int = (value, name, min, max) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new ControlError(`${name} peab olema täisarv ${min}–${max}.`);
  return n;
};

// Kontrollib juhtkäsu sisendi; seade ise ei kontrolli väärtusi alati, seega piirid tulevad spetsifikatsioonist.
export function parseControl(body) {
  const mode = body?.mode;
  if (!['auto', 'manual', 'boost', 'overpressure'].includes(mode)) throw new ControlError('Tundmatu režiim.');
  if (mode === 'auto') return { mode, co2Setpoint: body.co2Setpoint == null ? null : int(body.co2Setpoint, 'CO₂ piirmäär (ppm)', 450, 2000) };
  if (mode === 'manual') return { mode, fanLevel: int(body.fanLevel, 'Kiirus', 1, 10) };
  return { mode, minutes: int(body.minutes, 'Kestus (min)', 3, 60) };
}

// Kirjutab seadmesse. Eelmine ajutine režiim lülitatakse enne välja ja sätted kirjutatakse enne lülitit.
export async function applyControl(options, control) {
  const modbus = new ModbusTcp(options);
  await modbus.connect();
  try {
    const coils = await modbus.readCoils(4000, 7), boostOn = coils[4], overpressureOn = coils[5];
    const off = async (address, on) => { if (on) await modbus.writeCoil(address, false); };
    if (control.mode === 'auto') {
      await off(4004, boostOn); await off(4005, overpressureOn);
      if (control.co2Setpoint != null) await modbus.writeRegister(2004, control.co2Setpoint);
      await modbus.writeRegister(2000, 1);
    } else if (control.mode === 'manual') {
      await off(4004, boostOn); await off(4005, overpressureOn);
      await modbus.writeRegister(2005, control.fanLevel);
      await modbus.writeRegister(2000, 2);
    } else if (control.mode === 'boost') {
      await off(4005, overpressureOn);
      await modbus.writeRegister(2011, 0); await modbus.writeRegister(2010, control.minutes * 60);
      await modbus.writeCoil(4004, true);
    } else {
      await off(4004, boostOn);
      await modbus.writeRegister(2013, 0); await modbus.writeRegister(2012, control.minutes * 60);
      await modbus.writeCoil(4005, true);
    }
  } finally { modbus.close(); }
}

const SETTING_KEYS = new Set(['bypass', 'power', 'humidityControl', 'humiditySetpoint', 'vocControl', 'vocSetpoint', 'pmControl', 'pmSetpoint', 'overpressureFanLevel', 'filterInterval', 'resetFilter']);

// Lisasätted: iga väli on valikuline; tagastab järjestatud kirjutuste loendi [tüüp, aadress, väärtus].
export function parseSettings(body) {
  const b = body && typeof body === 'object' ? body : {}, writes = [];
  for (const key of Object.keys(b)) if (!SETTING_KEYS.has(key)) throw new ControlError(`Tundmatu säte: ${key}.`);
  const flag = (key, name, address) => { if (key in b) { if (typeof b[key] !== 'boolean') throw new ControlError(`${name} peab olema sees või väljas.`); writes.push(['coil', address, b[key]]); } };
  flag('bypass', 'Möödaviik', 4003); flag('power', 'Ventilatsioon', 4000);
  flag('humidityControl', 'Niiskuse juhtimine', 4027); flag('vocControl', 'VOC juhtimine', 4030); flag('pmControl', 'PM2,5 juhtimine', 4031);
  if ('humiditySetpoint' in b) {
    const n = Number(b.humiditySetpoint);
    if (!Number.isFinite(n) || n < 5 || n > 95) throw new ControlError('Niiskuse sihttase peab olema 5–95 %.');
    writes.push(['reg', 2003, Math.round(n * 10)]);
  }
  if ('vocSetpoint' in b) writes.push(['reg', 2034, int(b.vocSetpoint, 'VOC sihttase', 0, 500)]);
  if ('pmSetpoint' in b) writes.push(['reg', 2064, int(b.pmSetpoint, 'PM2,5 sihttase (µg/m³)', 0, 999)]);
  if ('overpressureFanLevel' in b) writes.push(['reg', 2007, int(b.overpressureFanLevel, 'Ülerõhu kiirus', 1, 10)]);
  if ('filterInterval' in b) writes.push(['reg', 2017, int(b.filterInterval, 'Filtri intervall (h)', 720, 8760)]);
  if (b.resetFilter === true) writes.push(['reg', 2018, 0]);
  else if ('resetFilter' in b) throw new ControlError('Filtri taimeri lähtestamiseks saada resetFilter: true.');
  if (!writes.length) throw new ControlError('Ühtegi muudatust ei valitud.');
  return writes;
}

export async function applySettings(options, writes) {
  const modbus = new ModbusTcp(options);
  await modbus.connect();
  try {
    for (const [kind, address, value] of writes) await (kind === 'coil' ? modbus.writeCoil(address, value) : modbus.writeRegister(address, value));
  } finally { modbus.close(); }
}
