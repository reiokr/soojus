// Kassi juhuslik käitumine "Elav kodu" stseenis. Loogika on lõuendist sõltumatu: update(t) tagastab poosi, mida scene.js joonistab.
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = k => k * k * (3 - 2 * k);
const lerp = (a, b, k) => a + (b - a) * k;
// 0 → 1 sissetulek (kestab osa 'up'), hoidmine, väljumine alates 'down'.
const envelope = (p, up = 0.2, down = 0.8) => smooth(clamp(p / up)) * smooth(clamp((1 - p) / (1 - down)));

export const CAT_ACTIONS = {
  tail: { label: 'liigutab saba', duration: 2.6, weight: 3 },
  ears: { label: 'liigutab kõrva', duration: 0.7, weight: 3 },
  turn: { label: 'keerab ennast', duration: 4.6, weight: 1.5 },
  stretch: { label: 'ringutab', duration: 3.8, weight: 1.5 },
  yawn: { label: 'haigutab', duration: 3, weight: 2 },
  lick: { label: 'lakub ennast', duration: 5.5, weight: 2 },
  sit: { label: 'istub ja vaatab ringi', duration: 10, weight: 2 },
  walk: { label: 'kõnnib teise kohta', duration: 8, weight: 2 },
  window: { label: 'hüppab radiaatorile akent vaatama', duration: 28, weight: 1.5 },
  goSofa: { label: 'läheb diivanile', duration: 12, weight: 1.5 }
};

// Diivanil olles valitavad tegevused: samad vahed ja kaalud nagu põrandal, aga kass jääb diivanile.
// Uni, istumine ja ümberpööramine on eraldi tegevused, seega nende vahel on samad pausid nagu põrandal.
export const SOFA_ACTIONS = {
  sofaSleep: { label: 'magab diivanil', duration: 30, weight: 2.2 },
  sofaSit: { label: 'istub diivanil ja vaatab ringi', duration: 8, weight: 2.2 },
  sofaTurn: { label: 'pöörab diivanil ümber', duration: 3.4, weight: 1.6 },
  sofaLick: { label: 'lakub end diivanil', duration: 5.5, weight: 1.8 },
  sofaTail: { label: 'liigutab saba diivanil', duration: 2.6, weight: 2.4 },
  sofaEars: { label: 'liigutab kõrva diivanil', duration: 0.7, weight: 2.4 },
  sofaYawn: { label: 'haigutab diivanil', duration: 3, weight: 1.6 },
  leaveSofa: { label: 'hüppab diivanilt maha', duration: 8, weight: 1.6 }
};
const ACTIONS = { ...CAT_ACTIONS, ...SOFA_ACTIONS };
const durationOf = name => ACTIONS[name]?.duration ?? 2;

// Kassi kohad põrandal (nihe kodukohast, px) ja radiaator, kuhu ta aknast välja vaatama hüppab (radiaatori pealmine serv on 82 px põrandast kõrgemal).
export const SPOTS = [0, -70, -135];
export const RADIATOR = { x: -82, h: 82 };
// Diivan elutoas: nihe kodukohast ja kõrgus istme peal (kass magab diivanil).
export const SOFA = { x: -348, y: -33 };
const WALK_SPEED = 42, STAND = 7;

// Puhkeposi: kõik 0, suund 1 (nägu paremale).
// x, y: asukoht kodukoha suhtes (px, y<0 on kõrgemal); yaw: kogu keha pööre ümber püstsuunalise telje 0 → π (0 = külg samas suunas, π/2 = nägu vaataja poole);
// headYaw: ainult pea pööre keha suhtes (>0 vaataja poole, <0 vaataja eest ära); raise: kui kõrgele keha jalgadel tõuseb (px); crouch: kägarasend;
// bird: aknast mööda lendav lind {u, dir, y0} või null; sit: istumine 0–1; air: õhus sirutatud jalad; tilt: nina üles (rad); walk/stepPhase: jalgade sammuamplituud (0–1) ja faas; eyes: 0 suletud, 1 lahti.
export const restPose = () => ({ act: null, dir: 1, flip: 1, x: 0, y: 0, tail: 0.08, tailPhase: 0, head: 0, headYaw: 0, mouth: 0, squeeze: 0, ear: 0, earBack: 0, stretch: 0, lift: 0, yaw: 0, raise: 0, crouch: 0, sit: 0, air: 0, tilt: 0, walk: 0, stepPhase: 0, eyes: 0, bird: null, breath: 0, tongue: 0, sleeping: true });

