import net from 'node:net';

// Alpha Innotec / Luxtronik 2.x juhtimise kohtvõrguliides (TCP 8889, binaarprotokoll).
// Kasutame AINULT lugemiskäsku 3004 ("calculations"). Kirjutamiskäske (3002/3003) ei implementeerita.
// Väljade järjekord on kogukonna dokumentatsioonist (python-luxtronik); esimesed väljad (10–18) on seadmega
// võrreldes kinnitatud myUplinki väärtustega, soojakandja väljad (19, 20) järgivad sama järjestust.
export class LuxtronikError extends Error {}

const READ_CALCULATIONS = 3004;

export function readLuxCalculations({ host, port = 8889, timeout = 6000 }) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let buf = Buffer.alloc(0), done = false;
    const finish = (fn, value) => { if (done) return; done = true; clearTimeout(timer); socket.destroy(); fn(value); };
    const timer = setTimeout(() => finish(reject, new LuxtronikError('Soojuspump ei vastanud õigel ajal.')), timeout);
    socket.on('connect', () => { const req = Buffer.alloc(8); req.writeInt32BE(READ_CALCULATIONS, 0); req.writeInt32BE(0, 4); socket.write(req); });
    socket.on('error', e => finish(reject, new LuxtronikError(`Ühendus ebaõnnestus: ${e.code || e.message}.`)));
    socket.on('close', () => finish(reject, new LuxtronikError('Ühendus suleti enne vastust.')));
    socket.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 12) return;
      const cmd = buf.readInt32BE(0), status = buf.readInt32BE(4), count = buf.readInt32BE(8);
      if (cmd !== READ_CALCULATIONS) return finish(reject, new LuxtronikError('Ootamatu vastus (see ei paista olevat Luxtronik).'));
      if (status !== 0) return finish(reject, new LuxtronikError(`Seade keeldus vastamast (olek ${status}).`));
      if (count < 60 || count > 2000) return finish(reject, new LuxtronikError('Vastus oli ootamatu pikkusega.'));
      if (buf.length < 12 + count * 4) return;
      finish(resolve, Array.from({ length: count }, (_, i) => buf.readInt32BE(12 + i * 4)));
    });
  });
}

// Võimsus vattides -> kW; vigane või võimatu väärtus on null.
const watts = v => Number.isInteger(v) && v >= 0 && v < 60000 ? v / 1000 : null;
const bar = v => Number.isInteger(v) && v >= 0 && v < 6000 ? v / 100 : null;
const kelvin = v => Number.isInteger(v) && v > -500 && v < 1500 ? v / 10 : null;
// Temperatuur kümnendikkraadides; andurita või vigane väärtus on null.
const temp = v => Number.isInteger(v) && v > -500 && v < 1500 ? v / 10 : null;

export function decodeLuxtronik(v) {
  const inp = i => v[i] === 1;
  return {
    temperatures: {
      flow: temp(v[10]), return: temp(v[11]), returnSet: temp(v[12]), buffer: temp(v[13]), hotGas: temp(v[14]), outdoor: temp(v[15]), outdoorAverage: temp(v[16]),
      hotWater: temp(v[17]), hotWaterSet: temp(v[18]), brineIn: temp(v[19]), brineOut: temp(v[20])
    },
    inputs: { evu: inp(31), motorProtection: inp(33), brineFlow: inp(35) },
    outputs: { hotWaterPump: inp(38), heatingPump: inp(39), brinePump: inp(43), compressor: inp(44) },
    compressorImpulses: Number.isInteger(v[57]) ? v[57] : null,
    // Võimsused vattides (indeksid 268 ja 257 kogukonna definitsioonist); kumb vastab myUplinki "Hetkevõimsusele", selgub võrdlusest (votePower).
    power: { acInput: watts(v[268]), heatOutput: watts(v[257]) },
    // Külmaaine- ja soojakandjaringi diagnostika (vea 765 "ülekuumenemine" uurimiseks): imemistemperatuur, rõhud, soojakandja vahe ja selle siht
    diagnostics: { suctionCompressor: temp(v[176]), highPressure: bar(v[180]), lowPressure: bar(v[181]), spread: kelvin(v[240]), spreadSet: kelvin(v[239]) },
    // Pumba enda vigade mälu (5 viimast); aeg on sekundites, nagu väljalülituste logis
    errors: [0, 1, 2, 3, 4].map(i => ({ code: v[100 + i], time: v[95 + i] })).filter(e => Number.isInteger(e.code) && e.code > 0 && Number.isInteger(e.time) && e.time > 1e9).map(e => ({ code: e.code, time: new Date(e.time * 1000).toISOString() }))
  };
}

