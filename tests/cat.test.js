import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CatBrain, CAT_ACTIONS, SOFA_ACTIONS, RADIATOR, SPOTS, SOFA, restPose } from '../src/next/live/cat.js';

const seeded = seed => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

test('cat sleeps first and then starts random actions', () => {
  const cat = new CatBrain(seeded(1), 0);
  assert.deepEqual(cat.update(0.5), { ...restPose(), tailPhase: 0.45 });
  let started = null;
  for (let t = 0.5; t < 20 && !started; t += 0.05) { const p = cat.update(t); if (p.act) started = p.act; }
  assert.ok(Object.keys(CAT_ACTIONS).includes(started));
});

test('every action runs, ends and never repeats twice in a row', () => {
  const cat = new CatBrain(seeded(7), 0), seen = new Set(), order = [];
  for (let t = 0; t < 6000; t += 0.05) {
    const p = cat.update(t);
    if (p.act && order.at(-1) !== p.act) { order.push(p.act); seen.add(p.act); }
  }
  assert.deepEqual([...seen].sort(), [...Object.keys(CAT_ACTIONS), ...Object.keys(SOFA_ACTIONS)].sort());
  for (let i = 1; i < order.length; i++) if (order[i] === order[i - 1]) assert.fail(`kordus: ${order[i]}`);
});

test('poses stay within drawable ranges', () => {
  const cat = new CatBrain(seeded(3), 0);
  for (let t = 0; t < 1500; t += 0.033) {
    const p = cat.update(t);
    assert.ok(p.mouth >= 0 && p.mouth <= 1 && p.squeeze >= 0 && p.squeeze <= 1 && p.stretch >= 0 && p.stretch <= 1 && p.tongue >= -0.001 && p.tongue <= 1.001, JSON.stringify(p));
    assert.ok(p.tail >= 0 && p.tail <= 1 && p.earBack >= 0 && p.earBack <= 1 && p.raise >= 0 && p.raise <= 7.001 && p.yaw >= 0 && p.yaw <= Math.PI + 0.001 && p.walk >= -0.001 && p.walk <= 1.001, JSON.stringify(p));
    assert.ok(p.sit >= 0 && p.sit <= 1.0001 && p.crouch >= 0 && p.crouch <= 1.0001 && p.air >= 0 && p.air <= 1.0001 && Math.abs(p.headYaw) <= 1.3 && (p.bird == null || (p.bird.u >= 0 && p.bird.u <= 1)) && Math.abs(p.tilt) <= 0.6 && p.y <= 0.001 && p.y >= -RADIATOR.h - 25 && p.x >= -410 && p.x <= 50, JSON.stringify(p));
    assert.ok(Math.abs(p.flip) <= 1.0001 && Math.abs(p.head) <= 0.9 && Math.abs(p.ear) <= 1.0001 && p.breath >= 0 && p.breath <= 1);
  }
});

test('turning: stands up, rotates half a turn in 3D and flips the facing direction when it finishes', () => {
  const cat = new CatBrain(seeded(5), 0);
  cat.begin(10, 'turn');
  const d = CAT_ACTIONS.turn.duration;
  const mid = cat.update(10 + d * 0.5);
  assert.ok(Math.abs(Math.cos(mid.yaw)) < 0.2, 'keskel on nägu vaataja poole');
  assert.ok(mid.raise > 6 && mid.walk > 0.9, 'seisab jalgadel ja astub');
  assert.equal(mid.flip, 1, 'pilt ei peegeldu, pöörde joonistab stseen');
  assert.ok(cat.update(10 + d * 0.05).yaw === 0 && cat.update(10 + d * 0.05).raise < 3);
  const end = cat.update(10 + d + 0.01);
  assert.equal(end.act === 'turn', false);
  assert.equal(end.raise, 0); assert.equal(end.yaw, 0);
  assert.equal(cat.dir, -1); assert.equal(end.flip, -1);
});

test('yawn opens the mouth wide at its peak and closes it again; lick shows the tongue', () => {
  const cat = new CatBrain(seeded(2), 0);
  cat.begin(0, 'yawn');
  assert.ok(cat.update(CAT_ACTIONS.yawn.duration * 0.5).mouth > 0.95);
  assert.equal(cat.update(CAT_ACTIONS.yawn.duration + 0.01).mouth, 0);
  cat.next = 1e9; cat.begin(100, 'lick');
  let maxTongue = 0, maxHead = 0;
  for (let t = 100; t < 100 + CAT_ACTIONS.lick.duration; t += 0.02) { const p = cat.update(t); maxTongue = Math.max(maxTongue, p.tongue); maxHead = Math.max(maxHead, p.head); }
  assert.ok(maxTongue > 0.8 && maxHead > 0.6);
});

