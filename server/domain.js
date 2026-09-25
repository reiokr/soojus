export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
// v2 values are already scaled; min/max/step are raw metadata. Writes use display units.
export function pointBounds(point) {
  const scale = Number(point.scaleValue ?? 1);
  if (!Number.isFinite(scale) || scale <= 0) throw new AppError('Parameetri skaleering ei ole korrektne.');
  const scaled = x => x == null ? null : Number((Number(x) * scale).toFixed(8));
  return { min: scaled(point.minValue), max: scaled(point.maxValue), step: scaled(point.stepValue) };
}
export function validatePoint(point, value) {
  if (!point || !point.writable) throw new AppError('Seda parameetrit ei saa muuta.', 403);
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') throw new AppError('Sisesta parameetri väärtus.');
  if (point.enumValues?.length) {
    if (!point.enumValues.some(x => String(x.value) === String(value))) throw new AppError('Vali üks seadme lubatud väärtustest.');
  } else {
    const n = Number(value);
    const bounds = pointBounds(point);
    if (!Number.isFinite(n)) throw new AppError('Väärtus peab olema arv.');
    if (bounds.min != null && n < bounds.min) throw new AppError(`Väikseim lubatud väärtus on ${bounds.min}.`);
    if (bounds.max != null && n > bounds.max) throw new AppError(`Suurim lubatud väärtus on ${bounds.max}.`);
    if (bounds.step > 0) {
      const steps = (n - Number(bounds.min ?? 0)) / bounds.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-6) throw new AppError(`Lubatud samm on ${bounds.step}.`);
    }
  }
  return String(value);
}
export function pointResults(body, ids) {
  return ids.map(id => ({ id, status: body?.[id] ?? 'unknown', success: String(body?.[id]).toLowerCase() === 'modified' }));
}
export function validateZone(zone, input) {
  if (!zone) throw new AppError('Tsooni ei leitud.', 404);
  const result = {};
  for (const key of ['setpointHeat', 'setpointCool']) {
    if (input[key] === undefined) continue;
    if (zone[key] == null) throw new AppError('Seda sihtväärtust tsoon ei paku.');
    const n = Number(input[key]);
    if (input[key] === '' || input[key] == null || !Number.isFinite(n)) throw new AppError('Sisesta korrektne sihtväärtus.');
    if (zone.setpointRangeMin != null && n < zone.setpointRangeMin || zone.setpointRangeMax != null && n > zone.setpointRangeMax) throw new AppError('Sihtväärtus on väljaspool tsooni lubatud vahemikku.');
    result[key] = n;
  }
  if (input.mode !== undefined) {
    const modes = String(zone.supportedModes ?? '').split(/[,;\s]+/).filter(Boolean);
    if (!modes.includes(input.mode)) throw new AppError('Tsoon ei toeta seda režiimi.');
    result.mode = input.mode;
  }
  if (!Object.keys(result).length) throw new AppError('Vali vähemalt üks muudetav väärtus.');
  return result;
}
export function csvCell(value) {
  let str = String(value ?? '');
  if (/^[=+@\t\r]/.test(str) || /^-\D/.test(str)) str = `'${str}`;
  return `"${str.replaceAll('"', '""')}"`;
}
