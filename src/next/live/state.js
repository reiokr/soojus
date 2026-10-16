// "Elava kodu" hetkeseis: päris andmed ühes lamedas objektis; demo-režiim üle kirjutab olekud, et animatsioone saaks igal ajal vaadata.
import { weatherScene } from '../../weather-logic.js';
import { bypassOpen } from '../../ventilation-logic.js';
import { HOME } from './sky.js';

const num = v => { const n = v == null || v === '' ? NaN : Number(v); return Number.isFinite(n) ? n : null; };

export const DEMOS = { off: 'Päris andmed', heat: 'Kütmine', water: 'Tarbevee laadimine', vent: 'Ventilatsioon', all: 'Kõik korraga' };

export function buildLiveState({ m = {}, climate = {}, vent = null, state = {}, now = new Date(), demo = 'off', hour = null, place = null, forecast = null, weatherDemo = 'off', lux = null }) {
  const d = vent?.data;
  const live = {
    time: new Date(now), demo: demo !== 'off' || weatherDemo !== 'off',
    place: place && Number.isFinite(place.latitude) ? { lat: place.latitude, lon: place.longitude, name: place.name } : { ...HOME, name: 'Tallinn' },
    weather: weatherScene(forecast, weatherDemo),
    outdoor: num(climate.outdoor) ?? num(forecast?.temperature), indoor: num(climate.indoor),
    water: num(m.water?.value), waterTarget: num(m.waterTarget), buffer: num(m.buffer?.value),
    supply: num(m.supply?.value), returnT: num(m.returnT?.value), powerKw: num(m.power?.value) ?? 0,
    compressor: lux?.data ? Boolean(lux.data.outputs.compressor) : m.compressor?.value == null ? null : Number(m.compressor.value) === 1,
    brine: lux?.data && num(lux.data.temperatures.brineIn) != null && num(lux.data.temperatures.brineOut) != null ? { present: true, in: lux.data.temperatures.brineIn, out: lux.data.temperatures.brineOut, flow: Boolean(lux.data.inputs.brineFlow), pump: Boolean(lux.data.outputs.brinePump), hotGas: num(lux.data.temperatures.hotGas) } : { present: false, in: null, out: null, flow: false, pump: false, hotGas: null },
    heatOn: Boolean(state.heatOn), hwOn: Boolean(state.hwOn), heatDemand: Boolean(state.heatDemand), hwDemand: Boolean(state.hwDemand),
    vent: d ? {
      present: true, running: d.switches.power && d.fans.supplyRpm > 0, level: d.fans.supplyLevel, rpm: d.fans.supplyRpm, airflow: d.airflow.supply,
      co2: d.co2, supplyTemp: d.temperatures.supply, extractTemp: d.temperatures.extract, recovery: d.heatRecovery, bypass: d.switches.bypass, bypassOpen: bypassOpen(d),
      humidity: Number.isFinite(d.humidity?.extract) ? d.humidity.extract : null,
      mode: vent.mode, modeText: vent.modeText
    } : { present: false, running: false, level: 0, rpm: 0, airflow: 0, co2: 500, supplyTemp: null, extractTemp: null, recovery: 0, bypass: false, bypassOpen: null, humidity: null, mode: null, modeText: null }
  };
  if (hour != null && Number.isFinite(hour)) {
    const t = new Date(now), h = Math.min(23.99, Math.max(0, hour));
    t.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0);
    live.time = t;
  }
  live.compressor = live.compressor ?? (live.heatOn || live.hwOn);
  const heat = demo === 'heat' || demo === 'all', water = demo === 'water' || demo === 'all', air = demo === 'vent' || demo === 'all';
  if ((demo === 'heat' || demo === 'water' || demo === 'all') && live.brine.present) Object.assign(live.brine, { out: Math.min(live.brine.out, live.brine.in - 3.2) });
  if (heat) Object.assign(live, { compressor: true, heatOn: true, heatDemand: false, powerKw: 3.4, supply: 38, returnT: 31, buffer: 36 });
  if (water) Object.assign(live, { compressor: true, hwOn: true, hwDemand: false, powerKw: 4.2, supply: 52, returnT: 44, water: Math.max(live.water ?? 0, 50), waterTarget: live.waterTarget ?? 55 });
  if (air) Object.assign(live.vent, { present: true, running: true, level: 8, rpm: 2600, airflow: 240, co2: 1150, recovery: live.vent.recovery || 80, mode: 'boost', modeText: 'Õhutus', supplyTemp: live.vent.supplyTemp ?? 19, extractTemp: live.vent.extractTemp ?? 22, humidity: live.vent.humidity ?? 46 });
  if (demo === 'all') live.powerKw = 4.2;
  return live;
}

// Lühikirjeldus ekraanilugejale ja HUD-ile.
export function liveSummary(live) {
  const parts = [];
  if (live.hwOn && live.heatOn) parts.push('pump kütab maja ja tarbevett');
  else if (live.hwOn) parts.push('pump soojendab tarbevett');
  else if (live.heatOn) parts.push('pump kütab maja');
  else if (live.heatDemand || live.hwDemand) parts.push('pump ootab käivitumist, kompressor seisab');
  else parts.push('pump puhkab');
  if (live.vent.present) parts.push(`ventilatsioon ${live.vent.running ? `töötab kiirusel ${live.vent.level}/10` : 'seisab'}`);
  return parts.join(', ');
}