test('sitting: sits down, looks around and lies down again in the same place', () => {
  const cat = new CatBrain(seeded(11), 0);
  cat.next = 1e9; cat.begin(0, 'sit');
  let maxSit = 0, maxLook = 0, minYaw = 0, x0 = cat.pos;
  for (let t = 0; t < cat.dur + 0.5; t += 0.05) { const p = cat.update(t); maxSit = Math.max(maxSit, p.sit); maxLook = Math.max(maxLook, Math.abs(p.headYaw)); minYaw = Math.min(minYaw, p.headYaw); if (!p.act) break; }
  assert.equal(maxSit, 1); assert.ok(maxLook > 0.3); assert.ok(minYaw >= -0.3, 'istudes ei kao nägu ära');
  const after = cat.update(cat.dur + 1);
  assert.equal(after.act, null); assert.equal(after.sit, 0); assert.equal(cat.pos, x0);
});

test('walking: stands up, turns if needed, walks to another spot and lies down there', () => {
  const cat = new CatBrain(seeded(4), 0);
  cat.next = 1e9; cat.begin(0, 'walk');
  const dest = cat.script.end.x, dur = cat.dur;
  assert.ok(SPOTS.includes(dest) && dest !== 0, 'uus koht');
  let walking = 0, xs = [];
  for (let t = 0; t < dur; t += 0.05) { const p = cat.update(t); if (p.walk > 0.99) walking++; xs.push(p.x); }
  assert.ok(walking > 20);
  for (let i = 1; i < xs.length; i++) assert.ok(Math.abs(xs[i] - xs[i - 1]) < 4, 'sujuv liikumine');
  const after = cat.update(dur + 0.1);
  assert.equal(after.act, null); assert.equal(cat.pos, dest); assert.equal(after.x, dest); assert.equal(after.raise, 0);
  assert.equal(cat.dir, dest < 0 ? -1 : 1);
});

test('window: hops onto the radiator, watches birds fly past with the face in view, hops down and goes back to a floor spot', () => {
  const cat = new CatBrain(seeded(9), 0);
  cat.next = 1e9; cat.begin(0, 'window');
  const dur = cat.dur;
  let top = 0, seatedX = null, minYaw = 0, minHead = 0, airborne = 0, maxTilt = 0, birds = 0, birdU = [];
  for (let t = 0; t < dur; t += 0.05) {
    const p = cat.update(t);
    top = Math.min(top, p.y); airborne = Math.max(airborne, p.air); maxTilt = Math.max(maxTilt, Math.abs(p.tilt));
    if (p.sit > 0.99 && p.y < -RADIATOR.h + 0.5) { seatedX = p.x; minYaw = Math.min(minYaw, p.headYaw); minHead = Math.min(minHead, p.head); if (p.bird) { birds++; birdU.push(p.bird.u); } }
  }
  assert.ok(top <= -RADIATOR.h - 1, 'jõuab radiaatorile'); assert.ok(airborne > 0.9 && maxTilt > 0.1);
  assert.equal(seatedX, RADIATOR.x);
  assert.ok(minYaw >= -0.3, 'nägu ei kao ära'); assert.ok(minHead < -0.28, 'pea üles akna poole');
  assert.ok(birds > 40 && Math.min(...birdU) < 0.1 && Math.max(...birdU) > 0.9, 'lind lendab akna ühest servast teise');
  const after = cat.update(dur + 0.1);
  assert.equal(after.act, null); assert.equal(after.y, 0); assert.equal(after.bird, null); assert.ok(SPOTS.includes(cat.pos));
  assert.ok(dur > 20 && dur < 45);
});

test('the cat never ends up between spots or in mid-air after long random play', () => {
  const cat = new CatBrain(seeded(21), 0);
  for (let t = 0; t < 6000; t += 0.1) {
    const p = cat.update(t);
    if (!p.act) {
      if (cat.onSofa) { assert.equal(cat.pos, SOFA.x, 'diivanil puhates on koht diivanil'); assert.equal(p.x, SOFA.x); assert.equal(p.y, SOFA.y); }
      else { assert.ok(SPOTS.includes(cat.pos), `asukoht ${cat.pos}`); assert.equal(p.y, 0); }
      assert.equal(p.sit, 0); assert.equal(p.raise, 0); assert.equal(p.yaw, 0);
    }
  }
});