export class CatBrain {
  constructor(rand = Math.random, t = 0) {
    this.rand = rand; this.t = t; this.act = null; this.start = 0; this.dir = 1; this.pos = 0; this.last = null; this.queue = null;
    this.script = null; this.dur = 0; this.onSofa = false;
    this.next = t + 3 + rand() * 5;
  }

  pick() {
    const table = this.onSofa ? SOFA_ACTIONS : CAT_ACTIONS;
    const names = Object.keys(table).filter(n => n !== this.last), total = names.reduce((s, n) => s + table[n].weight, 0);
    let r = this.rand() * total;
    for (const n of names) { r -= table[n].weight; if (r <= 0) return n; }
    return names[0];
  }

  // Käsikirja tegevused (istumine, kõndimine, aken) on jadad lõikudest; iga lõik liigub algseisust (s0) lõppseisu (s1).
  plan(name) {
    const r = this.rand, segs = [], st = { x: this.pos, y: this.onSofa ? SOFA.y : 0, r: 0, s: 0, c: 0 };
    let dir = this.dir;
    const seg = (kind, d, to = {}, extra = {}) => { const s0 = { ...st }, s1 = { ...st, ...to }; Object.assign(st, s1); segs.push({ kind, d, dir, s0, s1, ...extra }); };
    const face = x => { const want = x > st.x ? 1 : -1; if (want !== dir) { seg('turn', 1.6); dir = want; } };
    const walkTo = x => { if (Math.abs(x - st.x) < 6) return; face(x); seg('walk', Math.abs(x - st.x) / WALK_SPEED, { x }); };
    // Kohapeal 180° ümberpööramine: pöörde-lõik ja suuna vahetus järgmisteks lõikudeks.
    const turnAround = d => { seg('turn', d); dir = -dir; };
    const spot = () => { const far = SPOTS.filter(s => Math.abs(s - st.x) > 40); return far[Math.floor(r() * far.length)]; };
    if (name === 'sit') {
      seg('sitdown', 1.2, { s: 1 });
      seg('gaze', 6 + r() * 3, {}, { look: true });
      seg('situp', 1.2, { s: 0 });
    } else if (name === 'walk') {
      seg('rise', 0.8, { r: STAND });
      walkTo(spot());
      seg('fall', 0.8, { r: 0 });
    } else if (name === 'window') {
      seg('rise', 0.8, { r: STAND });
      walkTo(RADIATOR.x + (st.x > RADIATOR.x ? 28 : -28));
      face(RADIATOR.x);
      const hop = dir * 28;
      seg('crouch', 0.5, { r: 2.5, c: 1 });
      seg('jump', 0.9, { x: RADIATOR.x, y: -RADIATOR.h, r: STAND, c: 0 }, { arc: 22, air: true });
      seg('land', 0.35, { r: 3.5, c: 0.6 });
      seg('sitdown', 1.1, { r: 0, s: 1, c: 0 });
      const gaze = 9 + r() * 4, n = gaze > 11 ? 3 : 2, flights = Array.from({ length: n }, (_, i) => ({ t0: 1.2 + i * (gaze - 3.4) / n + r() * 0.9, d: 2.9 + r() * 0.6, dirX: r() < 0.5 ? 1 : -1, y0: 520 + r() * 55 }));
      seg('gaze', gaze, {}, { window: true, flights });
      seg('situp', 1.1, { r: STAND, s: 0 });
      seg('crouch', 0.45, { r: 2.5, c: 1 });
      seg('jump', 0.85, { x: RADIATOR.x + hop, y: 0, r: STAND, c: 0 }, { arc: 10, air: true });
      seg('land', 0.35, { r: 3.5, c: 0.6 });
      seg('rise', 0.35, { r: STAND, c: 0 });
      walkTo(spot());
      seg('fall', 0.8, { r: 0 });
    } else if (name === 'goSofa') {
      seg('rise', 0.8, { r: STAND });
      walkTo(SOFA.x + 42);
      face(SOFA.x);
      seg('crouch', 0.5, { r: 2.5, c: 1 });
      seg('jump', 0.9, { x: SOFA.x, y: SOFA.y, r: STAND, c: 0 }, { arc: 18, air: true });
      seg('land', 0.4, { r: 3.5, c: 0.6 });
      // pöörab diivanil näoga tuppa ja jääb lesima
      seg('rise', 0.6, { r: STAND });
      turnAround(1.8);
      seg('fall', 0.6, { r: 0 });
      seg('settle', 1.4, { r: 0, c: 0 });
    } else if (name === 'sofaSleep') {
      seg('settle', 1.4, { r: 0, c: 0 });
      seg('sleep', 16 + r() * 16, {});
      seg('wake', 1.4);
    } else if (name === 'sofaSit') {
      seg('sitdown', 1.0, { s: 1 });
      seg('gaze', 4 + r() * 4, {}, { look: true });
      seg('situp', 1.0, { s: 0 });
    } else if (name === 'sofaTurn') {
      seg('rise', 0.6, { r: STAND });
      turnAround(2.0);
      seg('fall', 0.6, { r: 0 });
    } else if (name === 'leaveSofa') {
      seg('rise', 0.6, { r: STAND });
      face(SOFA.x + 42);
      seg('crouch', 0.5, { r: 2.5, c: 1 });
      seg('jump', 0.9, { x: SOFA.x + 42, y: 0, r: STAND, c: 0 }, { arc: 12, air: true });
      seg('land', 0.35, { r: 3.5, c: 0.6 });
      seg('rise', 0.35, { r: STAND, c: 0 });
      walkTo(spot());
      seg('fall', 0.8, { r: 0 });
    }
    this.script = { segs, end: { x: st.x, dir } };
    return segs.reduce((s, g) => s + g.d, 0);
  }

