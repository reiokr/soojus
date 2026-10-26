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
  // Katkestused: päevane kWh on ainult mõõdetud osa. Normaliseerime täispäevaks,
  // et mudel ei õpiks poolikutest päevadest vale tarbimist.
  const rows = (days ?? [])
    .filter(day => finite(day?.electricKwh) != null && finite(day?.outdoor) != null)
    .map(day => {
      const coverage = Math.min(1, Math.max(0, finite(day.coverage) ?? 1));
      return { day: day.day, outdoor: Number(day.outdoor), coverage, electricKwh: Math.max(0, Number(day.electricKwh)) / Math.max(coverage, minCoverage) };
    })
    .filter(row => row.coverage >= minCoverage);
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

  const fitDays = history.filter(row => row.day < today).sort((a, b) => a.day.localeCompare(b.day));
  const model = fitElectricModel(fitDays, { base });
  const recent = fitDays
    .filter(row => finite(row.electricKwh) != null && finite(row.outdoor) != null && (finite(row.coverage) ?? 1) >= 0.5)
    .slice(-14)
    .map(row => ({ ...row, normalized: Number(row.electricKwh) / Math.max(0.5, Math.min(1, finite(row.coverage) ?? 1)) }));
  const fallbackDaily = average(recent.map(row => row.normalized)) ?? model?.meanKwh ?? null;
  const recentOutdoor = average(recent.map(row => Number(row.outdoor))) ?? average(fitDays.map(row => finite(row.outdoor)).filter(value => value != null));
  if (fallbackDaily == null) return { available: false, reason: 'noHistory', month: prefix, daysInMonth: totalDays, daysElapsed, daysRemaining: totalDays - daysElapsed };

  const rates = effectiveRates(tariff);
  const split = fitDays.reduce((sum, row) => {
    if (finite(row.electricKwh) == null) return sum;
    const parts = splitElectric(row, tariff.nightStart, tariff.nightEnd);
    sum.day += parts.dayKwh; sum.night += parts.nightKwh; return sum;
  }, { day: 0, night: 0 });
  const splitTotal = split.day + split.night;
  const nightShare = splitTotal > 0 ? split.night / splitTotal : nightHours(tariff.nightStart, tariff.nightEnd).length / 24;
  const averageRate = (1 - nightShare) * rates.day + nightShare * rates.night;

  // Kuu kulunud osa: mõõdetud kWh + katvuse põhjal hinnatud puuduv osa.
  // Kui päev on osaliselt mõõdetud, arvutame puuduva osa mudeli järgi; kui päev on täiesti puudu, siis terve päeva mudeli järgi.
  const byDay = new Map(history.map(row => [row.day, row]));
  let actualKwh = 0, actualCost = 0, measuredKwh = 0, measuredCost = 0, imputedKwh = 0, imputedCost = 0, coverageSum = 0, gapDays = 0;
  for (let dayNumber = 1; dayNumber <= daysElapsed; dayNumber++) {
    const day = `${prefix}-${pad(dayNumber)}`;
    const row = byDay.get(day);
    const coverage = Math.min(1, Math.max(0, finite(row?.coverage) ?? 0));
    coverageSum += coverage;
    if (coverage < 0.95) gapDays++;
    const measured = finite(row?.electricKwh);
    const outdoor = finite(row?.outdoor) ?? recentOutdoor;
    const predicted = model && outdoor != null ? predictDaily(model, outdoor) : fallbackDaily;
    if (measured != null && coverage >= 0.999) {
      actualKwh += measured;
      const cost = dayCost(row, tariff) ?? measured * averageRate;
      actualCost += cost; measuredKwh += measured; measuredCost += cost;
    } else if (measured != null && coverage > 0.01) {
      const missing = 1 - coverage, missingKwh = missing * predicted;
      const measuredPartCost = dayCost(row, tariff) ?? measured * averageRate;
      actualKwh += measured + missingKwh;
      actualCost += measuredPartCost + missingKwh * averageRate;
      measuredKwh += measured; measuredCost += measuredPartCost;
      imputedKwh += missingKwh; imputedCost += missingKwh * averageRate;
    } else {
      actualKwh += predicted;
      actualCost += predicted * averageRate;
      imputedKwh += predicted; imputedCost += predicted * averageRate;
    }
  }
  const actualCoverage = daysElapsed > 0 ? coverageSum / daysElapsed : 1;

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
  const fixedCost = rates.fixedMonthly;
  if (!future.length) {
    return { available: true, month: prefix, daysInMonth: totalDays, daysElapsed, daysRemaining: 0, actualKwh: round(actualKwh, 1), actualCost: round(actualCost, 2), measuredKwh: round(measuredKwh, 1), measuredCost: round(measuredCost, 2), imputedKwh: round(imputedKwh, 1), imputedCost: round(imputedCost, 2), forecastKwh: 0, forecastCost: 0, fixedCost, totalKwh: round(actualKwh, 1), totalCost: round(actualCost + fixedCost, 2), lowCost: round(actualCost + fixedCost, 2), highCost: round(actualCost + fixedCost, 2), model, forecastDaysUsed: 0, climateDaysUsed: 0, nightShare: 0, averageRate, actualCoverage: round(actualCoverage, 2), gapDays, confident: false, days: [] };
  }

  const forecastKwh = future.reduce((sum, day) => sum + day.electricKwh, 0);
  const forecastCost = forecastKwh * averageRate;
  const totalKwh = actualKwh + forecastKwh;
  const totalCost = actualCost + forecastCost + fixedCost;
  // Ligikaudne vahemik: mudeli jääkviga + ilma ebakindlus + katkestuste hinnang.
  const dailyRmse = model?.rmse ?? (fallbackDaily ? fallbackDaily * 0.25 : 0);
  const errorKwh = Math.sqrt(dailyRmse ** 2 * future.length + (forecastKwh * 0.10) ** 2 + (imputedKwh * 0.30) ** 2);
  const errorCost = errorKwh * averageRate;
  return {
    available: true,
    month: prefix,
    daysInMonth: totalDays,
    daysElapsed,
    daysRemaining: future.length,
    actualKwh: round(actualKwh, 1),
    actualCost: round(actualCost, 2),
    measuredKwh: round(measuredKwh, 1),
    measuredCost: round(measuredCost, 2),
    imputedKwh: round(imputedKwh, 1),
    imputedCost: round(imputedCost, 2),
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
    confident: Boolean(model && model.n >= 14 && daysElapsed >= 3 && actualCoverage >= 0.8),
    actualCoverage: round(actualCoverage, 2),
    gapDays,
    days: future.map(day => ({ ...day, electricKwh: round(day.electricKwh, 2) }))
  };
}
