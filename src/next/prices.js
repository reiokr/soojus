// Pakettide võrdlus: börsihinna kulu samast tunnijaotusest ja samadest võrgukomponentidest.
import { DEFAULT_TARIFF, parseTariff, splitElectric, dayCost, nightHours } from './tariff.js';

export function spotMap(prices) {
  const map = new Map();
  for (const row of prices ?? []) map.set(`${row.day}:${row.hour}`, Number(row.price));
  return map;
}

export function variableCost(days, tariff) {
  return (days ?? []).reduce((sum, day) => sum + (dayCost(day, tariff) ?? 0), 0);
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