  // Asukoha püsimiseks lehele naastes: salvestame ainult puhkeasendi (kus kass parasjagu on), mitte pooleliolevat tegevust.
  snapshot() { return { pos: this.pos, dir: this.dir, onSofa: this.onSofa }; }

  restore(s) {
    if (!s) return;
    if (s.onSofa) { this.onSofa = true; this.pos = SOFA.x; }
    else if (SPOTS.includes(s.pos)) { this.onSofa = false; this.pos = s.pos; }
    if (s.dir === -1 || s.dir === 1) this.dir = s.dir;
  }

  begin(t, name) {
    this.act = name; this.start = t; this.last = name; this.script = null;
    this.dur = this.plan(name) || durationOf(name);
    if (!this.script?.segs.length) this.dur = durationOf(name);
  }

  finish(t) {
    if (this.act === 'turn') this.dir = -this.dir;
    if (this.script?.segs.length) { this.pos = this.script.end.x; this.dir = this.script.end.dir; }
    const was = this.act;
    if (was === 'goSofa') this.onSofa = true;
    else if (was === 'leaveSofa') this.onSofa = false;
    this.act = null; this.script = null;
    if (was === 'stretch' && this.rand() < 0.45) { this.begin(t, 'yawn'); return; }
    const quick = was === 'ears' || was === 'sofaEars';
    this.next = t + (quick ? 2 + this.rand() * 4 : 6 + this.rand() * 14);
  }

