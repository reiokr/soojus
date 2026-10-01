import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWeather, searchPlaces, forecastUrl, WeatherError } from '../server/weather.js';

const body = { current: { time: '2026-09-30T18:15', temperature_2m: 15.6, weather_code: 3, cloud_cover: 93, wind_speed_10m: 2.3 }, daily: { time: ['2026-09-30'], weather_code: [3], temperature_2m_max: [16], temperature_2m_min: [9], precipitation_sum: [0] } };
const ok = json => async () => ({ ok: true, status: 200, json: async () => json });
const place = { name: 'Tartu', latitude: 58.38062, longitude: 26.72509 };

test('forecast url carries only rounded coordinates and metric units', () => {
  const u = new URL(forecastUrl(place));
  assert.equal(u.searchParams.get('latitude'), '58.38'); assert.equal(u.searchParams.get('longitude'), '26.73'); assert.equal(u.searchParams.get('wind_speed_unit'), 'ms');
  assert.ok(!u.search.includes('Tartu'));
  assert.equal(u.searchParams.get('forecast_days'), '7'); assert.match(u.searchParams.get('hourly'), /precipitation_probability/); assert.match(u.searchParams.get('daily'), /sunrise/); assert.match(u.searchParams.get('current'), /pressure_msl/);
});

test('weather is cached for ten minutes and falls back to stale data when the service is down', async () => {
  let calls = 0, t = 1_000_000, failing = false;
  const fetchImpl = async (...a) => { calls++; if (failing) throw new Error('offline'); return ok(body)(...a); };
  const weatherFor = createWeather(fetchImpl, () => t);
  const first = await weatherFor(place); assert.equal(first.weather.temperature, 15.6); assert.equal(first.stale, false);
  t += 5 * 60000; await weatherFor(place); assert.equal(calls, 1, 'vahemälus');
  t += 6 * 60000; failing = true;
  const stale = await weatherFor(place); assert.equal(calls, 2); assert.equal(stale.stale, true); assert.match(stale.error, /ühendust/); assert.equal(stale.weather.temperature, 15.6);
  t += 4 * 3600000;
  const gone = await weatherFor(place); assert.equal(gone.weather, null); assert.ok(gone.error);
  const other = await createWeather(async () => { throw new Error('x'); })({ name: 'Uus', latitude: 1, longitude: 2 }); assert.equal(other.weather, null);
});

test('service errors become readable messages', async () => {
  const bad = createWeather(async () => ({ ok: false, status: 503 }));
  assert.match((await bad(place)).error, /503/);
  const junk = createWeather(ok({ nope: 1 }));
  assert.ok((await junk(place)).error);
});

test('place search validates the query and keeps only usable results', async () => {
  const results = [{ name: 'Tartu', latitude: 58.38, longitude: 26.72, admin2: 'Tartu linn', admin1: 'Tartu maakond', country: 'Eesti Vabariik', country_code: 'EE' }, { name: 'Bad', latitude: null, longitude: 1 }, { latitude: 1, longitude: 1 }];
  const found = await searchPlaces('Tartu', ok({ results }));
  assert.equal(found.length, 1); assert.deepEqual(found[0], { name: 'Tartu', latitude: 58.38, longitude: 26.72, region: 'Tartu linn, Eesti Vabariik', countryCode: 'EE' });
  assert.deepEqual(await searchPlaces('xyz', ok({})), []);
  await assert.rejects(searchPlaces('a', ok({})), WeatherError); await assert.rejects(searchPlaces('x'.repeat(61), ok({})), WeatherError);
  let url = ''; await searchPlaces('Ülenurme & co', async u => { url = u; return ok({ results: [] })(); });
  assert.ok(url.includes(encodeURIComponent('Ülenurme & co')) && !url.includes('& co'));
});
