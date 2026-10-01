import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sunMaxElevation, skyPlacement, sunTimes, moonName, sunPosition, moonPhase, moonPosition, skyColors, darkness, groundColors, windowGlow, luminance, mix, HOME } from '../src/next/live/sky.js';

const maxElevation = day => { let best = -90; for (let m = 0; m < 1440; m += 5) best = Math.max(best, sunPosition(new Date(Date.UTC(2026, day[0], day[1], 0, m)), HOME).elevation); return best; };

test('sun reaches the expected solstice and equinox heights at Tallinn latitude', () => {
  assert.ok(Math.abs(maxElevation([5, 21]) - 54.0) < 0.8, 'suvine pööre ~54°');
  assert.ok(Math.abs(maxElevation([11, 21]) - 7.1) < 0.8, 'talvine pööre ~7°');
  assert.ok(Math.abs(maxElevation([2, 20]) - 30.6) < 1, 'pööripäev ~31°');
});

test('sun is south at midday, low in the north at midnight and rises in the east in summer', () => {
  const noon = sunPosition(new Date(Date.UTC(2026, 5, 21, 10, 20)), HOME);
  assert.ok(noon.azimuth > 170 && noon.azimuth < 190, `keskpäev lõunas: ${noon.azimuth}`);
  const midnight = sunPosition(new Date(Date.UTC(2026, 5, 21, 22, 20)), HOME);
  assert.ok(midnight.elevation < 7 && (midnight.azimuth > 330 || midnight.azimuth < 30), 'kesköö põhjas ja madalal');
  const rise = sunPosition(new Date(Date.UTC(2026, 5, 21, 1, 10)), HOME);
  assert.ok(Math.abs(rise.elevation) < 4 && rise.azimuth > 30 && rise.azimuth < 70, `päikesetõus kirdes: ${rise.azimuth}`);
});

test('moon phase follows the synodic month', () => {
  const newMoon = moonPhase(new Date(Date.UTC(2026, 0, 18, 19, 52)));
  assert.ok(newMoon.illumination < 0.03, 'uuskuu 18.01.2026');
  const fullMoon = moonPhase(new Date(Date.UTC(2026, 0, 3, 10, 3)));
  assert.ok(fullMoon.illumination > 0.97, 'täiskuu 03.01.2026');
  const { illumination, waxing } = moonPhase(new Date(Date.UTC(2026, 0, 25, 12)));
  assert.ok(illumination > 0.4 && illumination < 0.6 && waxing, 'esimene veerand');
  const pos = moonPosition(new Date(Date.UTC(2026, 0, 3, 22)), HOME);
  assert.ok(Number.isFinite(pos.elevation) && pos.azimuth >= 0 && pos.azimuth < 360);
});

