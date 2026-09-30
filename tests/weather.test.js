import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePlace, publicCoordinates, normalizeForecast, weatherLabel, weatherScene, compassName, DEFAULT_PLACE } from '../src/weather-logic.js';

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
  assert.equal(n.temperature, 15.6); assert.equal(n.cloud, 93); assert.equal(n.isDay, true); assert.equal(n.days.length, 2); assert.deepEqual(n.days[1], { date: '2026-10-01', code: 61, max: 12, min: 7.5, precipitation: 4.2 });
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
