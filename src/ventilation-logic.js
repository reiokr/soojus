// CO₂ tase siseruumis: piirid on üldlevinud soovituslikud väärtused (ppm).
export function co2Quality(ppm) {
  if (!Number.isFinite(ppm)) return { key: 'unknown', label: 'teadmata' };
  if (ppm < 800) return { key: 'good', label: 'hea' };
  if (ppm < 1000) return { key: 'ok', label: 'rahuldav' };
  if (ppm < 1400) return { key: 'high', label: 'kõrge' };
  return { key: 'bad', label: 'väga kõrge' };
}

export function filterInfo(elapsedHours, intervalHours) {
  if (!Number.isFinite(elapsedHours) || !Number.isFinite(intervalHours) || intervalHours <= 0) return null;
  const used = Math.min(1, Math.max(0, elapsedHours / intervalHours)), left = Math.max(0, intervalHours - elapsedHours);
  return { used, percent: Math.round(used * 100), leftHours: left, leftDays: Math.round(left / 24) };
}

const one = (n, singular, plural) => n === 1 ? singular : plural;
const decimal = new Intl.NumberFormat('et-EE', { maximumFractionDigits: 1 });
// Tunnid päevadeks ja kuudeks: "365 päeva (12 kuud)". Kuu = 30,44 päeva.
export function daysWithMonths(hours) {
  if (!Number.isFinite(hours)) return '—';
  const days = Math.round(hours / 24), months = Math.round(days / 30.44 * 10) / 10;
  return `${days} ${one(days, 'päev', 'päeva')} (${decimal.format(months)} ${one(months, 'kuu', 'kuud')})`;
}

export function ventilationSentence(view) {
  const d = view?.data;
  if (!d) return '';
  const air = co2Quality(d.co2);
  if (!d.switches.power) return 'Ventilatsioon on välja lülitatud.';
  return `${view.modeText || 'Ventilatsioon'}, kiirus ${d.fans.supplyLevel}/10, õhu kvaliteet ${air.label} (CO₂ ${d.co2} ppm).`;
}

export const MODE_INFO = {
  auto: { label: 'Automaatne', hint: 'Kiirus järgib CO₂ taset' },
  manual: { label: 'Manuaalne', hint: 'Püsiv valitud kiirus' },
  boost: { label: 'Õhutus', hint: 'Ajutine boost, lõpeb kestuse möödudes' },
  overpressure: { label: 'Ülerõhk', hint: 'Kamina režiim, lõpeb kestuse möödudes' }
};

// Ainult päris toa- ja välistemperatuur: välisõhk tuleb soojuspumba andurilt, sisetemperatuur ventilatsiooni väljatõmbeõhult.
export function climate(pumpOutdoor, vent) {
  const num = v => v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null;
  const ventOutdoor = num(vent?.data?.temperatures?.outside);
  const pump = num(pumpOutdoor);
  return { outdoor: pump ?? ventOutdoor, outdoorSource: pump != null ? 'soojuspump' : ventOutdoor != null ? 'ventilatsioon' : null, indoor: num(vent?.data?.temperatures?.extract) };
}

export const climatePoints = [
  { parameterId: 'indoor', label: 'Toas (ventilatsioon)', parameterUnit: '°C' },
  { parameterId: 'outdoor', label: 'Väljas (soojuspump)', parameterUnit: '°C' }
];
// Päringu lisaosa virtuaalsele "toas vs väljas" ajaloole.
export const climateQuery = (pumpId, outdoorPointId) => `&pump=${encodeURIComponent(pumpId)}&outdoor=${encodeURIComponent(outdoorPointId)}`;
