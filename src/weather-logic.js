// Ilma loogika, mida kasutavad nii server (vastuse normaliseerimine, asukoha kontroll) kui ka klient (pilt ja sõnad).
export const DEFAULT_PLACE = { name: 'Tallinn', latitude: 59.437, longitude: 24.754 };

const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

// Asukoht: nimi ≤80 märki, laius/pikkus lõplikud ja lubatud piirides. Tagastab puhastatud asukoha või viskab Errori.
export function validatePlace(input) {
  const coord = v => v == null || (typeof v === 'string' && v.trim() === '') ? NaN : Number(v);
  const lat = coord(input?.latitude), lon = coord(input?.longitude);
  const name = String(input?.name ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80);
  if (!name) throw new Error('Asukohal peab olema nimi.');
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error('Laiuskraad peab olema −90…90.');
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new Error('Pikkuskraad peab olema −180…180.');
  return { name, latitude: round(lat, 4), longitude: round(lon, 4) };
}

// Väljapoole saadetakse ainult ümardatud koordinaadid (~1 km), täpset aadressi ilmateenus ei vaja.
export const publicCoordinates = place => ({ latitude: round(place.latitude, 2), longitude: round(place.longitude, 2) });

const num = v => { const n = v == null || v === '' ? NaN : Number(v); return Number.isFinite(n) ? n : null; };

// Open-Meteo vastuse lihtsustus; puuduvad väärtused jäävad null.
export function normalizeForecast(raw) {
  const c = raw?.current;
  if (!c || num(c.temperature_2m) == null) throw new Error('Ilmateenuse vastus ei sisaldanud hetkeilma.');
  const d = raw.daily, days = Array.isArray(d?.time) ? d.time.map((date, i) => ({ date, code: num(d.weather_code?.[i]), max: num(d.temperature_2m_max?.[i]), min: num(d.temperature_2m_min?.[i]), precipitation: num(d.precipitation_sum?.[i]) })) : [];
  return {
    time: c.time ?? null, temperature: num(c.temperature_2m), feelsLike: num(c.apparent_temperature), humidity: num(c.relative_humidity_2m),
    code: num(c.weather_code) ?? 0, cloud: num(c.cloud_cover), wind: num(c.wind_speed_10m), windDirection: num(c.wind_direction_10m),
    precipitation: num(c.precipitation) ?? 0, rain: num(c.rain) ?? 0, showers: num(c.showers) ?? 0, snowfall: num(c.snowfall) ?? 0,
    snowDepth: num(c.snow_depth), isDay: c.is_day == null ? null : Boolean(Number(c.is_day)), days
  };
}

const LABELS = {
  0: 'selge', 1: 'peamiselt selge', 2: 'vahelduva pilvisusega', 3: 'pilves', 45: 'udu', 48: 'härmatisudu',
  51: 'kerge uduvihm', 53: 'uduvihm', 55: 'tihe uduvihm', 56: 'kerge jäine uduvihm', 57: 'jäine uduvihm',
  61: 'kerge vihm', 63: 'vihm', 65: 'tugev vihm', 66: 'kerge jäine vihm', 67: 'jäine vihm',
  71: 'kerge lumi', 73: 'lumi', 75: 'tugev lumi', 77: 'lumetera', 80: 'kerge hoovihm', 81: 'hoovihm', 82: 'tugev hoovihm',
  85: 'lumehoog', 86: 'tugev lumehoog', 95: 'äike', 96: 'äike ja rahe', 99: 'tugev äike ja rahe'
};
export const weatherLabel = code => LABELS[code] ?? 'teadmata';

const RAIN_BASE = { 51: 0.2, 53: 0.3, 55: 0.45, 56: 0.25, 57: 0.4, 61: 0.4, 63: 0.65, 65: 0.95, 66: 0.45, 67: 0.8, 80: 0.5, 81: 0.75, 82: 1, 95: 0.85, 96: 0.9, 99: 1 };
const SNOW_BASE = { 71: 0.35, 73: 0.65, 75: 1, 77: 0.3, 85: 0.5, 86: 0.9 };
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

export const WEATHER_DEMOS = { off: 'Päris ilm', clear: 'Selge', cloudy: 'Pilves', rain: 'Vihm', snow: 'Lumi', storm: 'Äike', fog: 'Udu' };
const DEMO_CODES = { clear: { code: 0, cloud: 5, wind: 2, precipitation: 0 }, cloudy: { code: 3, cloud: 100, wind: 5 }, rain: { code: 65, cloud: 100, wind: 7, precipitation: 4 }, snow: { code: 73, cloud: 100, wind: 3, snowfall: 1.5, snowDepth: 0.12 }, storm: { code: 95, cloud: 100, wind: 12, precipitation: 6 }, fog: { code: 45, cloud: 90, wind: 1 } };

// Ilm pildi jaoks: kõik väärtused 0…1 (v.a. tekst ja liik).
export function weatherScene(w, demo = 'off') {
  const src = demo !== 'off' && DEMO_CODES[demo] ? { ...DEMO_CODES[demo], temperature: w?.temperature ?? 10 } : w;
  if (!src) return null;
  const code = src.code ?? 0, precip = src.precipitation ?? 0, snowfall = src.snowfall ?? 0;
  const rain = RAIN_BASE[code] != null ? clamp(Math.max(RAIN_BASE[code], precip / 5)) : clamp(precip / 6) * (snowfall > 0 ? 0 : 1);
  const snow = SNOW_BASE[code] != null ? clamp(Math.max(SNOW_BASE[code], snowfall / 2)) : clamp(snowfall / 2);
  const fog = code === 45 || code === 48 ? 1 : 0;
  const base = (src.cloud ?? 0) / 100;
  const floor = code === 3 ? 0.85 : code === 2 ? 0.4 : code === 1 ? 0.12 : rain > 0 || snow > 0 || fog ? 0.85 : 0;
  const cloud = clamp(Math.max(base, floor));
  const kind = code >= 95 ? 'storm' : snow > 0.05 ? 'snow' : rain > 0.05 ? 'rain' : fog ? 'fog' : cloud > 0.75 ? 'cloudy' : cloud > 0.3 ? 'partly' : 'clear';
  return { kind, label: weatherLabel(code), code, cloud, rain, snow, fog, storm: code >= 95, wind: clamp((src.wind ?? 0) / 14), windMs: src.wind ?? 0, snowCover: clamp((src.snowDepth ?? 0) / 0.12), temperature: src.temperature ?? null, feelsLike: src.feelsLike ?? null, humidity: src.humidity ?? null, demo: demo !== 'off' };
}

export const compassName = deg => deg == null ? '' : ['põhjatuul', 'kirdetuul', 'idatuul', 'kagutuul', 'lõunatuul', 'edelatuul', 'läänetuul', 'loodetuul'][Math.round((((deg % 360) + 360) % 360) / 45) % 8];
