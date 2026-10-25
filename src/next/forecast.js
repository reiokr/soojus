// Kuu elektrikulu prognoos: ajalooline kompressori elektritarbimine vs. küttekraadid
// (HDD, baas 15 °C) + lähiaja ilmaprognoos. Kaugemate päevade jaoks kasutatakse
// ajaloolist same-aja keskmist. See on hinnang, mitte garantii.
import { dayCost, effectiveRates, nightHours, splitElectric } from './tariff.js';

const DAY_MS = 86400000;
const pad = value => String(value).padStart(2, '0');
const localDay = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
const average = values => values.length ? values.reduce((sum, value) => sum + Number(value), 0) / values.length : null;
const finite = value => value == null || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;

// Vähimruutude sirge y = a + b·HDD. b<0 ei ole küttepumba puhul mõistlik, siis jääb ainult baastarve.
export function fitElectricModel(days, { base = 15, minCoverage = 0.5, minDays = 7 } = {}) {
  const rows = (days ?? []).filter(day => finite(day?.electricKwh) != null && finite(day?.outdoor) != null && (day.coverage == null || day.coverage >= minCoverage))
    .map(day => ({ day: day.day, outdoor: Number(day.outdoor), electricKwh: Math.max(0, Number(day.electricKwh)) }));
  if (rows.length < minDays) return null;
  const xs = rows.map(day => Math.max(0, base - day.outdoor));
  const ys = rows.map(day => day.electricKwh);
  const n = rows.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
  const denominator = n * sxx - sx * sx;
  let b = denominator > 1e-9 ? (n * sxy - sx * sy) / denominator : 0;
  let a = (sy - b * sx) / n;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < 0) { b = 0; a = average(ys); }
  a = Math.max(0, a);
  const rmse = Math.sqrt(rows.reduce((sum, day, index) => sum + (ys[index] - (a + b * xs[index])) ** 2, 0) / n);
  return { a, b, base, n, rmse, meanKwh: average(ys), minDay: rows[0].day, maxDay: rows.at(-1).day };
}

export function predictDaily(model, outdoor) {
  return Math.max(0, model.a + model.b * Math.max(0, model.base - Number(outdoor)));
}

function monthDayKey(day) {
  const [, month, date] = String(day).split('-').map(Number);
  return month * 31 + date;
}

// Sama aastaaja ajalooline keskmine temperatuur (kuupäev ±5 päeva). Kui seda pole,
// kasutatakse viimase 14 päeva keskmist.
function climateOutdoor(history, day) {
  const target = monthDayKey(day);
  const values = history
    .filter(row => finite(row.outdoor) != null && row.day && row.day < day)
    .filter(row => Math.abs(monthDayKey(row.day) - target) <= 5)
    .map(row => Number(row.outdoor));
  return average(values);
}

function forecastTemperatures(forecastDays) {
  const map = new Map();
  for (const day of forecastDays ?? []) {
    if (!day?.date) continue;
    const max = finite(day.max), min = finite(day.min);
    const mean = max != null && min != null ? (max + min) / 2 : max ?? min;
    if (mean != null) map.set(day.date, mean);
  }
  return map;
}

