import { getLocale, t } from './i18n/index.js';

export async function api(url, options = {}) {
  const response = await fetch(`/api${url}`, { ...options, headers: { 'Content-Type': 'application/json', 'X-Soojus-Request': '1', ...options.headers }, signal: options.signal || AbortSignal.timeout(40000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || t('common.requestFailed'));
  return data;
}
export const number = (n, decimals = 1) => n == null || n === '' || !Number.isFinite(Number(n)) ? '—' : new Intl.NumberFormat(getLocale(), { maximumFractionDigits: decimals }).format(Number(n));
export function date(value, options = {}) {
  if (!value) return '—';
  const d = new Date(typeof value === 'number' ? value : String(value).replace(/\+0$/, '+00:00'));
  return Number.isNaN(d.valueOf()) ? String(value) : new Intl.DateTimeFormat(getLocale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', ...options }).format(d);
}
export const time = value => value ? new Intl.DateTimeFormat(getLocale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—';
const ENUM_ALIASES = {
  'Automaatika': 'enum.auto', 'Manuaalne': 'enum.manual', 'Küte': 'enum.heat', 'Kütmine': 'enum.heat', 'Jahutamine': 'enum.cool', 'Jahutus': 'enum.cooling',
  'Väljas': 'enum.off', 'Sees': 'enum.on', 'Puudub vajadus': 'enum.noDemand', 'Vajadus': 'enum.demand',
  'Kütterežiim': 'enum.heatMode', 'Soe tarbevesi': 'enum.hwMode', 'Basseiniküte': 'enum.pool', 'Sulatus': 'enum.defrost',
  'Lisaküte': 'enum.aux', 'Õhutus': 'enum.boost', 'Ülerõhk': 'enum.overpressure'
};
export const enumText = text => { const key = ENUM_ALIASES[text] || `enum.${text}`; const value = t(key); return value === key ? text : value; };
// This model exposes missing category translations and several ambiguous names.
const NAME_ALIASES = {
  'Välisõhutemperatuur': 'name.outdoorTemp', 'Kütteringipump HUP': 'name.circPump', 'El.kü.keha': 'name.elHeater',
  'Elektritenn aktiivne': 'name.elHeaterActive', 'Veateade': 'name.errorMessage', 'Tööaeg': 'name.operatingTime',
  'Sul/.Prim.r./ Läbiv.': 'name.defrostFlow', 'Ülerõhupressostaat': 'name.highPressure', 'Mootorikaitse': 'name.motorProtection',
  'Alarõhupressostaat': 'name.lowPressure', 'Ventilaat. BOSUP': 'name.fanBosup', 'Soojuspumba katmine': 'name.pumpCoverage',
  'Soovitud parameetrid :': 'name.desiredParams', 'Töötunnid soojuspump': 'name.hoursPump', 'Töötunnid VD1': 'name.hoursVd1',
  'Töötunnid ZWE1': 'name.hoursZwe1', 'Impulsid kompr. 1': 'name.compressorPulses', 'Küttepiirang': 'name.heatingLimit',
  'Töötunnid küte.': 'name.hoursHeating', 'Peab väärt': 'name.targetValue', 'Ekstra soe vesi kestvus': 'name.extraHwDuration',
  'output min.': 'name.outputMin', 'output max.': 'name.outputMax', 'output': 'name.output',
  'Sissepuhke temperatuur': 'name.supplyTemp', 'Väljatõmbe temperatuur': 'name.extractTemp',
  'Välisõhu temperatuur (ventilatsioon)': 'name.outdoorVent', 'Sissepuhke niiskus': 'name.supplyHum',
  'Väljatõmbe niiskus': 'name.extractHum', 'Välisõhu niiskus': 'name.outdoorHum', 'VOC indeks': 'name.voc',
  'Sissepuhke ventilaator': 'name.supplyFan', 'Väljatõmbe ventilaator': 'name.extractFan',
  'Sissepuhke õhuvool (hinnang)': 'name.supplyFlow', 'Väljatõmbe õhuvool (hinnang)': 'name.extractFlow',
  'Soojustagastus': 'name.heatRecovery', 'Temperatuur + -': 'name.tempOffset',
  'Soojakandja maast (sisse pumpa)': 'name.brineInLux', 'Soojakandja maasse (pumbast välja)': 'name.brineOutLux',
  'Kuumgaas': 'name.hotGas', 'Imemistemperatuur kompressorisse': 'name.suction', 'Kõrgrõhk': 'name.pressureHigh',
  'Madalrõhk': 'name.pressureLow', 'Soojakandja temperatuuride vahe': 'name.brineSpread', 'Soojakandja vahe siht': 'name.brineSpreadSet',
  'Elektrivõimsus (pump otse)': 'name.powerAc', 'Soojusvõimsus (pump otse)': 'name.powerHeat'
};
export const pointNameText = name => NAME_ALIASES[name] ? t(NAME_ALIASES[name]) : name;
const GROUPS = { 'Küte': 'group.heating', 'Väliskliima': 'group.climate', 'Tarbevesi': 'group.water', 'Olek': 'group.state', 'Energia': 'group.energy', 'Väljundid': 'group.outputs', 'Sisendid': 'group.inputs', 'Muu': 'group.other', 'Töötunnid': 'group.hours', 'Temperatuurid': 'group.temps' };
export const groupText = group => GROUPS[group] ? t(GROUPS[group]) : group;

// Only confirmed WZSV 92H3M ids get these presentation aliases. Every other model uses API metadata.
const aliases = { '0': 'point.supply', '1': 'point.return', '2': 'point.returnTarget', '3': 'point.buffer', '6': 'point.water', '7': 'point.waterTarget', '17': 'point.workState', '21': 'point.power', '31': 'point.flow', '39': 'point.outdoorAvg', '45': 'point.heatState', '46': 'point.waterState', '5729': 'point.hwHours', '25000': 'point.quickCharge', '25001': 'point.boost', '5001': 'point.heatOffset', '5003': 'point.heatMode', '5004': 'point.waterMode', '5105': 'point.waterSetpoint', '5700': 'point.outdoorLimit', '6146': 'point.boostTarget', '6147': 'point.boostDuration', '40001': 'point.heatCircuitMode', '40007': 'point.waterZoneMode', '40009': 'point.boostMode', '40010': 'point.waterZoneTemp' };
export function enhance(points, model) {
  const wzsv = model === 'WZSV 92H3M';
  return points.map(p => {
    const scale = Number(p.scaleValue ?? 1);
    const scaled = x => x == null ? null : Number((Number(x) * scale).toFixed(8));
    const id = p.parameterId;
    let group = 'Muu';
    if (p.smartHomeCategories?.some(c => /hw/.test(c)) || /tarbe|boiler|soe vesi/i.test(p.parameterName) || wzsv && ['5105','6146','6147','40007','40009','40010'].includes(id)) group = 'Tarbevesi';
    else if (/välis|keskmine temp/i.test(p.parameterName) || p.smartHomeCategories?.includes('sh-outdoorTemp')) group = 'Väliskliima';
    else if (/töötun|impulsid|tööaeg/i.test(p.parameterName)) group = 'Töötunnid';
    else if (/rõhu|kaitse|^EVU|^Sul\//i.test(p.parameterName)) group = 'Sisendid';
    else if (p.enumValues?.length && !p.writable && !/olek|olukord|veateade/i.test(p.parameterName)) group = 'Väljundid';
    else if (/küt|pealev|tagasiv|akupaak/i.test(p.parameterName) || wzsv && ['5001','5003','40001'].includes(id)) group = 'Küte';
    else if (p.parameterUnit === '°C') group = 'Temperatuurid';
    else if (p.parameterUnit === 'kW' || p.parameterUnit === 'kWh') group = 'Energia';
    else if (/olek|olukord|veateade/i.test(p.parameterName)) group = 'Olek';
    return { ...p, label: wzsv && aliases[id] ? t(aliases[id]) : pointNameText(p.parameterName), group, min: scaled(p.minValue), max: scaled(p.maxValue), step: scaled(p.stepValue), display: p.enumValues?.length ? enumText(p.enumValues.find(e => String(e.value) === String(p.value))?.text || p.strVal) : p.strVal ?? String(p.value ?? '—') };
  });
}
export function metric(points, model, id, category, pattern) {
  return (model === 'WZSV 92H3M' && points.find(p => p.parameterId === id)) || points.find(p => p.smartHomeCategories?.includes(category)) || points.find(p => pattern?.test(p.parameterName));
}

const HOUR = 3600000, DAY = 24 * HOUR;
const TIME_STEPS = [15 * 60000, 30 * 60000, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY, 14 * DAY, 30 * DAY, 60 * DAY, 90 * DAY];
export const axisNumber = (v, decimals) => new Intl.NumberFormat('et-EE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v);
export function niceScale(lo, hi, target = 5, minSpan = 0) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { domain: ['auto', 'auto'], ticks: undefined, decimals: 0 };
  const nonNegative = lo >= 0;
  if (hi - lo < minSpan) { const mid = (lo + hi) / 2; lo = mid - minSpan / 2; hi = mid + minSpan / 2; }
  if (hi - lo < 1e-9) { const pad = Math.max(Math.abs(lo) * .05, 1); lo -= pad; hi += pad; }
  const pad = (hi - lo) * .08; lo -= pad; hi += pad;
  if (nonNegative && lo < 0) lo = 0;
  const rough = (hi - lo) / target, mag = 10 ** Math.floor(Math.log10(rough)), norm = rough / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const decimals = step >= 1 ? 0 : Math.ceil(-Math.log10(step) - 1e-9);
  const start = Math.floor(lo / step + 1e-9), end = Math.ceil(hi / step - 1e-9);
  const ticks = []; for (let i = start; i <= end; i++) ticks.push(Number((i * step).toFixed(10)));
  return { domain: [ticks[0], ticks.at(-1)], ticks, decimals };
}
export function timeTicks(from, to, target = 6) {
  const span = to - from;
  if (!(span > 0)) return { ticks: [from], step: HOUR };
  const step = TIME_STEPS.find(s => span / s <= target) || TIME_STEPS.at(-1), ticks = [];
  if (step < DAY) {
    const off = new Date(from).getTimezoneOffset() * 60000;
    for (let t = Math.ceil((from - off) / step) * step + off; t <= to; t += step) ticks.push(t);
  } else {
    const d = new Date(from); d.setHours(0, 0, 0, 0);
    if (d.getTime() < from) d.setDate(d.getDate() + 1);
    for (; d.getTime() <= to; d.setDate(d.getDate() + Math.round(step / DAY))) ticks.push(d.getTime());
  }
  return { ticks: ticks.length ? ticks : [from, to], step };
}
const tickFormats = {
  weekday: new Intl.DateTimeFormat('et-EE', { weekday: 'short', day: 'numeric', month: 'numeric' }),
  day: new Intl.DateTimeFormat('et-EE', { day: 'numeric', month: 'numeric' }),
  month: new Intl.DateTimeFormat('et-EE', { day: 'numeric', month: 'short' })
};
export function timeTickLabel(value, step) {
  if (step < DAY) return time(value);
  const f = step <= 2 * DAY ? tickFormats.weekday : step < 30 * DAY ? tickFormats.day : tickFormats.month;
  return f.format(new Date(value));
}
export const plotKey = id => `~${id}`;
export const estKey = id => `?${id}`;
// Igal ajahetkel on seeria mõõdetud väärtus (id) ja joonistatav väärtus (plotKey(id)). Joonistatav väärtus
// interpoleeritakse kahe lähedase mõõtmise vahel, et teiste seeriate ajahetked joont ei katkestaks.
// Liiga pikas mõõtmisvahes (nt server oli väljas) jääb joonistatav väärtus tühjaks ja joon katkeb;
// vahe täidetakse eraldi hinnangulise väärtusega (estKey(id)): seade teatab väärtuse muutumisel, seega hoitakse
// viimast teadaolevat väärtust kuni järgmise mõõtmiseni. Seda joonistatakse punktiirjoonena.
export function mergeSeries(rows, ids, bucketSeconds, fillTimes = []) {
  const step = bucketSeconds > 0 ? bucketSeconds * 1000 : 0, gapMs = Math.max(step * 3, 20 * 60000);
  const cells = new Map(), lists = new Map(ids.map(id => [id, []]));
  for (const r of rows) {
    const list = lists.get(r.point), t = Date.parse(r.time);
    if (!list || !Number.isFinite(t)) continue;
    const key = step > 0 ? Math.floor(t / step) * step : t;
    if (!cells.has(key)) cells.set(key, { time: key });
    const cell = cells.get(key);
    if (cell[r.point] == null) { cell[r.point] = r.value; cell[plotKey(r.point)] = r.value; list.push(key); }
  }
  // Tühjad tugiajahetked, et kursor ja tooltip ei hüppaks andmeteta vahemikus kaugele järgmise mõõtmiseni.
  for (const t of fillTimes) { const key = Math.round(t); if (!cells.has(key)) cells.set(key, { time: key }); }
  for (const list of lists.values()) {
    list.sort((a, b) => a - b);
    for (let i = 1; i < list.length; i++) if (list[i] - list[i - 1] > gapMs) {
      const gapKey = list[i - 1] + Math.max(step, 60000);
      if (!cells.has(gapKey)) cells.set(gapKey, { time: gapKey });
      cells.get(gapKey).gap = true;
    }
  }
  const keys = [...cells.keys()].sort((a, b) => a - b);
  for (const [id, list] of lists) {
    let from = 0;
    for (let i = 1; i < list.length; i++) {
      const k0 = list[i - 1], k1 = list[i], v0 = cells.get(k0)[id], v1 = cells.get(k1)[id];
      const name = k1 - k0 > gapMs ? estKey(id) : plotKey(id);
      while (from < keys.length && keys[from] <= k0) from++;
      if (name === estKey(id)) { cells.get(k0)[name] = v0; cells.get(k1)[name] = v1; }
      for (let j = from; j < keys.length && keys[j] < k1; j++) cells.get(keys[j])[name] = name === estKey(id) ? v0 : v0 + (v1 - v0) * (keys[j] - k0) / (k1 - k0);
    }
  }
  return [...cells.values()].sort((a, b) => a.time - b.time);
}
export function seriesStats(data, id) {
  let min = Infinity, max = -Infinity, sum = 0, n = 0, last = null;
  for (const r of data) { const v = r[id]; if (v == null) continue; if (v < min) min = v; if (v > max) max = v; sum += v; n++; last = v; }
  return n ? { min, max, avg: sum / n, last } : null;
}
export function stateSpans(rows, from, to, classify) {
  const s = rows.map(r => ({ t: Date.parse(r.time), v: Number(r.value) })).filter(x => Number.isFinite(x.t) && Number.isFinite(x.v)).sort((a, b) => a.t - b.t);
  const spans = [];
  for (let i = 0; i < s.length; i++) {
    const a = Math.max(s[i].t, from), b = Math.min(i + 1 < s.length ? s[i + 1].t : to, to);
    if (b <= a) continue;
    const kind = classify(s[i].v), last = spans.at(-1);
    if (last && last.kind === kind && last.to === a) last.to = b; else spans.push({ from: a, to: b, kind });
  }
  return spans;
}
export const wzsvWorkState = v => v === 0 || v === 6 ? 'heat' : v === 1 ? 'hw' : 'idle';
export const targetKey = id => `^${id}`;
const wzsvTargets = { '6': '5105' };
export function targetLines(points, model, selectedIds) {
  if (model !== 'WZSV 92H3M') return [];
  return Object.entries(wzsvTargets).flatMap(([forId, id]) => {
    const p = points.find(x => x.parameterId === id);
    return p && selectedIds.includes(forId) && !selectedIds.includes(id) ? [{ forId, id, label: p.label, unit: p.parameterUnit }] : [];
  });
}
// Sihtväärtus kehtib kuni järgmise muutuseni, seega hoiame viimast teadaolevat väärtust.
export function holdValues(rows, times) {
  const s = rows.map(r => ({ t: Date.parse(r.time), v: Number(r.value) })).filter(x => Number.isFinite(x.t) && Number.isFinite(x.v)).sort((a, b) => a.t - b.t);
  let i = -1;
  return times.map(t => { while (i + 1 < s.length && s[i + 1].t <= t) i++; return i >= 0 ? s[i].v : null; });
}
// Seisundi väärtus kehtib kuni järgmise muutuseni, kuid mitte andmeteta vahemike kaudu.
export function clipSpans(spans, gaps) {
  return gaps.reduce((list, g) => list.flatMap(s => g.to <= s.from || g.from >= s.to ? [s] : [
    ...(g.from > s.from ? [{ ...s, to: g.from }] : []),
    ...(g.to < s.to ? [{ ...s, from: g.to }] : [])
  ]), spans);
}
