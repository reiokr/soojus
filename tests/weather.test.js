import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePlace, publicCoordinates, normalizeForecast, weatherLabel, weatherScene, compassName, weatherKind, dewPoint, windLabel, pressureLabel, uvLabel, visibilityLabel, outlook, daylight, DEFAULT_PLACE } from '../src/weather-logic.js';

test('places are validated, cleaned and rounded', () => {
  assert.deepEqual(validatePlace({ name: '  Ülenurme <b> ', latitude: '58.3162', longitude: 26.72517 }), { name: 'Ülenurme b', latitude: 58.3162, longitude: 26.7252 });
  assert.equal(validatePlace({ name: 'x'.repeat(200), latitude: 0, longitude: 0 }).name.length, 80);
  for (const bad of [null, {}, { name: '', latitude: 1, longitude: 1 }, { name: 'a', latitude: 91, longitude: 0 }, { name: 'a', latitude: 0, longitude: -181 }, { name: 'a', latitude: 'abc', longitude: 0 }, { name: 'a', latitude: null, longitude: 0 }, { name: 'a', latitude: Infinity, longitude: 0 }])
    assert.throws(() => validatePlace(bad), Error, JSON.stringify(bad));
  assert.deepEqual(publicCoordinates({ latitude: 58.38062, longitude: 26.72509 }), { latitude: 58.38, longitude: 26.73 });
  assert.equal(DEFAULT_PLACE.name, 'Tallinn');
});

const raw = { current: { time: '2026-09-30T18:15', temperature_2m: 15.6, apparent_temperature: 15.2, relative_humidity_2m: 83, precipitation: 0, rain: 0, showers: 0, snowfall: 0, weather_code: 3, cloud_cover: 93, wind_speed_10m: 2.3, wind_direction_10m: 82, is_day: 1, snow_depth: 0 },
  daily: { time: ['2026-09-30', '2026-10-01'], weather_code: [3, 61], temperature_2m_max: [16.9, 12], temperature_2m_min: [12.4, 7.5], precipitation_sum: [0, 4.2] } };

test('forecast response is normalised and missing values stay null', () => {
  const n = normalizeForecast(raw);
  assert.equal(n.temperature, 15.6); assert.equal(n.cloud, 93); assert.equal(n.isDay, true); assert.equal(n.days.length, 2); assert.deepEqual(n.days[1], { date: '2026-10-01', code: 61, max: 12, min: 7.5, precipitation: 4.2, rainChance: null, wind: null, gust: null, sunrise: null, sunset: null, uv: null });
  const sparse = normalizeForecast({ current: { temperature_2m: 3, weather_code: null, wind_speed_10m: '' } });
  assert.equal(sparse.code, 0); assert.equal(sparse.wind, null); assert.equal(sparse.snowDepth, null); assert.equal(sparse.isDay, null); assert.deepEqual(sparse.days, []);
  for (const bad of [null, {}, { current: {} }, { current: { temperature_2m: 'x' } }]) assert.throws(() => normalizeForecast(bad));
});

test('weather codes map to Estonian words and a drawable scene', () => {
  assert.equal(weatherLabel(0), 'selge'); assert.equal(weatherLabel(95), 'äike'); assert.equal(weatherLabel(123), 'teadmata');
  const clear = weatherScene({ code: 0, cloud: 4, wind: 2 });
  assert.equal(clear.kind, 'clear'); assert.ok(clear.cloud < 0.1 && clear.rain === 0 && clear.snow === 0);
  assert.equal(weatherScene({ code: 3, cloud: 50 }).kind, 'cloudy'); assert.ok(weatherScene({ code: 3, cloud: 50 }).cloud >= 0.85);
  const rain = weatherScene({ code: 65, cloud: 100, precipitation: 6 });
  assert.equal(rain.kind, 'rain'); assert.ok(rain.rain > 0.9 && rain.snow === 0);
  assert.ok(weatherScene({ code: 61, cloud: 100, precipitation: 0 }).rain >= 0.4);
  const snow = weatherScene({ code: 73, cloud: 100, snowfall: 1, snowDepth: 0.2 });
  assert.equal(snow.kind, 'snow'); assert.equal(snow.rain, 0); assert.equal(snow.snowCover, 1);
  assert.equal(weatherScene({ code: 45, cloud: 80 }).fog, 1); assert.equal(weatherScene({ code: 45 }).kind, 'fog');
  const storm = weatherScene({ code: 99, cloud: 100, wind: 20 });
  assert.ok(storm.storm && storm.kind === 'storm' && storm.wind === 1);
  assert.equal(weatherScene(null), null);
});

test('demo weather overrides the real values and is flagged', () => {
  const real = { code: 0, cloud: 0, temperature: 12 };
  for (const [demo, kind] of [['rain', 'rain'], ['snow', 'snow'], ['storm', 'storm'], ['fog', 'fog'], ['cloudy', 'cloudy'], ['clear', 'clear']]) {
    const s = weatherScene(real, demo); assert.equal(s.kind, kind, demo); assert.equal(s.demo, true); assert.equal(s.temperature, 12);
  }
  assert.equal(weatherScene(real, 'off').demo, false);
  assert.equal(compassName(82), 'idatuul'); assert.equal(compassName(0), 'põhjatuul'); assert.equal(compassName(355), 'põhjatuul'); assert.equal(compassName(null), '');
});

