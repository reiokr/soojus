import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CatBrain, CAT_ACTIONS, restPose } from '../src/next/live/cat.js';

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
  for (let t = 0; t < 4000; t += 0.05) {
    const p = cat.update(t);
    if (p.act && order.at(-1) !== p.act) { order.push(p.act); seen.add(p.act); }
  }
  assert.deepEqual([...seen].sort(), Object.keys(CAT_ACTIONS).sort());
  for (let i = 1; i < order.length; i++) if (order[i] === order[i - 1]) assert.fail(`kordus: ${order[i]}`);
});

test('poses stay within drawable ranges', () => {
  const cat = new CatBrain(seeded(3), 0);
  for (let t = 0; t < 1500; t += 0.033) {
    const p = cat.update(t);
    assert.ok(p.mouth >= 0 && p.mouth <= 1 && p.squeeze >= 0 && p.squeeze <= 1 && p.stretch >= 0 && p.stretch <= 1 && p.tongue >= -0.001 && p.tongue <= 1.001, JSON.stringify(p));
    assert.ok(p.tail >= 0 && p.tail <= 1 && p.earBack >= 0 && p.earBack <= 1 && p.lift >= -0.001 && p.lift <= 12, JSON.stringify(p));
    assert.ok(Math.abs(p.flip) <= 1.0001 && Math.abs(p.head) <= 0.9 && Math.abs(p.ear) <= 1.0001 && p.breath >= 0 && p.breath <= 1);
  }
});

test('turning over flips the facing direction when it finishes', () => {
  const cat = new CatBrain(seeded(5), 0);
  cat.begin(10, 'turn');
  const mid = cat.update(10 + CAT_ACTIONS.turn.duration * 0.5);
  assert.ok(Math.abs(mid.flip) < 0.2, 'keskel on külg kitsas');
  assert.ok(mid.lift > 5);
  const end = cat.update(10 + CAT_ACTIONS.turn.duration + 0.01);
  assert.equal(end.act === 'turn', false);
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
