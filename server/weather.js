import { normalizeForecast, publicCoordinates } from '../src/weather-logic.js';

const FORECAST = 'https://api.open-meteo.com/v1/forecast', GEOCODING = 'https://geocoding-api.open-meteo.com/v1/search';
const CURRENT = 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,rain,showers,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,visibility,is_day,snow_depth';
const HOURLY = 'temperature_2m,weather_code,precipitation_probability,precipitation,wind_speed_10m,is_day';
const DAILY = 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,sunrise,sunset,uv_index_max';
const TTL = 10 * 60000, STALE = 3 * 3600000;

export class WeatherError extends Error {}

async function getJson(url, fetchImpl, timeout = 8000) {
  let res;
  try { res = await fetchImpl(url, { signal: AbortSignal.timeout(timeout), headers: { Accept: 'application/json' } }); }
  catch (e) { throw new WeatherError(e?.name === 'TimeoutError' ? 'Ilmateenus ei vastanud õigel ajal.' : 'Ilmateenusega ei saanud ühendust.'); }
  if (!res.ok) throw new WeatherError(`Ilmateenus vastas veaga (${res.status}).`);
  try { return await res.json(); } catch { throw new WeatherError('Ilmateenuse vastus ei olnud loetav.'); }
}

export function forecastUrl(place) {
  const { latitude, longitude } = publicCoordinates(place);
  return `${FORECAST}?latitude=${latitude}&longitude=${longitude}&current=${CURRENT}&hourly=${HOURLY}&daily=${DAILY}&forecast_days=7&timezone=auto&wind_speed_unit=ms`;
}

// Ilm vahemäluga: sama koht 10 minutit; kui teenus ei vasta, kasutatakse kuni 3 tundi vana vastust ja märgitakse see aegunuks.
export function createWeather(fetchImpl = fetch, now = () => Date.now()) {
  const cache = new Map();
  return async function weatherFor(place) {
    const key = `${publicCoordinates(place).latitude},${publicCoordinates(place).longitude}`, hit = cache.get(key);
    if (hit && now() - hit.at < TTL) return { weather: hit.weather, fetchedAt: hit.at, stale: false, error: null };
    try {
      const weather = normalizeForecast(await getJson(forecastUrl(place), fetchImpl));
      cache.set(key, { weather, at: now() });
      return { weather, fetchedAt: now(), stale: false, error: null };
    } catch (e) {
      if (hit && now() - hit.at < STALE) return { weather: hit.weather, fetchedAt: hit.at, stale: true, error: e.message };
      return { weather: null, fetchedAt: null, stale: false, error: e instanceof WeatherError ? e.message : 'Ilma laadimine ebaõnnestus.' };
    }
  };
}

// Asukohaotsing: 2–60 märki; tulemus on lühike loend koos piirkonna nimega, et sama nimega kohti eristada.
export async function searchPlaces(query, fetchImpl = fetch) {
  const q = String(query ?? '').replace(/[\u0000-\u001f]/g, ' ').trim();
  if (q.length < 2 || q.length > 60) throw new WeatherError('Otsingusõna peab olema 2–60 märki.');
  const data = await getJson(`${GEOCODING}?name=${encodeURIComponent(q)}&count=8&language=et&format=json`, fetchImpl);
  return (Array.isArray(data.results) ? data.results : []).filter(r => Number.isFinite(r.latitude) && Number.isFinite(r.longitude) && r.name).map(r => ({
    name: String(r.name).slice(0, 80), latitude: r.latitude, longitude: r.longitude,
    region: [r.admin2 || r.admin1, r.country].filter(Boolean).join(', ').slice(0, 120), countryCode: r.country_code || null
  }));
}
