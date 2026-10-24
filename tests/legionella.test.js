import test from 'node:test';
import assert from 'node:assert/strict';
import { nextOccurrence, advanceNext, normalizeLegionella, legionellaAction, beginRun, endRun, shiftAfterManual, legionellaStop, legionellaPoke, legionellaPlateau, defaultLegionella } from '../server/legionella.js';

const DAY = 86400000;
// Kohalik aeg, et test ei sõltuks ajavööndist.
const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();

test('next occurrence finds the next chosen weekday and time', () => {
  // R 23.10.2026 12:00 → pühapäev 25.10 kell 03:00
  const sunday = new Date(nextOccurrence(6, '03:00', at(2026, 10, 23, 12)));
  assert.equal(sunday.getDay(), 0);
  assert.equal(sunday.getDate(), 25);
  assert.equal(sunday.getHours(), 3);
  // sama päev, kellaaeg veel ees → täna
  const today = new Date(nextOccurrence(6, '03:00', at(2026, 10, 25, 2)));
  assert.equal(today.getDate(), 25);
  assert.equal(today.getHours(), 3);
  // sama päev, kellaaeg möödas → nädal hiljem
  const week = new Date(nextOccurrence(6, '03:00', at(2026, 10, 25, 4)));
  assert.equal(week.getDate(), 1);
  assert.equal(week.getMonth(), 10);
  assert.equal(nextOccurrence(0, '25:00'), null);
});

test('legionella config accepts only 1/2/4 weeks, a valid weekday/time and sane target/duration', () => {
  const bad = normalizeLegionella({ enabled: true, weeks: 3, weekday: 9, time: '25:00', target: 90, durationMin: 45 }, null, at(2026, 10, 23));
  assert.equal(bad.weeks, 4);
  assert.equal(bad.weekday, 6);
  assert.equal(bad.time, '03:00');
  assert.equal(bad.target, 65);
  assert.equal(bad.durationMin, 30);
  assert.ok(bad.nextRun);
  const ok = normalizeLegionella({ enabled: true, weeks: 2, weekday: 0, time: '04:30', target: 61.5, durationMin: 60 }, null, at(2026, 10, 23));
  assert.equal(ok.weeks, 2);
  assert.equal(ok.weekday, 0);
  assert.equal(ok.time, '04:30');
  assert.equal(ok.target, 61.5);
  assert.equal(ok.durationMin, 60);
  const monday = new Date(ok.nextRun);
  assert.equal(monday.getDay(), 1);
  assert.equal(monday.getHours(), 4);
  assert.equal(monday.getMinutes(), 30);
});

test('advance keeps the anchored rhythm (every N weeks, same weekday)', () => {
  const cfg = { ...defaultLegionella(), weeks: 4, nextRun: new Date(at(2026, 9, 1, 3)).toISOString() };
  const next = advanceNext(cfg, at(2026, 9, 1, 5));
  assert.equal(Date.parse(next) - Date.parse(cfg.nextRun), 28 * DAY);
  // kui vahepeal jäi mitu korda vahele, hüppab järgmise tuleviku korrani
  const far = advanceNext(cfg, at(2026, 11, 1));
  assert.ok(Date.parse(far) > at(2026, 11, 1));
});

test('legionella action: start when due, skip when badly late, stop when the run ends', () => {
  const now = at(2026, 10, 23);
  const due = { ...defaultLegionella(), enabled: true, nextRun: new Date(now - 60000).toISOString() };
  assert.equal(legionellaAction(due, now), 'start');
  assert.equal(legionellaAction({ ...due, nextRun: new Date(now - 5 * DAY).toISOString() }, now), 'skip');
  assert.equal(legionellaAction({ ...due, enabled: false }, now), null);
  assert.equal(legionellaAction({ ...due, nextRun: new Date(now + DAY).toISOString() }, now), null);
  const run = beginRun(due, now);
  assert.ok(run.running?.startedAt);
  assert.equal(run.lastRun, run.running.startedAt);
  assert.equal(legionellaAction(run, now + 60000), 'running');
  assert.equal(legionellaAction(run, Date.parse(run.running.endsAt) + 1000), 'stop');
  const done = endRun(run, Date.parse(run.running.endsAt));
  assert.equal(done.running, null);
  assert.ok(Date.parse(done.nextRun) > Date.parse(run.running.endsAt));
});

test('a manual run counts as this cycle and pushes the next scheduled run forward', () => {
  const now = at(2026, 10, 23, 12); // reede enne pühapäevast graafikut
  const cfg = { ...defaultLegionella(), enabled: true, weeks: 4, weekday: 6, time: '03:00', nextRun: new Date(at(2026, 10, 25, 3)).toISOString() };
  const next = shiftAfterManual(cfg, now);
  assert.ok(Date.parse(next) > now + 21 * DAY, 'vähemalt kolm nädalat edasi');
  const d = new Date(next);
  assert.equal(d.getDay(), 0);
  assert.equal(d.getHours(), 3);
});

test('legionella run re-arms the device boost until the target is reached, then stops', () => {
  const now = at(2026, 10, 23, 12);
  const run = beginRun({ ...defaultLegionella(), enabled: true, target: 63, durationMin: 30, weeks: 4 }, now);
  // kohe pärast algust: ei peata ega kinnita uuesti
  assert.equal(legionellaStop(run, 50, now + 5 * 60000), false);
  assert.equal(legionellaPoke(run, 50, now + 5 * 60000), false);
  // 10 min pärast ja siht veel saavutamata → kinnita siht uuesti
  assert.equal(legionellaPoke(run, 50, now + 11 * 60000), true);
  assert.equal(legionellaPoke(run, 63, now + 11 * 60000), false);
  // siht käes, aga kestus pole täis → veel ei peata
  assert.equal(legionellaStop(run, 63, now + 10 * 60000), false);
  assert.equal(legionellaStop(run, 63, now + 31 * 60000), true);
  // 4 h turvapiir peatab ka siis, kui siht jäi saavutamata
  assert.equal(legionellaStop(run, 50, now + 4 * 3600000 + 1000), true);
});

test('a run stops when the temperature has not improved for 30 minutes', () => {
  const now = at(2026, 10, 23, 12);
  const run = beginRun({ ...defaultLegionella(), enabled: true, target: 63, durationMin: 30, weeks: 4 }, now);
  assert.equal(legionellaPlateau(run, 59.6, now + 10 * 60000), false);
  const stalled = { ...run, running: { ...run.running, lastTemp: 59.6, lastTempAt: new Date(now).toISOString() } };
  assert.equal(legionellaPlateau(stalled, 59.6, now + 29 * 60000), false);
  assert.equal(legionellaPlateau(stalled, 59.6, now + 31 * 60000), true);
  assert.equal(legionellaPlateau(run, null, now + 31 * 60000), false);
});
