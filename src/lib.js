export async function api(url, options = {}) {
  const response = await fetch(`/api${url}`, { ...options, headers: { 'Content-Type': 'application/json', 'X-Soojus-Request': '1', ...options.headers }, signal: options.signal || AbortSignal.timeout(40000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Päring ebaõnnestus.');
  return data;
}
export const number = (n, decimals = 1) => n == null || n === '' || !Number.isFinite(Number(n)) ? '—' : new Intl.NumberFormat('et-EE', { maximumFractionDigits: decimals }).format(Number(n));
export function date(value, options = {}) {
  if (!value) return '—';
  const d = new Date(typeof value === 'number' ? value : String(value).replace(/\+0$/, '+00:00'));
  return Number.isNaN(d.valueOf()) ? String(value) : new Intl.DateTimeFormat('et-EE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', ...options }).format(d);
}
export const time = value => value ? new Intl.DateTimeFormat('et-EE', { hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—';
export const enumText = text => ({ off: 'Väljas', on: 'Sees', heat: 'Kütmine', cool: 'Jahutamine', auto: 'Automaatne', Party: 'Peorežiim', Normal: 'Tavarežiim', Default: 'Vaikimisi', Home: 'Kodus', Away: 'Eemal', Vacation: 'Puhkus' }[text] || text);
// This model exposes missing category translations and several ambiguous names.
// Only confirmed WZSV 92H3M ids get these presentation aliases. Every other model uses API metadata.
const aliases = { '0': 'Pealevool', '1': 'Tagasivool', '2': 'Tagasivoolu siht', '3': 'Akupaagi temperatuur', '6': 'Tarbevee temperatuur', '7': 'Tarbevee siht', '17': 'Seadme tööolek', '21': 'Hetkevõimsus', '31': 'Vooluhulk', '39': 'Välisõhu keskmine', '46': 'Tarbevee olek', '5001': 'Kütte temperatuuri nihe', '5003': 'Kütte töörežiim', '5004': 'Tarbevee töörežiim', '5105': 'Tarbevee sihttemperatuur', '5700': 'Kütte välisõhupiir', '6146': 'Kõrgendatud tarbevee siht', '6147': 'Ekstra sooja vee kestus', '40001': 'Kütteringi režiim', '40007': 'Tarbeveetsooni režiim', '40009': 'Kõrgendatud tarbevee režiim', '40010': 'Tarbeveetsooni temperatuur' };
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
    return { ...p, label: wzsv && aliases[id] || p.parameterName, group, min: scaled(p.minValue), max: scaled(p.maxValue), step: scaled(p.stepValue), display: p.enumValues?.length ? enumText(p.enumValues.find(e => String(e.value) === String(p.value))?.text || p.strVal) : p.strVal ?? String(p.value ?? '—') };
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
