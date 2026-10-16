import test from 'node:test';
import assert from 'node:assert/strict';

// scene.js ehitab konstruktoris Path2D radu (brauseri API) ja joonistab canvas 2D konteksti; Node'is anname lihtsad stubid.
globalThis.Path2D ??= class { moveTo() {} lineTo() {} ellipse() {} closePath() {} };
const { LiveScene } = await import('../src/next/live/scene.js');

const stubCtx = () => new Proxy({}, { get: (t, p) => (p in t ? t[p] : () => {}), set: (t, p, v) => { t[p] = v; return true; } });
const sceneWith = ctx => new LiveScene({ width: 0, height: 0, getContext: () => ctx });

test('välk teatab onLightning ainult äikese ajal, mitte kohe uuesti ega reduced motion korral', () => {
  const ctx = stubCtx(), scene = sceneWith(ctx);
  let hits = 0; scene.onLightning = () => { hits++; };
  scene.reduced = false; scene.a.storm = 1; scene.bolt.t = -1; scene.bolt.cooldown = -1;
  scene.drawFlash(ctx, { scale: 1, ox: 0, oy: 0 });
  assert.equal(hits, 1, 'esimene välk teatab');
  scene.drawFlash(ctx, { scale: 1, ox: 0, oy: 0 });
  assert.equal(hits, 1, 'kohe teist korda ei löö (cooldown)');
  scene.a.storm = 0; scene.bolt.t = -1; scene.bolt.cooldown = -1;
  scene.drawFlash(ctx, { scale: 1, ox: 0, oy: 0 });
  assert.equal(hits, 1, 'väljaspool tormi ei löö');
  scene.reduced = true; scene.a.storm = 1; scene.bolt.t = -1; scene.bolt.cooldown = -1;
  scene.drawFlash(ctx, { scale: 1, ox: 0, oy: 0 });
  assert.equal(hits, 1, 'reduced motion korral jääb vaikseks');
});

test('goblin: duši all pöörab esi → külg → selg, joonistus jääb tasakaalu ja dušši lõppedes kaob', () => {
  let depth = 0;
  const ctx = new Proxy({}, { get: (t, p) => p === 'save' ? () => { depth++; } : p === 'restore' ? () => { depth--; } : (p in t ? t[p] : () => {}), set: (t, p, v) => { t[p] = v; return true; } });
  const scene = sceneWith(ctx), seen = { front: false, side: false, back: false };
  scene.a.hw = 1;
  for (let i = 0; i < 4000; i++) {
    scene.t += 0.05; scene.drawGoblin(ctx, 0.3, 0.05);
    assert.equal(depth, 0, 'save/restore peavad olema tasakaalus');
    const g = scene.goblin;
    if (g.pos >= 1 && g.walk < 0.05 && g.tu >= 1) { const c = Math.cos(g.yaw), s = Math.abs(Math.sin(g.yaw)); if (c > 0.95) seen.front = true; if (s > 0.95) seen.side = true; if (c < -0.95) seen.back = true; }
  }
  assert.deepEqual(seen, { front: true, side: true, back: true }, 'nähakse nii esi-, külg- kui ka seljavaadet');
  assert.ok(scene.goblin.foamF > 0.5 && scene.goblin.foam > 0.9, 'vaht kasvab seal, kus ta küürib');
  scene.a.hw = 0;
  for (let i = 0; i < 200; i++) { scene.t += 0.05; scene.drawGoblin(ctx, 0.3, 0.05); }
  assert.equal(scene.goblin.pos, 0, 'dušši lõppedes kõnnib ära');
  assert.equal(depth, 0);
});
