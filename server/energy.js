// Energia- ja kuluaruanne: soojus- ja elektrivõimsuse ajaline integraal päevade kaupa.
// Andmed tulevad pumba kohalikust liidesest (Luxtronik): power_heat ja power_ac.
// Kui kohalikku liidest pole, saab soojusvõimsuse myUplinki punktist 21, aga elektrit ja COP-i siis ei arvutata.

const DAY_MS = 86400000;
export const MAX_GAP_SECONDS = 900; // pikem vaheaeg ei ole usaldusväärne mõõtmine
export const MAX_DAYS = 366;

const finite = value => value == null || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const dayOf = iso => iso.slice(0, 10);
const addDay = day => new Date(Date.parse(`${day}T00:00:00.000Z`) + DAY_MS).toISOString().slice(0, 10);
const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

// samples: [{ time, power_ac, power_heat }] – ajaliselt järjestamata või osalised read.
// Tagastab päevad (from…to, puuduvad päevad nullidega) ja summad. Iga intervall jaotatakse
// kesköö piiril päevade vahel; pikem kui MAX_GAP_SECONDS vaheaeg loetakse katkestuseks.
export function dailyEnergy(samples, { from = null, to = null, maxGap = MAX_GAP_SECONDS } = {}) {
  const rows = (samples ?? [])
    .map(row => ({ time: row.time, ac: finite(row.power_ac), heat: finite(row.power_heat) }))
    .filter(row => row.time && (row.ac != null || row.heat != null))
    .sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0);

  const counts = new Map();
  for (const row of rows) { const day = dayOf(row.time); counts.set(day, (counts.get(day) ?? 0) + 1); }

  const days = new Map();
  const ensure = day => {
    if (!days.has(day)) days.set(day, { day, electricKwh: 0, heatKwh: 0, hours: 0, segments: 0 });
    return days.get(day);
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i], next = rows[i + 1];
    const start = Date.parse(row.time);
    if (!Number.isFinite(start)) continue;
    // Vanad, kokkusurutud päevad hoiavad ühte päevakeskmist rida kell 00:00 – siis kehtib terve päev.
    const compacted = counts.get(dayOf(row.time)) <= 1 && row.time.slice(11, 19) === '00:00:00';
    let end = next ? Date.parse(next.time) : start + (compacted ? DAY_MS : maxGap * 1000);
    if (to && Number.isFinite(Date.parse(to))) end = Math.min(end, Date.parse(to));
    if (!Number.isFinite(end) || end <= start) continue;
    let cursor = start;
    while (cursor < end) {
      const day = new Date(cursor).toISOString().slice(0, 10);
      const midnight = Date.parse(`${day}T00:00:00.000Z`) + DAY_MS;
      const segmentEnd = Math.min(end, midnight);
      const seconds = Math.min((segmentEnd - cursor) / 1000, compacted ? 86400 : maxGap);
      const entry = ensure(day);
      if (row.ac != null) entry.electricKwh += row.ac * seconds / 3600;
      if (row.heat != null) entry.heatKwh += row.heat * seconds / 3600;
      if ((row.ac ?? 0) > 0.1) entry.hours += seconds / 3600;
      entry.segments += 1;
      cursor = segmentEnd;
    }
  }

  const keys = [...days.keys()].sort();
  const first = from ? dayOf(from) : keys[0];
  const last = to ? dayOf(to) : keys.at(-1);
  const list = [];
  if (first && last && first <= last) {
    for (let day = first, guard = 0; day <= last && guard < MAX_DAYS + 1; day = addDay(day), guard++) {
      const entry = days.get(day) ?? { day, electricKwh: 0, heatKwh: 0, hours: 0, segments: 0 };
      list.push({
        ...entry,
        electricKwh: round(entry.electricKwh),
        heatKwh: round(entry.heatKwh),
        hours: round(entry.hours, 1),
        cop: entry.electricKwh > 0.001 ? round(entry.heatKwh / entry.electricKwh, 2) : null
      });
    }
  }

  const totals = list.reduce((sum, day) => ({
    electricKwh: sum.electricKwh + day.electricKwh,
    heatKwh: sum.heatKwh + day.heatKwh,
    hours: sum.hours + day.hours
  }), { electricKwh: 0, heatKwh: 0, hours: 0 });
  totals.electricKwh = round(totals.electricKwh);
  totals.heatKwh = round(totals.heatKwh);
  totals.hours = round(totals.hours, 1);
  totals.cop = totals.electricKwh > 0.001 ? round(totals.heatKwh / totals.electricKwh, 2) : null;
  return { days: list, totals };
}

// Pivot: ühel ajahetkel olevad punktid üheks reaks.
function pivot(rows) {
  const byTime = new Map();
  for (const row of rows) {
    const entry = byTime.get(row.time) ?? {};
    if (row.point === 'power_ac') entry.power_ac = row.value;
    else if (row.point === 'power_heat') entry.power_heat = row.value;
    byTime.set(row.time, entry);
  }
  return [...byTime].map(([time, entry]) => ({ time, ...entry }));
}

export function energyReport(db, { deviceId, from, to, luxId = 'luxtronik', maxGap } = {}) {
  const luxRows = db.prepare(`SELECT time, point, value FROM samples WHERE device=? AND point IN ('power_ac','power_heat') AND time>=? AND time<? ORDER BY time`).all(luxId, from, to);
  const samples = pivot(luxRows);
  let source = 'lux', electricKnown = true;
  if (!samples.length) {
    // Varuvariant: myUplinki punkt 21 on soojusvõimsus (kW), elektriandmeid sellest ei saa.
    const rows = db.prepare(`SELECT time, value FROM samples WHERE device=? AND point='21' AND time>=? AND time<? ORDER BY time`).all(deviceId, from, to);
    samples.push(...rows.map(row => ({ time: row.time, power_heat: row.value })));
    source = 'uplink';
    electricKnown = false;
  }
  const series = dailyEnergy(samples, { from, to, maxGap });
  if (source === 'uplink') {
    for (const day of series.days) { day.electricKwh = null; day.cop = null; day.hours = null; }
    series.totals.electricKwh = null; series.totals.cop = null; series.totals.hours = null;
  }
  const outdoor = new Map(db.prepare(`SELECT substr(time,1,10) AS day, AVG(value) AS value FROM samples WHERE device=? AND point='5' AND time>=? AND time<? GROUP BY day`).all(deviceId, from, to).map(row => [row.day, round(row.value, 1)]));
  for (const day of series.days) day.outdoor = outdoor.get(day.day) ?? null;
  return { from, to, source, electricKnown, days: series.days, totals: series.totals };
}
