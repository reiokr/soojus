// Taeva loogika "Elava kodu" vaate jaoks: päikese ja kuu asend, kuufaas ning taevavärvid.
// Valemid on lihtsustatud (Meeus, madal täpsus): sobivad joonistamiseks, mitte navigeerimiseks.
import { t } from '../../i18n/index.js';

const RAD = Math.PI / 180;
export const HOME = { lat: 59.437, lon: 24.754 }; // Tallinn

export const julianDay = date => date.getTime() / 86400000 + 2440587.5;
const norm360 = d => ((d % 360) + 360) % 360;

function sunEcliptic(jd) {
  const n = jd - 2451545.0, L = norm360(280.460 + 0.9856474 * n), g = norm360(357.528 + 0.9856003 * n) * RAD;
  return { lambda: norm360(L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)), n };
}

function horizontal(jd, lambdaDeg, { lat, lon }) {
  const n = jd - 2451545.0, eps = (23.439 - 0.0000004 * n) * RAD, lam = lambdaDeg * RAD;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)), dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const gmst = norm360(280.46061837 + 360.98564736629 * n), ha = (gmst + lon) * RAD - ra, phi = lat * RAD;
  const elevation = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha)) / RAD;
  const azimuth = norm360(Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) / RAD + 180);
  return { elevation, azimuth };
}

export function sunPosition(date, place = HOME) {
  const jd = julianDay(date);
  return horizontal(jd, sunEcliptic(jd).lambda, place);
}

// Kuu vanus (0–1 uuskuust uuskuuni) ja valgustatud osa; asend on ekliptikal, mis piisab taustaks.
export function moonPhase(date) {
  const age = norm360(((julianDay(date) - 2451550.1) / 29.530588853) * 360) / 360;
  return { age, illumination: (1 - Math.cos(age * 2 * Math.PI)) / 2, waxing: age < 0.5 };
}

export function moonPosition(date, place = HOME) {
  const jd = julianDay(date), { lambda } = sunEcliptic(jd), { age } = moonPhase(date);
  return horizontal(jd, norm360(lambda + age * 360), place);
}

const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const toHex = rgb => '#' + rgb.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
export const mix = (a, b, k) => { const x = hex(a), y = hex(b), t = Math.min(1, Math.max(0, k)); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
export const luminance = c => { const [r, g, b] = hex(c); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };

// Taevas kolmes kihis (ülal, keskel, silmapiir) päikese kõrguse järgi: öö → koit/videvik → päev.
const SKY = [
  { e: -18, top: '#050a1c', mid: '#0a1330', horizon: '#14214a' },
  { e: -8, top: '#0e1a42', mid: '#26306a', horizon: '#57457f' },
  { e: -1, top: '#2b3f7c', mid: '#8a5f8f', horizon: '#f08a5a' },
  { e: 6, top: '#4f7fc0', mid: '#e3a079', horizon: '#ffd08a' },
  { e: 20, top: '#3f8fdc', mid: '#8fc6ee', horizon: '#dff2ff' },
  { e: 90, top: '#2f86dc', mid: '#86c4f0', horizon: '#dff3ff' }
];
export function skyColors(elevation) {
  const e = Math.min(90, Math.max(-18, elevation));
  for (let i = 1; i < SKY.length; i++) {
    if (e <= SKY[i].e) {
      const a = SKY[i - 1], b = SKY[i], k = (e - a.e) / (b.e - a.e);
      return { top: mix(a.top, b.top, k), mid: mix(a.mid, b.mid, k), horizon: mix(a.horizon, b.horizon, k) };
    }
  }
  const last = SKY.at(-1);
  return { top: last.top, mid: last.mid, horizon: last.horizon };
}

// Pimedus 0 (päev) … 1 (öö): juhib tähti, aknavalgust ja valgusallikaid.
export function darkness(elevation) { return Math.min(1, Math.max(0, (4 - elevation) / 14)); }

// Maa värv välistemperatuuri järgi: härmatis → jahe hall-roheline → heledam suvine.
export function groundColors(outdoor) {
  const t = Number.isFinite(outdoor) ? outdoor : 10;
  const warm = Math.min(1, Math.max(0, (t - 5) / 18)), frost = Math.min(1, Math.max(0, (2 - t) / 8));
  let top = mix('#5a7a52', '#7fa556', warm); top = mix(top, '#c9d8e4', frost);
  let bottom = mix('#33472f', '#4c6a36', warm); bottom = mix(bottom, '#7d93a8', frost);
  return { top, bottom, frost };
}

// Aknahõõgus: külm tuba on sinakas, mugav soe merevaik, liiga soe oranžikas; öösel heledam.
export function windowGlow(indoor, dark) {
  const t = Number.isFinite(indoor) ? indoor : 21;
  const warm = Math.min(1, Math.max(0, (t - 17) / 9));
  const base = warm < 0.5 ? mix('#bcd6ee', '#ffd98a', warm * 2) : mix('#ffd98a', '#ff9a4a', (warm - 0.5) * 2);
  return { color: base, strength: 0.25 + 0.75 * dark };
}

// Päikesetõus ja -loojang antud kuupäeval (kohalik kuupäev); otsib horisondi ületuse (-0,83°) viieminutise sammuga.
export function sunTimes(date, place = HOME) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(), out = { rise: null, set: null };
  let prev = sunPosition(new Date(start), place).elevation;
  for (let m = 5; m <= 1440; m += 5) {
    const t = start + m * 60000, el = sunPosition(new Date(t), place).elevation, edge = -0.833;
    if (prev < edge && el >= edge && !out.rise) out.rise = new Date(t - 5 * 60000 + ((edge - prev) / (el - prev)) * 5 * 60000);
    if (prev >= edge && el < edge && !out.set) out.set = new Date(t - 5 * 60000 + ((prev - edge) / (prev - el)) * 5 * 60000);
    prev = el;
  }
  return out;
}

export function moonName(phase) {
  const a = phase.age;
  if (a < 0.03 || a > 0.97) return t('moon.new');
  if (a < 0.22) return t('moon.waxingCrescent');
  if (a < 0.28) return t('moon.firstQuarter');
  if (a < 0.47) return t('moon.waxingGibbous');
  if (a < 0.53) return t('moon.full');
  if (a < 0.72) return t('moon.waningGibbous');
  if (a < 0.78) return t('moon.lastQuarter');
  return t('moon.waningCrescent');
}

// Päeva kõrgeim päikesekõrgus (kraadides); vaade kasutab seda, et keskpäeva päike jääks alati katuse kohale.
export function sunMaxElevation(date, place = HOME) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  let best = -90;
  for (let m = 600; m <= 900; m += 15) best = Math.max(best, sunPosition(new Date(start + m * 60000), place).elevation);
  return best;
}

// Taevakeha asend pildil (maailmakoordinaadid): x azimuudist, y kõrgusest; peamiselt päikese kaar on normeeritud päeva kõrgeima punktiga.
export function skyPlacement(body, maxElevation, { W = 1600, GROUND = 700 } = {}) {
  const x = W / 2 + Math.max(-1.2, Math.min(1.2, (body.azimuth - 180) / 105)) * (W * 0.46);
  const top = 92, base = GROUND - 62;
  const frac = body.elevation >= 0 ? Math.min(1, body.elevation / Math.max(3, maxElevation)) : Math.max(-0.35, body.elevation / 24);
  return { x, y: base - frac * (base - top) };
}