  update(t) {
    if (!this.act && t >= this.next) this.begin(t, this.pick());
    let p = 0;
    if (this.act) { const dur = this.script?.segs.length ? this.dur : durationOf(this.act); p = (t - this.start) / dur; if (p >= 1) { this.finish(t); p = 0; } }
    return this.pose(t, p);
  }

  scripted(o, t, local) {
    let acc = 0, seg = this.script.segs.at(-1), u = 1;
    for (const g of this.script.segs) { if (local < acc + g.d) { seg = g; u = (local - acc) / g.d; break; } acc += g.d; }
    const e = smooth(clamp(u)), { s0, s1, kind } = seg, mix = key => lerp(s0[key], s1[key], e);
    o.dir = o.flip = seg.dir; o.sleeping = false; o.eyes = 1;
    o.x = kind === 'walk' ? lerp(s0.x, s1.x, u) : mix('x');
    o.y = mix('y') - (seg.arc ?? 0) * Math.sin(Math.PI * u);
    o.raise = mix('r'); o.sit = mix('s'); o.crouch = mix('c');
    o.tail = 0.08; o.tailPhase = t * 0.9;
    if (kind === 'turn') { o.yaw = Math.PI * e; o.walk = 0.7; o.stepPhase = t * 7; o.tail = 0.35; o.tailPhase = t * 2.4; o.eyes = 0; }
    else if (kind === 'walk') {
      o.walk = 1; o.stepPhase = Math.abs(o.x - s0.x) * 0.285; o.tail = 0.4; o.tailPhase = t * 2;
      o.head = Math.sin(o.stepPhase) * 0.04; o.ear = Math.max(0, Math.sin(t * 5)) * 0.2 * (Math.sin(t * 0.7) > 0.8 ? 1 : 0);
    } else if (seg.air) {
      o.air = Math.sin(Math.PI * clamp(u * 1.05)) ** 0.6; o.walk = 0;
      o.tilt = (s1.y < s0.y ? 0.5 : -0.35) * Math.cos(Math.PI * u) * clamp(Math.sin(Math.PI * u) * 2.2);
    } else if (kind === 'crouch' || kind === 'land') { o.tilt = -0.1 * o.crouch; o.tail = 0.3; o.tailPhase = t * 4; }
    else if (kind === 'gaze') {
      o.tail = seg.window ? 0.95 : 0.55; o.tailPhase = t * 1.8;
      const fade = envelope(u, 0.08, 0.92);
      if (seg.window) {
        // aknast välja: nägu jääb nähtavale, pea on kergelt üles tõstetud akna poole ja jälgib mööda lendavat lindu; lindu nähes ärkab kass: kõrvad ette, saba virvendab
        const lt = u * seg.d, fl = seg.flights.find(f => lt >= f.t0 && lt <= f.t0 + f.d);
        let watch = 0;
        if (fl) {
          const fu = (lt - fl.t0) / fl.d;
          o.bird = { u: fu, dir: fl.dirX, y0: fl.y0 };
          const birdX = 800 + 180 * (fl.dirX > 0 ? fu : 1 - fu), ahead = clamp(((birdX - (972 + o.x)) / 90) * seg.dir, -1, 1);
          watch = envelope(fu, 0.15, 0.85); o.head = -(0.34 + 0.2 * ahead * watch) * fade; o.headYaw = -0.25 * Math.max(0, -ahead) * watch * fade;
        } else { o.head = -(0.3 + 0.05 * Math.sin(t * 0.8)) * fade; o.headYaw = -0.1 * fade; }
        o.ear = (0.2 + 0.5 * watch + 0.2 * Math.max(0, Math.sin(t * 2.3))) * fade; o.tailPhase = t * (3.3 + 5 * watch); o.tail = (0.75 + 0.25 * watch); o.breath = 0.1 * fade;
      } else {
        // ringivaatamine: pea pöördub vaataja poole ja tagasi, nägu jääb alati nähtavale
        const look = Math.sin(t * 0.8) * 0.5 + Math.sin(t * 0.37 + 1) * 0.5;
        o.headYaw = (look > 0 ? 1.2 : 0.25) * look * fade; o.head = -0.08 * fade; o.ear = Math.max(0, Math.sin(t * 1.9)) * 0.4 * fade;
      }
    } else if (kind === 'settle') { o.sleeping = true; o.eyes = 1 - smooth(clamp((u - 0.15) / 0.6)); o.breath = 0.3 + 0.3 * Math.sin(t * 0.9); o.tail = 0.1; o.tailPhase = t * 0.6; }
    else if (kind === 'sleep') { o.sleeping = true; o.eyes = 0; o.breath = 0.45 + 0.4 * Math.sin(t * 0.85); o.tail = 0.05; o.tailPhase = t * 0.4; }
    else if (kind === 'wake') { o.sleeping = false; o.eyes = smooth(clamp(u / 0.5)); o.stretch = Math.sin(Math.PI * u) * 0.6; o.tail = 0.3; o.tailPhase = t * 2.2; }
    else if (kind === 'sitdown' || kind === 'situp') { o.tail = 0.3; o.tailPhase = t * 1.4; }
    return o;
  }

