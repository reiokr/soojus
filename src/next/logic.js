import { clipSpans, stateSpans, wzsvWorkState } from '../lib.js';
import { t } from '../i18n/index.js';

const HOUR = 3600000;

// Töörežiim ("küte", "tarbevesi") ei tähenda, et kompressor töötab: pärast viga võib pump tund aega seista, kuigi režiim näitab küttepäringut.
// Kui kompressori olek on teada, loetakse "kütab/soojendab" ainult töötava kompressori korral, muidu on see ootel.
export function pumpState({ workMode, heatingState, hwState, compressor }) {
  const mode = Number(workMode?.value);
  const modeHeat = mode === 0 || mode === 6 || Number(heatingState?.value) === 3;
  const modeHw = mode === 1 || Number(hwState?.value) === 3;
  const comp = compressor?.value == null ? null : Number(compressor.value) === 1;
  const heatOn = modeHeat && comp !== false, hwOn = modeHw && comp !== false;
  const heatDemand = !heatOn && (Number(heatingState?.value) === 2 || (modeHeat && comp === false));
  const hwDemand = !hwOn && (Number(hwState?.value) === 2 || (modeHw && comp === false));
  // Kompressori tegelik olek on töötamise peamine signaal; režiim ütleb ainult, mida parasjagu tehakse.
  const running = comp === true || heatOn || hwOn;
  return { heatOn, hwOn, heatDemand, hwDemand, compressor: comp, running, stalled: comp === false && (modeHeat || modeHw), stalledFor: modeHw && !modeHeat ? 'tarbevee soojendus' : 'küte' };
}

// Tarbevee temperatuur seatud sihi suhtes: mida kaugemal allpool, seda tugevam hoiatus.
// (Kütte puhul ei sobi pealevoolu ja tagasivoolu absoluutväärtusi hinnata, sest tarbevee
// kütmise ajal tõusevad need ajutiselt – seepärast on norm ainult akupaagil ja toatemperatuuril.)
export function dhwQuality(temp, target) {
  const cur = temp == null || temp === '' ? NaN : Number(temp), g = target == null || target === '' ? NaN : Number(target);
  if (!Number.isFinite(cur) || !Number.isFinite(g) || g <= 0) return null;
  const below = g - cur;
  // 1 K tolerants ainult anduri müra jaoks; juba 2 K allpool ei ole "siht käes".
  if (below <= 1) return { key: 'good', label: t('quality.atTarget') };
  if (below <= 5) return { key: 'high', label: t('quality.heatingUp') };
  return { key: 'bad', label: t('quality.belowTarget') };
}

// Akupaagi temperatuur kütte tagasivoolu sihi suhtes: paak peaks hoidma vähemalt sihttaset.
export function bufferQuality(temp, target) {
  const cur = temp == null || temp === '' ? NaN : Number(temp), g = target == null || target === '' ? NaN : Number(target);
  if (!Number.isFinite(cur) || !Number.isFinite(g)) return null;
  const below = g - cur;
  // Akupaak peab olema sihile lähemal kui 1 K, muidu on ta juba jahtunud.
  if (below <= 1) return { key: 'good', label: t('quality.atTarget') };
  if (below <= 6) return { key: 'high', label: t('quality.cooled') };
  return { key: 'bad', label: t('quality.cold') };
}

// Tervitus kellaaja järgi (näidatakse Elava kodu pildil kellaaja kohal; järgib pildil näidatavat aega, mitte alati praegust).
export function greeting(date = new Date()) {
  const h = date.getHours();
  return h < 5 ? t('live.greetNight') : h < 11 ? t('live.greetMorning') : h < 17 ? t('live.greetDay') : h < 22 ? t('live.greetEvening') : t('live.greetNight');
}

export function stateSentence(state, online) {
  if (!online) return 'Soojuspump on võrguühenduseta.';
  if (state.stalled) return `${state.stalledFor === 'küte' ? 'Küte' : 'Tarbevee soojendus'} on nõutud, aga kompressor seisab ja ootab käivitumist.`;
  if (state.hwOn && state.heatOn) return 'Pump kütab praegu maja ja tarbevett.';
  if (state.hwOn) return 'Pump soojendab praegu tarbevett.';
  if (state.heatOn) return 'Pump kütab praegu maja.';
  if (state.running) return 'Pump töötab.';
  if (state.heatDemand || state.hwDemand) return 'Pump ootab käivitamist.';
  return 'Pump puhkab.';
}

export function formatDuration(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return '0 min';
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

// Viimase 24 tunni kokkuvõte seisundi ajaloost; andmeta vahemikke ei loeta seisuajaks.
export function daySummary(stateRows, gaps, from, to) {
  const spans = clipSpans(stateSpans(stateRows, from, to, wzsvWorkState), gaps);
  const total = to - from;
  const covered = total - gaps.reduce((sum, g) => sum + Math.max(0, Math.min(g.to, to) - Math.max(g.from, from)), 0);
  const sum = kind => spans.filter(s => s.kind === kind).reduce((n, s) => n + (s.to - s.from), 0);
  return {
    spans,
    heatMs: sum('heat'),
    hwMs: sum('hw'),
    runMs: sum('heat') + sum('hw'),
    hwCycles: spans.filter(s => s.kind === 'hw').length,
    coverage: total > 0 ? Math.max(0, covered / total) : 0
  };
}

// Tellimuse aegumise hoiatus: null või { days, name }.
// Temperatuuri värv paagis: külm sinine → soe kollakas → kuum oranž.
const STOPS = [[15, [79, 159, 200]], [35, [216, 196, 120]], [50, [226, 140, 70]], [65, [200, 70, 40]]];
export function tempColor(t) {
  if (!Number.isFinite(t)) return 'rgb(150,150,150)';
  if (t <= STOPS[0][0]) return `rgb(${STOPS[0][1].join(',')})`;
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const [t0, c0] = STOPS[i - 1], [t1, c1] = STOPS[i], k = (t - t0) / (t1 - t0);
      return `rgb(${c0.map((v, j) => Math.round(v + (c1[j] - v) * k)).join(',')})`;
    }
  }
  return `rgb(${STOPS.at(-1)[1].join(',')})`;
}

export function scalePosition(t, min = 15, max = 65) {
  if (!Number.isFinite(t)) return 0;
  return Math.min(1, Math.max(0, (t - min) / (max - min)));
}

export function secondsAsText(seconds) {
  const minutes = Math.round(Number(seconds) / 60);
  if (!Number.isFinite(minutes)) return '—';
  return minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} h` : minutes > 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}