test('sky gets brighter with the sun and darkness falls after sunset', () => {
  const lum = e => luminance(skyColors(e).top) + luminance(skyColors(e).horizon);
  const samples = [-20, -10, -3, 3, 10, 20].map(lum);
  for (let i = 1; i < samples.length; i++) assert.ok(samples[i] > samples[i - 1], `kõrgus ${i}`);
  assert.ok(lum(50) > lum(10), 'kõrge päike on heledam kui madal');
  assert.equal(darkness(30), 0); assert.equal(darkness(-15), 1); assert.ok(darkness(-2) > 0.3 && darkness(-2) < 0.7);
  assert.match(skyColors(10).top, /^#[0-9a-f]{6}$/);
});

test('ground frosts in the cold and windows glow warmer when indoors is comfortable', () => {
  assert.ok(groundColors(-8).frost > 0.9 && groundColors(15).frost === 0);
  assert.ok(luminance(groundColors(-8).top) > luminance(groundColors(15).top));
  const cold = windowGlow(16, 0), cosy = windowGlow(22, 1);
  assert.ok(cosy.strength > cold.strength);
  assert.notEqual(cold.color, cosy.color);
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
});

import { buildLiveState, liveSummary, DEMOS } from '../src/next/live/state.js';

const base = { m: { water: { value: 46.3 }, power: { value: 0 }, supply: { value: 24.8 }, returnT: { value: 24.6 }, buffer: { value: 24 }, waterTarget: 45 }, climate: { outdoor: 17, indoor: 22.8 }, state: { heatOn: false, hwOn: false }, now: new Date(2026, 8, 30, 16, 0) };
const ventView = { mode: 'auto', modeText: 'Automaatne', data: { switches: { power: true, bypass: false }, fans: { supplyRpm: 1300, supplyLevel: 1 }, airflow: { supply: 100 }, co2: 590, temperatures: { supply: 21.2, extract: 22.8 }, heatRecovery: 79 } };

test('live state carries real readings and reports a resting pump', () => {
  const s = buildLiveState({ ...base, vent: ventView });
  assert.equal(s.demo, false); assert.equal(s.water, 46.3); assert.equal(s.indoor, 22.8); assert.equal(s.vent.level, 1); assert.equal(s.vent.running, true);
  assert.equal(liveSummary(s), 'pump puhkab, ventilatsioon töötab kiirusel 1/10');
  assert.equal(buildLiveState({ ...base }).vent.present, false);
  assert.equal(buildLiveState({ m: { water: { value: '' } } }).water, null);
});

test('demo modes override activity and are flagged, scrub moves only the clock', () => {
  assert.ok(Object.keys(DEMOS).length === 5);
  const heat = buildLiveState({ ...base, vent: ventView, demo: 'heat' });
  assert.equal(heat.demo, true); assert.equal(heat.heatOn, true); assert.equal(heat.hwOn, false); assert.equal(heat.powerKw, 3.4);
  const water = buildLiveState({ ...base, demo: 'water' });
  assert.equal(water.hwOn, true); assert.ok(water.water >= 50);
  const air = buildLiveState({ ...base, vent: ventView, demo: 'vent' });
  assert.equal(air.vent.level, 8); assert.equal(air.vent.mode, 'boost'); assert.equal(air.heatOn, false);
  const all = buildLiveState({ ...base, demo: 'all' });
  assert.ok(all.heatOn && all.hwOn && all.vent.present && all.vent.running);
  assert.match(liveSummary(all), /maja ja tarbevett/);
  const night = buildLiveState({ ...base, hour: 2.5 });
  assert.equal(night.time.getHours(), 2); assert.equal(night.time.getMinutes(), 30); assert.equal(night.time.getDate(), 30); assert.equal(night.water, 46.3);
});

test('sunrise and sunset times and moon names are plausible for Tallinn', () => {
  const hours = d => d.getUTCHours() + d.getUTCMinutes() / 60;
  const summer = sunTimes(new Date(Date.UTC(2026, 5, 21, 12)), HOME), winter = sunTimes(new Date(Date.UTC(2026, 11, 21, 12)), HOME);
  assert.ok(summer.rise && summer.set && winter.rise && winter.set);
  const summerLen = (summer.set - summer.rise) / 3600000, winterLen = (winter.set - winter.rise) / 3600000;
  assert.ok(summerLen > 18 && summerLen < 19.6, `suvepäev ${summerLen}`);
  assert.ok(winterLen > 5.3 && winterLen < 6.6, `talvepäev ${winterLen}`);
  assert.ok(Math.abs(hours(summer.rise) - 1.1) < 0.5, `tõus UTC ${hours(summer.rise)}`);
  assert.equal(moonName({ age: 0.5 }), 'täiskuu'); assert.equal(moonName({ age: 0.01 }), 'uuskuu'); assert.equal(moonName({ age: 0.25 }), 'esimene veerand'); assert.equal(moonName({ age: 0.9 }), 'kahanev kuusirp');
});

test('sun stays above the roof line at its culmination and sinks towards the hills in the evening', () => {
  for (const [m, d] of [[5, 21], [11, 21], [2, 20]]) {
    const day = new Date(2026, m, d, 12), max = sunMaxElevation(day, HOME), noon = new Date(Date.UTC(2026, m, d, 10, 20)), at = skyPlacement(sunPosition(noon, HOME), max);
    assert.ok(at.y < 200, `keskpäev ${m}: y=${at.y}`);
    assert.ok(Math.abs(at.x - 800) < 160, `keskpäev keskel: x=${at.x}`);
    const evening = skyPlacement(sunPosition(new Date(Date.UTC(2026, m, d, 14)), HOME), max);
    assert.ok(evening.y > at.y, 'õhtul madalamal');
  }
  assert.ok(sunMaxElevation(new Date(2026, 5, 21, 12), HOME) > sunMaxElevation(new Date(2026, 11, 21, 12), HOME) + 40);
  const below = skyPlacement({ azimuth: 300, elevation: -10 }, 30);
  assert.ok(below.y > 640 && below.x > 1100);
});

test('sky calculations follow the chosen place, not a fixed city', () => {
  const tartu = { lat: 58.3806, lon: 26.7251 };
  const day = new Date(Date.UTC(2026, 2, 20, 12));
  const a = sunTimes(day, HOME), b = sunTimes(day, tartu);
  const diffMin = (a.rise - b.rise) / 60000;
  assert.ok(diffMin > 5 && diffMin < 12, `Tartu päike tõuseb ~8 min varem: ${diffMin}`);
  assert.ok(Math.abs((a.set - b.set) / 60000 - diffMin) < 3);
  const noon = new Date(Date.UTC(2026, 5, 21, 9, 40));
  assert.notEqual(sunPosition(noon, HOME).azimuth.toFixed(1), sunPosition(noon, tartu).azimuth.toFixed(1));
  assert.ok(sunMaxElevation(new Date(2026, 5, 21, 12), tartu) < sunMaxElevation(new Date(2026, 5, 21, 12), { lat: 40, lon: 26.7 }));
  const live = buildLiveState({ now: new Date(2026, 8, 30, 12), place: { name: 'Tartu', latitude: 58.3806, longitude: 26.7251 }, forecast: { temperature: 14.8, code: 61, cloud: 100, precipitation: 1 } });
  assert.deepEqual(live.place, { lat: 58.3806, lon: 26.7251, name: 'Tartu' });
  assert.equal(live.weather.kind, 'rain'); assert.equal(live.outdoor, 14.8, 'andur puudub, kasutatakse ilmateenust');
  assert.equal(buildLiveState({ now: new Date(), climate: { outdoor: 20.5 }, forecast: { temperature: 14.8, code: 0 } }).outdoor, 20.5);
  assert.equal(buildLiveState({ now: new Date() }).place.name, 'Tallinn');
  assert.equal(buildLiveState({ now: new Date(), forecast: { temperature: 3, code: 0 }, weatherDemo: 'snow' }).weather.kind, 'snow');
  assert.equal(buildLiveState({ now: new Date(), weatherDemo: 'snow' }).demo, true);
});

test('brine temperatures from the pump reach the live state, and demo heating keeps the loop physically plausible', () => {
  const lux = { data: { outputs: { compressor: false, brinePump: false }, inputs: { brineFlow: true }, temperatures: { brineIn: 19.1, brineOut: 18.6, hotGas: 36.3 } } };
  const real = buildLiveState({ ...base, lux });
  assert.deepEqual(real.brine, { present: true, in: 19.1, out: 18.6, flow: true, pump: false, hotGas: 36.3 });
  assert.equal(real.compressor, false, 'kompressori olek tuleb pumbalt');
  assert.match(buildLiveState({ ...base, lux: { data: { ...lux.data, outputs: { compressor: true, brinePump: true } } } }).compressor.toString(), /true/);
  const demo = buildLiveState({ ...base, lux, demo: 'heat' });
  assert.ok(demo.brine.in - demo.brine.out >= 3.2 - 1e-9, 'töötades on soojakandja maasse külmem kui maast');
  assert.equal(demo.compressor, true);
  assert.equal(buildLiveState({ ...base }).brine.present, false);
  assert.equal(buildLiveState({ ...base, lux: { data: { outputs: {}, inputs: {}, temperatures: { brineIn: null, brineOut: 5 } } } }).brine.present, false);
});
