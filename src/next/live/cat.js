// Magava kassi juhuslik käitumine "Elav kodu" stseenis. Loogika on lõuendist sõltumatu: update(t) tagastab poosi, mida scene.js joonistab.
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = k => k * k * (3 - 2 * k);
// 0 → 1 sissetulek (kestab osa 'up'), hoidmine, väljumine alates 'down'.
const envelope = (p, up = 0.2, down = 0.8) => smooth(clamp(p / up)) * smooth(clamp((1 - p) / (1 - down)));

export const CAT_ACTIONS = {
  tail: { label: 'liigutab saba', duration: 2.6, weight: 3 },
  ears: { label: 'liigutab kõrva', duration: 0.7, weight: 3 },
  turn: { label: 'keerab ennast', duration: 2.8, weight: 1.5 },
  stretch: { label: 'ringutab', duration: 3.8, weight: 1.5 },
  yawn: { label: 'haigutab', duration: 3, weight: 2 },
  lick: { label: 'lakub ennast', duration: 5.5, weight: 2 }
};

// Puhkeposi: kõik 0, suund 1 (nägu paremale).
export const restPose = () => ({ act: null, dir: 1, flip: 1, tail: 0.08, tailPhase: 0, head: 0, mouth: 0, squeeze: 0, ear: 0, earBack: 0, stretch: 0, lift: 0, breath: 0, tongue: 0, sleeping: true });

export class CatBrain {
  constructor(rand = Math.random, t = 0) {
    this.rand = rand; this.t = t; this.act = null; this.start = 0; this.dir = 1; this.last = null; this.queue = null;
    this.next = t + 3 + rand() * 5;
  }

  pick() {
    const names = Object.keys(CAT_ACTIONS).filter(n => n !== this.last), total = names.reduce((s, n) => s + CAT_ACTIONS[n].weight, 0);
    let r = this.rand() * total;
    for (const n of names) { r -= CAT_ACTIONS[n].weight; if (r <= 0) return n; }
    return names[0];
  }

  begin(t, name) { this.act = name; this.start = t; this.last = name; }

  finish(t) {
    if (this.act === 'turn') this.dir = -this.dir;
    const was = this.act;
    this.act = null;
    if (was === 'stretch' && this.rand() < 0.45) { this.begin(t, 'yawn'); return; }
    const quick = was === 'ears';
    this.next = t + (quick ? 2 + this.rand() * 4 : 6 + this.rand() * 14);
  }

  update(t) {
    if (!this.act && t >= this.next) this.begin(t, this.pick());
    let p = 0;
    if (this.act) { p = (t - this.start) / CAT_ACTIONS[this.act].duration; if (p >= 1) { this.finish(t); p = 0; } }
    return this.pose(t, p);
  }

  pose(t, p) {
    const o = restPose(), act = this.act;
    o.act = act; o.dir = this.dir; o.flip = this.dir; o.tailPhase = t * 0.9;
    if (!act) return o;
    if (act === 'tail') { const e = envelope(p, 0.15, 0.82); o.tail = 0.08 + 0.92 * e; o.tailPhase = t * 7.5; }
    else if (act === 'ears') { o.ear = Math.sin(Math.PI * p) * (0.6 + 0.4 * Math.sin(p * 18)); }
    else if (act === 'turn') {
      const roll = smooth(clamp((p - 0.28) / 0.44));
      o.flip = this.dir * Math.cos(Math.PI * roll);
      o.lift = Math.sin(Math.PI * clamp((p - 0.18) / 0.64)) * 11;
      o.head = -0.28 * envelope(p, 0.2, 0.55);
      o.sleeping = false;
    } else if (act === 'stretch') {
      const e = envelope(p, 0.34, 0.74);
      o.stretch = e; o.tail = 0.08 + 0.5 * e; o.tailPhase = t * 3;
      o.mouth = 0.55 * smooth(clamp((p - 0.5) / 0.15)) * smooth(clamp((0.92 - p) / 0.15)); o.squeeze = e * 0.8; o.breath = 0.4 * e;
      o.sleeping = false;
    } else if (act === 'yawn') {
      const e = envelope(p, 0.28, 0.72);
      o.head = -0.34 * e; o.mouth = e; o.squeeze = e; o.earBack = e; o.breath = 0.7 * e; o.sleeping = false;
    } else if (act === 'lick') {
      const e = envelope(p, 0.14, 0.86), busy = envelope(p, 0.34, 0.8);
      o.head = 0.72 * e + Math.sin(t * 13) * 0.07 * busy;
      o.tongue = busy * (0.5 + 0.5 * Math.sin(t * 13 + 1.2)) ; o.sleeping = false;
    }
    return o;
  }
}