test('diivanitegevused: maga, istu, pööra ja tule maha töötavad eraldi', () => {
  const cat = new CatBrain(seeded(11), 0);
  cat.next = 1e9; cat.onSofa = true; cat.pos = SOFA.x; cat.dir = 1;

  cat.begin(0, 'sofaSleep');
  let slept = false;
  for (let t = 0; t < cat.dur; t += 0.05) { const p = cat.update(t); if (p.sleeping) slept = true; assert.equal(p.x, SOFA.x); assert.equal(p.y, SOFA.y); }
  assert.ok(slept, 'magab diivanil');
  cat.update(cat.dur + 0.1);

  cat.begin(100, 'sofaSit');
  let maxSit = 0;
  for (let t = 100; t < 100 + cat.dur; t += 0.05) maxSit = Math.max(maxSit, cat.update(t).sit);
  assert.equal(maxSit, 1, 'istub diivanil');
  cat.update(100 + cat.dur + 0.1);

  const dir0 = cat.dir; cat.begin(200, 'sofaTurn');
  let turned = false;
  for (let t = 200; t < 200 + cat.dur; t += 0.05) { const p = cat.update(t); if (p.yaw > 2.4 && p.raise > 4) turned = true; }
  cat.update(200 + cat.dur + 0.1);
  assert.ok(turned, 'pöörab diivanil ümber');
  assert.equal(cat.dir, -dir0, 'pärast pööret on suund vastupidine');

  cat.begin(300, 'leaveSofa');
  const dur = cat.dur;
  cat.update(300 + dur + 0.1);
  assert.equal(cat.onSofa, false, 'tuleb diivanilt maha');
  assert.ok(SPOTS.includes(cat.pos));
});

test('sofa: kass läheb diivanile, teeb seal mitu eri tegevust pausidega ja tuleb lõpuks maha', () => {
  const cat = new CatBrain(seeded(11), 0);
  let visits = 0, prevOn = false, prevAct = null, gap = false, sofaCount = 0, gaps = 0, left = false;
  const distinct = new Set();
  for (let t = 0; t < 3000; t += 0.05) {
    const p = cat.update(t), on = cat.onSofa, act = p.act;
    if (on && !prevOn) visits++;
    if (!on && prevOn) left = true;
    const sofaAct = on && act && act.startsWith('sofa') && act !== 'leaveSofa';
    if (sofaAct && act !== prevAct) { sofaCount++; distinct.add(act); if (gap) gaps++; gap = false; }
    if (on && !act) gap = true;
    prevOn = on; prevAct = act;
  }
  assert.ok(visits > 0, 'külastab diivanit');
  assert.ok(left, 'tuleb ka diivanilt maha');
  assert.ok(sofaCount >= 3, `diivanil mitu tegevust (${sofaCount})`);
  assert.ok(distinct.size >= 2, `vähemalt kaks eri tegevust (${[...distinct].join(', ')})`);
  assert.ok(gaps >= 2, 'tegevuste vahel on pausid');
});

test('asukoha salvestus ja taastamine: põrandal ja diivanil', () => {
  const from = new CatBrain(seeded(11), 0);
  from.next = 1e9; from.begin(0, 'walk'); from.update(from.dur + 0.1);
  const spot = from.pos, dir = from.dir;
  assert.ok(SPOTS.includes(spot));
  const to = new CatBrain(seeded(1), 1000);
  to.restore(from.snapshot());
  assert.equal(to.pos, spot); assert.equal(to.dir, dir); assert.equal(to.onSofa, false);

  const sofa = new CatBrain(seeded(11), 0);
  sofa.next = 1e9; sofa.onSofa = true; sofa.pos = SOFA.x;
  const rest = new CatBrain(seeded(1), 0);
  rest.restore(sofa.snapshot());
  assert.equal(rest.onSofa, true); assert.equal(rest.pos, SOFA.x);

  // vigane salvestus ei riku asukohta
  const safe = new CatBrain(seeded(1), 0);
  safe.restore({ pos: 999, dir: 5, onSofa: false });
  assert.equal(safe.pos, 0); assert.equal(safe.dir, 1);
});
