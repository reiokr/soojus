import { t, getLocale } from './i18n/index.js';

// CO₂ tase siseruumis: piirid on üldlevinud soovituslikud väärtused (ppm).
export function co2Quality(ppm) {
  if (!Number.isFinite(ppm)) return { key: 'unknown', label: 'teadmata' };
  if (ppm < 800) return { key: 'good', label: t('quality.airGood') };
  if (ppm < 1000) return { key: 'ok', label: t('quality.airOk') };
  if (ppm < 1400) return { key: 'high', label: t('quality.airHigh') };
  return { key: 'bad', label: t('quality.airBad') };
}

// Infokaartide värv: roheline = normis, kollane = üle normi, punane = tugevalt üle normi.
// CO₂ järgib samu piire nagu co2Quality (800 / 1000 / 1400 ppm), niiskus mugavusvahemikku
// (30–60 %), VOC seadme enda sihttaset (vaikimisi 250), PM2,5 WHO soovitust (15 / 35 µg/m³)
// ja toatemperatuur mugavusvahemikku (19–25 °C). Tagastab ka lühikese sildi kaardi jaoks.
export function readingQuality(kind, value, setpoint = null) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return null;
  const v = Number(value), level = (key, label) => ({ key, label });
  if (kind === 'co2') {
    const q = co2Quality(v);
    return q.key === 'high' || q.key === 'bad' ? level(q.key, q.label) : level('good', q.key === 'ok' ? t('quality.ok') : t('quality.good'));
  }
  if (kind === 'hum') {
    if (v < 25) return level('bad', t('quality.veryDry'));
    if (v < 30) return level('high', t('quality.dry'));
    if (v > 70) return level('bad', t('quality.veryHumid'));
    if (v > 60) return level('high', t('quality.humid'));
    return level('good', t('quality.good'));
  }
  if (kind === 'voc') {
    const norm = Number.isFinite(Number(setpoint)) && Number(setpoint) > 0 ? Number(setpoint) : 250;
    if (v > norm * 1.3) return level('bad', t('quality.bad'));
    if (v > norm) return level('high', t('quality.high'));
    return level('good', t('quality.good'));
  }
  if (kind === 'pm25') {
    if (v > 35) return level('bad', t('quality.bad'));
    if (v > 15) return level('high', t('quality.high'));
    return level('good', t('quality.good'));
  }
  if (kind === 'temp') {
    if (v < 17) return level('bad', t('quality.cold'));
    if (v < 19) return level('high', t('quality.cool'));
    if (v > 27) return level('bad', t('quality.hot'));
    if (v > 25) return level('high', t('quality.warm'));
    return level('good', t('quality.good'));
  }
  return null;
}

export function filterInfo(elapsedHours, intervalHours) {
  if (!Number.isFinite(elapsedHours) || !Number.isFinite(intervalHours) || intervalHours <= 0) return null;
  const used = Math.min(1, Math.max(0, elapsedHours / intervalHours)), left = Math.max(0, intervalHours - elapsedHours);
  return { used, percent: Math.round(used * 100), leftHours: left, leftDays: Math.round(left / 24) };
}

const one = (n, singular, plural) => n === 1 ? singular : plural;
// Tunnid päevadeks ja kuudeks: "365 päeva (12 kuud)". Kuu = 30,44 päeva.
export function daysWithMonths(hours) {
  if (!Number.isFinite(hours)) return '—';
  const days = Math.round(hours / 24), months = Math.round(days / 30.44 * 10) / 10;
  const decimal = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 });
  return t('vent.daysMonths', {
    days, months: decimal.format(months),
    dayWord: one(days, t('common.day'), t('common.days')),
    monthWord: one(months, t('common.month'), t('common.months'))
  });
}

// Seadme režiimitekst on eesti keeles; kaardil ja lauses näidatakse tõlgitud nime.
const MODE_TEXT = { Automaatne: 'vent.automatic', Manuaalne: 'vent.manual', Õhutus: 'vent.boost', Ülerõhk: 'vent.overpressure' };
export const ventModeText = text => !text ? '' : (MODE_TEXT[text] ? t(MODE_TEXT[text]) : text);

export function ventilationSentence(view) {
  const d = view?.data;
  if (!d) return '';
  const air = co2Quality(d.co2);
  if (!d.switches.power) return t('vent.sentenceOff');
  return t('vent.sentence', { mode: ventModeText(view.modeText) || t('nav.ventilation'), level: d.fans.supplyLevel, air: air.label, co2: d.co2 });
}

export const MODE_INFO = {
  auto: { label: 'vent.modeAuto', hint: 'vent.hintAuto' },
  manual: { label: 'vent.modeManual', hint: 'vent.hintManual' },
  boost: { label: 'vent.modeBoost', hint: 'vent.hintBoost' },
  overpressure: { label: 'vent.modeOverpressure', hint: 'vent.hintOverpressure' }
};

// Ainult päris toa- ja välistemperatuur: välisõhk tuleb soojuspumba andurilt, sisetemperatuur ventilatsiooni väljatõmbeõhult.
export function climate(pumpOutdoor, vent) {
  const num = v => v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null;
  const ventOutdoor = num(vent?.data?.temperatures?.outside);
  const pump = num(pumpOutdoor);
  return { outdoor: pump ?? ventOutdoor, outdoorSource: pump != null ? 'soojuspump' : ventOutdoor != null ? 'ventilatsioon' : null, indoor: num(vent?.data?.temperatures?.extract) };
}

export const climatePoints = () => [
  { parameterId: 'indoor', label: t('vent.chartIndoor'), parameterUnit: '°C' },
  { parameterId: 'outdoor', label: t('vent.chartOutdoor'), parameterUnit: '°C' }
];
// Päringu lisaosa virtuaalsele "toas vs väljas" ajaloole.
export const climateQuery = (pumpId, outdoorPointId) => `&pump=${encodeURIComponent(pumpId)}&outdoor=${encodeURIComponent(outdoorPointId)}`;

const finiteNum = v => v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null;

// Möödaviigu klapi asend. Seade ise klapi asendit Modbusi kaudu ei edasta (ainult automaatrežiimi
// luba, coil 4003), seega tuletame selle juhendis kirjeldatud avanemistingimustest ja seadme enda
// soojustagastuse näidust: klapp avaneb, kui välisõhk on üle 13 °C ja jahedam kui väljatõmbeõhk,
// ning avatud klapi korral soojusvahetust ei toimu, mistõttu soojustagastus langeb (väike viivitus).
// Tagastab true = avatud, false = suletud, null = asend teadmata (nt seade seisab või andur puudub).
export const BYPASS_RECOVERY_MAX = 40;
export function bypassOpen(data) {
  if (!data?.switches?.bypass) return false; // automaatika väljas → klapp on alati suletud
  const outside = finiteNum(data.temperatures?.outside), extract = finiteNum(data.temperatures?.extract);
  const rpm = finiteNum(data.fans?.supplyRpm), recovery = finiteNum(data.heatRecovery);
  if (outside == null || extract == null || rpm == null || rpm <= 0) return null; // seade seisab
  if (outside <= 13 || outside >= extract) return false; // avanemistingimus pole täidetud
  if (recovery == null) return null;
  return recovery < BYPASS_RECOVERY_MAX;
}