export function forecastMonth({ historyDays = [], forecastDays = [], tariff, now = new Date(), base = 15 } = {}) {
  const year = now.getFullYear(), month = now.getMonth();
  const prefix = `${year}-${pad(month + 1)}`;
  const totalDays = new Date(year, month + 1, 0).getDate();
  const today = localDay(now);
  const daysElapsed = now.getDate();
  const history = (historyDays ?? []).filter(row => row?.day);
  const electricKnown = history.some(row => finite(row.electricKwh) != null);
  if (!electricKnown) return { available: false, reason: 'noElectric', month: prefix, daysInMonth: totalDays, daysElapsed, daysRemaining: totalDays - daysElapsed };

  const actualDays = history.filter(row => row.day.startsWith(prefix) && row.day <= today && finite(row.electricKwh) != null);
  const actualCoverage = daysElapsed > 0 ? actualDays.length / daysElapsed : 1;
  const actualKwh = actualDays.reduce((sum, row) => sum + Number(row.electricKwh), 0);
  const actualCost = actualDays.reduce((sum, row) => sum + (dayCost(row, tariff) ?? 0), 0);
  const fitDays = history.filter(row => row.day < today).sort((a, b) => a.day.localeCompare(b.day));
  const model = fitElectricModel(fitDays, { base });
  const recent = fitDays.filter(row => finite(row.electricKwh) != null && finite(row.outdoor) != null).slice(-14);
  const fallbackDaily = average(recent.map(row => Number(row.electricKwh))) ?? model?.meanKwh ?? null;
  const recentOutdoor = average(recent.map(row => Number(row.outdoor))) ?? average(fitDays.map(row => finite(row.outdoor)).filter(value => value != null));
  if (fallbackDaily == null) return { available: false, reason: 'noHistory', month: prefix, daysInMonth: totalDays, daysElapsed, daysRemaining: totalDays - daysElapsed };

  const forecastMap = forecastTemperatures(forecastDays);
  const future = [];
  for (const cursor = new Date(year, month, daysElapsed + 1); cursor.getMonth() === month; cursor.setDate(cursor.getDate() + 1)) {
    const day = localDay(cursor);
    const forecastTemp = forecastMap.get(day);
    const climateTemp = forecastTemp == null ? climateOutdoor(fitDays, day) : null;
    const outdoor = forecastTemp ?? climateTemp ?? recentOutdoor;
    const source = forecastTemp != null ? 'forecast' : 'climate';
    const electricKwh = model ? predictDaily(model, outdoor) : fallbackDaily;
    future.push({ day, outdoor: outdoor == null ? null : round(outdoor, 1), electricKwh, source });
  }
  if (!future.length) {
    const fixed = effectiveRates(tariff).fixedMonthly;
    return { available: true, month: prefix, daysInMonth: totalDays, daysElapsed, daysRemaining: 0, actualKwh: round(actualKwh, 1), actualCost: round(actualCost, 2), forecastKwh: 0, forecastCost: 0, fixedCost: fixed, totalKwh: round(actualKwh, 1), totalCost: round(actualCost + fixed, 2), lowCost: round(actualCost + fixed, 2), highCost: round(actualCost + fixed, 2), model, forecastDaysUsed: 0, climateDaysUsed: 0, nightShare: 0, averageRate: 0, actualCoverage: round(actualCoverage, 2), confident: false, days: [] };
  }

  const forecastKwh = future.reduce((sum, day) => sum + day.electricKwh, 0);
  const rates = effectiveRates(tariff);
  const split = fitDays.reduce((sum, row) => {
    if (finite(row.electricKwh) == null) return sum;
    const parts = splitElectric(row, tariff.nightStart, tariff.nightEnd);
    sum.day += parts.dayKwh; sum.night += parts.nightKwh; return sum;
  }, { day: 0, night: 0 });
  const splitTotal = split.day + split.night;
  const nightShare = splitTotal > 0 ? split.night / splitTotal : nightHours(tariff.nightStart, tariff.nightEnd).length / 24;
  const averageRate = (1 - nightShare) * rates.day + nightShare * rates.night;
  const forecastCost = forecastKwh * averageRate;
  const fixedCost = rates.fixedMonthly;
  const totalKwh = actualKwh + forecastKwh;
  const totalCost = actualCost + forecastCost + fixedCost;
  // Ligikaudne vahemik: mudeli jääkviga + ilma/tarbimise ebakindlus.
  const dailyRmse = model?.rmse ?? (fallbackDaily ? fallbackDaily * 0.25 : 0);
  const errorKwh = Math.sqrt(dailyRmse ** 2 * future.length + (forecastKwh * 0.10) ** 2);
  const errorCost = errorKwh * averageRate;
  return {
    available: true,
    month: prefix,
    daysInMonth: totalDays,
    daysElapsed,
    daysRemaining: future.length,
    actualKwh: round(actualKwh, 1),
    actualCost: round(actualCost, 2),
    forecastKwh: round(forecastKwh, 1),
    forecastCost: round(forecastCost, 2),
    fixedCost: round(fixedCost, 2),
    totalKwh: round(totalKwh, 1),
    totalCost: round(totalCost, 2),
    lowCost: round(Math.max(0, totalCost - errorCost), 2),
    highCost: round(totalCost + errorCost, 2),
    model,
    fallbackDaily: fallbackDaily == null ? null : round(fallbackDaily, 1),
    forecastDaysUsed: future.filter(day => day.source === 'forecast').length,
    climateDaysUsed: future.filter(day => day.source === 'climate').length,
    nightShare: round(nightShare, 2),
    averageRate: round(averageRate, 4),
    confident: Boolean(model && model.n >= 14 && actualDays.length >= 3 && actualCoverage >= 0.8),
    actualCoverage: round(actualCoverage, 2),
    days: future.map(day => ({ ...day, electricKwh: round(day.electricKwh, 2) }))
  };
}
