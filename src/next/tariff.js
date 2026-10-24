// Elektritariifi puhtad abifunktsioonid.
// - single: üks lõpphind (koos maksudega)
// - dual:   päeva/öö lõpphinnad (koos maksudega)
// - detail: arve komponendid (energia, võrk, tasud, käibemaks) → arvutab päeva/öö hinna
// Öine aeg võib ületada keskööd (nt 22 → 7). Tunnijaotus tuleb energia-API päevarealt.

export const DEFAULT_TARIFF = Object.freeze({
  type: 'single',
  price: 0.19,
  dayPrice: 0.22,
  nightPrice: 0.12,
  nightStart: 22,
  nightEnd: 7,
  // Detailne vaade, Elektrum Eesti september 2026, Pilka mõõtepunkt (410,338 kWh).
  // Energiahind sisaldab tasakaalustamisvõimsuse kulu (0,10025 + 0,00373).
  energyPrice: 0.10398,
  networkDay: 0.0607,
  networkNight: 0.0351,
  security: 0.00758,
  excise: 0.0021,
  renewable: 0.0084,
  vat: 24,
  monthlyNetwork: 8.34,
  monthlySeller: 1.54,
  includeMonthly: false
});

const hour = (value, fallback) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 23 ? number : fallback;
};
const price = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
};
const percent = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : fallback;
};

export function parseTariff(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_TARIFF };
  const type = raw.type === 'dual' ? 'dual' : raw.type === 'detail' ? 'detail' : 'single';
  return {
    type,
    price: price(raw.price, DEFAULT_TARIFF.price),
    dayPrice: price(raw.dayPrice, DEFAULT_TARIFF.dayPrice),
    nightPrice: price(raw.nightPrice, DEFAULT_TARIFF.nightPrice),
    nightStart: hour(raw.nightStart, DEFAULT_TARIFF.nightStart),
    nightEnd: hour(raw.nightEnd, DEFAULT_TARIFF.nightEnd),
    energyPrice: price(raw.energyPrice, DEFAULT_TARIFF.energyPrice),
    networkDay: price(raw.networkDay, DEFAULT_TARIFF.networkDay),
    networkNight: price(raw.networkNight, DEFAULT_TARIFF.networkNight),
    security: price(raw.security, DEFAULT_TARIFF.security),
    excise: price(raw.excise, DEFAULT_TARIFF.excise),
    renewable: price(raw.renewable, DEFAULT_TARIFF.renewable),
    vat: percent(raw.vat, DEFAULT_TARIFF.vat),
    monthlyNetwork: price(raw.monthlyNetwork, DEFAULT_TARIFF.monthlyNetwork),
    monthlySeller: price(raw.monthlySeller, DEFAULT_TARIFF.monthlySeller),
    includeMonthly: raw.includeMonthly === true
  };
}

export function nightHours(start, end) {
  const from = hour(start, DEFAULT_TARIFF.nightStart), to = hour(end, DEFAULT_TARIFF.nightEnd);
  if (from === to) return [];
  const hours = [];
  for (let current = from; current !== to; current = (current + 1) % 24) hours.push(current);
  return hours;
}

// Ühine päeva/öö lõpphind (€/kWh, koos käibemaksuga) ja kuutasu (€/kuu, koos KM-ga).
export function effectiveRates(tariff) {
  const config = parseTariff(tariff);
  if (config.type === 'single') return { day: config.price, night: config.price, fixedMonthly: 0 };
  if (config.type === 'dual') return { day: config.dayPrice, night: config.nightPrice, fixedMonthly: 0 };
  const factor = 1 + config.vat / 100;
  const base = config.energyPrice + config.security + config.excise + config.renewable;
  return {
    day: (base + config.networkDay) * factor,
    night: (base + config.networkNight) * factor,
    fixedMonthly: config.includeMonthly ? (config.monthlyNetwork + config.monthlySeller) * factor : 0
  };
}

// Jagab päeva elektri päevaseks ja öiseks. Kui tunnijaotust pole (vanad koondatud read),
// kasutatakse öötundide osakaalu kogu päevast.
export function splitElectric(day, start, end) {
  const total = Number(day?.electricKwh) || 0;
  const hours = nightHours(start, end);
  const night = new Set(hours);
  const byHour = Array.isArray(day?.electricByHour) ? day.electricByHour : null;
  if (!byHour) {
    const nightKwh = total * hours.length / 24;
    return { dayKwh: total - nightKwh, nightKwh };
  }
  let nightKwh = 0;
  for (let h = 0; h < 24; h++) if (night.has(h)) nightKwh += Number(byHour[h]) || 0;
  return { dayKwh: Math.max(0, total - nightKwh), nightKwh };
}

export function dayCost(day, tariff) {
  if (day?.electricKwh == null) return null;
  const config = parseTariff(tariff), rates = effectiveRates(config);
  if (config.type === 'single') return day.electricKwh * rates.day;
  const { dayKwh, nightKwh } = splitElectric(day, config.nightStart, config.nightEnd);
  return dayKwh * rates.day + nightKwh * rates.night;
}

// Kuutasu jagatakse valitud perioodi peale (kuu = 30,44 päeva).
export function monthlyCost(tariff, periodDays = 30) {
  const config = parseTariff(tariff);
  if (config.type !== 'detail' || !config.includeMonthly) return 0;
  return (config.monthlyNetwork + config.monthlySeller) * (1 + config.vat / 100) * Math.max(0, Number(periodDays) || 0) / 30.44;
}

export function totalCost(days, tariff, periodDays = 30) {
  const variable = (days ?? []).reduce((sum, day) => sum + (dayCost(day, tariff) ?? 0), 0);
  return variable + monthlyCost(tariff, periodDays);
}