export async function readLuxtronik(options) { return decodeLuxtronik(await readLuxCalculations(options)); }

export const LUX_ID = 'luxtronik';
export const LUX_POINTS = [
  ['brine_in', 'Soojakandja maast (sisse pumpa)', '°C', d => d.temperatures.brineIn],
  ['brine_out', 'Soojakandja maasse (pumbast välja)', '°C', d => d.temperatures.brineOut],
  ['hot_gas', 'Kuumgaas', '°C', d => d.temperatures.hotGas],
  ['suction_comp', 'Imemistemperatuur kompressorisse', '°C', d => d.diagnostics.suctionCompressor],
  ['pressure_high', 'Kõrgrõhk', 'bar', d => d.diagnostics.highPressure],
  ['pressure_low', 'Madalrõhk', 'bar', d => d.diagnostics.lowPressure],
  ['brine_spread', 'Soojakandja temperatuuride vahe', 'K', d => d.diagnostics.spread],
  ['brine_spread_set', 'Soojakandja vahe siht', 'K', d => d.diagnostics.spreadSet],
  ['power_ac', 'Elektrivõimsus (pump otse)', 'kW', d => d.power.acInput],
  ['power_heat', 'Soojusvõimsus (pump otse)', 'kW', d => d.power.heatOutput]
];
export function luxValues(data) {
  return LUX_POINTS.map(([id, label, unit, get]) => ({ id, label, unit, value: get(data) })).filter(v => v.value != null && Number.isFinite(v.value));
}

// ---- Otseandmed myUplinki näitude asemel -------------------------------------------------------------
// Järgmised myUplinki parameetrid on pumba enda väärtustega kontrollitud (samal ajal loetud väärtused klappisid):
// pealevool, tagasivool, tagasivoolu siht, akupaak, välisõhk, välisõhu keskmine, tarbevesi ja selle siht, kompressor, impulsid.
// Ülejäänud näidud (võimsus, tööaeg, häired, seaded jne) tulevad edasi myUplinkist.
export const LUX_MAP = [
  ['0', 'temp', d => d.temperatures.flow], ['1', 'temp', d => d.temperatures.return], ['2', 'temp', d => d.temperatures.returnSet],
  ['3', 'temp', d => d.temperatures.buffer], ['5', 'temp', d => d.temperatures.outdoor], ['39', 'temp', d => d.temperatures.outdoorAverage],
  ['6', 'temp', d => d.temperatures.hotWater], ['40010', 'temp', d => d.temperatures.hotWater], ['7', 'temp', d => d.temperatures.hotWaterSet],
  ['70', 'state', d => d.outputs.compressor ? 1 : 0], ['5674', 'count', d => d.compressorImpulses]
];
const MAP = new Map(LUX_MAP.map(([id, kind, get]) => [id, { kind, get }]));

export function overlayDirect(points, data, timestamp, { powerSource = null } = {}) {
  let overlaid = 0;
  const merged = points.map(p => {
    const id = String(p.parameterId);
    // Võimsus (21) kirjutatakse üle ainult siis, kui võrdlus myUplinkiga on õige näiduveeru kinnitanud.
    const m = id === '21' && powerSource ? { kind: 'power', get: d => d.power?.[powerSource] } : MAP.get(id);
    const v = m?.get(data);
    if (!m || v == null || !Number.isFinite(v)) return p;
    if (m.kind === 'temp' && p.parameterUnit && p.parameterUnit !== '°C') return p;
    overlaid++;
    const text = m.kind === 'power' ? `${Number(v.toFixed(3))}kW` : m.kind === 'state' ? (p.enumValues?.find(e => String(e.value) === String(v))?.text ?? (v ? 'Sees' : 'Väljas')) : m.kind === 'temp' ? `${v}°C` : String(v);
    return { ...p, value: v, strVal: text, timestamp, source: 'direct' };
  });
  return { points: merged, overlaid };
}