  pose(t, p) {
    const o = restPose(), act = this.act;
    o.act = act; o.dir = this.dir; o.flip = this.dir; o.tailPhase = t * 0.9;
    // diivanil olles on kassi alus diivani iste (x, y), põrandal tema põrandakoht
    o.x = this.onSofa ? SOFA.x : this.pos; o.y = this.onSofa ? SOFA.y : 0;
    if (!act) return o;
    if (this.script?.segs.length) return this.scripted(o, t, p * this.dur);
    // diivani väiketegevused (sofaTail, sofaEars, sofaLick, sofaYawn) kasutavad samu poose kui põrandal
    const base = act.startsWith('sofa') ? act.slice(4, 5).toLowerCase() + act.slice(5) : act;
    if (base === 'tail') { const e = envelope(p, 0.15, 0.82); o.tail = 0.08 + 0.92 * e; o.tailPhase = t * 7.5; }
    else if (base === 'ears') { o.ear = Math.sin(Math.PI * p) * (0.6 + 0.4 * Math.sin(p * 18)); }
    else if (base === 'turn') {
      // tõuseb jalgadele, pöörab sammudega 180° ümber püstsuunalise telje ja heidab uuesti pikali (suund vahetub lõpus)
      const stand = envelope(p, 0.2, 0.8), turning = smooth(clamp((p - 0.22) / 0.56));
      o.raise = 7 * stand; o.yaw = Math.PI * turning;
      o.walk = Math.sin(Math.PI * clamp((p - 0.2) / 0.6)); o.stepPhase = t * 7;
      o.tail = 0.08 + 0.45 * stand; o.tailPhase = t * 2.4;
      o.head = -0.2 * envelope(p, 0.2, 0.55);
      o.sleeping = false;
    } else if (base === 'stretch') {
      const e = envelope(p, 0.34, 0.74);
      o.stretch = e; o.tail = 0.08 + 0.5 * e; o.tailPhase = t * 3;
      o.mouth = 0.55 * smooth(clamp((p - 0.5) / 0.15)) * smooth(clamp((0.92 - p) / 0.15)); o.squeeze = e * 0.8; o.breath = 0.4 * e;
      o.sleeping = false;
    } else if (base === 'yawn') {
      const e = envelope(p, 0.28, 0.72);
      o.head = -0.34 * e; o.mouth = e; o.squeeze = e; o.earBack = e; o.breath = 0.7 * e; o.sleeping = false;
    } else if (base === 'lick') {
      const e = envelope(p, 0.14, 0.86), busy = envelope(p, 0.34, 0.8);
      o.head = 0.72 * e + Math.sin(t * 13) * 0.07 * busy;
      o.tongue = busy * (0.5 + 0.5 * Math.sin(t * 13 + 1.2)) ; o.sleeping = false;
    }
    return o;
  }
}