test('extended forecast keeps detail fields, local times and the next 24 hours', () => {
  const hours = Array.from({ length: 48 }, (_, i) => `${i < 24 ? '2026-09-30' : '2026-10-01'}T${String(i % 24).padStart(2, '0')}:00`);
  const full = normalizeForecast({
    current: { time: '2026-09-30T18:15', temperature_2m: 15, weather_code: 3, wind_gusts_10m: 9.4, pressure_msl: 1008.2, visibility: 24000 },
    hourly: { time: hours, temperature_2m: hours.map((_, i) => i), weather_code: hours.map(() => 61), precipitation_probability: hours.map(() => 40), precipitation: hours.map(() => 0.2), wind_speed_10m: hours.map(() => 3), is_day: hours.map((_, i) => (i % 24 >= 7 && i % 24 <= 18 ? 1 : 0)) },
    daily: { time: ['2026-09-30'], weather_code: [3], temperature_2m_max: [16], temperature_2m_min: [9], precipitation_sum: [1], precipitation_probability_max: [70], wind_speed_10m_max: [6], wind_gusts_10m_max: [11], sunrise: ['2026-09-30T07:12'], sunset: ['2026-09-30T18:55'], uv_index_max: [2.5] }
  });
  assert.equal(full.gust, 9.4); assert.equal(full.pressure, 1008.2); assert.equal(full.visibility, 24000);
  assert.equal(full.hourly.length, 24); assert.equal(full.hourly[0].time, '2026-09-30T18:00'); assert.equal(full.hourly[0].isDay, true); assert.equal(full.hourly[1].isDay, false);
  assert.deepEqual(full.days[0], { date: '2026-09-30', code: 3, max: 16, min: 9, precipitation: 1, rainChance: 70, wind: 6, gust: 11, sunrise: '2026-09-30T07:12', sunset: '2026-09-30T18:55', uv: 2.5 });
  assert.deepEqual(normalizeForecast({ current: { temperature_2m: 1 }, daily: { time: ['2026-09-30'], sunrise: ['bad'] } }).days[0].sunrise, null);
  assert.deepEqual(normalizeForecast({ current: { temperature_2m: 1 }, hourly: { time: ['x'], temperature_2m: [1] } }).hourly, []);
});

test('icon kinds, labels and derived values', () => {
  const kinds = { 0: 'clear', 1: 'clear', 2: 'partly', 3: 'cloudy', 45: 'fog', 51: 'drizzle', 61: 'rain', 82: 'rain', 73: 'snow', 86: 'snow', 95: 'storm', 99: 'storm' };
  for (const [code, kind] of Object.entries(kinds)) assert.equal(weatherKind(Number(code)), kind, code);
  assert.equal(weatherKind(null), 'cloudy');
  assert.ok(Math.abs(dewPoint(20, 50) - 9.3) < 0.2); assert.equal(dewPoint(null, 50), null); assert.equal(dewPoint(10, 0), null);
  assert.equal(windLabel(0.2), 'tuulevaikus'); assert.equal(windLabel(5), 'mõõdukas tuul'); assert.equal(windLabel(25), 'torm'); assert.equal(windLabel(null), '');
  assert.equal(pressureLabel(995), 'madal'); assert.equal(pressureLabel(1010), 'normaalne'); assert.equal(pressureLabel(1030), 'kõrge');
  assert.equal(uvLabel(1), 'madal'); assert.equal(uvLabel(7), 'kõrge'); assert.equal(uvLabel(12), 'äärmuslik');
  assert.equal(visibilityLabel(24000), 'väga hea'); assert.equal(visibilityLabel(500), 'väga kehv');
  assert.equal(daylight('2026-09-30T07:12', '2026-09-30T18:55'), 703); assert.equal(daylight(null, 'x'), null);
});

test('outlook finds coldest, warmest and the first wet hour', () => {
  assert.equal(outlook([]), null); assert.equal(outlook(null), null);
  const rows = [{ time: '2026-09-30T18:00', temperature: 12, precipitation: 0, rainChance: 10 }, { time: '2026-09-30T23:00', temperature: 4, precipitation: 0, rainChance: 20 }, { time: '2026-10-01T05:00', temperature: 9, precipitation: 0.4, rainChance: 30 }, { time: '2026-10-01T09:00', temperature: 14, precipitation: 0.3, rainChance: 80 }];
  assert.deepEqual(outlook(rows), { min: { temperature: 4, time: '2026-09-30T23:00' }, max: { temperature: 14, time: '2026-10-01T09:00' }, rainStart: '2026-10-01T05:00', rainTotal: 0.7 });
  assert.equal(outlook([{ time: 't', temperature: 5, precipitation: 0, rainChance: 5 }]).rainStart, null);
});