// Kontroll enne usaldamist: vähemalt 75% temperatuuridest peab klappima myUplinki omadega (±3 °C, myUplink võib olla minuti vana).
// null tähendab, et võrdlust ei saa teha (liiga vähe andmeid), siis otseandmeid ei keelata.
export function verifyMapping(points, data) {
  let checked = 0, agree = 0;
  for (const p of points) {
    const m = MAP.get(String(p.parameterId));
    if (!m || m.kind !== 'temp') continue;
    const a = Number(p.value), b = m.get(data);
    if (!Number.isFinite(a) || b == null || !Number.isFinite(b)) continue;
    checked++; if (Math.abs(a - b) <= 3) agree++;
  }
  return { checked, agree, ok: checked >= 4 ? agree / checked >= 0.75 : null };
}

// Võimsuse allika valik: kui pump töötab ja myUplinki võimsus on >0,3 kW, hääletab see kandidaat, mis jääb ±25% sisse.
// Mõlemad sisse jäävad (või ei kumbki) ei anna häält, nii ei saa juhuslik hetk allikat valida.
export function votePower(points, data, tolerance = 0.25) {
  const up = Number(points.find(p => String(p.parameterId) === '21')?.value);
  if (!data?.outputs?.compressor || !(up > 0.3)) return null;
  const fits = k => data.power?.[k] != null && Math.abs(data.power[k] - up) / up <= tolerance;
  const a = fits('acInput'), h = fits('heatOutput');
  return a && !h ? 'acInput' : h && !a ? 'heatOutput' : null;
}
// Võrdlus käib alles 3 sama häälega ja 0 vastuhäälega; tagasilükkamiseks piisab 5 eksimusest järjest.
export function updatePowerChoice(state, vote, points, data) {
  if (state.source) {
    const up = Number(points.find(p => String(p.parameterId) === '21')?.value), own = data?.power?.[state.source];
    if (data?.outputs?.compressor && up > 0.3 && own != null) state.strikes = Math.abs(own - up) / up > 0.5 ? state.strikes + 1 : 0;
    if (state.strikes >= 5) Object.assign(state, { source: null, votes: { acInput: 0, heatOutput: 0 }, strikes: 0 });
    return state;
  }
  if (vote) state.votes[vote]++;
  const other = k => k === 'acInput' ? 'heatOutput' : 'acInput';
  for (const k of ['acInput', 'heatOutput']) if (state.votes[k] >= 3 && state.votes[other(k)] === 0) state.source = k;
  return state;
}

// Otseandmed on kasutatavad, kui lugemine on värske (alla 3 min) ja väljade vastavus pole ümber lükatud.
export const isUsable = (state, now = Date.now()) => Boolean(state?.data && state.readAt && now - state.readAt < 180000 && state.verified !== false);

// Veakoodide eestikeelsed nimed (Luxtroniku veatabel); tundmatu kood jääb koodiks.
const ERROR_NAMES = {
  701: 'Madalrõhu viga', 702: 'Madalrõhu blokeering', 703: 'Külmumiskaitse', 704: 'Kuumgaasi viga', 705: 'Kompressori mootorikaitse', 706: 'Soojakandjapumba mootorikaitse',
  707: 'Soojuspumba kodeering', 708: 'Tagasivoolu andur', 709: 'Pealevoolu andur', 710: 'Kuumgaasi andur', 711: 'Välisõhu andur', 712: 'Tarbevee andur', 713: 'Soojusallika sisendi andur',
  715: 'Kõrgrõhulüliti väljalülitus', 716: 'Kõrgrõhu viga', 717: 'Vooluhulk', 718: 'Maksimaalne välistemperatuur', 719: 'Minimaalne välistemperatuur', 720: 'Soojusallika minimaalne temperatuur',
  721: 'Madalrõhu väljalülitus', 722: 'Temperatuuride vahe (küte)', 723: 'Temperatuuride vahe (tarbevesi)', 727: 'Soojakandjaringi rõhk', 728: 'Soojusallika väljundi andur', 729: 'Faasijärjestuse viga',
  751: 'Faasijärjestuse jälgimine', 752: 'Toide / voolutugevus', 762: 'Imemisandur (kompressor)', 763: 'Imemisandur (aurusti)', 764: 'Kompressori kütte andur',
  765: 'Külmaaine ülekuumenemine liiga madal (SSH alla 2 K üle 5 min)', 766: 'Kompressori töövahemiku piir', 770: 'Madal ülekuumenemine', 771: 'Kõrge ülekuumenemine', 776: 'Kompressori töövahemiku piir'
};
export const errorName = code => ERROR_NAMES[code] || `Veakood ${code}`;
