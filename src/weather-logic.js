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
  const d = raw.daily, days = Array.isArray(d?.time) ? d.time.map((date, i) => ({
    date, code: num(d.weather_code?.[i]), max: num(d.temperature_2m_max?.[i]), min: num(d.temperature_2m_min?.[i]), precipitation: num(d.precipitation_sum?.[i]),
    rainChance: num(d.precipitation_probability_max?.[i]), wind: num(d.wind_speed_10m_max?.[i]), gust: num(d.wind_gusts_10m_max?.[i]),
    sunrise: localTime(d.sunrise?.[i]), sunset: localTime(d.sunset?.[i]), uv: num(d.uv_index_max?.[i])
  })) : [];
  const h = raw.hourly, nowHour = localTime(c.time)?.slice(0, 13) ?? null;
  const hourly = Array.isArray(h?.time) ? h.time.map((t, i) => ({
    time: localTime(t), temperature: num(h.temperature_2m?.[i]), code: num(h.weather_code?.[i]), rainChance: num(h.precipitation_probability?.[i]),
    precipitation: num(h.precipitation?.[i]) ?? 0, wind: num(h.wind_speed_10m?.[i]), isDay: h.is_day?.[i] == null ? null : Boolean(Number(h.is_day[i]))
  })).filter(x => x.time && x.temperature != null && (nowHour == null || x.time.slice(0, 13) >= nowHour)).slice(0, 24) : [];
  return {
    time: c.time ?? null, temperature: num(c.temperature_2m), feelsLike: num(c.apparent_temperature), humidity: num(c.relative_humidity_2m),
    code: num(c.weather_code) ?? 0, cloud: num(c.cloud_cover), wind: num(c.wind_speed_10m), windDirection: num(c.wind_direction_10m), gust: num(c.wind_gusts_10m),
    pressure: num(c.pressure_msl), visibility: num(c.visibility),
    precipitation: num(c.precipitation) ?? 0, rain: num(c.rain) ?? 0, showers: num(c.showers) ?? 0, snowfall: num(c.snowfall) ?? 0,
    snowDepth: num(c.snow_depth), isDay: c.is_day == null ? null : Boolean(Number(c.is_day)), days, hourly
  };
}

// Open-Meteo kohalik aeg "2026-10-01T07:12" (ilma ajavööndita); muu jääb null.
const localTime = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? v.slice(0, 16) : null;

// Ikooni liik ilmakoodi järgi (sama liigid kui weatherScene'il, lisaks uduvihm).
export function weatherKind(code) {
  if (code == null) return 'cloudy';
  if (code >= 95) return 'storm';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if ([51, 53, 55, 56, 57].includes(code)) return 'drizzle';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'rain';
  if (code === 45 || code === 48) return 'fog';
  if (code === 3) return 'cloudy';
  if (code === 2) return 'partly';
  return 'clear';
}

// Kastepunkt (Magnuse valem), °C.
export function dewPoint(temp, humidity) {
  if (temp == null || humidity == null || !(humidity > 0)) return null;
  const a = 17.62, b = 243.12, g = Math.log(humidity / 100) + (a * temp) / (b + temp);
  return (b * g) / (a - g);
}

export const windLabel = ms => ms == null ? '' : ms < 0.5 ? t('wx.windCalm') : ms < 3.4 ? t('wx.windLight') : ms < 8 ? t('wx.windModerate') : ms < 13.9 ? t('wx.windStrong') : ms < 20.8 ? t('wx.windVeryStrong') : t('wx.windStorm');
export const pressureLabel = hpa => hpa == null ? '' : hpa < 1000 ? t('wx.pressLow') : hpa <= 1020 ? t('wx.pressNormal') : t('wx.pressHigh');
export const uvLabel = uv => uv == null ? '' : uv < 3 ? t('wx.uvLow') : uv < 6 ? t('wx.uvModerate') : uv < 8 ? t('wx.uvHigh') : uv < 11 ? t('wx.uvVeryHigh') : t('wx.uvExtreme');
export const visibilityLabel = m => m == null ? '' : m >= 10000 ? t('wx.visVeryGood') : m >= 4000 ? t('wx.visGood') : m >= 1000 ? t('wx.visPoor') : t('wx.visVeryPoor');

// Järgmiste tundide kokkuvõte: külmim ja soojim hetk, sademete algus ja kogus.
export function outlook(hourly) {
  const rows = (hourly ?? []).filter(x => x?.temperature != null);
  if (!rows.length) return null;
  let min = rows[0], max = rows[0], total = 0;
  for (const r of rows) { if (r.temperature < min.temperature) min = r; if (r.temperature > max.temperature) max = r; total += r.precipitation ?? 0; }
  const wet = rows.find(r => (r.precipitation ?? 0) >= 0.1 || (r.rainChance ?? 0) >= 60);
  return { min: { temperature: min.temperature, time: min.time }, max: { temperature: max.temperature, time: max.time }, rainStart: wet?.time ?? null, rainTotal: Math.round(total * 10) / 10 };
}

export const daylight = (sunrise, sunset) => {
  if (!sunrise || !sunset) return null;
  const min = (Date.parse(`${sunset}:00Z`) - Date.parse(`${sunrise}:00Z`)) / 60000;
  return Number.isFinite(min) && min > 0 ? min : null;
};

import { t } from './i18n/index.js';

const LABELS = {
  0: 'weather.clear', 1: 'weather.mostlyClear', 2: 'weather.partlyCloudy', 3: 'weather.cloudy', 45: 'weather.fog', 48: 'weather.rimeFog',
  51: 'weather.lightDrizzle', 53: 'weather.drizzle', 55: 'weather.denseDrizzle', 56: 'weather.lightFreezingDrizzle', 57: 'weather.freezingDrizzle',
  61: 'weather.lightRain', 63: 'weather.rain', 65: 'weather.heavyRain', 66: 'weather.lightFreezingRain', 67: 'weather.freezingRain',
  71: 'weather.lightSnow', 73: 'weather.snow', 75: 'weather.heavySnow', 77: 'weather.snowGrains', 80: 'weather.lightShowers', 81: 'weather.showers', 82: 'weather.heavyShowers',
  85: 'weather.snowShowers', 86: 'weather.heavySnowShowers', 95: 'weather.thunder', 96: 'weather.thunderHail', 99: 'weather.heavyThunderHail'
};
export const weatherLabel = code => t(LABELS[code] || 'weather.unknown');

const RAIN_BASE = { 51: 0.2, 53: 0.3, 55: 0.45, 56: 0.25, 57: 0.4, 61: 0.4, 63: 0.65, 65: 0.95, 66: 0.45, 67: 0.8, 80: 0.5, 81: 0.75, 82: 1, 95: 0.85, 96: 0.9, 99: 1 };
const SNOW_BASE = { 71: 0.35, 73: 0.65, 75: 1, 77: 0.3, 85: 0.5, 86: 0.9 };
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

export const WEATHER_DEMOS = { off: 'wx.demoOff', clear: 'wx.demoClear', cloudy: 'wx.demoCloudy', rain: 'wx.demoRain', snow: 'wx.demoSnow', storm: 'wx.demoStorm', fog: 'wx.demoFog' };
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

const COMPASS = ['compass.north', 'compass.northeast', 'compass.east', 'compass.southeast', 'compass.south', 'compass.southwest', 'compass.west', 'compass.northwest'];
export const compassName = deg => deg == null ? '' : t(COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]);
