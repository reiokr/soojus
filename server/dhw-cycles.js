// Tarbevee tsüklite tuvastus: kütmine, pausid, siht ja kestus.
// Sisend on minutipõhised read (water/target/hw/mode/compressor/power).
const MINUTE = 60000;
const TARGET_TOLERANCE = 0.5;
const PAUSE_SPLIT_MINUTES = 45;
const MAX_CYCLES = 30;
const MIN_CYCLE_MINUTES = 3; // ühe-kahe minutilised täiendused ei ole eraldi tsüklid

const finite = value => value == null || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
const iso = time => new Date(time).toISOString();

function pushSegment(cycle, type, time) {
  const last = cycle.segments.at(-1);
  if (last?.type === type) { last.to = time + MINUTE; last.minutes += 1; }
  else cycle.segments.push({ type, from: time, to: time + MINUTE, minutes: 1 });
}

function closeCycle(cycle, cycles, { reached, ongoing, stopReason, end }) {
  const durationMinutes = Math.max(1, Math.round((end - cycle.start) / MINUTE));
  cycles.push({
    start: iso(cycle.start),
    end: iso(end),
    ongoing,
    reachedTarget: reached,
    stopReason,
    startTemp: round(cycle.startTemp),
    minTemp: round(cycle.minTemp),
    maxTemp: round(cycle.maxTemp),
    target: cycle.target == null ? null : round(cycle.target, 1),
    maxTarget: cycle.maxTarget == null ? null : round(cycle.maxTarget, 1),
    durationMinutes,
    heatingMinutes: Math.round(cycle.heatingMinutes),
    pauseMinutes: Math.round(cycle.pauseMinutes),
    pauseCount: cycle.segments.filter(segment => segment.type === 'pause').length,
    maxPower: round(cycle.maxPower),
    avgPower: cycle.powerCount ? round(cycle.powerSum / cycle.powerCount) : null,
    segments: cycle.segments.map(segment => ({ type: segment.type, minutes: segment.minutes, from: iso(segment.from), to: iso(segment.to) }))
  });
}

export function buildDhwCycles(rows, { now = Date.now() } = {}) {
  const points = (rows ?? []).map(row => ({
    time: Date.parse(row.time),
    water: finite(row.water),
    target: finite(row.target),
    hw: finite(row.hw),
    mode: finite(row.mode),
    compressor: finite(row.compressor),
    power: finite(row.power)
  })).filter(row => Number.isFinite(row.time) && row.water != null).sort((a, b) => a.time - b.time);
  if (!points.length) return { cycles: [], summary: { count: 0, reached: 0, ongoing: 0, avgDurationMinutes: null, avgPauseMinutes: null, totalPauseMinutes: 0 } };

  // Sumbumine: hw/mode/target/compressor tulevad mõnikord harvemini kui temperatuur.
  let target = null, hw = null, mode = null, compressor = null;
  const clean = points.map(row => {
    if (row.target != null) target = row.target;
    if (row.hw != null) hw = row.hw;
    if (row.mode != null) mode = row.mode;
    if (row.compressor != null) compressor = row.compressor;
    return { ...row, target, hw, mode, compressor };
  });

  const active = row => row.hw === 3 || row.hw === 2 || (row.hw == null && row.mode === 1);
  const running = row => Number(row.compressor) >= 0.5;
  const cycles = [];
  let cycle = null;

  const close = (why, end, ongoing = false, reached = false) => {
    if (!cycle) return;
    closeCycle(cycle, cycles, { reached, ongoing, stopReason: why, end });
    cycle = null;
  };

  for (let i = 0; i < clean.length; i++) {
    const row = clean[i];
    if (cycle && row.time - cycle.lastTime > 15 * MINUTE) close('gap', cycle.lastTime + MINUTE);
    const isActive = active(row);
    if (!cycle && isActive) {
      cycle = {
        start: row.time, lastTime: row.time, startTemp: row.water, minTemp: row.water, maxTemp: row.water,
        target: row.target, maxTarget: row.target, heatingMinutes: 0, pauseMinutes: 0,
        powerSum: 0, powerCount: 0, maxPower: 0, pauseStart: null, segments: []
      };
    }
    if (!cycle) continue;
    const heating = isActive && running(row);
    pushSegment(cycle, heating ? 'heat' : 'pause', row.time);
    if (heating) {
      cycle.heatingMinutes += 1;
      if (row.power != null) { cycle.powerSum += row.power; cycle.powerCount += 1; cycle.maxPower = Math.max(cycle.maxPower, row.power); }
    } else cycle.pauseMinutes += 1;
    cycle.minTemp = Math.min(cycle.minTemp, row.water);
    cycle.maxTemp = Math.max(cycle.maxTemp, row.water);
    if (row.target != null) { cycle.target = row.target; cycle.maxTarget = Math.max(cycle.maxTarget ?? row.target, row.target); }
    cycle.lastTime = row.time;

    const reached = cycle.maxTarget != null && cycle.maxTemp >= cycle.maxTarget - TARGET_TOLERANCE;
    if (reached) { close('target', row.time + MINUTE, false, true); continue; }
    if (!isActive) {
      if (cycle.pauseStart == null) cycle.pauseStart = row.time;
      if (row.time - cycle.pauseStart >= PAUSE_SPLIT_MINUTES * MINUTE) close('pause', row.time + MINUTE);
    } else cycle.pauseStart = null;
  }
  if (cycle) {
    const ongoing = now - cycle.lastTime < 15 * MINUTE;
    close(ongoing ? 'ongoing' : 'end', cycle.lastTime + MINUTE, ongoing, false);
  }

  const recent = cycles.filter(item => item.ongoing || item.durationMinutes >= MIN_CYCLE_MINUTES).slice(-MAX_CYCLES);
  const closed = recent.filter(item => !item.ongoing);
  const summary = {
    count: recent.length,
    reached: recent.filter(item => item.reachedTarget).length,
    ongoing: recent.filter(item => item.ongoing).length,
    avgDurationMinutes: closed.length ? Math.round(closed.reduce((sum, item) => sum + item.durationMinutes, 0) / closed.length) : null,
    avgPauseMinutes: closed.length ? Math.round(closed.reduce((sum, item) => sum + item.pauseMinutes, 0) / closed.length) : null,
    totalPauseMinutes: recent.reduce((sum, item) => sum + item.pauseMinutes, 0)
  };
  return { cycles: recent, summary };
}
