// Pakettide võrdlus: börsihinna kulu samast tunnijaotusest ja samadest võrgukomponentidest.
import { DEFAULT_TARIFF, parseTariff, splitElectric, dayCost, effectiveRates, nightHours } from './tariff.js';

export function spotMap(prices) {
  const map = new Map();
  for (const row of prices ?? []) map.set(`${row.day}:${row.hour}`, Number(row.price));
  return map;
}

export function variableCost(days, tariff) {
  return (days ?? []).reduce((sum, day) => sum + (dayCost(day, tariff) ?? 0), 0);
}

// Normaliseerib mõõdetud perioodi täispikkuseks: mõõtmislüngad jagatakse öise osakaalu järgi.
// Täielikult mõõdetud osa kasutab tegelikku tunnijaotust, puuduv osa käsitsi või ajaloolist osakaalu.
export function periodSplit(days, tariff, { coverage = null, nightShare = null } = {}) {
  const config = parseTariff(tariff), rates = effectiveRates(config);
  const clamp = value => Math.min(1, Math.max(0, Number(value)));
  let measuredKwh = 0, measuredDayKwh = 0, measuredNightKwh = 0, coverageSum = 0, count = 0;
  for (const day of days ?? []) {
    measuredKwh += Number(day?.electricKwh) || 0;
    const split = splitElectric(day, config.nightStart, config.nightEnd);
    measuredDayKwh += split.dayKwh; measuredNightKwh += split.nightKwh;
    coverageSum += day?.coverage != null && Number.isFinite(Number(day.coverage)) ? clamp(day.coverage) : 1;
    count += 1;
  }
  const periodCoverage = coverage != null && Number.isFinite(Number(coverage)) ? clamp(coverage) : count ? coverageSum / count : 1;
  const estimatedKwh = periodCoverage > 0.05 ? measuredKwh / periodCoverage : measuredKwh;
  const missingKwh = Math.max(0, estimatedKwh - measuredKwh);
  const measuredSplit = measuredDayKwh + measuredNightKwh;
  const historyNightShare = measuredSplit > 0 ? measuredNightKwh / measuredSplit : nightHours(config.nightStart, config.nightEnd).length / 24;
  const manual = nightShare != null && Number.isFinite(Number(nightShare)) ? clamp(nightShare) : null;
  const share = manual == null ? historyNightShare : manual;
  return {
    measuredKwh, estimatedKwh, missingKwh,
    coverage: periodCoverage,
    dayKwh: measuredDayKwh + missingKwh * (1 - share),
    nightKwh: measuredNightKwh + missingKwh * share,
    measuredDayKwh, measuredNightKwh,
    historyNightShare, nightShare: share,
    averageRate: (1 - share) * rates.day + share * rates.night
  };
}

export function dualCost(days, dayPrice, nightPrice, nightStart, nightEnd) {
  let cost = 0, kwh = 0;
  for (const day of days ?? []) {
    const split = splitElectric(day, nightStart, nightEnd);
    cost += split.dayKwh * dayPrice + split.nightKwh * nightPrice;
    kwh += split.dayKwh + split.nightKwh;
  }
  return { cost, kwh };
}

// Börsipakett: spot (EUR/kWh ilma KM-ta) + marginaal + võrgutasud ja tasud + KM.
// Võrgukomponendid tulevad detailtariifist; kui praegune pakett ei ole detailne, kasutatakse vaikimisi V2 komponente.
export function exchangeCost(days, spot, tariff, margin = 0) {
  const config = parseTariff(tariff);
  const base = config.type === 'detail' ? config : DEFAULT_TARIFF;
  const factor = 1 + base.vat / 100;
  const fees = base.security + base.excise + base.renewable;
  const night = new Set(nightHours(config.nightStart, config.nightEnd));
  let cost = 0, covered = 0, total = 0;
  for (const day of days ?? []) {
    const dayTotal = Number(day.electricKwh) || 0;
    total += dayTotal;
    const byHour = Array.isArray(day.electricByHour) ? day.electricByHour : null;
    if (!byHour) continue;
    for (let hour = 0; hour < 24; hour++) {
      const kwh = Number(byHour[hour]) || 0;
      if (!kwh) continue;
      const price = spot?.get(`${day.day}:${hour}`);
      if (price == null || !Number.isFinite(price)) continue;
      const network = night.has(hour) ? base.networkNight : base.networkDay;
      cost += kwh * (price + margin + network + fees) * factor;
      covered += kwh;
    }
  }
  return { cost, covered, total, missing: Math.max(0, total - covered), coverage: total > 0 ? covered / total : 0, average: covered > 0 ? cost / covered : null };
}
