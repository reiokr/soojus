// Elektritariifi puhtad abifunktsioonid: üks hind või päev/öö kahetariif.
// Öine aeg võib ületada keskööd (nt 22 → 7). Tunnijaotus tuleb energia-API päevarealt.

export const DEFAULT_TARIFF = Object.freeze({
  type: 'single',
  price: 0.19,
  dayPrice: 0.22,
  nightPrice: 0.12,
  nightStart: 22,
  nightEnd: 7
});

const hour = (value, fallback) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 23 ? number : fallback;
};
const price = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
};

export function parseTariff(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_TARIFF };
  return {
    type: raw.type === 'dual' ? 'dual' : 'single',
    price: price(raw.price, DEFAULT_TARIFF.price),
    dayPrice: price(raw.dayPrice, DEFAULT_TARIFF.dayPrice),
    nightPrice: price(raw.nightPrice, DEFAULT_TARIFF.nightPrice),
    nightStart: hour(raw.nightStart, DEFAULT_TARIFF.nightStart),
    nightEnd: hour(raw.nightEnd, DEFAULT_TARIFF.nightEnd)
  };
}

export function nightHours(start, end) {
  const from = hour(start, DEFAULT_TARIFF.nightStart), to = hour(end, DEFAULT_TARIFF.nightEnd);
  if (from === to) return [];
  const hours = [];
  for (let current = from; current !== to; current = (current + 1) % 24) hours.push(current);
  return hours;
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
  const config = parseTariff(tariff);
  if (config.type === 'single') return day.electricKwh * config.price;
  const { dayKwh, nightKwh } = splitElectric(day, config.nightStart, config.nightEnd);
  return dayKwh * config.dayPrice + nightKwh * config.nightPrice;
}

export function totalCost(days, tariff) {
  return (days ?? []).reduce((sum, day) => sum + (dayCost(day, tariff) ?? 0), 0);
}
