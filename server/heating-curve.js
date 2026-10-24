// Küttekõvera andmed: seadme tagasivoolu siht (punkt 2) välisõhu (punkt 5) suhtes.
// Kõver tuletatakse ajaloost, sest seadme enda kõvera parameetrid API kaudu ei ole.
const finite = value => value == null || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

export function buildHeatingCurve(rows, { maxScatter = 800 } = {}) {
  const valid = (rows ?? []).map(row => ({
    time: row.time,
    outdoor: finite(row.outdoor),
    target: finite(row.target),
    return: finite(row.return),
    supply: finite(row.supply),
    compressor: finite(row.compressor)
  })).filter(row => row.outdoor != null && row.outdoor >= -35 && row.outdoor <= 35);

  const bins = new Map();
  for (const row of valid) {
    if (row.target == null || row.target <= 0 || row.target > 80) continue;
    const key = Math.round(row.outdoor * 2) / 2;
    const entry = bins.get(key) ?? { outdoor: key, targetSum: 0, returnSum: 0, supplySum: 0, count: 0 };
    entry.targetSum += row.target;
    if (row.return != null) entry.returnSum += row.return;
    if (row.supply != null) entry.supplySum += row.supply;
    entry.count += 1;
    bins.set(key, entry);
  }

  const points = [...bins.values()]
    .map(entry => ({
      outdoor: entry.outdoor,
      target: round(entry.targetSum / entry.count, 2),
      return: entry.returnSum ? round(entry.returnSum / entry.count, 1) : null,
      supply: entry.supplySum ? round(entry.supplySum / entry.count, 1) : null,
      count: entry.count
    }))
    .sort((a, b) => a.outdoor - b.outdoor);

  const active = valid.filter(row => (row.compressor ?? 0) > 0.5 && row.return != null && row.return >= 15 && row.return <= 45 && row.target != null && row.target > 0);
  const stride = Math.max(1, Math.ceil(active.length / maxScatter));
  const scatter = active.filter((_, index) => index % stride === 0).map(row => ({ outdoor: round(row.outdoor, 1), return: round(row.return, 1), supply: row.supply == null ? null : round(row.supply, 1) }));

  return {
    points,
    scatter,
    count: valid.length,
    outdoorMin: points.length ? points[0].outdoor : null,
    outdoorMax: points.length ? points.at(-1).outdoor : null
  };
}
