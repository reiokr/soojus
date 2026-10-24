import { sunPosition, moonPosition, moonPhase, skyColors, darkness, groundColors, windowGlow, mix, HOME, sunMaxElevation, skyPlacement } from './sky.js';
import { tempColor } from '../logic.js';
import { CatBrain, restPose } from './cat.js';
import { t as tr } from '../../i18n/index.js';
import { number } from '../../lib.js';

// "Elav kodu": canvas-stseen. Maailm on 1600×900 ühikut, sobitatakse ekraanile; taevas ja maa jätkuvad üle serva.
// Maailm on 1600 ühikut lai; nähtav on y = VIEW.y … VIEW.y + VIEW.h, nii et maapinna lõige (maakontuur) jääb pildile.
export const W = 1600, GROUND = 700, SOIL_TOP = 778, VIEW = { y: 60, h: 960 };
// Kassi asukoht jääb lehele naastes samaks (localStorage); võti järgib ülejäänud rakenduse 'soojus.*' nimetust.
const CAT_KEY = 'soojus.cat';
const TAU = Math.PI * 2;
// Katuse geomeetria: välimine pind, kalle ja paksus; kõik katuse osad (pööning, lumi, korsten, kübarad) arvutavad sellest.
const ROOF = { apexX: 810, apexY: 232, slope: 0.3957, thick: 26, x0: 290, x1: 1330 };
const roofTop = x => ROOF.apexY + Math.abs(x - ROOF.apexX) * ROOF.slope;
const HOUSE_X0 = 320, HOUSE_X1 = 1300, FOUNDATION_BOTTOM = 764;
// Maja sisemus (läbilõige): seinte vahe ja pööning; udu jääb sellest välja.
const HOUSE_SHELL = { L: 360, R: 1260, TOP: 440, FLOOR: 700 };
// Elutoa ja tehnilise ruumi vahesein: nihutatud vasakule, et elutuba oleks suurem.
const LIVING_X = 502;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = k => k * k * (3 - 2 * k);
// Jõudlus: stseen on aeglane ambient-maal, seega 24 kaadrit sekundis on visuaalselt piisav
// (60/120/144 Hz ekraanil tähendaks see lihtsalt 2–6× rohkem joonistamist) ja tagapuhver
// on piiratud pindalaga, et 4K täisekraanil ei tekiks kümnete megapikslite lõuendit.
const TARGET_FPS = 24, MAX_PIXELS = 4e6;

function mulberry32(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const hexRgb = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const rgbaCache = new Map();
function rgba(hex, a = 1) {
  const key = hex + a.toFixed(2);
  let v = rgbaCache.get(key);
  if (!v) { const [r, g, b] = hexRgb(hex.length === 7 ? hex : '#888888'); v = `rgba(${r},${g},${b},${a.toFixed(3)})`; if (rgbaCache.size > 4000) rgbaCache.clear(); rgbaCache.set(key, v); }
  return v;
}
const rgbToHex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
const cssToHex = css => { const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(css); return m ? rgbToHex(+m[1], +m[2], +m[3]) : '#888888'; };
const heatHex = t => cssToHex(tempColor(t));
// Vahemälu võti: värvid ümardatakse astmele, et aeglaselt muutuv taevas ei sunniks tausta
// igal kaadril uuesti joonistama (muutus 4/255 on silmale nähtamatu).
const qHex = (hex, step = 4) => '#' + [1, 3, 5].map(i => Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) / step) * step).toString(16).padStart(2, '0')).join('');

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else { ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
}

// Eesti mets horisondil: kolm kihti kuuski (kaugem on väiksem ja uduvinelisem) ning siin-seal mänd. Kujud on Path2D-d, mille alus on y = 0.
function buildForest(rng) {
  const spruce = (path, x, h, w, snow) => {
    const n = Math.max(5, Math.round(h / 24)), step = h / n, side = [];
    for (let i = 1; i <= n; i++) {
      const y = -h + (i / n) * h, hw = (w / 2) * Math.pow(i / n, 0.92) * (0.92 + rng() * 0.16);
      side.push([hw * 0.46, y - step * (0.42 + rng() * 0.1)], [hw, y + (i < n ? step * 0.04 : 0)]);
    }
    // lumi okste peal: iga oksakorruse ülemisel nõlval lai sälk ning latva kübar
    for (let i = 0; i < side.length; i += 2) {
      const [nx, ny] = side[i], [tx, ty] = side[i + 1], ex = nx + (tx - nx) * 0.82, ey = ny + (ty - ny) * 0.82, th = step * (0.2 + rng() * 0.08);
      for (const sg of [-1, 1]) { snow.moveTo(x + sg * nx, ny); snow.lineTo(x + sg * ex, ey); snow.lineTo(x + sg * (ex - 1.5), ey + th * 0.6); snow.lineTo(x + sg * (nx * 0.55), ny + th); snow.closePath(); }
    }
    snow.moveTo(x, -h - 1); snow.lineTo(x - side[1][0] * 0.9, -h + step * 0.72); snow.lineTo(x + side[1][0] * 0.9, -h + step * 0.72); snow.closePath();
    path.moveTo(x, -h);
    for (const [dx, y] of side) path.lineTo(x - dx, y);
    path.lineTo(x - side.at(-1)[0] * 0.55, 2);
    path.lineTo(x + side.at(-1)[0] * 0.55, 2);
    for (let i = side.length - 1; i >= 0; i--) path.lineTo(x + side[i][0], side[i][1]);
    path.closePath();
  };
  const pine = (trunk, crown, x, h, snow) => {
    const top = -h * 0.8, lean = (rng() - 0.5) * 6;
    trunk.moveTo(x - 3.4, 2); trunk.lineTo(x - 2 + lean * 0.4, top * 0.55); trunk.lineTo(x - 1.4 + lean, top + 6); trunk.lineTo(x + 1.6 + lean, top + 6); trunk.lineTo(x + 2.4 + lean * 0.4, top * 0.55); trunk.lineTo(x + 3.6, 2); trunk.closePath();
    for (let i = 0; i < 4; i++) {
      const cxp = x + lean + (rng() - 0.5) * h * 0.2, cyp = top - h * 0.03 * i + (rng() - 0.4) * h * 0.1, rx = h * (0.1 + rng() * 0.07), ry = rx * (0.4 + rng() * 0.15);
      const tilt = (rng() - 0.5) * 0.3;
      crown.moveTo(cxp + rx, cyp); crown.ellipse(cxp, cyp, rx, ry, tilt, 0, TAU);
      snow.moveTo(cxp - rx * 0.92, cyp - ry * 0.28); snow.ellipse(cxp, cyp - ry * 0.22, rx * 0.92, ry * 0.7, tilt, Math.PI, TAU); snow.closePath();
    }
    // sirge külgoks krooni all, nagu männil
    crown.moveTo(x + lean - 1, top + 4); crown.lineTo(x + lean - h * 0.14, top + h * 0.1); crown.lineTo(x + lean - h * 0.12, top + h * 0.075); crown.lineTo(x + lean, top + 2); crown.closePath();
  };
  const layers = [
    { gap: [14, 26], h: [78, 128], k: 0.4, pines: 0.03 },
    { gap: [20, 36], h: [118, 190], k: 0.4, pines: 0.07 },
    { gap: [28, 48], h: [150, 238], k: 0.38, pines: 0.09 }
  ];
  return layers.map(L => {
    const sp = new Path2D(), trunk = new Path2D(), crown = new Path2D(), snow = new Path2D();
    for (let x = -420 + rng() * 20; x < W + 420; x += L.gap[0] + rng() * (L.gap[1] - L.gap[0])) {
      if (rng() < 0.05) { x += 18 + rng() * 26; continue; }
      const h = L.h[0] + Math.pow(rng(), 1.3) * (L.h[1] - L.h[0]);
      if (rng() < L.pines) pine(trunk, crown, x, h * 1.25, snow); else spruce(sp, x, h, h * L.k, snow);
    }
    return { spruce: sp, trunk, crown, snow, h: L.h[1] * 1.3 };
  });
}

function makePath(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum.at(-1);
  return { pts, cum, total, vu: cum.map(c => c / total) };
}
function pointAt(path, u, out) {
  const d = u * path.total, { cum, pts } = path;
  let i = 1; while (i < cum.length - 1 && cum[i] < d) i++;
  const k = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
  out.x = lerp(pts[i - 1][0], pts[i][0], k); out.y = lerp(pts[i - 1][1], pts[i][1], k);
  return out;
}

// Torustik (maailmakoordinaadid).
const PATHS = {
  heatSupplyA: makePath([[472, 520], [472, 486], [460, 486]]),
  heatSupplyB: makePath([[460, 478], [765, 478], [765, 652], [830, 652]]),
  heatReturn: makePath([[830, 678], [805, 678], [805, 730], [470, 730], [470, 698]]),
  hwSupply: makePath([[488, 600], [515, 600], [515, 710], [1150, 710], [1150, 690]]),
  hwReturn: makePath([[1192, 690], [1192, 720], [518, 720], [518, 620], [488, 620]]),
  showerFeed: makePath([[1172, 545], [1172, 465], [1090, 465], [1090, 522]]),
  airSupply: makePath([[500, 350], [500, 398], [600, 386], [730, 364], [790, 368], [842, 392], [872, 402], [872, 446]]),
  airExtract: makePath([[798, 446], [798, 404], [812, 372], [845, 340], [862, 326], [862, 246]])
};

const HOT = '#ff6a2a', COLD = '#2e9bff';
const brineHex = t => mix('#58b6ff', '#ffc27d', clamp((t - 2) / 22));

// Maakontuur: soojakandja väljub pumbast (x=484), käib läbi maa serpentiinina ja naaseb pumba juurde (x=448).
function groundLoopPoints() {
  const pts = [[484, 704], [484, 812], [640, 812]], rows = [812, 846, 880, 914], xl = 640, xr = 1250, r = 17;
  rows.forEach((y, i) => {
    const toRight = i % 2 === 0;
    pts.push([toRight ? xr : xl, y]);
    if (i < rows.length - 1) for (let k = 1; k <= 8; k++) { const a = -Math.PI / 2 + (k / 8) * Math.PI; pts.push([(toRight ? xr : xl) + (toRight ? 1 : -1) * Math.cos(a) * r, y + r + Math.sin(a) * r]); }
  });
  pts.push([448, 914], [448, 704]);
  return pts;
}
export const GROUND_LOOP = makePath(groundLoopPoints());

// Klõpsatavad seadmed (maailmakoordinaadid): lehele viiv sihtkoht, silt ja esiletõstu värv.
export const HOTSPOTS = {
  pump: { x: 372, y: 520, w: 116, h: 180, r: 14, color: '#ffb347', page: 'heating', label: 'Maasoojuspump', go: 'Küte', info: 'Võtab soojust maapinnast (maakontuuri soojakandjast), tõstab selle kompressoriga kõrgemale temperatuurile ja annab majale ning tarbeveele. Ekraanil on hetkevõimsus, klaasi taga pöörleb kompressor.' },
  ground: { x: 600, y: 790, w: 690, h: 150, r: 12, color: '#7fd4ff', page: 'heating', label: 'Maakontuur', go: 'Küte', info: 'Toru maa sees, kus soojakandja võtab maapinnast soojust ja viib selle pumbani. myUplink ei anna soojakandja temperatuure; need saab nähtavale, kui ühendad pumba kohtvõrguliidese (Seaded ja ühendus).' },
  vent: { x: 738, y: 326, w: 154, h: 76, r: 11, color: '#7fd4ff', page: 'ventilation', label: 'Ventilatsioon', go: 'Ventilatsioon', info: 'Vahetab toaõhu värske vastu ja soojendab sissepuhutavat õhku väljatõmbeõhu soojusega. Kiirus ja režiim sõltuvad CO₂ tasemest.' },
  boiler: { x: 1138, y: 545, w: 64, h: 145, r: 30, color: '#ff9b6a', page: 'water', label: 'Veeboiler', go: 'Tarbevesi', info: 'Hoiab sooja tarbevett dušši ja kraanide jaoks. Pump soojendab selle sihttemperatuurini, termomeeter näitab hetketaset.' }
};

class Flow {
  constructor(path, count, rng, size = 3) {
    this.path = path; this.size = size; this.n = count;
    this.off = Array.from({ length: count }, (_, i) => (i + rng() * 0.6) / count);
    this.jit = Array.from({ length: count }, () => (rng() - 0.5) * 5);
    this.phase = rng();
  }
  advance(dt, speed) { this.phase = (this.phase + dt * speed) % 1; }
}

export class LiveScene {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.w = 800; this.h = 450; this.dpr = 1;
    this.state = null; this.t = 0; this.last = 0; this.raf = 0; this.running = false; this.reduced = false; this.frameMs = 0;
    this.nextFrame = 0; this.frameBudget = 1000 / TARGET_FPS; this.bgKey = ''; this.forestKey = ''; this.cloudKey = ''; this.houseKey = ''; this.cloudAcc = 0; this.forestLayers = null;
    this.sprites = new Map();
    const rng = this.rng = mulberry32(20260930);
    this.cat = new CatBrain();
    this.loadCat();
    this.a = { comp: 0, scroll: 0, drift: 0, cloud: 0.15, rain: 0, snow: 0, fog: 0, wind: 0.15, snowCover: 0, storm: 0, flash: 0, heat: 0, hw: 0, power: 0, air: 0, fan: 0, pumpFan: 0, co2: 0, glow: 0.2, recovery: 0, water: 40, buffer: 30, indoor: 21, outdoor: 10, level: 0 };
    this.stars = Array.from({ length: 240 }, () => ({ x: rng() * W, y: rng() * (GROUND - 90), r: 0.4 + rng() * 1.3, p: rng() * TAU, s: 0.6 + rng() * 2 }));
    this.clouds = Array.from({ length: 13 }, (_, i) => ({ x: rng() * W * 1.4 - 100, y: 70 + rng() * 260, s: 0.7 + rng() * 1.1, v: 5 + rng() * 9, seed: i }));
    this.forest = buildForest(mulberry32(5150));
    this.grass = Array.from({ length: 170 }, () => ({ x: rng() * (W + 400) - 200, h: 10 + rng() * 26, p: rng() * TAU, l: rng() }));
    this.canopy = Array.from({ length: 70 }, () => { const a = rng() * TAU, d = Math.sqrt(rng()) * 92; return { x: Math.cos(a) * d, y: Math.sin(a) * d * 0.8, r: 12 + rng() * 15, c: rng(), p: rng() * TAU }; });
    this.leaves = Array.from({ length: 16 }, () => this.newLeaf(rng, true));
    this.fireflies = Array.from({ length: 14 }, () => ({ x: 60 + rng() * 360, y: 560 + rng() * 130, vx: 0, vy: 0, p: rng() * TAU, s: 0.5 + rng() }));
    this.motes = Array.from({ length: 110 }, () => ({ x: 740 + rng() * 290, y: 460 + rng() * 230, vx: (rng() - 0.5) * 6, vy: (rng() - 0.5) * 6, r: 0.8 + rng() * 1.8, p: rng() * TAU, on: rng() }));
    this.drops = Array.from({ length: 46 }, () => ({ x: 1090 + (rng() - 0.5) * 12, y: 522 + rng() * 170, v: 280 + rng() * 140, dx: (rng() - 0.5) * 16 }));
    this.splashes = Array.from({ length: 10 }, () => ({ x: 1090, r: 99, a: 0 }));
    this.bubbles = Array.from({ length: 22 }, () => ({ x: 1140 + rng() * 60, y: 520 + rng() * 160, v: 18 + rng() * 26, r: 1.4 + rng() * 2.4, p: rng() * TAU }));
    this.steam = Array.from({ length: 26 }, () => ({ x: 1075 + rng() * 40, y: 640 + rng() * 40, v: 18 + rng() * 22, r: 8 + rng() * 14, p: rng(), o: rng() }));
    this.exhaust = Array.from({ length: 30 }, () => ({ u: rng(), o: (rng() - 0.5) * 30, v: 0.5 + rng() * 0.5 }));
    this.flows = {
      heatSupplyA: new Flow(PATHS.heatSupplyA, 3, rng, 3.2), heatSupplyB: new Flow(PATHS.heatSupplyB, 7, rng, 3.2), heatReturn: new Flow(PATHS.heatReturn, 14, rng, 3),
      hwSupply: new Flow(PATHS.hwSupply, 15, rng, 3.4), hwReturn: new Flow(PATHS.hwReturn, 15, rng, 3), showerFeed: new Flow(PATHS.showerFeed, 6, rng, 3),
      airSupply: new Flow(PATHS.airSupply, 22, rng, 2.6), airExtract: new Flow(PATHS.airExtract, 22, rng, 2.6)
    };
    this.drops2 = Array.from({ length: 340 }, () => ({ x: -300 + rng() * (W + 600), y: rng() * (GROUND + 120), v: 620 + rng() * 380, l: 10 + rng() * 14, gy: GROUND + 8 + rng() * 96 }));
    this.flakes = Array.from({ length: 240 }, () => ({ x: -300 + rng() * (W + 600), y: rng() * (GROUND + 100), v: 26 + rng() * 40, r: 1.2 + rng() * 2.4, p: rng() * TAU, gy: GROUND + 6 + rng() * 90 }));
    this.rainSplash = Array.from({ length: 36 }, () => ({ x: 0, y: 0, r: 0, a: 0 }));
    this.fogBlobs = Array.from({ length: 12 }, () => ({ x: rng() * (W + 600) - 300, y: GROUND - 80 + rng() * 150, r: 200 + rng() * 180, v: 6 + rng() * 10, o: rng() }));
    this.bolt = { t: -1, pts: [], cooldown: 6 };
    this.twigs = [0, 1, 2, 3].map(() => Array.from({ length: 4 }, () => ({ dx: (rng() - 0.5) * 70, dy: -10 - rng() * 30, bend: (rng() - 0.5) * 20, sub: rng() })));
    this.clumps = []; this.puffs = []; this.clumpT = 2; this.shake = 0; this.tips = [];
    const dr = mulberry32(99);
    this.mounds = Array.from({ length: 34 }, () => { const c = -260 + dr() * 2200; return { c, w: 50 + dr() * 110, a: 0.5 + dr() * 0.5 }; });
    this.shoot = { t: -1, x: 0, y: 0, cooldown: 14 };
    this.tmp = { x: 0, y: 0 };
    this.hoverId = null; this.fullscreen = false; this.onLightning = null; this.hv = { pump: 0, ground: 0, vent: 0, boiler: 0 };
    this.brine = new Flow(GROUND_LOOP, 110, rng, 2.7);
  }

  setHover(id) { this.hoverId = id; if (this.reduced && this.state) this.frame(performance.now()); }
  // Täisekraanis jäetakse maakontuuri soojakandja temperatuurisildid joonistamata (pilt on suur ja puhtam).
  setFullscreen(v) { this.fullscreen = Boolean(v); if (this.reduced && this.state) this.frame(performance.now()); }

  newLeaf(rng = this.rng, scatter = false) { return { x: 110 + rng() * 170, y: scatter ? 420 + rng() * 280 : 400 + rng() * 60, vx: 10 + rng() * 26, vy: 24 + rng() * 26, p: rng() * TAU, r: 3 + rng() * 2.6, c: rng() }; }

  setState(state) { this.state = state; }

  // Kassi asukoha püsimine: loeme puhkeasendi lehe laadimisel ja kirjutame selle tagasi, kui see muutub (tegevuse lõpus) või vaade suletakse.
  catKey() { const c = this.cat; return `${c.pos},${c.dir},${c.onSofa ? 1 : 0}`; }
  loadCat() {
    try { const s = JSON.parse(localStorage.getItem(CAT_KEY) || 'null'); if (s) this.cat.restore(s); } catch { /* salvestust pole või privaatne režiim */ }
    this.catSaved = this.catKey();
  }
  saveCat() {
    try { localStorage.setItem(CAT_KEY, JSON.stringify(this.cat.snapshot())); } catch { /* privaatne režiim */ }
    this.catSaved = this.catKey();
  }

  resize(cssW, cssH, dpr) {
    this.w = Math.max(200, cssW); this.h = Math.max(120, cssH);
    // Piirang: 4K täisekraanil (3840×2160) ja 2× DPR-iga tekiks 33 MP lõuend, mida täidetakse
    // kaadris mitu korda. Maalilise stseeni jaoks piisab ~4 MP tagapuhvrist.
    this.dpr = Math.max(0.6, Math.min(dpr, Math.sqrt(MAX_PIXELS / (this.w * this.h))));
    this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
    this.bgKey = ''; this.forestKey = ''; this.cloudKey = ''; this.houseKey = '';
  }

  // Taustavahemälu jaoks eraldi lõuend (Node'is/testides ownerDocument puudub → joonistame otse).
  cacheCanvas() {
    const doc = this.canvas?.ownerDocument;
    return doc?.createElement ? doc.createElement('canvas') : null;
  }

  // Osakeste hõõgus: varem tekkis igal kaadril sadu uusi radialGradiente (igaüks kallis objekt).
  // Nüüd joonistame iga värvi kohta ühe 64×64 sprite'i ja kopeerime seda; läbipaistvuse annab globalAlpha.
  glowSprite(color) {
    const key = qHex(color, 8);
    let sp = this.sprites.get(key);
    if (!sp) {
      const doc = this.canvas?.ownerDocument;
      if (!doc?.createElement) return null;
      const S = 64, cv = doc.createElement('canvas'); cv.width = S; cv.height = S;
      const cx = cv.getContext('2d'), g = cx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      g.addColorStop(0, rgba(key, 1)); g.addColorStop(0.4, rgba(key, 0.5)); g.addColorStop(1, rgba(key, 0));
      cx.fillStyle = g; cx.fillRect(0, 0, S, S);
      if (this.sprites.size > 400) this.sprites.clear();
      sp = cv; this.sprites.set(key, cv);
    }
    return sp;
  }

  glow(ctx, color, x, y, r, alpha) {
    if (!(alpha > 0.004) || !(r > 0.2)) return;
    const sp = this.glowSprite(color); if (!sp) return;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(sp, x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
  }

  start() {
    if (this.running) return;
    if (this.reduced) { this.frame(performance.now()); return; }
    this.running = true; this.last = performance.now(); this.nextFrame = 0;
    const loop = now => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      if (now < this.nextFrame) return;
      this.nextFrame = now + this.frameBudget;
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }
  // Kaadrisagedus: LiveHome reguleerib selle 24 / 8 / 4 fps sõltuvalt sellest, kas kasutaja vaatab lehte.
  setFps(fps) { this.frameBudget = 1000 / Math.max(1, fps); }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }
  destroy() { this.stop(); this.saveCat(); }

  // Tasane üleminek sihtväärtuste poole, et lülitumised poleks järsud.
  ease(dt) {
    const s = this.state, a = this.a, k = x => this.reduced ? 1 : 1 - Math.exp(-dt * x);
    const heatT = s.heatOn ? 1 : s.heatDemand ? 0.3 : 0.06, hwT = s.hwOn ? 1 : s.hwDemand ? 0.3 : 0.06;
    a.heat += (heatT - a.heat) * k(1.6); a.hw += (hwT - a.hw) * k(1.6);
    const w = s.weather;
    a.cloud += ((w ? w.cloud : 0.15) - a.cloud) * k(0.7); a.rain += ((w ? w.rain : 0) - a.rain) * k(0.9); a.snow += ((w ? w.snow : 0) - a.snow) * k(0.9);
    a.fog += ((w ? w.fog : 0) - a.fog) * k(0.6); a.wind += ((w ? w.wind : 0.15) - a.wind) * k(0.6); a.snowCover += ((w ? w.snowCover : 0) - a.snowCover) * k(0.9);
    a.storm += ((w?.storm ? 1 : 0) - a.storm) * k(1);
    // Hanged kasvavad sajuga aeglaselt (täis sajuga ~65 s), sulavad soojaga veelgi aeglasemalt; päris lumikate annab alumise piiri.
    const floor = a.snowCover * 0.3;
    if (this.reduced) a.drift = Math.max(floor, a.snow > 0.05 ? 0.7 : 0);
    else if (a.snow > 0.05) a.drift = Math.min(1, a.drift + dt * 0.015 * a.snow);
    else if ((a.outdoor ?? 0) > 1.5) a.drift = Math.max(floor, a.drift - dt * 0.004 * (a.outdoor - 1));
    a.drift = Math.max(a.drift, floor);
    for (const id of Object.keys(this.hv)) this.hv[id] += ((this.hoverId === id ? 1 : 0) - this.hv[id]) * (this.reduced ? 1 : 1 - Math.exp(-dt * 10));
    a.comp += ((s.running ? 1 : 0) - a.comp) * k(2.2);
    if (!this.reduced && a.comp > 0.03) a.scroll += dt * (0.5 + 7 * a.comp);
    a.power += (clamp(s.powerKw / 5) - a.power) * k(1.2);
    const v = s.vent, airT = v.present && v.running ? clamp(v.rpm / 2600, 0.12, 1) : 0;
    a.air += (airT - a.air) * k(1.4);
    a.co2 += (clamp(((v.co2 ?? 500) - 600) / 1100) - a.co2) * k(0.8);
    a.recovery += (clamp((v.recovery || 0) / 100) - a.recovery) * k(1);
    a.water += ((s.water ?? 40) - a.water) * k(0.8); a.buffer += ((s.buffer ?? 30) - a.buffer) * k(0.8);
    a.indoor += ((s.indoor ?? 21) - a.indoor) * k(0.6); a.outdoor += ((s.outdoor ?? 10) - a.outdoor) * k(0.6);
    if (!this.reduced) { a.fan += dt * (8 * a.air + 0.2); a.pumpFan += dt * (2 + 26 * a.power); }
  }

  frame(now) {
    if (!this.state) return;
    const t0 = performance.now(), dt = this.reduced ? 0 : clamp((now - this.last) / 1000, 0, 0.13);
    this.last = now; this.t += dt;
    this.ease(dt || 0.016);
    const ctx = this.ctx, s = this.state;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const scale = Math.min(this.w / W, this.h / VIEW.h), ox = (this.w - W * scale) / 2, oy = (this.h - VIEW.h * scale) / 2 - VIEW.y * scale;
    const place = s.place || HOME, a = this.a;
    const sun = sunPosition(s.time, place), moon = moonPosition(s.time, place), phase = moonPhase(s.time);
    const dark = darkness(sun.elevation), glow = windowGlow(a.indoor, dark);
    // pilvine ilm hallistab taeva ja valgustab maad vähem; lumi heledamaks
    let sky = skyColors(sun.elevation), ground = groundColors(a.outdoor);
    const grey = mix('#8a93a3', '#1c2230', dark), gk = clamp(a.cloud * 0.5 + a.rain * 0.2 + a.snow * 0.15 + a.fog * 0.25);
    sky = { top: mix(sky.top, grey, gk), mid: mix(sky.mid, grey, gk * 0.9), horizon: mix(sky.horizon, mix(grey, '#c8cfda', 0.3 * (1 - dark)), gk * 0.8) };
    const snowLvl = Math.max(a.drift, a.snowCover * 0.8), cover = Math.max(a.snowCover, a.drift * 0.9);
    if (cover > 0.02) ground = { ...ground, top: mix(ground.top, mix('#f2f7fc', '#3a4660', dark * 0.75), cover * 0.92), bottom: mix(ground.bottom, mix('#c9d6e4', '#283048', dark * 0.75), cover * 0.85), frost: Math.max(ground.frost, cover * 0.4) };
    const day = s.time.toDateString();
    const dayKey = `${day}|${place.lat}|${place.lon}`;
    if (dayKey !== this.dayKey) { this.dayKey = dayKey; this.maxElev = sunMaxElevation(s.time, place); }
    const env = { sun, moon, phase, dark, sky, ground, glow, scale, ox, oy, season: season(s.time), maxElev: this.maxElev, cloud: a.cloud, snowLvl };
    this.env = env;
    this.catPose = this.reduced ? restPose() : this.cat.update(this.t);
    // Kass muudab puhkeasendit ainult tegevuse lõpus; siis salvestame selle kohe, et ka vahepeal lehelt lahkumine ei kaotaks asukohta.
    if (this.catSaved !== this.catKey()) this.saveCat();
    ctx.save();
    this.drawBackdrop(ctx, env);
    ctx.translate(ox, oy); ctx.scale(scale, scale);
    this.drawSkyBodies(ctx, env, dt);
    this.drawClouds(ctx, env, dt);
    this.drawForest(ctx, env);
    this.drawTree(ctx, env, dt);
    this.drawHouse(ctx, env, dt);
    this.drawUnderground(ctx, env, dt);
    this.drawHover(ctx, env);
    this.drawForeground(ctx, env, dt);
    this.drawPrecip(ctx, env, dt);
    this.drawFog(ctx, env, dt);
    ctx.restore();
    this.drawFlash(ctx, env, dt);
    this.frameMs = lerp(this.frameMs, performance.now() - t0, 0.05);
  }

  // ---- taust (ekraaniruumis, ulatub üle stseeni serva)
  // Taevas ja maa on sujuvad gradientid, mis muutuvad ainult valguse/ilma tõttu. Hoiame need
  // eraldi lõuendil ja teeme kaadris ainult odava kopeerimise (drawImage), mitte kahte suurt
  // gradienttäitmist. Uuesti joonistame siis, kui toonid on märgatavalt muutunud (vm paar sekundit).
  drawBackdrop(ctx, env) {
    const bg = this.bgCanvas ??= this.cacheCanvas();
    const bctx = bg?.getContext?.('2d');
    if (!bctx) return this.paintBackdrop(ctx, env);
    const { sky, ground, dark } = env;
    const key = `${qHex(sky.top)}|${qHex(sky.mid)}|${qHex(sky.horizon)}|${qHex(ground.top)}|${qHex(ground.bottom)}|${dark.toFixed(2)}|${this.w}|${this.h}|${this.dpr}`;
    if (key !== this.bgKey) {
      const bw = Math.round(this.w * this.dpr), bh = Math.round(this.h * this.dpr);
      if (bg.width !== bw || bg.height !== bh) { bg.width = bw; bg.height = bh; }
      bctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.paintBackdrop(bctx, env);
      this.bgKey = key;
    }
    ctx.drawImage(bg, 0, 0, this.w, this.h);
  }

  paintBackdrop(ctx, { sky, ground, scale, oy, dark }) {
    const horizon = oy + GROUND * scale, g = ctx.createLinearGradient(0, 0, 0, horizon);
    g.addColorStop(0, sky.top); g.addColorStop(0.55, sky.mid); g.addColorStop(1, sky.horizon);
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.w, horizon + 2);
    const gg = ctx.createLinearGradient(0, horizon, 0, this.h), night = '#070d16';
    // Muru tumeneb öösel nagu murulibledki: nii horisondilähedane muru kui esiplaan.
    gg.addColorStop(0, mix(mix(ground.top, sky.horizon, 0.18), night, dark * 0.55));
    gg.addColorStop(1, mix(mix(ground.bottom, '#000000', 0.1 + dark * 0.35), night, dark * 0.45));
    ctx.fillStyle = gg; ctx.fillRect(0, horizon, this.w, this.h - horizon);
  }

  drawSkyBodies(ctx, { sun, moon, phase, dark, sky, maxElev }, dt) {
    const place = (b, max) => skyPlacement(b, max, { W, GROUND });
    // Taevakehad (päike, kuu, tähed) ainult taevaossa: loojuv/loojunud päike ei tohi murule paista.
    ctx.save(); ctx.beginPath(); ctx.rect(-2000, -3000, W + 4000, GROUND + 3000); ctx.clip();
    // tähed
    if (dark > 0.02) {
      ctx.save();
      // 240 üksiktäitmise asemel 5 alfagruppi: täpid on nii väikesed, et astmeline hämarus ei paista.
      const buckets = new Map();
      for (const st of this.stars) {
        const fade = clamp((GROUND - 40 - st.y) / 260) * (1 - this.a.cloud * 0.92), tw = 0.55 + 0.45 * Math.sin(this.t * st.s + st.p);
        const q = Math.round(Math.pow(dark, 1.4) * tw * fade * 5); if (q <= 0) continue;
        let list = buckets.get(q); if (!list) buckets.set(q, list = []);
        list.push(st);
      }
      for (const [q, list] of buckets) {
        ctx.fillStyle = `rgba(255,250,235,${(q / 5).toFixed(3)})`; ctx.beginPath();
        for (const st of list) { ctx.moveTo(st.x + st.r, st.y); ctx.arc(st.x, st.y, st.r, 0, TAU); }
        ctx.fill();
      }
      const sh = this.shoot;
      if (!this.reduced && dark > 0.7) {
        sh.cooldown -= dt;
        if (sh.t < 0 && sh.cooldown < 0) { sh.t = 0; sh.x = 200 + this.rng() * 900; sh.y = 60 + this.rng() * 200; sh.cooldown = 16 + this.rng() * 22; }
        if (sh.t >= 0) {
          sh.t += dt; const k = sh.t / 0.9;
          if (k >= 1) sh.t = -1;
          else { const x = sh.x + k * 260, y = sh.y + k * 120, g = ctx.createLinearGradient(x, y, x - 90, y - 42); g.addColorStop(0, `rgba(255,255,255,${0.9 * (1 - k)})`); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 90, y - 42); ctx.stroke(); }
        }
      }
      ctx.restore();
    }
    // kuu
    const mp = place(moon, 48);
    if (moon.elevation > -6) {
      const r = 27, lit = 0.35 + 0.65 * clamp(dark * 1.4), ks = Math.cos(phase.age * TAU);
      const cl = 1 - this.a.cloud * 0.8;
      const halo = ctx.createRadialGradient(mp.x, mp.y, r * 0.6, mp.x, mp.y, r * 6);
      halo.addColorStop(0, `rgba(210,225,255,${0.30 * dark * phase.illumination * cl})`); halo.addColorStop(1, 'rgba(210,225,255,0)');
      ctx.fillStyle = halo; ctx.fillRect(mp.x - r * 6, mp.y - r * 6, r * 12, r * 12);
      ctx.save(); ctx.globalAlpha = lit * cl; ctx.translate(mp.x, mp.y);
      ctx.fillStyle = 'rgba(120,135,170,0.28)'; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
      if (!phase.waxing) ctx.scale(-1, 1);
      ctx.beginPath(); ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
      if (ks > 0) ctx.ellipse(0, 0, Math.max(0.5, ks * r), r, 0, Math.PI / 2, -Math.PI / 2, true); else ctx.ellipse(0, 0, Math.max(0.5, -ks * r), r, 0, Math.PI / 2, Math.PI * 1.5, false);
      ctx.closePath(); ctx.fillStyle = '#f4f1e2'; ctx.fill();
      ctx.restore();
    }
    // päike
    if (sun.elevation > -8) {
      const sp = place(sun, maxElev), low = clamp(1 - sun.elevation / 28), core = mix('#fff6d6', '#ff9d4d', low), vis = clamp((sun.elevation + 8) / 10) * (1 - this.a.cloud * 0.85);
      const halo = ctx.createRadialGradient(sp.x, sp.y, 4, sp.x, sp.y, 130 + low * 240);
      halo.addColorStop(0, rgba(core, 0.85 * vis)); halo.addColorStop(0.25, rgba(mix(core, '#ff7a3a', 0.4), 0.32 * vis)); halo.addColorStop(1, rgba(core, 0));
      ctx.fillStyle = halo; ctx.fillRect(sp.x - 380, sp.y - 380, 760, 760);
      ctx.fillStyle = rgba(core, vis); ctx.beginPath(); ctx.arc(sp.x, sp.y, 30 + low * 6, 0, TAU); ctx.fill();
    }
    this.sunPos = place(sun, maxElev);
    ctx.restore();
  }

  drawClouds(ctx, { sky, dark, scale }, dt) {
    const a = this.a, total = this.clouds.length, dim = clamp(a.rain * 0.7 + a.storm * 0.5 + a.snow * 0.3);
    const tone = mix(mix(mix(sky.horizon, '#ffffff', 0.7), '#2a3556', dark * 0.85), mix('#707a8c', '#1f2533', dark), dim), shade = mix(tone, sky.mid, 0.4);
    // Pilved liiguvad aeglaselt, aga 91 suurt läbipaistvat gradienttäitmist kaadris oli kalleim üksikosa.
    // Joonistame pilvekihi (koos pilvekattega) pooleldi resolutsiooniga eraldi lõuendile ~10 korda sekundis.
    // Liikumine on nii aeglane, et see ei paista; kaader aga teeb ainult ühe kopeerimise.
    const X0 = -460, Y0 = -200, LW = W + 920, LH = GROUND * 0.85 + 200;
    for (const c of this.clouds) { c.x += c.v * dt * (1 + a.wind * 5); if (c.x > W + 260) { c.x = -300; c.y = 70 + this.rng() * 260; } }
    const cache = this.cloudCache ??= this.cacheCanvas();
    const res = Math.min(1.5, (scale || 1) * this.dpr * 0.5);
    this.cloudAcc = (this.cloudAcc || 0) + dt;
    if (!cache) return this.paintClouds(ctx, { tone, shade, dark, a, total });
    const key = `${qHex(tone)}|${qHex(shade)}|${dark.toFixed(2)}|${a.cloud.toFixed(2)}|${res.toFixed(3)}`;
    if (key !== this.cloudKey || this.cloudAcc > 0.1) {
      const cw = Math.ceil(LW * res), ch = Math.ceil(LH * res);
      if (cache.width !== cw || cache.height !== ch) { cache.width = cw; cache.height = ch; }
      const cx = cache.getContext('2d');
      cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, cw, ch);
      cx.setTransform(res, 0, 0, res, -X0 * res, -Y0 * res);
      this.paintClouds(cx, { tone, shade, dark, a, total });
      this.cloudKey = key; this.cloudAcc = 0;
    }
    ctx.drawImage(cache, X0, Y0, LW, LH);
  }

  paintClouds(ctx, { tone, shade, dark, a, total }) {
    // päris pilvekiht katab taeva, kui on pilves
    const over = clamp((a.cloud - 0.45) / 0.45);
    if (over > 0.01) { const g = ctx.createLinearGradient(0, -100, 0, GROUND * 0.85); g.addColorStop(0, rgba(tone, 0.92 * over)); g.addColorStop(0.7, rgba(shade, 0.55 * over)); g.addColorStop(1, rgba(shade, 0)); ctx.fillStyle = g; ctx.fillRect(-400, -200, W + 800, GROUND * 0.85 + 200); }
    this.clouds.forEach((c, idx) => {
      const present = clamp((a.cloud * 1.15 - (idx / total) * 0.95) / 0.22);
      if (present <= 0.01) return;
      const r = mulberry32(c.seed * 97 + 5), blobs = 7, size = 1 + a.cloud * 0.6;
      for (let i = 0; i < blobs; i++) {
        const bx = c.x + (i - 3) * 38 * c.s * size + (r() - 0.5) * 18, by = c.y + (r() - 0.5) * 16 * c.s, br = (34 + r() * 26) * c.s * size;
        this.glow(ctx, tone, bx, by, br, (0.55 - dark * 0.22) * present);
      }
    });
  }

  // ---- taustamets: kuused ja mõned männid, kaugemad kihid uduvinelised; öösel tumenevad, lumega saavad valged latvad, tuul kallutab lähimat kihti
  // Kolm suurt Path2D-d olid kaadri kalleim osa, kuigi nende värvid muutuvad ainult valguse/lumega.
  // Seepärast joonistame kihid eraldi lõuenditele ja kaadris ainult kopeerime need (koos tuulekallutusega).
  drawForest(ctx, { sky, ground, dark, snowLvl, scale }) {
    const haze = [0.62, 0.4, 0.17], night = [0.55, 0.7, 0.82], day = ['#46705f', '#32604b', '#214a38'];
    const cover = clamp(Math.max(this.a.snowCover, this.a.drift * 0.6)), snowTop = mix('#eef4fa', '#3a4660', dark * 0.75), snowA = clamp(snowLvl * 1.8);
    const colors = this.forest.map((f, l) => {
      const base = mix(mix(day[l], sky.horizon, haze[l]), '#0a1222', dark * night[l]);
      const top = mix(base, snowTop, cover * (0.38 + l * 0.08));
      return { base, top, trunk: mix(mix('#7a4d32', base, 0.45), '#0a1222', dark * 0.3), crown: mix(mix(base, '#6a8f4c', 0.16 * (1 - dark)), top, cover * 0.2), snow: mix(snowTop, sky.horizon, haze[l] * 0.45), snowAlpha: snowA * (0.8 + l * 0.1) };
    });
    const cache = this.forestCache ??= this.cacheCanvas();
    const res = Math.min(2, (scale || 1) * this.dpr * 0.75);
    const key = cache && `${qHex(snowTop)}|${qHex(sky.horizon)}|${dark.toFixed(2)}|${cover.toFixed(2)}|${snowA.toFixed(2)}|${res.toFixed(3)}`;
    if (cache && key !== this.forestKey) {
      this.forestLayers = this.forest.map((f, l) => {
        const fx0 = -440, fw = 2480, fy0 = -f.h - 6, fh = f.h + 12;
        const cv = this.forestLayers?.[l]?.cv ?? this.cacheCanvas();
        const bw = Math.ceil(fw * res), bh = Math.ceil(fh * res);
        if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
        const cx = cv.getContext('2d');
        cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, bw, bh);
        cx.setTransform(res, 0, 0, res, -fx0 * res, -fy0 * res);
        this.paintForestLayer(cx, f, colors[l]);
        return { cv, fx0, fy0, fw, fh };
      });
      this.forestKey = key;
    }
    this.forest.forEach((f, l) => {
      const sway = this.reduced ? 0 : Math.sin(this.t * (0.5 + l * 0.12) + l * 2) * 0.0045 * (0.3 + this.a.wind * 3) * l;
      const L = this.forestLayers?.[l];
      ctx.save(); ctx.translate(0, GROUND + 4); ctx.transform(1, 0, -sway, 1, 0, 0);
      if (L) ctx.drawImage(L.cv, L.fx0, L.fy0, L.fw, L.fh);
      else this.paintForestLayer(ctx, f, colors[l]);
      ctx.restore();
    });
    const g = ctx.createLinearGradient(0, GROUND - 6, 0, GROUND + 4), edge = mix(mix(ground.top, sky.horizon, 0.2), '#070d16', dark * 0.55);
    g.addColorStop(0, rgba(edge, 0)); g.addColorStop(1, rgba(edge, 1));
    ctx.fillStyle = g; ctx.fillRect(-400, GROUND - 6, W + 800, 12);
  }

  paintForestLayer(ctx, f, c) {
    const g = ctx.createLinearGradient(0, -f.h, 0, 0);
    g.addColorStop(0, c.top); g.addColorStop(0.5, mix(c.top, c.base, 0.6)); g.addColorStop(1, c.base);
    ctx.fillStyle = c.trunk; ctx.fill(f.trunk);
    ctx.fillStyle = g; ctx.fill(f.spruce);
    ctx.fillStyle = c.crown; ctx.fill(f.crown);
    if (c.snowAlpha > 0.03) { ctx.globalAlpha = c.snowAlpha; ctx.fillStyle = c.snow; ctx.fill(f.snow); ctx.globalAlpha = 1; }
  }

  drawTree(ctx, { season, dark, sky, ground, snowLvl }, dt) {
    const gust = 1 + this.a.wind * 3.4, bx = 190;
    this.shake *= this.reduced ? 0 : Math.exp(-dt * 2.6);
    const sway = (Math.sin(this.t * 0.9 * (1 + this.a.wind)) * 3 + Math.sin(this.t * 0.37) * 2) * gust + Math.sin(this.t * 25) * this.shake * 3.2;
    const branches = [[-58, -70], [62, -84], [-24, -120], [30, -40]].map(([dx, dy]) => ({ sx: bx + sway * 0.25, sy: 560 + dy * 0.2, cx: bx + dx * 0.4, cy: 520 + dy * 0.4, ex: bx + dx + sway, ey: 480 + dy * 0.5 }));
    const wood = mix('#4b3a2c', '#10121c', dark * 0.6), snowC = mix('#f5f9fd', '#4a5672', dark * 0.72), snowA = clamp(snowLvl * 1.8);
    const tips = [];
    const twigPath = (b, tw) => { const x = b.ex + tw.dx * 0.6, y = b.ey + tw.dy * 0.7; return { x0: b.ex, y0: b.ey, x, y, cx: b.ex + tw.dx * 0.25 + tw.bend, cy: b.ey + tw.dy * 0.5, sub: tw.sub }; };
    ctx.save(); ctx.strokeStyle = wood; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = 18; ctx.beginPath(); ctx.moveTo(bx, GROUND + 6); ctx.quadraticCurveTo(bx - 6, 600, bx + sway * 0.3, 520); ctx.stroke();
    const drawBranches = (extra = 0) => {
      branches.forEach((b, i) => {
        ctx.lineWidth = 8 + extra; ctx.beginPath(); ctx.moveTo(b.sx, b.sy); ctx.quadraticCurveTo(b.cx, b.cy, b.ex, b.ey); ctx.stroke();
        this.twigs[i].forEach(tw => {
          const t = twigPath(b, tw);
          ctx.lineWidth = 3.6 + extra * 0.5; ctx.beginPath(); ctx.moveTo(t.x0, t.y0); ctx.quadraticCurveTo(t.cx, t.cy, t.x, t.y); ctx.stroke();
          ctx.lineWidth = 2 + extra * 0.4; ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(t.x + (t.sub - 0.5) * 26, t.y - 10 - t.sub * 8); ctx.stroke();
        });
      });
    };
    drawBranches();
    branches.forEach((b, i) => { tips.push([b.ex, b.ey]); this.twigs[i].forEach(tw => { const t = twigPath(b, tw); tips.push([t.x, t.y]); }); });
    if (season.leaf) {
      for (const c of this.canopy) {
        const x = bx + sway + c.x + Math.sin(this.t * 1.3 + c.p) * 1.6, y = 452 + c.y + Math.cos(this.t * 1.1 + c.p) * 1.2;
        const col = mix(mix(season.a, season.b, c.c), '#050a14', dark * 0.62 + (1 - c.c) * 0.12);
        ctx.fillStyle = rgba(col, season.density); ctx.beginPath(); ctx.arc(x, y, c.r, 0, TAU); ctx.fill();
        if (snowLvl > 0.05 && c.y < 14) { ctx.fillStyle = rgba(snowC, snowA * 0.9); ctx.beginPath(); ctx.ellipse(x, y - c.r * 0.42, c.r * 0.82, c.r * 0.42, 0, 0, TAU); ctx.fill(); }
      }
    } else if (snowLvl > 0.05) {
      // lumi okstel ja oksaharudel: sama joon nihutatud üles valgena
      ctx.save(); ctx.translate(0, -3.4); ctx.strokeStyle = rgba(snowC, snowA); drawBranches(-3.6); ctx.restore();
    }
    ctx.restore();
    this.tips = tips;
    this.updateClumps(ctx, { season, snowLvl, dark, snowC, bx, sway }, dt);
    if (season.fall) for (const l of this.leaves) {
      if (!this.reduced) { l.x += (l.vx + this.a.wind * 90 + Math.sin(this.t + l.p) * 18) * dt; l.y += l.vy * dt; l.p += dt * 2.2; }
      if (l.y > GROUND + 14 || l.x > W) Object.assign(l, this.newLeaf());
      ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.p); ctx.fillStyle = rgba(mix(mix(season.a, season.b, l.c), '#080c16', dark * 0.6), 0.95);
      ctx.beginPath(); ctx.ellipse(0, 0, l.r, l.r * 0.55, 0, 0, TAU); ctx.fill(); ctx.restore();
    }
  }

  // Puult kukuvad lumetutid: tutt lahkub oksalt, puru laguneb langedes, maha jõudes tõuseb lumepilv ja hang kasvab veidi.
  updateClumps(ctx, { season, snowLvl, snowC, bx, sway }, dt) {
    if (!this.reduced && snowLvl > 0.12) {
      this.clumpT -= dt * (0.45 + this.a.wind * 2.2 + (this.a.snow > 0.05 ? 0.7 : 0));
      if (this.clumpT < 0 && this.clumps.length < 10) {
        this.clumpT = 1.2 + this.rng() * 3;
        let x, y;
        if (season.leaf) { const tops = this.canopy.filter(c => c.y < 10), c = tops[Math.floor(this.rng() * tops.length)]; x = bx + sway + c.x; y = 452 + c.y - c.r * 0.3; }
        else { const tip = this.tips[Math.floor(this.rng() * this.tips.length)] || [bx, 480]; x = tip[0]; y = tip[1]; }
        this.clumps.push({ x, y, vx: (this.rng() - 0.5) * 18 + this.a.wind * 40, vy: 0, r: 5 + this.rng() * 5, land: GROUND + 10 + this.rng() * 34, trail: [] });
        this.shake = 1;
      }
    }
    for (let i = this.clumps.length - 1; i >= 0; i--) {
      const c = this.clumps[i];
      if (!this.reduced) { c.vy += 560 * dt; c.y += c.vy * dt; c.x += c.vx * dt; c.r *= 1 - dt * 0.25; c.trail.push([c.x + (this.rng() - 0.5) * 10, c.y - 4 - this.rng() * 8, 1]); if (c.trail.length > 10) c.trail.shift(); }
      for (const tr of c.trail) tr[2] -= dt * 2;
      if (c.y >= c.land) {
        for (let k = 0; k < 10; k++) { const ang = Math.PI + this.rng() * Math.PI, sp = 25 + this.rng() * 90; this.puffs.push({ x: c.x, y: c.land, vx: Math.cos(ang) * sp * 1.4, vy: Math.sin(ang) * sp * 0.8, r: 2 + this.rng() * 4, life: 1 }); }
        this.a.drift = Math.min(1, this.a.drift + 0.003);
        this.clumps.splice(i, 1); continue;
      }
      ctx.fillStyle = rgba(snowC, 0.85);
      for (const tr of c.trail) if (tr[2] > 0) { ctx.globalAlpha = Math.max(0, tr[2]) * 0.7; ctx.beginPath(); ctx.arc(tr[0], tr[1], 1.6 + tr[2] * 1.4, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, TAU); ctx.fill();
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      if (!this.reduced) { p.life -= dt * 1.5; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt; p.vx *= 1 - dt * 2.2; }
      if (p.life <= 0) { this.puffs.splice(i, 1); continue; }
      ctx.fillStyle = rgba(snowC, p.life * 0.75); ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1.6 - p.life * 0.6), 0, TAU); ctx.fill();
    }
  }

  // ---- maja
  // Maja alumine pool (vari, pööning, toad, põrand, vaheseinad) on staatiline – see sõltub ainult
  // valgusest. Hoiame selle eraldi lõuendil ja kopeerime kaadris; uuesti joonistame vaid tooni muutudes.
  drawHouse(ctx, env, dt) {
    const { dark } = env, a = this.a, s = this.state;
    const { L, R, TOP, FLOOR } = HOUSE_SHELL;
    const cache = this.houseCache ??= this.cacheCanvas();
    if (!cache) this.paintHouseBase(ctx, dark);
    else {
      const res = Math.min(2, (env.scale || 1) * this.dpr), X0 = 180, Y0 = 200, HW = 1250, HH = 615;
      const key = `${dark.toFixed(2)}|${res.toFixed(3)}`;
      if (key !== this.houseKey) {
        const bw = Math.ceil(HW * res), bh = Math.ceil(HH * res);
        if (cache.width !== bw || cache.height !== bh) { cache.width = bw; cache.height = bh; }
        const cx = cache.getContext('2d');
        cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, bw, bh);
        cx.setTransform(res, 0, 0, res, -X0 * res, -Y0 * res);
        this.paintHouseBase(cx, dark);
        this.houseKey = key;
      }
      ctx.drawImage(cache, X0, Y0, HW, HH);
    }
    this.drawWindows(ctx, env);
    this.drawAtticVent(ctx, env, dt);
    this.drawPipes(ctx, env, dt);
    this.drawPump(ctx, env, dt);
    this.drawBuffer(ctx, env);
    this.drawFurniture(ctx, env);
    this.drawLiving(ctx, env, dt);
    this.drawBath(ctx, env, dt);
    this.drawRoomAir(ctx, env, dt);
    // seinad ja katus
    ctx.fillStyle = mix('#3a4454', '#0c0f1a', dark * 0.5);
    ctx.fillRect(L - 10, TOP, 14, FLOOR - TOP); ctx.fillRect(R - 4, TOP, 14, FLOOR - TOP); ctx.fillRect(L - 10, TOP - 6, R - L + 20, 12);
    this.drawRoof(ctx, env);
  }

  paintHouseBase(ctx, dark) {
    const { L, R, TOP, FLOOR } = HOUSE_SHELL;
    // vari maja all
    const sh = ctx.createRadialGradient(810, GROUND + 26, 40, 810, GROUND + 26, 560);
    sh.addColorStop(0, `rgba(0,0,0,${0.3 + dark * 0.15})`); sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save(); ctx.scale(1, 0.14); ctx.translate(0, (GROUND + 26) / 0.14 - (GROUND + 26)); ctx.fillStyle = sh; ctx.fillRect(200, GROUND + 26 - 560, 1220, 1120); ctx.restore();
    // pööning
    const attic = ctx.createLinearGradient(0, 260, 0, TOP);
    attic.addColorStop(0, mix('#3a3145', '#0d101c', dark * 0.6)); attic.addColorStop(1, mix('#2a2733', '#0a0d18', dark * 0.5));
    // pööningu täide järgib katuse alapinda täpselt sama kaldega (4 px katuse alla peidus) ja lõpeb seina välisservas, nii et vahele ei jää taevariba ega väljaulatuvat nurka
    ctx.fillStyle = attic; ctx.beginPath(); ctx.moveTo(L - 10, TOP + 6); ctx.lineTo(L - 10, roofTop(L - 10) + ROOF.thick - 4); ctx.lineTo(ROOF.apexX, ROOF.apexY + ROOF.thick - 4); ctx.lineTo(R + 10, roofTop(R + 10) + ROOF.thick - 4); ctx.lineTo(R + 10, TOP + 6); ctx.closePath(); ctx.fill();
    // toad
    const wall = mix('#f4ecdd', '#3c3746', dark * 0.72), wall2 = mix('#eadfcb', '#2f2b3a', dark * 0.72);
    [[L, LIVING_X, wall2], [LIVING_X, 1040, wall], [1040, R, wall2]].forEach(([x0, x1, c]) => { const g = ctx.createLinearGradient(0, TOP, 0, FLOOR); g.addColorStop(0, c); g.addColorStop(1, mix(c, '#b9a98e', 0.35 - dark * 0.2)); ctx.fillStyle = g; ctx.fillRect(x0, TOP, x1 - x0, FLOOR - TOP); });
    // põrand ja vundament
    ctx.fillStyle = mix('#c8bfae', '#2a2935', dark * 0.65); ctx.fillRect(L - 30, FLOOR, R - L + 60, 46);
    ctx.fillStyle = mix('#a99f8e', '#1f1e29', dark * 0.65); ctx.fillRect(L - 30, FLOOR + 46, R - L + 60, 6);
    ctx.strokeStyle = rgba('#2b3542', 0.35); ctx.lineWidth = 1.2; ctx.beginPath(); for (let x = L - 20; x < R + 30; x += 14) { ctx.moveTo(x, FLOOR + 46); ctx.lineTo(x + 14, FLOOR); } ctx.stroke();
    // vaheseinad: korralik paksus (12 px, välisseinast veidi õhemad ja heledamad), servadel tumedam joon; torud ja seadmed jäävad nende ette
    for (const px of [LIVING_X, 1040]) {
      const w = 12, g = ctx.createLinearGradient(px - w / 2, 0, px + w / 2, 0);
      g.addColorStop(0, mix('#8c97a6', '#2b303f', dark * 0.7)); g.addColorStop(0.5, mix('#76818f', '#23283a', dark * 0.7)); g.addColorStop(1, mix('#5d6876', '#1b1f2d', dark * 0.7));
      ctx.fillStyle = g; ctx.fillRect(px - w / 2, TOP, w, FLOOR - TOP);
      ctx.fillStyle = mix('#3a4454', '#0c0f1a', dark * 0.5); ctx.fillRect(px - w / 2 - 1, TOP, 1.8, FLOOR - TOP); ctx.fillRect(px + w / 2 - 0.8, TOP, 1.8, FLOOR - TOP);
      ctx.fillStyle = rgba('#000000', 0.1 + dark * 0.08); ctx.fillRect(px + w / 2 + 1, TOP, 8, FLOOR - TOP);
      ctx.fillStyle = mix('#59636f', '#14171f', dark * 0.5); ctx.fillRect(px - w / 2 - 2, FLOOR - 7, w + 4, 7);
    }
  }

  drawRoof(ctx, { dark, snowLvl }) {
    const { apexX: cx, apexY: A, thick: T, x0, x1 } = ROOF, top = roofTop;
    const tile = mix('#8a4a38', '#1a1420', dark * 0.65), hi = mix('#c97b5a', '#2a2233', dark * 0.65), edge = mix('#5a2d24', '#0d0a13', dark * 0.6);
    const metal = mix('#59636f', '#151823', dark * 0.6), brick = mix('#9a6f5c', '#1d1822', dark * 0.65);
    // korsten jääb katuse taha, nii et pinnast "kasvab" see välja
    ctx.fillStyle = brick; ctx.fillRect(1026, 262, 34, 80);
    ctx.strokeStyle = rgba('#000000', 0.18); ctx.lineWidth = 1;
    for (let y = 272; y < 340; y += 9) { ctx.beginPath(); ctx.moveTo(1026, y); ctx.lineTo(1060, y); ctx.stroke(); for (let x = 1034 + ((y / 9) % 2) * 8; x < 1060; x += 16) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 9); ctx.stroke(); } }
    ctx.fillStyle = mix('#3a3f4a', '#0a0c14', dark * 0.55); ctx.fillRect(1021, 256, 44, 9);
    // katuseplaat: välispind, räästaotsad ja alumine pind
    const g = ctx.createLinearGradient(0, A, 0, top(x0) + T);
    g.addColorStop(0, hi); g.addColorStop(0.45, tile); g.addColorStop(1, edge);
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x0, top(x0)); ctx.lineTo(cx, A); ctx.lineTo(x1, top(x1)); ctx.lineTo(x1, top(x1) + T); ctx.lineTo(cx, A + T); ctx.lineTo(x0, top(x0) + T); ctx.closePath(); ctx.fill();
    // räästalaud ja varjuriba alumisel servas
    ctx.fillStyle = edge; ctx.beginPath(); ctx.moveTo(x0, top(x0) + T - 7); ctx.lineTo(cx, A + T - 7); ctx.lineTo(x1, top(x1) + T - 7); ctx.lineTo(x1, top(x1) + T); ctx.lineTo(cx, A + T); ctx.lineTo(x0, top(x0) + T); ctx.closePath(); ctx.fill();
    // kiviplaadid: read piki kallet ja vahelduvad püstsiilud
    ctx.lineWidth = 1; ctx.strokeStyle = rgba('#000000', 0.2);
    [7, 13, 19].forEach((d, row) => {
      ctx.beginPath(); ctx.moveTo(x0, top(x0) + d); ctx.lineTo(cx, A + d); ctx.lineTo(x1, top(x1) + d); ctx.stroke();
      for (let x = x0 + 10 + (row % 2) * 12; x < x1; x += 24) { if (Math.abs(x - cx) < 6) continue; const y = top(x) + d; ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x, y); ctx.stroke(); }
    });
    // harja valgus
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = rgba(mix(hi, '#ffffff', 0.45), 0.6 * (1 - dark)); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x0 + 3, top(x0 + 3) + 2); ctx.lineTo(cx, A + 2); ctx.lineTo(x1 - 3, top(x1 - 3) + 2); ctx.stroke();
    // õhu sisse- ja väljatõmbekübarad katuse pinnal (kanalid lähevad läbi plaadi)
    const cap = (x, h) => { const y = top(x); ctx.fillStyle = metal; ctx.fillRect(x - 7, y - h, 14, h + 4); ctx.beginPath(); ctx.moveTo(x - 13, y - h + 2); ctx.lineTo(x, y - h - 13); ctx.lineTo(x + 13, y - h + 2); ctx.closePath(); ctx.fill(); ctx.strokeStyle = rgba('#000000', 0.25); ctx.lineWidth = 1; ctx.stroke(); };
    cap(500, 18); cap(862, 18);
    if (snowLvl > 0.03) this.drawRoofSnow(ctx, dark, snowLvl);
  }

  // Lumi katusel: järgib katuse välispinda, paksus kasvab hangedega; räästal kaarub serva üle ja külmaga rippuvad jääpurikad.
  drawRoofSnow(ctx, dark, lvl) {
    const { apexX: cx, apexY: A, thick: T, x0, x1 } = ROOF, top = roofTop, thick = 4 + 15 * lvl;
    const snow = mix('#f5f9fd', '#4a5672', dark * 0.72), shade = mix('#b9c9dc', '#2a3350', dark * 0.7);
    const pts = [];
    for (let x = x0 - 6; x <= x1 + 6; x += 9) {
      const end = Math.min(1, (x - (x0 - 6)) / 26, ((x1 + 6) - x) / 26), lump = 0.8 + 0.2 * Math.sin(x * 0.047 + 1.3) + 0.08 * Math.sin(x * 0.19), nearRidge = 1 + 0.25 * Math.exp(-Math.pow((x - cx) / 28, 2));
      pts.push([x, top(Math.min(x1, Math.max(x0, x))), thick * lump * nearRidge * (0.25 + 0.75 * smooth(end)), 1 - end]);
    }
    ctx.save(); ctx.lineJoin = 'round';
    ctx.fillStyle = snow; ctx.beginPath();
    pts.forEach(([x, y, h], i) => i ? ctx.lineTo(x, y - h) : ctx.moveTo(x, y - h));
    for (let i = pts.length - 1; i >= 0; i--) { const [x, y, , cur] = pts[i]; ctx.lineTo(x, y + 1 + cur * 6 * lvl); }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = rgba(shade, 0.8); ctx.lineWidth = 2; ctx.beginPath();
    pts.forEach(([x, y, , cur], i) => { const yy = y + 1 + cur * 6 * lvl; i ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); }); ctx.stroke();
    // kübarate ja korstna lumekübarad
    for (const [x, w, y] of [[500, 15, top(500) - 28], [862, 15, top(862) - 28], [1043, 25, 254]]) { ctx.fillStyle = snow; ctx.beginPath(); ctx.ellipse(x, y + 3, w * (0.6 + 0.4 * lvl), 3 + 6 * lvl, 0, Math.PI, TAU); ctx.fill(); }
    if ((this.a.outdoor ?? 5) < 3 && lvl > 0.2) {
      ctx.fillStyle = rgba(mix('#e6f1fb', '#7a8aa6', dark * 0.6), 0.9);
      for (const base of [x0 + 8, x0 + 20, x0 + 34, x0 + 48, x1 - 8, x1 - 20, x1 - 34, x1 - 48]) { const y = top(base) + T - 1, len = 7 + 14 * lvl * (0.5 + 0.5 * Math.abs(Math.sin(base * 1.7))); ctx.beginPath(); ctx.moveTo(base - 2.4, y); ctx.lineTo(base + 2.4, y); ctx.lineTo(base, y + len); ctx.closePath(); ctx.fill(); }
    }
    ctx.restore();
  }

  drawWindows(ctx, { glow, dark, sky }) {
    const pane = (x, y, w, h, inside) => {
      ctx.save(); rr(ctx, x, y, w, h, 4); ctx.clip();
      const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, sky.mid); g.addColorStop(1, sky.horizon); ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
      const inner = ctx.createRadialGradient(x + w / 2, y + h * 0.7, 6, x + w / 2, y + h * 0.7, Math.max(w, h) * 0.85);
      // päeval peegeldub toa soe valgus klaasis, öösel on akna taga tume õu: hõõgus nõrgeneb pimedusega ja jääb ainult alumisse serva (lambi poole)
    const day = 1 - dark * 0.82; inner.addColorStop(0, rgba(glow.color, (0.35 + 0.6 * glow.strength * (0.4 + dark * 0.6)) * day)); inner.addColorStop(1, rgba(glow.color, (0.1 + 0.3 * dark) * day)); ctx.fillStyle = inner; ctx.fillRect(x, y, w, h);
      inside?.();
      ctx.restore();
      ctx.strokeStyle = mix('#ffffff', '#1a1c28', dark * 0.75); ctx.lineWidth = 6; rr(ctx, x, y, w, h, 4); ctx.stroke();
      ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2); ctx.stroke();
    };
    const env = { glow, dark, sky };
    pane(800, 495, 180, 115, () => { this.drawWindowWeather(ctx, 800, 495, 180, 115, env); this.drawBird(ctx, dark); }); pane(1062, 482, 56, 46, () => this.drawWindowWeather(ctx, 1062, 482, 56, 46, env));
    if (dark > 0.05) { // valgus langeb õue (maja sees hõõgub, aknast väljas ei ole valgust, seega valgus langeb ainult maale)
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const spill = ctx.createRadialGradient(890, GROUND + 8, 10, 890, GROUND + 8, 260); spill.addColorStop(0, rgba(glow.color, 0.22 * dark * glow.strength)); spill.addColorStop(1, rgba(glow.color, 0));
      ctx.save(); ctx.scale(1, 0.22); ctx.translate(0, (GROUND + 8) / 0.22 - (GROUND + 8)); ctx.fillStyle = spill; ctx.fillRect(630, GROUND + 8 - 260, 520, 520); ctx.restore(); ctx.restore();
    }
  }

  // Ilm aknast vaadatuna: pilved, vihmajooned, lumehelbed, udu ja äikesevälk (aken on kärbitud ristkülik, mille sees see joonistatakse).
  drawWindowWeather(ctx, x, y, w, h, { dark }) {
    const a = this.a, t = this.reduced ? 0 : this.t, wet = clamp(a.rain * 0.8 + a.storm * 0.6 + a.snow * 0.4);
    const cloudCol = mix(mix('#ffffff', '#98a1b0', wet), '#1c2230', dark * 0.8);
    if (a.cloud > 0.12) {
      const n = Math.ceil(a.cloud * 5);
      for (let i = 0; i < n; i++) {
        const span = w + 120, cx = x - 60 + ((i * 71 + t * (3 + i * 1.4) * (1 + a.wind * 2.5)) % span), cy = y + 12 + ((i * 37) % (h * 0.55)), r = (14 + (i * 13) % 18) * (w / 180 + 0.45);
        const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.6); gr.addColorStop(0, rgba(cloudCol, Math.min(0.9, a.cloud * 0.8))); gr.addColorStop(1, rgba(cloudCol, 0));
        ctx.save(); ctx.translate(cx, cy); ctx.scale(1.7, 0.7); ctx.translate(-cx, -cy); ctx.fillStyle = gr; ctx.fillRect(cx - r * 1.7, cy - r * 1.7, r * 3.4, r * 3.4); ctx.restore();
      }
      ctx.fillStyle = rgba(mix('#8a93a3', '#10141f', dark * 0.8), Math.min(0.5, a.cloud * 0.5)); ctx.fillRect(x, y, w, h);
    }
    // vihm ja lumi järgivad välisilma: sama kalle (vasakult ülalt paremale alla), sama kiirus ja pikkus ning sama hõredus (tihedus pinnaühiku kohta ×2, et läbi klaasi paistaks)
    const area = w * h, fr = n => { const v = Math.sin(n) * 43758.5453; return v - Math.floor(v); };
    if (a.rain > 0.04) {
      const n = Math.max(1, Math.round(340 * a.rain * area / (2200 * 740) * 2)), slant = 0.1 + a.wind * 0.55, tone = dark > 0.4 ? '185,205,235' : '170,195,230';
      ctx.lineCap = 'round'; ctx.lineWidth = 1.3 + a.rain * 0.7; ctx.strokeStyle = `rgba(${tone},${(0.55 + 0.3 * a.rain).toFixed(3)})`; ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const v = 620 + fr(i * 3.1) * 380, l = 10 + fr(i * 5.7) * 14, span = h + l + 20, run = t * v + fr(i * 9.3) * span, c = Math.floor(run / span);
        const py = y - l + (run % span), px = x - 20 + fr(i * 12.9 + c * 78.2) * (w + 40) + slant * (py - y);
        ctx.moveTo(px, py); ctx.lineTo(px - slant * l, py - l);
      }
      ctx.stroke();
    }
    if (a.snow > 0.04) {
      const n = Math.max(1, Math.round(240 * Math.min(1, a.snow * 1.5) * area / (2200 * 700) * 2)), drift = a.wind * 160;
      ctx.fillStyle = `rgba(${dark > 0.4 ? '225,235,250' : '255,255,255'},${(0.72 + 0.2 * a.snow).toFixed(3)})`; ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const v = (26 + fr(i * 4.3) * 40) * (0.7 + a.snow * 0.6), r = 1.2 + fr(i * 6.1) * 2.4, span = h + 2 * r + 10, run = t * v + fr(i * 8.7) * span, c = Math.floor(run / span);
        const py = y - r + (run % span), px = x - 10 + fr(i * 11.3 + c * 51.7) * (w + 20) + Math.sin(t * 0.9 + i) * 6 + (drift / v) * (py - y);
        ctx.moveTo(px + r, py); ctx.arc(px, py, r, 0, TAU);
      }
      ctx.fill();
    }
    if (a.fog > 0.04) { ctx.fillStyle = rgba(mix('#dfe6ee', '#3a4458', dark * 0.85), Math.min(0.85, a.fog * 0.8)); ctx.fillRect(x, y, w, h); }
    if (a.flash > 0.02) { ctx.fillStyle = `rgba(255,255,255,${(a.flash * 0.75).toFixed(3)})`; ctx.fillRect(x, y, w, h); }
  }

  // aknast mööda lendav tihane (ilmub ainult siis, kui kass aknast välja vaatab); öösel ei lenda
  drawBird(ctx, dark) {
    const b = this.catPose?.bird;
    if (!b) return;
    const u = b.u, x = 786 + 208 * (b.dir > 0 ? u : 1 - u), y = b.y0 + Math.sin(u * 9) * 7 - Math.sin(u * Math.PI) * 14;
    // öösel lendab akna taga ööliblikas (tule poole), päeval tihane
    const night = clamp((dark - 0.35) / 0.3);
    if (night > 0.5) { this.drawMoth(ctx, x, y, u, b.dir, night); return; }
    const flap = Math.sin(this.t * 38), dim = clamp((dark - 0.3) / 0.45);
    const lit = c => mix(c, '#eef4ff', dim * 0.8), rim = rgba('#f6faff', 0.45 + 0.45 * dim);
    const back = lit(mix('#5f86b4', '#26344b', dark * 0.5)), belly = lit(mix('#f0d450', '#7a6b30', dark * 0.5)), cap = lit(mix('#26364d', '#101722', dark * 0.5));
    ctx.save(); ctx.translate(x, y); ctx.scale(b.dir * 1.35, 1.35); ctx.rotate(Math.cos(u * 9) * 0.12 - 0.08);
    const wing = () => { ctx.beginPath(); ctx.moveTo(-2, -2); ctx.quadraticCurveTo(-5, -9 * flap - 2, -11, -7 * flap + 1); ctx.quadraticCurveTo(-6, -1, 2, -0.5); ctx.closePath(); };
    const body = () => { ctx.beginPath(); ctx.ellipse(0, 0, 8.5, 4.6, 0, 0, TAU); };
    ctx.fillStyle = back; ctx.beginPath(); ctx.moveTo(-7, 0.5); ctx.lineTo(-16, -1.5 + flap * 1.2); ctx.lineTo(-15, 2.8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = belly; body(); ctx.fill();
    ctx.fillStyle = back; ctx.beginPath(); ctx.ellipse(-0.5, -1.6, 8, 3.2, 0, Math.PI, TAU); ctx.fill();
    ctx.fillStyle = cap; ctx.beginPath(); ctx.arc(7.2, -1.8, 3.5, 0, TAU); ctx.fill();
    ctx.fillStyle = lit('#f4f4ee'); ctx.beginPath(); ctx.ellipse(7.8, -0.4, 2.2, 1.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = mix('#2a2a2a', '#c9d4e4', dim * 0.7); ctx.beginPath(); ctx.moveTo(10.2, -2); ctx.lineTo(13.4, -1.2); ctx.lineTo(10.2, -0.6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = back; wing(); ctx.fill();
    // hele äär, et lind paistaks ka tumeda klaasi ja häguse ilmaga
    ctx.strokeStyle = rim; ctx.lineWidth = 1.1; ctx.lineJoin = 'round'; body(); ctx.stroke(); wing(); ctx.stroke();
    ctx.beginPath(); ctx.arc(7.2, -1.8, 3.5, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  // Ööliblikas: kahvatud tiivad, kiire tiivalöök, rahutu lend ja ümber pehme hõõgus (tuli akna taga), et teda öösel tumedal klaasil näha oleks.
  drawMoth(ctx, x, y, u, dir, night) {
    const t = this.reduced ? 0 : this.t, beat = Math.sin(t * 26), knock = Math.sin(u * 22) * 3.2, wing = mix('#efe4c8', '#f7f0dd', night), edge = mix('#c2b088', '#d8cba8', night), body = mix('#6b5c42', '#a3957a', night);
    ctx.save(); ctx.translate(x, y + knock); ctx.rotate(Math.cos(u * 10) * 0.2 - 0.05); ctx.scale(dir * 1.2, 1.2);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 15); glow.addColorStop(0, rgba('#ffeec2', 0.4 * night)); glow.addColorStop(1, rgba('#ffeec2', 0));
    ctx.fillStyle = glow; ctx.fillRect(-15, -15, 30, 30);
    const fly = 0.55 + 0.45 * beat;   // tiivalöök: tiivad tõusevad ja laskuvad
    for (const sg of [-1, 1]) {
      ctx.fillStyle = rgba(wing, 0.95); ctx.beginPath(); ctx.ellipse(-1.5, sg * (3.4 * fly + 1.2), 6.4, 2.5 + 1.6 * (1 - fly), sg * 0.22, 0, TAU); ctx.fill();
      ctx.strokeStyle = rgba(edge, 0.85); ctx.lineWidth = 0.7; ctx.stroke();
      ctx.fillStyle = rgba(mix(wing, edge, 0.3), 0.8); ctx.beginPath(); ctx.ellipse(-3.6, sg * (2.6 * fly + 1), 4.2, 1.8 + 1.1 * (1 - fly), sg * 0.28, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(0, 0, 5.6, 1.9, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = rgba('#4c3f2c', 0.75); ctx.lineWidth = 0.7; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(5.4, -0.4, 1.6, 1.4, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = rgba(body, 0.95); ctx.lineWidth = 0.8;
    for (const sg of [-1, 1]) { ctx.beginPath(); ctx.moveTo(5.8, -0.9 + sg * 0.5); ctx.quadraticCurveTo(9, -3 + sg * 2.4, 11.4, -3.6 + sg * 3.2); ctx.stroke(); }
    ctx.restore();
  }

  // ---- ventilatsioon pööningul
  drawAtticVent(ctx, { dark }, dt) {
    const v = this.state.vent; if (!v.present) return;
    const a = this.a, s = this.state;
    ctx.save();
    // kanalid
    const duct = (path, w) => { ctx.strokeStyle = rgba('#20283a', 0.5 + dark * 0.2); ctx.lineWidth = w + 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); path.pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); ctx.strokeStyle = mix('#9aa6b6', '#3a4252', dark * 0.6); ctx.lineWidth = w; ctx.beginPath(); path.pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); };
    duct(PATHS.airSupply, 12); duct(PATHS.airExtract, 12);
    // õhuosakesed
    this.drawAir(ctx, dt);
    // seade
    const g = ctx.createLinearGradient(0, 326, 0, 400); g.addColorStop(0, mix('#eef2f6', '#4a5366', dark * 0.65)); g.addColorStop(1, mix('#c4ccd6', '#2c3344', dark * 0.65));
    ctx.fillStyle = g; rr(ctx, 738, 326, 154, 76, 9); ctx.fill(); ctx.strokeStyle = rgba('#2b3542', 0.55); ctx.lineWidth = 2; ctx.stroke();
    // soojusvaheti (vastuvool)
    const dx = 815, dy = 364, cold = mix('#7cc4ff', '#ffffff', 0.2), warm = mix('#ffb27a', '#ff7a4a', 0.4);
    const eg = ctx.createLinearGradient(dx - 38, dy, dx + 38, dy); eg.addColorStop(0, rgba(cold, 0.9)); eg.addColorStop(0.5, rgba(mix(cold, warm, a.recovery * 0.8), 0.95)); eg.addColorStop(1, rgba(warm, 0.9));
    ctx.fillStyle = eg; ctx.beginPath(); ctx.moveTo(dx - 38, dy); ctx.lineTo(dx, dy - 30); ctx.lineTo(dx + 38, dy); ctx.lineTo(dx, dy + 30); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = rgba('#ffffff', 0.55); ctx.lineWidth = 1; for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(dx + i * 9 - 26, dy + 24 - Math.abs(i) * 6 + 4); ctx.lineTo(dx + i * 9 + 26 - 52 + 26, dy - 24 + Math.abs(i) * 6 - 4); ctx.stroke(); }
    ctx.strokeStyle = '#2b3542'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(dx - 38, dy); ctx.lineTo(dx, dy - 30); ctx.lineTo(dx + 38, dy); ctx.lineTo(dx, dy + 30); ctx.closePath(); ctx.stroke();
    // ventilaatorid
    for (const fx of [764, 866]) this.drawFan(ctx, fx, 364, 15, this.a.fan * (fx > 800 ? 1 : -1), 5, a.air);
    ctx.restore();
  }

  drawFan(ctx, x, y, r, angle, blades, blur, hubColor = '#2b3542') {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.beginPath(); ctx.arc(0, 0, r + 3, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#2b3542'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, r + 3, 0, TAU); ctx.stroke();
    ctx.rotate(angle);
    if (blur > 0.45) { ctx.fillStyle = `rgba(43,53,66,${0.12 * blur})`; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); }
    ctx.fillStyle = rgba('#2b3542', 1 - blur * 0.55);
    for (let i = 0; i < blades; i++) { ctx.rotate(TAU / blades); ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(r * 0.4, -r * 0.15, r * 0.95, -r * 0.35, r * 0.85, r * 0.2); ctx.bezierCurveTo(r * 0.6, r * 0.25, r * 0.2, r * 0.12, 0, 0); ctx.fill(); }
    ctx.fillStyle = hubColor; ctx.beginPath(); ctx.arc(0, 0, r * 0.22, 0, TAU); ctx.fill();
    ctx.restore();
  }

  drawAir(ctx, dt) {
    const s = this.state, v = s.vent, a = this.a; if (a.air < 0.02) return;
    const outC = mix('#8fd0ff', '#ffb27a', clamp(((s.outdoor ?? 10) - 4) / 26)), inC = mix('#ffe2b8', '#ffab70', clamp(((s.indoor ?? 21) - 18) / 8));
    const speed = 0.045 + 0.2 * a.air, density = clamp((v.airflow || 100) / 240, 0.25, 1);
    const draw = (flow, colorFn, sizeMul = 1) => {
      flow.advance(dt, speed);
      const n = Math.max(4, Math.round(flow.n * density)), p = this.tmp;
      for (let i = 0; i < n; i++) {
        const u = (flow.off[i] + flow.phase) % 1; pointAt(flow.path, u, p);
        const c = colorFn(u), tw = 0.6 + 0.4 * Math.sin(this.t * 4 + i * 1.7);
        const r = flow.size * sizeMul * (0.8 + 0.5 * a.air);
        this.glow(ctx, c, p.x, p.y, r * 3.6, 0.85 * tw);
      }
    };
    const sv = PATHS.airSupply.vu, ex = PATHS.airExtract.vu;
    draw(this.flows.airSupply, u => { const k = a.recovery * smooth(clamp((u - sv[3]) / (sv[6] - sv[3]))); return mix(outC, inC, k); });
    draw(this.flows.airExtract, u => { const k = a.recovery * smooth(clamp((u - ex[2]) / (ex[4] - ex[2]))) * 0.92; return mix(inC, outC, k); }, 0.9);
    // väljapuhe: hajuvad pilved katuse kohal
    for (const e of this.exhaust) {
      e.u = (e.u + dt * 0.12 * a.air * e.v) % 1;
      const x = 862 + Math.sin(e.u * 7 + e.o) * 10 * e.u + e.o * e.u * 0.8, y = 246 - e.u * 150, al = Math.sin(e.u * Math.PI) * 0.45 * a.air;
      const c = mix(outC, '#ffffff', 0.5), r = 5 + e.u * 18;
      this.glow(ctx, c, x, y, r, al);
    }
    // diffuusor toas
    ctx.fillStyle = '#2b3542'; ctx.fillRect(862, 444, 22, 6); ctx.fillRect(788, 444, 22, 6);
  }

  // ---- torud ja voolud
  drawPipes(ctx, { dark }, dt) {
    const s = this.state, a = this.a;
    const tube = path => { ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = rgba('#1f2a3a', 0.28 + dark * 0.25); ctx.lineWidth = 13; ctx.beginPath(); path.pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); ctx.strokeStyle = mix('#dfe7ef', '#2a3142', dark * 0.65); ctx.lineWidth = 9; ctx.stroke(); };
    Object.entries(PATHS).filter(([k]) => !k.startsWith('air')).forEach(([, p]) => tube(p));
    const hotC = heatHex(Math.max(25, s.supply ?? 40) + 8), coldC = heatHex(Math.min(40, s.returnT ?? 28) - 6);
    const go = (flow, level, color, sizeMul = 1) => {
      flow.advance(dt, 0.02 + 0.3 * level);
      const p = this.tmp, r = flow.size * sizeMul * (0.8 + 0.6 * level), alpha = 0.3 + 0.7 * clamp(level * 1.4 + 0.12);
      for (let i = 0; i < flow.n; i++) {
        const u = (flow.off[i] + flow.phase) % 1; pointAt(flow.path, u, p);
        this.glow(ctx, color, p.x, p.y, r * 3.2, alpha);
      }
    };
    go(this.flows.heatSupplyA, a.heat, hotC); go(this.flows.heatSupplyB, a.heat, hotC); go(this.flows.heatReturn, a.heat, coldC);
    go(this.flows.hwSupply, a.hw, hotC, 1.1); go(this.flows.hwReturn, a.hw, coldC, 1.1); go(this.flows.showerFeed, a.hw * 0.8, hotC, 0.9);
  }

  // Maasoojuspump on sisetingimuste kapp: ekraan, uks klaasaknaga (selle taga pöörleb kompressor) ja soojakandja ühendused põranda all.
  drawPump(ctx, { dark }) {
    const a = this.a, s = this.state, x = 372, y = 520, w = 116, h = 180, running = Boolean(s.running);
    const g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, mix('#f6f8fa', '#566072', dark * 0.6)); g.addColorStop(0.5, mix('#e4e9ef', '#434c5e', dark * 0.6)); g.addColorStop(1, mix('#b9c2ce', '#323a4a', dark * 0.6));
    ctx.fillStyle = g; rr(ctx, x, y, w, h, 12); ctx.fill(); ctx.strokeStyle = '#2b3542'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.strokeStyle = rgba('#2b3542', 0.25); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + 8, y + 70); ctx.lineTo(x + w - 8, y + 70); ctx.stroke();
    // ekraan
    ctx.fillStyle = '#0b1420'; rr(ctx, x + 14, y + 12, w - 28, 50, 6); ctx.fill();
    const kw = s.powerKw ?? 0, text = `${number(kw, 1)} kW`;
    ctx.fillStyle = rgba(running ? '#ffb347' : '#6fe0c8', 0.92); ctx.font = '700 25px Manrope, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x + w / 2, y + 30);
    ctx.fillStyle = rgba('#ffffff', 0.55); ctx.font = '700 8.5px Manrope, sans-serif'; ctx.fillText(running ? tr('live.canvasCompressorOn') : tr('live.canvasCompressorOff'), x + w / 2, y + 51);
    ctx.fillStyle = rgba('#ffffff', 0.12); ctx.fillRect(x + 16, y + 14, w - 32, 8);
    // uks ja klaasaken
    ctx.fillStyle = mix('#d3d9e1', '#2d3546', dark * 0.6); rr(ctx, x + 12, y + 80, w - 24, 88, 8); ctx.fill(); ctx.strokeStyle = rgba('#2b3542', 0.5); ctx.lineWidth = 1.5; ctx.stroke();
    const cx = x + w / 2 - 6, cy = y + 124;
    ctx.fillStyle = '#121b27'; ctx.beginPath(); ctx.arc(cx, cy, 33, 0, TAU); ctx.fill();
    ctx.save(); ctx.translate(cx, cy); ctx.beginPath(); ctx.arc(0, 0, 31, 0, TAU); ctx.clip(); ctx.rotate(a.scroll);
    ctx.lineCap = 'round'; ctx.lineWidth = 3.4; ctx.strokeStyle = rgba(running ? '#ff9b4a' : '#6f7d90', 0.55 + 0.4 * a.comp); ctx.beginPath();
    for (let t = 0; t <= 4.6 * Math.PI; t += 0.2) { const r = 3 + t * 1.85, px = Math.cos(t) * r, py = Math.sin(t) * r; t ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.stroke();
    ctx.strokeStyle = rgba(running ? '#ffd39a' : '#9aa6b6', 0.7); ctx.lineWidth = 2; ctx.beginPath();
    for (let t = 0; t <= 4.6 * Math.PI; t += 0.2) { const r = 3 + t * 1.85, px = Math.cos(t + Math.PI) * r, py = Math.sin(t + Math.PI) * r; t ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.stroke();
    ctx.restore();
    if (running) { const gl = ctx.createRadialGradient(cx, cy, 4, cx, cy, 36); gl.addColorStop(0, rgba('#ff9b4a', 0.22 * a.comp)); gl.addColorStop(1, rgba('#ff9b4a', 0)); ctx.fillStyle = gl; ctx.fillRect(cx - 40, cy - 40, 80, 80); }
    ctx.strokeStyle = rgba('#ffffff', 0.35); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, 33, -2.6, -1.2); ctx.stroke();
    ctx.strokeStyle = '#2b3542'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, 33, 0, TAU); ctx.stroke();
    ctx.fillStyle = mix('#9aa6b6', '#3a4454', dark * 0.5); rr(ctx, x + w - 26, y + 108, 6, 34, 3); ctx.fill();
    // led
    const pulse = running ? 0.6 + 0.4 * Math.sin(this.t * 4) : 0.85;
    ctx.fillStyle = running ? rgba('#ffb347', pulse) : rgba('#5be3a0', pulse); ctx.beginPath(); ctx.arc(x + w - 17, y + h - 12, 4, 0, TAU); ctx.fill();
    // soojakandja ühendused ja jalad
    ctx.fillStyle = mix('#8fb7d6', '#3c5670', dark * 0.5); ctx.fillRect(443, y + h - 2, 10, 8); ctx.fillRect(479, y + h - 2, 10, 8);
    ctx.fillStyle = mix('#3a4454', '#0c0f1a', dark * 0.5); ctx.fillRect(x + 14, y + h, 16, 6); ctx.fillRect(x + w - 30, y + h, 16, 6);
  }

  // Maa lõige: mullakihid, kivid, puujuured ja soojakandja kontuur, milles osakesed liiguvad kompressori töötamise ajal.
  drawUnderground(ctx, { dark, ground }, dt) {
    const a = this.a, top = SOIL_TOP, bottom = 1140, night = dark * 0.62;
    const g = ctx.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, mix('#856443', '#141a26', night)); g.addColorStop(0.3, mix('#6d5137', '#10151f', night)); g.addColorStop(0.7, mix('#553f30', '#0c1018', night)); g.addColorStop(1, mix('#3a2d21', '#080b12', night));
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-400, bottom); ctx.lineTo(-400, top);
    for (let x = -400; x <= W + 400; x += 12) ctx.lineTo(x, top + Math.sin(x * 0.031) * 2.4 + Math.sin(x * 0.11) * 1.2);
    ctx.lineTo(W + 400, bottom); ctx.closePath(); ctx.fill();
    // muru serv
    ctx.fillStyle = mix(ground.top, '#0a1018', dark * 0.55); ctx.fillRect(-400, top - 5, W + 800, 6);
    // mullakihtide jooned ja kivid (püsivad, seemnest)
    ctx.lineWidth = 1.4;
    [[838, 0.16], [900, 0.2], [986, 0.26]].forEach(([y0, al], i) => { ctx.strokeStyle = rgba('#000000', al); ctx.beginPath(); for (let x = -400; x <= W + 400; x += 14) { const y = y0 + Math.sin(x * 0.012 + i * 2) * 7 + Math.sin(x * 0.05 + i) * 2; x === -400 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.stroke(); });
    const rnd = mulberry32(5150);
    // Kivid ja mullatükid: kaks värvi, seega kaks täitmist 70 asemel.
    const rockC = rgba(mix('#8a7f72', '#1c1e26', night), 0.6), soilC = rgba(mix('#2a2018', '#07080c', night), 0.45);
    const rocks = [], clods = [];
    for (let i = 0; i < 70; i++) { const x = -300 + rnd() * (W + 600), y = top + 18 + rnd() * 330, r = 2 + rnd() * 9, rock = rnd() > 0.6; (rock ? rocks : clods).push([x, y, r * 1.3, r, rnd() * 3]); }
    for (const [col, list] of [[rockC, rocks], [soilC, clods]]) {
      if (!list.length) continue;
      ctx.fillStyle = col; ctx.beginPath();
      for (const [x, y, rx, ry, rot] of list) { ctx.moveTo(x + rx * Math.cos(rot), y + rx * Math.sin(rot)); ctx.ellipse(x, y, rx, ry, rot, 0, TAU); }
      ctx.fill();
    }
    // puu juured
    ctx.strokeStyle = mix('#3e2f22', '#0b0d14', night); ctx.lineCap = 'round'; ctx.lineWidth = 6;
    for (const [dx, dy, cx2] of [[-110, 120, -30], [-60, 170, -6], [90, 140, 34], [50, 190, 10]]) { ctx.beginPath(); ctx.moveTo(190, top); ctx.quadraticCurveTo(190 + cx2, top + dy * 0.45, 190 + dx, top + dy); ctx.stroke(); }
    // ussid ja mardikad liiguvad aeglaselt mullas (ainult soojal ajal)
    if ((this.a.outdoor ?? 10) > 4) for (let i = 0; i < 4; i++) { const x0 = 1280 + i * 70 + Math.sin(this.t * 0.25 + i * 2) * 30, y0 = top + 60 + i * 55; ctx.strokeStyle = rgba(mix('#c98f8f', '#2a1a1c', night), 0.75); ctx.lineWidth = 3.2; ctx.beginPath(); for (let k = 0; k <= 10; k++) { const xx = x0 - k * 4, yy = y0 + Math.sin(k * 0.9 + this.t * 2 + i) * 3; k ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); } ctx.stroke(); }
    // külmumispiir
    const cold = clamp(((0 - (this.a.outdoor ?? 5)) / 12)), frost = Math.max(cold, this.a.snowCover * 0.4);
    if (frost > 0.02) { const fg = ctx.createLinearGradient(0, top, 0, top + 46); fg.addColorStop(0, rgba('#cfe6f7', 0.42 * frost)); fg.addColorStop(1, rgba('#cfe6f7', 0)); ctx.fillStyle = fg; ctx.fillRect(-400, top, W + 800, 46); }
    // soojakandja kontuur
    const pts = GROUND_LOOP.pts, trace = () => { ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); };
    if (a.comp > 0.05) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = rgba('#4fb8ff', 0.09 * a.comp); ctx.lineWidth = 40; trace(); ctx.stroke(); ctx.lineWidth = 22; ctx.strokeStyle = rgba('#7fd4ff', 0.08 * a.comp); trace(); ctx.stroke(); ctx.restore(); }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = rgba('#0a1018', 0.55); ctx.lineWidth = 12; trace(); ctx.stroke();
    ctx.strokeStyle = mix('#b9d3ea', '#3f5670', dark * 0.6); ctx.lineWidth = 8; trace(); ctx.stroke();
    // osakesed: külm soojakandja väljub pumbast ja soojeneb maa sees
    this.brine.advance(dt, 0.02 * a.comp);
    const p = this.tmp, n = this.brine.n, alpha = 0.16 + 0.8 * a.comp;
    for (let i = 0; i < n; i++) {
      const u = (this.brine.off[i] + this.brine.phase) % 1; pointAt(GROUND_LOOP, u, p);
      const br = this.state.brine, c = br?.present ? mix(brineHex(br.out), brineHex(br.in), smooth(clamp((u - 0.1) / 0.75))) : mix('#8fd8ff', '#ffc98c', smooth(clamp((u - 0.12) / 0.72))), r = 2.7 * (0.85 + 0.3 * a.comp);
      this.glow(ctx, c, p.x, p.y, r * 3.2, alpha);
    }
    const br = this.state.brine;
    if (br?.present && !this.fullscreen) {
      const tag = (x, y, title, value, col) => {
        ctx.save(); const w = 150;
        ctx.fillStyle = 'rgba(8,14,26,0.78)'; rr(ctx, x, y, w, 46, 9); ctx.fill(); ctx.strokeStyle = rgba(col, 0.9); ctx.lineWidth = 1.6; ctx.stroke();
        ctx.fillStyle = rgba('#ffffff', 0.7); ctx.font = '700 10.5px Manrope, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(title, x + 12, y + 14);
        ctx.fillStyle = '#fff'; ctx.font = '700 19px Manrope, sans-serif'; ctx.fillText(`${number(value, 1)} °C`, x + 12, y + 33); ctx.restore();
      };
      tag(930, 944, tr('live.canvasBrineToGround'), br.out, brineHex(br.out));
      tag(1100, 944, tr('live.canvasBrineFromGround'), br.in, brineHex(br.in));
    }
    ctx.fillStyle = rgba('#ffffff', 0.5 - dark * 0.1); ctx.font = '700 13px Manrope, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
    ctx.fillText(tr('live.canvasGroundLoop'), 420, 880); if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }

  drawBuffer(ctx, { dark }) {
    const a = this.a, x = 400, y = 448, w = 60, h = 64, t = a.buffer;
    const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, heatHex(t + 2)); g.addColorStop(1, heatHex(t - 5));
    ctx.fillStyle = g; rr(ctx, x, y, w, h, 24); ctx.fill();
    const sheen = ctx.createLinearGradient(x, 0, x + w, 0); sheen.addColorStop(0, 'rgba(255,255,255,0.45)'); sheen.addColorStop(0.3, 'rgba(255,255,255,0.06)'); sheen.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = sheen; rr(ctx, x, y, w, h, 24); ctx.fill();
    const sweep = (this.t * 0.16) % 1; ctx.save(); rr(ctx, x, y, w, h, 24); ctx.clip(); ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(x, y + sweep * (h + 60) - 40, w, 26); ctx.restore();
    ctx.strokeStyle = '#2b3542'; ctx.lineWidth = 2.5; rr(ctx, x, y, w, h, 24); ctx.stroke();
    ctx.fillStyle = mix('#3a4454', '#0c0f1a', dark * 0.5); ctx.fillRect(x + 10, y + h, 12, 6); ctx.fillRect(x + w - 22, y + h, 12, 6);
  }

  // Elutoa mööbel: vaip, sohva ja seinapilt. Joonistatakse enne radiaatorit ja kassi, et need jääksid ette.
  drawFurniture(ctx, { dark }) {
    const fab = mix('#c07a5c', '#38251e', dark * 0.6), fabD = mix('#9c5d44', '#281812', dark * 0.6), cush = mix('#e0b48f', '#4a332a', dark * 0.55);
    const woodD = mix('#6a4327', '#181009', dark * 0.6);
    // vaip põrandal
    ctx.fillStyle = rgba(mix('#b7a58b', '#2a2733', dark * 0.55), 0.55); rr(ctx, 516, 690, 333, 10, 5); ctx.fill();
    ctx.strokeStyle = rgba(mix('#8f7d63', '#1c1a22', dark * 0.5), 0.5); ctx.lineWidth = 1; ctx.stroke();
    // sohva (esivaade: seljatugi, kaks seljapatja, kaks istmepatja ja käetoed)
    ctx.fillStyle = woodD; for (const lx of [572, 610, 632, 670]) ctx.fillRect(lx, 694, 5, 4);
    ctx.fillStyle = fab; rr(ctx, 566, 636, 116, 38, 12); ctx.fill();
    ctx.fillStyle = cush; rr(ctx, 572, 641, 50, 27, 8); ctx.fill(); rr(ctx, 627, 641, 50, 27, 8); ctx.fill();
    ctx.fillStyle = fab; rr(ctx, 574, 668, 100, 26, 8); ctx.fill();
    ctx.fillStyle = mix('#d8ab7f', '#463124', dark * 0.5); rr(ctx, 578, 669, 46, 21, 6); ctx.fill(); rr(ctx, 628, 669, 46, 21, 6); ctx.fill();
    ctx.fillStyle = fabD; rr(ctx, 562, 650, 22, 46, 9); ctx.fill(); rr(ctx, 662, 650, 22, 46, 9); ctx.fill();
    ctx.fillStyle = mix('#e6c98a', '#4a4026', dark * 0.5); rr(ctx, 584, 645, 22, 19, 8); ctx.fill();
    ctx.strokeStyle = rgba('#000000', 0.12); ctx.lineWidth = 1.2; rr(ctx, 566, 636, 116, 38, 12); ctx.stroke();
    // seinapilt (jääb vasakule torust, mis läheb x=765 juures üles)
    const fx = 580, fy = 490, fw = 68, fh = 54;
    ctx.fillStyle = woodD; rr(ctx, fx - 4, fy - 4, fw + 8, fh + 8, 3); ctx.fill();
    ctx.fillStyle = mix('#f3ead9', '#2f2b36', dark * 0.6); ctx.fillRect(fx, fy, fw, fh);
    ctx.fillStyle = rgba(mix('#7fa8c9', '#243a4d', dark * 0.5), 0.85); ctx.beginPath();
    ctx.moveTo(fx, fy + 44); ctx.quadraticCurveTo(fx + 20, fy + 16, fx + 36, fy + 38); ctx.quadraticCurveTo(fx + 52, fy + 18, fx + fw, fy + 46);
    ctx.lineTo(fx + fw, fy + fh); ctx.lineTo(fx, fy + fh); ctx.closePath(); ctx.fill();
    ctx.fillStyle = rgba(mix('#e8c46a', '#5a4a24', dark * 0.5), 0.9); ctx.beginPath(); ctx.arc(fx + 52, fy + 14, 5, 0, TAU); ctx.fill();
  }

  drawLiving(ctx, { dark, glow }, dt) {
    const a = this.a, s = this.state;
    // radiaator
    const x = 830, y = 622, w = 120, h = 68, heat = a.heat;
    const hot = mix('#9aa4b0', '#ff7a3a', clamp(heat * 1.15 - 0.08)), cold = mix('#dfe5ec', '#33394a', dark * 0.6);
    if (heat > 0.2) { const hg = ctx.createRadialGradient(x + w / 2, y + h / 2, 10, x + w / 2, y + h / 2, 170); hg.addColorStop(0, rgba('#ff8a3a', 0.30 * heat)); hg.addColorStop(1, rgba('#ff8a3a', 0)); ctx.fillStyle = hg; ctx.fillRect(x - 160, y - 130, w + 320, h + 260); }
    for (let i = 0; i < 9; i++) { const fx = x + 4 + i * 13.2, g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, mix(cold, hot, 0.85)); g.addColorStop(1, mix(cold, hot, 0.45 + 0.2 * Math.sin(this.t * 2 + i) * heat)); ctx.fillStyle = g; rr(ctx, fx, y, 10, h, 4); ctx.fill(); ctx.strokeStyle = '#2b3542'; ctx.lineWidth = 1.6; ctx.stroke(); }
    ctx.fillStyle = '#2b3542'; ctx.fillRect(x - 6, y + 10, 8, 10); ctx.fillRect(x - 6, y + h - 18, 8, 10); ctx.fillRect(x + 12, y + h, 8, 8); ctx.fillRect(x + w - 20, y + h, 8, 8);
    // soojuse virvendus
    if (heat > 0.25 && !this.reduced) {
      ctx.save(); ctx.lineWidth = 2.2; ctx.lineCap = 'round';
      for (let i = 0; i < 7; i++) {
        const bx = x + 8 + i * 17; ctx.beginPath();
        for (let k = 0; k <= 16; k++) { const f = k / 16, yy = y - 4 - f * 92, xx = bx + Math.sin(this.t * 2.4 + f * 7 + i) * (2 + f * 7); k ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); }
        const g = ctx.createLinearGradient(0, y, 0, y - 92); g.addColorStop(0, rgba('#ff8a3a', 0.5 * heat)); g.addColorStop(1, rgba('#ff8a3a', 0)); ctx.strokeStyle = g; ctx.stroke();
      }
      ctx.restore();
    }
    // taim
    ctx.fillStyle = mix('#b9653f', '#3a2620', dark * 0.6); ctx.beginPath(); ctx.moveTo(693, 660); ctx.lineTo(729, 660); ctx.lineTo(723, 700); ctx.lineTo(699, 700); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = mix('#3f8f4d', '#16301f', dark * 0.6); ctx.lineWidth = 5; ctx.lineCap = 'round';
    for (const [dx, dy, c] of [[-26, -34, 0], [-6, -52, 1], [22, -38, 2], [34, -14, 3]]) { const sw = Math.sin(this.t * 1.2 + c) * 2.5; ctx.beginPath(); ctx.moveTo(711, 662); ctx.quadraticCurveTo(711 + dx * 0.4 + sw, 662 + dy * 0.7, 711 + dx + sw * 1.4, 662 + dy); ctx.stroke(); }
    // põrandalamp
    const lampOn = dark > 0.25, lx = 1008;
    ctx.strokeStyle = mix('#3a4454', '#0c0f1a', dark * 0.5); ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(lx, 700); ctx.lineTo(lx, 604); ctx.stroke(); ctx.fillStyle = '#2b3542'; ctx.fillRect(lx - 14, 697, 28, 5);
    if (lampOn) { const lg = ctx.createRadialGradient(lx, 596, 4, lx, 596, 210); lg.addColorStop(0, rgba('#ffd28a', 0.55 * dark)); lg.addColorStop(1, rgba('#ffd28a', 0)); ctx.fillStyle = lg; ctx.fillRect(lx - 210, 386, 420, 420); }
    ctx.fillStyle = lampOn ? rgba('#ffe2a8', 0.95) : mix('#e8dcc4', '#3a3340', dark); ctx.beginPath(); ctx.moveTo(lx - 18, 606); ctx.lineTo(lx + 18, 606); ctx.lineTo(lx + 11, 582); ctx.lineTo(lx - 11, 582); ctx.closePath(); ctx.fill();
    this.drawCat(ctx, dark, heat);
  }

  // Magav triibuline (punakas tabby) kass: hingab koos radiaatori soojusega ning teeb juhuslikke liigutusi (cat.js).
  drawCat(ctx, dark, heat) {
    const pose = this.catPose;
    const cx = 972 + pose.x, cy = 690 + pose.y, night = dark * 0.55;
    const fur = mix('#d9924e', '#5b3e24', night), stripe = mix('#8d5024', '#2e1d10', night), light = mix('#f4e4c4', '#85755d', night), inner = mix('#f2a9a0', '#7a5456', night);
    const breath = 1 + Math.sin(this.t * (1.3 + heat * 0.4)) * 0.035 + pose.breath * 0.07;
    // keha pööre ümber püstsuunalise telje (cat.js: yaw): c = külgvaate koosinus, k = kui külili kass on (1 külg, 0 nägu/tagumik vaataja poole)
    const raise = pose.raise, sit = pose.sit, c = Math.cos(pose.yaw), sn = Math.sin(pose.yaw), k = Math.abs(c), sgn = c < 0 ? -1 : 1, kb = 0.36 + 0.64 * k;
    // pea pöörab lisaks kehale (headYaw): >0 nägu vaataja poole, <0 vaatab vaataja eest ära (näha on kõrvad ja kukal, nägu peidus)
    const hy = pose.yaw + pose.headYaw, ch = Math.cos(hy), kh = Math.abs(ch), sgnH = ch < 0 ? -1 : 1, fvis = clamp((Math.sin(hy) + 1) / 0.4);
    const headX = 14 * c + 10 * ch;
    const L = (prof, front) => front + (prof - front) * kh;
    const poly = pts => { ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fill(); };
    if (pose.sleeping && !this.reduced) this.drawZzz(ctx, cx + pose.dir * 28, cy - 22, dark);
    ctx.save(); ctx.translate(cx, cy); ctx.scale(pose.flip, 1);
    const floorY = 10.6 + raise;
    // ringutades tagajalad (tagumik üleval) põrandast puusani
    const stretchLegs = () => {
      const st = pose.stretch, sx = 1 + 0.12 * st, th = 0.2 * st, cs = Math.cos(th), sn2 = Math.sin(th);
      const hipAt = (px, py) => { const dx = (px - 30) * sx, dy = py - 10; return [30 + dx * cs - dy * sn2, 10 + dx * sn2 + dy * cs]; };
      const shown = clamp((st - 0.05) / 0.25), legs = [[-21, 4, -3, mix(fur, stripe, 0.5), 5.2], [-15, 5, 0, fur, 5.8]];
      ctx.save(); ctx.globalAlpha = shown; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const [px, py, dx, col, w] of legs) {
        const [hx, hy2] = hipAt(px, py), fx = hx - 3 - 2 * st + dx * 0.4, fy = 10.6;
        ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(hx, hy2); ctx.quadraticCurveTo((hx + fx) / 2 - 3.5 * st, (hy2 + fy) / 2 + 1, fx, fy - 1); ctx.stroke();
        ctx.fillStyle = mix(light, stripe, col === fur ? 0 : 0.25); ctx.beginPath(); ctx.ellipse(fx + 1.2, fy, 4.2, 2.6, 0, 0, TAU); ctx.fill();
      }
      ctx.restore();
    };
    if (pose.stretch > 0.05) stretchLegs();
    ctx.translate(0, -raise);
    ctx.translate(0, -2); ctx.rotate(-pose.tilt); ctx.translate(0, 2);
    // ringutamine: tagumik tõuseb, keha pikeneb, esiosa jääb põrandale
    ctx.translate(30, 10); ctx.rotate(0.2 * pose.stretch); ctx.scale(1 + 0.12 * pose.stretch, 1); ctx.translate(-30, -10);
    // istumine: keha tõuseb tagumiku ümber püsti, pea püsib sirge
    const sitAngle = 0.8 * sit, sitScale = 1 - 0.14 * sit;
    const sitT = () => { ctx.translate(-14, 8); ctx.rotate(-sitAngle); ctx.scale(sitScale, 1 + 0.05 * sit); ctx.translate(14, -8); };
    const sitMap = (px, py) => { const dx = (px + 14) * sitScale, dy = (py - 8) * (1 + 0.05 * sit); return [-14 + dx * Math.cos(sitAngle) + dy * Math.sin(sitAngle), 8 - dx * Math.sin(sitAngle) + dy * Math.cos(sitAngle)]; };
    // püstijalad (seistes ja kõndides): neli jalga, pööratult kolmemõõtmeliselt; õhus sirutatud, kõndides astuvad diagonaalis
    const legsA = (1 - sit) * clamp(raise / 1.5);
    const standing = [[-15, -4.5, 0, false], [14, -4.5, Math.PI, true], [-15, 4.5, Math.PI, false], [14, 4.5, 0, true]].map(([x, z, ph, front]) => {
      const lift = Math.max(0, Math.sin(pose.stepPhase + ph)) * 2.4 * pose.walk + (front ? 7 : 6) * pose.air;
      return { x: x * c - z * sn, dx: (front ? 9 : -9) * pose.air, depth: x * sn + z * c, lift, far: z < 0 };
    });
    const drawLeg = leg => {
      const foot = floorY - leg.lift;
      ctx.save(); ctx.globalAlpha = legsA; ctx.lineCap = 'round';
      ctx.strokeStyle = leg.far ? mix(fur, stripe, 0.35) : fur; ctx.lineWidth = 5.2; ctx.beginPath(); ctx.moveTo(leg.x, 6); ctx.lineTo(leg.x + leg.dx, foot - 1); ctx.stroke();
      ctx.fillStyle = leg.far ? mix(light, stripe, 0.2) : light; ctx.beginPath(); ctx.ellipse(leg.x + leg.dx + 0.8 * sgn * k, foot, 3.9, 2.5, 0, 0, TAU); ctx.fill();
      ctx.restore();
    };
    // saba (alati keha taga): värvitud ja tumedate rõngastega; pöörde ajal kahaneb ja liigub teisele poole, istudes lebab põrandal
    ctx.save(); ctx.scale(sgn * Math.max(k, 0.12), 1);
    const a = (Math.sin(pose.tailPhase) * 0.5 + 0.5) * pose.tail * 16;
    const tailP = [[-24, 4, -22, 9], [-46, 8 - a * 0.55, -42, 13.6], [-32, 12 - a * 1.1, -51, 12 - a * 1.05]].map(([x0, y0, x1, y1]) => [lerp(x0, x1, sit), lerp(y0, y1, sit)]);
    const tail = () => { ctx.beginPath(); ctx.moveTo(...tailP[0]); ctx.quadraticCurveTo(...tailP[1], ...tailP[2]); };
    ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.strokeStyle = fur; tail(); ctx.stroke();
    ctx.save(); ctx.lineCap = 'butt'; ctx.setLineDash([2.4, 5]); ctx.strokeStyle = stripe; tail(); ctx.stroke(); ctx.restore();
    ctx.fillStyle = stripe; ctx.beginPath(); ctx.arc(tailP[2][0], tailP[2][1], 3, 0, TAU); ctx.fill();
    ctx.restore();
    if (legsA > 0.01) standing.filter(l => l.depth < 0).forEach(drawLeg);
    // keha ja selja triibud (pöörates kitsamaks)
    ctx.save(); sitT(); ctx.scale(kb, 1);
    const ry = 13 * breath;
    ctx.fillStyle = fur; ctx.beginPath(); ctx.ellipse(0, -2, 26, ry, 0, 0, TAU); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.ellipse(0, -2, 26, ry, 0, 0, TAU); ctx.clip();
    ctx.strokeStyle = stripe; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) { const x = -19 + i * 7.2; ctx.beginPath(); ctx.moveTo(x, -2 - ry - 1); ctx.quadraticCurveTo(x + 2.5, -6, x + 0.5, 3 - i % 2 * 2); ctx.stroke(); }
    ctx.fillStyle = light; ctx.globalAlpha = 0.55; ctx.beginPath(); ctx.ellipse(2, 10, 20, 5, 0, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
    ctx.restore();
    // käpad: puhkeasendis lõua all, ringutades ette sirutatud, jalgadel seistes ja istudes asendavad neid jalad
    if (pose.stretch > 0.05) {
      const ex = 26 + 24 * pose.stretch, ey = 9.5 - 5 * pose.stretch;
      ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.strokeStyle = fur; ctx.beginPath(); ctx.moveTo(16, 8); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.fillStyle = light; ctx.beginPath(); ctx.ellipse(ex, ey, 4, 3, 0, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = (1 - clamp(pose.stretch * 1.6)) * (1 - clamp(raise / 2.5)) * (1 - clamp(sit * 3)); ctx.fillStyle = light; ctx.beginPath(); ctx.ellipse(27, 9, 8, 4, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = stripe; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(24, 6.5); ctx.lineTo(24, 9.5); ctx.moveTo(29, 6.2); ctx.lineTo(29, 9.5); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.restore();
    if (legsA > 0.01) standing.filter(l => l.depth >= 0).forEach(drawLeg);
    if (sit > 0.02) {
      // istudes: tagumine reis ja tagakäpp põrandal, esijalad sirged rinnast alla
      ctx.save(); ctx.globalAlpha = clamp(sit * 4);
      ctx.fillStyle = fur; ctx.beginPath(); ctx.ellipse(-13, 3, 12.5, 10.5, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = stripe; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
      for (const [x, y] of [[-20, -3], [-14, -5], [-8, -2]]) { ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 2, y + 5, x - 0.5, y + 10); ctx.stroke(); }
      ctx.fillStyle = light; ctx.beginPath(); ctx.ellipse(-1.5, floorY, 6.5, 2.6, 0, 0, TAU); ctx.fill();
      const [fx, fy] = sitMap(14, 7);
      for (const [dx, col, pawCol] of [[3.4, mix(fur, stripe, 0.35), mix(light, stripe, 0.2)], [-0.6, fur, light]]) {
        ctx.strokeStyle = col; ctx.lineWidth = 5.2; ctx.beginPath(); ctx.moveTo(fx + dx, fy); ctx.lineTo(fx + dx + 0.6, floorY - 1); ctx.stroke();
        ctx.fillStyle = pawCol; ctx.beginPath(); ctx.ellipse(fx + dx + 1.8, floorY, 4.2, 2.5, 0, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
    // pea (alati keha ees): kuju liigub külgvaatest esiküljele; vasakule vaadates peegeldub; kehaga koos tõusev ja sirge
    ctx.save(); sitT(); ctx.scale(sgnH, 1); ctx.translate(sgnH * headX - 24, 0);
    ctx.save(); ctx.translate(16, -4); ctx.rotate(pose.head + 0.8 * sit * 1.0); ctx.translate(-16, 4);
    const back = pose.earBack * 4, lerpPts = (pp, ff) => pp.map(([x, y], i) => [L(x, ff[i][0]), L(y, ff[i][1])]);
    ctx.fillStyle = fur; ctx.beginPath(); ctx.ellipse(24, -6, L(10, 11.3), 10, 0, 0, TAU); ctx.fill();
    poly(lerpPts([[18, -13], [20 - back, -24 + back * 0.8], [26, -14]], [[15, -10], [17 - back * 0.5, -23 + back * 0.6], [23, -14]]));
    ctx.fillStyle = inner; ctx.globalAlpha = 0.35 + 0.65 * fvis; poly(lerpPts([[20, -14.5], [21 - back * 0.8, -21 + back * 0.6], [24.2, -14.8]], [[17.5, -12.5], [18.5 - back * 0.4, -20.5 + back * 0.5], [22, -14.5]])); ctx.globalAlpha = 1;
    ctx.save(); ctx.translate(29, -13); ctx.rotate(-pose.ear * 0.5 + pose.earBack * 0.3); ctx.translate(-29, 13);
    ctx.fillStyle = fur; poly(lerpPts([[26, -14], [32 - back * 0.5, -23 + back * 0.8], [33, -10]], [[25, -14], [31 - back * 0.5, -23 + back * 0.6], [33, -10]]));
    ctx.fillStyle = inner; ctx.globalAlpha = 0.35 + 0.65 * fvis; poly(lerpPts([[27.6, -14.6], [31.4 - back * 0.4, -21 + back * 0.6], [32, -12]], [[26.2, -14.5], [29.6 - back * 0.3, -20.5 + back * 0.5], [31.4, -11.5]])); ctx.globalAlpha = 1; ctx.restore();
    // otsa "M" ja põsetriibud (esiküljel mõlemal põsel); eest ära vaadates triibud jäävad, nägu kaob
    ctx.strokeStyle = stripe; ctx.lineWidth = 1.7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(21, -15.4); ctx.lineTo(21.8, -11); ctx.moveTo(25, -16); ctx.lineTo(25, -11.2); ctx.moveTo(29, -15.2); ctx.lineTo(28.2, -11); ctx.stroke();
    ctx.save(); ctx.globalAlpha = fvis;
    ctx.beginPath(); ctx.moveTo(15.2, -4.5); ctx.lineTo(19.6, -4); ctx.moveTo(15.4, -1); ctx.lineTo(19.4, -1.6); ctx.stroke();
    if (kh < 0.99) { ctx.save(); ctx.globalAlpha = fvis * (1 - kh); ctx.beginPath(); ctx.moveTo(32.8, -4.5); ctx.lineTo(28.4, -4); ctx.moveTo(32.6, -1); ctx.lineTo(28.6, -1.6); ctx.stroke(); ctx.restore(); }
    // hele koon, nina, silmad
    ctx.fillStyle = light; ctx.beginPath(); ctx.ellipse(L(30.6, 24), L(-2.6, -2), L(4.6, 6), L(3.6, 4.2), 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e07a85'; poly(lerpPts([[32.6, -5.6], [35.2, -5.4], [34, -3.6]], [[22.4, -4.8], [25.6, -4.8], [24, -2.8]]));
    const eyeInk = mix('#3a2412', '#120b05', night), open = pose.eyes > 0.5 && pose.squeeze < 0.35;
    const eye = (ex, alpha) => {
      ctx.save(); ctx.globalAlpha *= alpha;
      if (open) { ctx.fillStyle = mix('#d7b43c', '#8a7430', night); ctx.beginPath(); ctx.ellipse(ex, -8, 2.3, 2.7, 0, 0, TAU); ctx.fill(); ctx.fillStyle = eyeInk; ctx.beginPath(); ctx.ellipse(ex + 0.2, -8, 0.9, 2.3, 0, 0, TAU); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.arc(ex - 0.5, -8.9, 0.55, 0, TAU); ctx.fill(); }
      else { ctx.strokeStyle = eyeInk; ctx.lineWidth = 1.5 + pose.squeeze * 0.8; ctx.beginPath(); if (pose.squeeze > 0.35) { ctx.moveTo(ex - 3, -9.6); ctx.lineTo(ex, -7); ctx.lineTo(ex + 3, -9.6); } else { ctx.moveTo(ex - 2.5, -8); ctx.quadraticCurveTo(ex, -6.6, ex + 2.5, -8); } ctx.stroke(); }
      ctx.restore();
    };
    eye(L(28.5, 28), 1);
    if (kh < 0.85) eye(L(35.5, 20), clamp((0.85 - kh) / 0.35));
    if (pose.mouth > 0.03) {
      ctx.fillStyle = '#2a0f16'; ctx.beginPath(); ctx.ellipse(32, -1.2, 1.6 + pose.mouth * 3, 0.8 + pose.mouth * 5.4, 0, 0, TAU); ctx.fill();
      if (pose.mouth > 0.4) { ctx.fillStyle = '#e0707f'; ctx.beginPath(); ctx.ellipse(32.4, 0.6 + pose.mouth, 1.9, 2.4, 0, 0, TAU); ctx.fill(); }
    }
    if (pose.tongue > 0.05) { ctx.fillStyle = '#ff8fa3'; ctx.beginPath(); ctx.ellipse(33, 0.8 + pose.tongue, 1.9, 1 + pose.tongue * 3, 0, 0, TAU); ctx.fill(); }
    ctx.restore(); ctx.restore(); ctx.restore();
    ctx.restore();
  }

  drawZzz(ctx, x, y, dark) {
    ctx.save(); ctx.fillStyle = mix('#4b5a78', '#d6def3', dark);
    for (let i = 0; i < 3; i++) {
      const k = (this.t * 0.2 + i / 3) % 1;
      ctx.globalAlpha = Math.sin(Math.PI * k) * 0.55; ctx.font = `700 ${Math.round(8 + k * 7)}px 'Plus Jakarta Sans', sans-serif`;
      ctx.fillText('z', x + k * 16 + Math.sin(k * 6 + i) * 3, y - k * 30);
    }
    ctx.restore();
  }

  drawBath(ctx, { dark }, dt) {
    const a = this.a, s = this.state, x = 1138, y = 545, w = 64, h = 145, t = a.water;
    // aur
    if (a.hw > 0.3) for (const st of this.steam) {
      if (!this.reduced) { st.p = (st.p + dt * 0.11 * a.hw) % 1; }
      const k = st.p, sx = st.x + Math.sin(k * 6 + st.o * 9) * 16, sy = 690 - k * 190, al = Math.sin(k * Math.PI) * 0.22 * a.hw, r = st.r * (0.6 + k * 1.6);
      this.glow(ctx, '#ffffff', sx, sy, r, al);
    }
    // goblin tuleb boileri tagant ja läheb sinna tagasi, seepärast joonistatakse ta enne boilerit
    this.drawGoblin(ctx, dark, dt);
    // boiler
    ctx.save(); rr(ctx, x, y, w, h, 28); ctx.clip();
    const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, heatHex(t + 3)); g.addColorStop(0.55, heatHex(t)); g.addColorStop(1, heatHex(t - 14)); ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    const waveY = y + 20;
    ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.beginPath(); ctx.moveTo(x, waveY);
    for (let i = 0; i <= 40; i++) { const px = x + (w * i) / 40; ctx.lineTo(px, waveY + Math.sin(this.t * 1.7 + i * 0.5) * (1.6 + a.hw * 2.6) + Math.sin(this.t * 0.8 + i * 0.23) * 1.2); }
    ctx.lineTo(x + w, y); ctx.lineTo(x, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x, waveY + 3, w, h);
    for (const b of this.bubbles) {
      if (a.hw > 0.3 && !this.reduced) { b.y -= b.v * dt * (0.5 + a.hw); b.p += dt * 3; }
      if (b.y < waveY + 6) { b.y = y + h - 10; b.x = x + 12 + this.rng() * (w - 24); }
      if (a.hw > 0.3) { ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(b.x + Math.sin(b.p) * 4, b.y, b.r, 0, TAU); ctx.stroke(); }
    }
    const sheen = ctx.createLinearGradient(x, 0, x + w, 0); sheen.addColorStop(0, 'rgba(255,255,255,0.5)'); sheen.addColorStop(0.28, 'rgba(255,255,255,0.05)'); sheen.addColorStop(1, 'rgba(0,0,0,0.25)'); ctx.fillStyle = sheen; ctx.fillRect(x, y, w, h);
    ctx.restore(); ctx.strokeStyle = '#2b3542'; ctx.lineWidth = 2.5; rr(ctx, x, y, w, h, 28); ctx.stroke();
    // termomeeter
    const ty = v => y + h - 26 - clamp((v - 15) / 50) * (h - 62), tx = x + w + 18;
    ctx.strokeStyle = mix('#2b3542', '#9aa6b6', dark * 0.8); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(tx, ty(65)); ctx.lineTo(tx, ty(15)); ctx.stroke();
    ctx.fillStyle = mix('#2b3542', '#9aa6b6', dark * 0.8); ctx.font = '600 11px Manrope, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const v of [20, 30, 40, 50, 60]) { ctx.beginPath(); ctx.moveTo(tx - 5, ty(v)); ctx.lineTo(tx + 5, ty(v)); ctx.stroke(); ctx.fillText(String(v), tx + 9, ty(v)); }
    if (s.waterTarget != null) { ctx.fillStyle = '#2b3542'; ctx.beginPath(); ctx.moveTo(tx - 8, ty(s.waterTarget) - 6); ctx.lineTo(tx - 1, ty(s.waterTarget)); ctx.lineTo(tx - 8, ty(s.waterTarget) + 6); ctx.closePath(); ctx.fill(); }
    ctx.fillStyle = heatHex(t); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(tx, ty(t), 6, 0, TAU); ctx.fill(); ctx.stroke();
    // dušš
    ctx.fillStyle = mix('#c9d3de', '#3a4454', dark * 0.6); ctx.beginPath(); ctx.moveTo(1074, 520); ctx.lineTo(1106, 520); ctx.lineTo(1100, 534); ctx.lineTo(1080, 534); ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#2b3542'; ctx.lineWidth = 1.6; ctx.stroke();
    if (a.hw > 0.45) {
      ctx.lineCap = 'round';
      for (const d of this.drops) {
        if (!this.reduced) { d.y += d.v * dt; }
        if (d.y > 696) { d.y = 536; const sp = this.splashes.find(z => z.a <= 0.02); if (sp) { sp.x = 1090 + d.dx * 1.3; sp.r = 1; sp.a = 0.6; } d.dx = (this.rng() - 0.5) * 16; }
        const k = clamp((d.y - 536) / 160); ctx.strokeStyle = `rgba(150,215,255,${0.75 * a.hw})`; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(1090 + d.dx * k, d.y - 9); ctx.lineTo(1090 + d.dx * k, d.y); ctx.stroke();
      }
      for (const sp of this.splashes) { if (sp.a > 0.02) { sp.r += dt * 26; sp.a *= 1 - dt * 3.2; ctx.strokeStyle = `rgba(170,225,255,${sp.a})`; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.ellipse(sp.x, 698, sp.r, sp.r * 0.3, 0, 0, TAU); ctx.stroke(); } }
    }
  }

  // Nalja pärast: kui dušš jookseb, ilmub selle alla irvitav roheline goblin, kes end käsnaga küürib ja vahtu täis saab.
  // Goblin on joonistatud pooleldi 3D-s: keha ja pea pöörlevad (yaw) ümber püstsuunalise telje, iga osa projekteeritakse kehakoordinaatidest (a külg, y kõrgus, b ette) ekraanile.
  // Duši all küürib ta vaheldumisi kõhtu (esivaade), külge (profiil) ja selga (käsn üle õla, teise käega alaselga). Pöörde ajal astub ta jalgadega, pea juhib pööret ja keha jõuab veidi üle.
  drawGoblin(ctx, dark, dt) {
    const home = -Math.PI / 2;
    const g = this.goblin ??= { pos: 0, foam: 0, foamF: 0, foamB: 0, walk: 0, dirn: -1, yaw: home, hyaw: home, from: home, hfrom: home, goal: home, tu: 1, tdur: 1, phase: 'front', phaseT: 0, phaseLen: 3, phaseGoal: 0, was: false };
    const on = this.a.hw > 0.45, target = on ? 1 : 0;
    let moving = false;
    if (this.reduced) { g.pos = target; g.walk = 0; }
    else {
      const d = target - g.pos; moving = Math.abs(d) > 1e-4;
      if (moving) { g.dirn = d > 0 ? -1 : 1; g.pos = clamp(g.pos + Math.sign(d) * Math.min(Math.abs(d), dt * 0.7)); }
      g.walk += ((moving ? 1 : 0) - g.walk) * Math.min(1, dt * 8);
    }
    if (g.pos <= 0.001) { Object.assign(g, { foam: 0, foamF: 0, foamB: 0, yaw: home, hyaw: home, from: home, hfrom: home, goal: home, tu: 1, phase: 'front', phaseT: 0, was: false }); return; }
    const arr = smooth(clamp((g.pos - 0.88) / 0.12)), e = arr, t = this.reduced ? 0 : this.t, k = dark * 0.45;
    // --- pöördekäitumine: esi → külg → selg juhuslikus järjekorras; kõndides vaatab ta liikumissuunas (profiil)
    const near = (goal, ref) => goal + TAU * Math.round((ref - goal) / TAU);
    const pick = base => { let c = near(base, g.yaw); if (Math.abs(Math.abs(c - g.yaw) - Math.PI) < 0.05 && Math.random() < 0.5) c += c > g.yaw ? -TAU : TAU; return c; };
    if (this.reduced) { g.yaw = g.hyaw = g.goal = g.from = g.hfrom = 0; g.tu = 1; g.foamF = 0.4; g.foamB = 0; g.foam = 0.4; }
    else {
      let want;
      if (moving || g.walk > 0.3) { want = near(g.dirn < 0 ? -Math.PI / 2 : Math.PI / 2, g.yaw); g.was = true; }
      else {
        if (g.was) { g.was = false; g.phase = 'front'; g.phaseT = 0; g.phaseLen = 3 + Math.random() * 1.6; g.phaseGoal = pick(0); }
        g.phaseT += dt;
        if (g.phaseT > g.phaseLen) {
          const r = Math.random(), p = g.phase;
          g.phase = p === 'front' ? (r < 0.55 ? 'side' : 'back') : p === 'side' ? (r < 0.5 ? 'front' : 'back') : (r < 0.6 ? 'front' : 'side');
          g.phaseT = 0; g.phaseLen = g.phase === 'side' ? 2.3 + Math.random() * 1.4 : 3 + Math.random() * 1.9;
          g.phaseGoal = pick(g.phase === 'front' ? 0 : g.phase === 'side' ? -Math.PI / 2 : -Math.PI);
        }
        want = g.phaseGoal;
      }
      if (Math.abs(want - g.goal) > 1e-6) { g.goal = want; g.from = g.yaw; g.hfrom = g.hyaw; g.tu = 0; g.tdur = Math.abs(want - g.yaw) > 2.4 ? 2 : 1.3; }
      g.tu = Math.min(1, g.tu + dt / g.tdur);
      const over = u => { const sm = u * u * (3 - 2 * u), w = clamp((u - 0.7) / 0.3); return sm + 0.14 * Math.sin(Math.PI * w) ** 2; };
      g.yaw = g.from + (g.goal - g.from) * over(g.tu); g.hyaw = g.hfrom + (g.goal - g.hfrom) * over(Math.min(1, g.tu * 1.3));
      g.foam = Math.min(1, g.foam + dt * 0.045 * arr);
      if (arr > 0.6 && !moving) { const bk = g.phase === 'back'; g.foamB = clamp(g.foamB + dt * (bk ? 0.17 : -0.02)); g.foamF = clamp(g.foamF + dt * (bk ? -0.02 : 0.13)); }
    }
    const skin = mix('#86c552', '#33521f', k), skinD = mix('#5e9a34', '#243a15', k), belly = mix('#a8da72', '#45662b', k), pink = mix('#e8a095', '#6a4a44', k), foam = mix('#ffffff', '#b8c4d6', dark * 0.5);
    const sway = Math.sin(t * 3.1) * 1.3 * (1 - g.walk), scrub = Math.sin(t * 9) * arr, jig = Math.sin(t * 18) * 1.4 * arr, bob = Math.sin(t * 14) * 0.5, chuckle = 0.5 + 0.5 * Math.sin(t * 14 + 1);
    const turnAmt = g.tu < 1 ? Math.sin(Math.PI * g.tu) * clamp(Math.abs(g.goal - g.from)) : 0, step = Math.max(g.walk, turnAmt);
    const wph = t * 11, liftL = Math.max(0, Math.sin(wph)) * 2.6 * step, liftR = Math.max(0, -Math.sin(wph)) * 2.6 * step;
    const bobW = -Math.abs(Math.sin(wph)) * 1.3 * step + (g.tu < 0.16 && g.walk < 0.3 && !this.reduced ? Math.sin(Math.PI * g.tu / 0.16) * 1.1 : 0);
    // projektsioon: keha (C, S) ja pea (hC, hS) pöörde järgi; a = külg, b = ette, tagastab ekraani x ja sügavuse z (z > 0 on vaatajale lähemal)
    const C = Math.cos(g.yaw), S = Math.sin(g.yaw), hC = Math.cos(g.hyaw), hS = Math.sin(g.hyaw);
    const bx = (a, b) => a * C + b * S, bz = (a, b) => -a * S + b * C, hx = (a, b) => a * hC + b * hS, hz = (a, b) => -a * hS + b * hC;
    const tx = sway * 0.35, wig = Math.max(0, -C) * Math.sin(t * 8.5) * 2.2 * e;
    // asukoht: boileri taga (x≈1162) → duši all (x=1090)
    ctx.save(); ctx.translate(1162 - 72 * smooth(g.pos), 697); ctx.rotate(g.dirn * 0.07 * g.walk); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // jalad ja suured lamedad jalalabad: kaugem jalg enne, kõndides ja pöörates tõstavad jalgu vaheldumisi
    for (const L of [-1, 1].map(sg => ({ sg, z: bz(sg * 7, 0), lift: sg < 0 ? liftL : liftR })).sort((p, q) => p.z - q.z)) {
      const sg = L.sg, hipX = tx * 0.9 + bx(sg * 6, 0), ankX = bx(sg * 7.5, 1.2), fx = bx(sg * 8.5, 2.6), fw = Math.max(3.2, Math.hypot(6.4 * C, 5.6 * S));
      ctx.strokeStyle = skinD; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(hipX, -14); ctx.lineTo(ankX, -3 - L.lift); ctx.stroke();
      ctx.fillStyle = skinD; ctx.beginPath(); ctx.ellipse(fx, -1.6 - L.lift, fw, 2.7, sg * 0.08 * C, 0, TAU); ctx.fill();
      for (const tt of [-3.5, 0, 3.5]) { const a = sg * 8.5 + tt * 1.1; if (bz(a, 6) > -1) { ctx.beginPath(); ctx.arc(bx(a, 6), -1.4 - L.lift + Math.abs(tt) * 0.15, 1.5, 0, TAU); ctx.fill(); } }
    }
    ctx.translate(0, bobW);
    // käed: kahe lülilise käe lähend (IK); käsn läheb kõhult üle õla selja peale, teine käsi kratsib kaenlat või alaselga
    const wB = smooth(clamp((-C - 0.05) / 0.9)), prof = S * S;
    const mix3 = (p, q, w) => [p[0] + (q[0] - p[0]) * w, p[1] + (q[1] - p[1]) * w, p[2] + (q[2] - p[2]) * w];
    let spT = mix3([3 + scrub * 6.5 * (1 - prof), -25 + jig + scrub * 5 * prof, 13.5], [4 + scrub * 5.5, -32 + jig * 0.6, -11.8], wB); spT[1] -= 7 * Math.sin(Math.PI * wB);
    spT = mix3(spT, [12.5, -22, 4 * Math.sin(wph + Math.PI)], g.walk);
    let rtT = mix3([-9.5 + Math.sin(t * 6) * 2, -29 + Math.sin(t * 6) * 1.5, 3], [-3 - scrub * 4, -21 + jig, -11.5], wB); rtT[1] -= 3 * Math.sin(Math.PI * wB);
    rtT = mix3(rtT, [-12.5, -22, 4 * Math.sin(wph)], g.walk);
    const ik = (sh, hd, pref) => {
      const L1 = 9.4, L2 = 9.8; let dx = hd[0] - sh[0], dy = hd[1] - sh[1]; const d = Math.hypot(dx, dy) || 1, reach = Math.min(d, L1 + L2 - 0.3), ux = dx / d, uy = dy / d;
      const aa = (L1 * L1 - L2 * L2 + reach * reach) / (2 * reach), hh = Math.sqrt(Math.max(0, L1 * L1 - aa * aa)), px = -uy, py = ux, sgn = px * pref[0] + py * pref[1] >= 0 ? 1 : -1;
      return { elbow: [sh[0] + ux * aa + px * hh * sgn, sh[1] + uy * aa + py * hh * sgn], hand: [sh[0] + ux * reach, sh[1] + uy * reach] };
    };
    const sponge = (x, y) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(scrub * 0.25 + 0.5 * wB);
      ctx.fillStyle = mix('#f2d44a', '#7a6a28', k); rr(ctx, -5.2, -3.6, 10.4, 7.2, 3); ctx.fill();
      ctx.fillStyle = mix('#c9a626', '#5a4b1a', k); for (const [px, py] of [[-2.4, -1], [1.8, 1.2], [2.6, -1.6], [-1, 1.6]]) { ctx.beginPath(); ctx.arc(px, py, 0.9, 0, TAU); ctx.fill(); }
      ctx.fillStyle = foam; ctx.beginPath(); ctx.arc(-4.5, -3, 2.2, 0, TAU); ctx.arc(4.8, 3.2, 2, 0, TAU); ctx.arc(0.5, 4, 1.8, 0, TAU); ctx.fill();
      ctx.restore();
    };
    const arms = [{ sg: 1, T: spT, pref: [C - 0.8 * S, 0.9 - 1.7 * wB], sp: true }, { sg: -1, T: rtT, pref: [-C - 0.8 * S, 0.5 + 0.2 * wB], sp: false }].map(A => ({ ...A, z: bz(A.T[0], A.T[2]) }));
    const drawArm = A => {
      const sh = [tx + bx(A.sg * 10.5, 0), -36], { elbow, hand } = ik(sh, [tx + bx(A.T[0], A.T[2]), A.T[1]], A.pref);
      ctx.strokeStyle = skin; ctx.lineWidth = 4.2; ctx.beginPath(); ctx.moveTo(sh[0], sh[1]); ctx.lineTo(elbow[0], elbow[1]); ctx.lineTo(hand[0], hand[1]); ctx.stroke();
      ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(hand[0], hand[1], 2.7, 0, TAU); ctx.fill();
      if (A.sp) sponge(hand[0], hand[1]);
    };
    arms.filter(A => A.z < -1.5).forEach(drawArm);
    // keha: ümar kõht ees, tagumik taga; seljavaates seljaroog ja abaluud
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(tx + bx(0, -5) + wig, -18, 7.6, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(tx + wig * 0.3, -27, Math.hypot(12.5 * C, 10.5 * S), 14, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(tx + bx(0, 6), -24, 8, 0, TAU); ctx.fill();
    const fa = clamp(C * 2.4), ab = clamp(-C * 2.2);
    if (fa > 0.01) { ctx.save(); ctx.globalAlpha = fa; ctx.fillStyle = belly; ctx.beginPath(); ctx.ellipse(tx + bx(0, 8), -24, Math.max(0.1, 8 * Math.abs(C)), 9.5, 0, 0, TAU); ctx.fill(); ctx.restore(); }
    if (ab > 0.01) {
      ctx.save(); ctx.globalAlpha = ab; ctx.strokeStyle = skinD; ctx.lineWidth = 1.6;
      const spx = tx + bx(0, -10.4) + wig * 0.2;
      ctx.beginPath(); ctx.moveTo(spx, -38); ctx.lineTo(spx, -17); ctx.stroke();
      ctx.fillStyle = skinD; for (const yy of [-34, -28, -22]) { ctx.beginPath(); ctx.moveTo(spx - 1.7, yy + 2.2); ctx.lineTo(spx, yy - 1.8); ctx.lineTo(spx + 1.7, yy + 2.2); ctx.closePath(); ctx.fill(); }
      for (const sg of [-1, 1]) { ctx.beginPath(); ctx.moveTo(tx + bx(sg * 3, -10.3), -33); ctx.quadraticCurveTo(tx + bx(sg * 10, -10.3), -31, tx + bx(sg * 8, -10.8), -24); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(tx + bx(0, -8) + wig * 0.4, -17); ctx.quadraticCurveTo(tx + bx(0, -8) + wig * 0.4 + 1.5, -14, tx + bx(0, -8) + wig * 0.4, -11.5); ctx.stroke();
      ctx.restore();
    }
    // vaht: kõhul ja seljal kasvab seal, kus ta parajasti küürib
    ctx.fillStyle = foam;
    const blob = ([a, y, b, fr], amt) => { if (amt < 0.02 || bz(a, b) < -2.5) return; ctx.beginPath(); ctx.arc(tx + bx(a, b) + Math.sin(t * 2 + a) * 0.4, y, fr * (0.15 + 0.85 * amt), 0, TAU); ctx.fill(); };
    for (const p of [[-8, -18, 10, 4.6], [-3, -14, 12, 4], [5, -16, 11, 4.8], [10, -22, 6, 3.6], [-11, -26, 5, 3.4], [0, -20, 13, 3.8], [8, -30, 8, 3], [-6, -32, 8, 3.2]]) blob(p, g.foamF);
    for (const p of [[-8, -18, -9, 4.6], [-3, -14, -10, 4], [5, -16, -9, 4.8], [10, -26, -6, 3.6], [-10, -28, -6, 3.4], [0, -23, -11, 4.2], [6, -31, -9, 3.6], [-5, -34, -8, 3.2]]) blob(p, g.foamB);
    arms.filter(A => A.z >= -1.5).forEach(drawArm);
    // pea: suured kõrvad (profiilis tagasi pühitud), kaldus kulmud, konksus nina, irve hammastega
    ctx.save(); ctx.translate(sway * 0.6, -47 + bob);
    const RX = 13, RZ = 11, RY = 10.5, sweep = a => -1.1 * Math.max(0, Math.abs(a) - 10.5), EP = (a, y) => [hx(a, sweep(a)), y];
    const ears = [-1, 1].map(sg => { const f = Math.sin(t * 8 + sg) * 1.2; return { z: hz(sg * 20, sweep(20)), o: [EP(sg * 10.5, -4), EP(sg * 20, -9 + f), EP(sg * 28, -10 + f * 1.3), EP(sg * 20, 0), EP(sg * 11, 4)], i: [EP(sg * 12.5, -2), EP(sg * 20, -6 + f), EP(sg * 24.5, -8 + f * 1.2), EP(sg * 19, -1), EP(sg * 12.5, 2)] }; });
    const earPath = p => { ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]); ctx.quadraticCurveTo(p[1][0], p[1][1], p[2][0], p[2][1]); ctx.quadraticCurveTo(p[3][0], p[3][1], p[4][0], p[4][1]); ctx.closePath(); };
    const drawEar = en => {
      ctx.fillStyle = skin; earPath(en.o); ctx.fill();
      if (hS * hS > 0.05) { ctx.save(); ctx.globalAlpha = hS * hS * 0.85; ctx.strokeStyle = skinD; ctx.lineWidth = 1.1; earPath(en.o); ctx.stroke(); ctx.restore(); }
      const pa = clamp(hC * 2.2); if (pa > 0.02) { ctx.save(); ctx.globalAlpha = pa; ctx.fillStyle = pink; earPath(en.i); ctx.fill(); ctx.restore(); }
    };
    const facePt = (a, y) => { const b = RZ * Math.sqrt(Math.max(0.04, 1 - (a / RX) ** 2 - (y / RY) ** 2)); return { x: hx(a, b), z: hz(a, b) }; };
    const noseAfter = hC > -0.2, nose = () => {
      const N = (a, y, b) => [hx(a, b), y], p0 = N(-2, -3.2, 9.8), c1 = N(0.5, 0.2, 19.5), p1 = N(1.6, 4, 17), c2 = N(1.9, 4.6, 12.5), p2 = N(3.2, 2.2, 10.2);
      ctx.fillStyle = skinD; ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.quadraticCurveTo(c1[0], c1[1], p1[0], p1[1]); ctx.quadraticCurveTo(c2[0], c2[1], p2[0], p2[1]); ctx.closePath(); ctx.fill();
    };
    ears.filter(en => en.z < 0).forEach(drawEar);
    if (!noseAfter) nose();
    ctx.fillStyle = skin; ctx.beginPath(); ctx.ellipse(0, 0, Math.hypot(RX * hC, RZ * hS), RY, 0, 0, TAU); ctx.fill();
    const bsA = clamp(-hC * 2); if (bsA > 0.02) { ctx.save(); ctx.globalAlpha = 0.3 * bsA; ctx.fillStyle = skinD; ctx.beginPath(); ctx.ellipse(0, -1, 8.5, 7.2, 0, 0, TAU); ctx.fill(); ctx.restore(); }
    ctx.fillStyle = skinD; for (const a of [-3.5, 0, 3.5]) { const b = -a * 0.9; ctx.beginPath(); ctx.moveTo(hx(a - 1.6, b), -9.5); ctx.lineTo(hx(a + a * 0.3, b), -15.5 + Math.abs(a) * 0.3); ctx.lineTo(hx(a + 1.6, b), -9.5); ctx.closePath(); ctx.fill(); }
    ears.filter(en => en.z >= 0).forEach(drawEar);
    // silmad: kollased, püstise pupilliga, pooleldi pilukil (kaval); nähtavad ainult vaatajapoolsel küljel, profiilis üks silm
    for (const sg of [-1, 1]) {
      const a = sg * 5.2, b = 9.8, nA = a / (RX * RX), nB = b / (RZ * RZ), nz = (-nA * hS + nB * hC) / Math.hypot(nA, nB), v = clamp((nz - 0.08) / 0.4);
      if (v < 0.02) continue;
      const ex = hx(a, b), w = Math.max(0.3, nz);
      ctx.save(); ctx.globalAlpha = v;
      ctx.fillStyle = mix('#ffe34d', '#8a7a2a', k); ctx.beginPath(); ctx.ellipse(ex, -1.2, 3.5 * w, 2.8, sg * -0.15 * w, 0, TAU); ctx.fill();
      ctx.fillStyle = '#1a2a10'; ctx.beginPath(); ctx.ellipse(ex + (-sg * 0.4 + g.dirn * 0.9 * g.walk) * w + hS * 1.1, -1, 0.85 * Math.max(0.55, w), 2.3, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = skinD; ctx.beginPath(); ctx.ellipse(ex, -3.1, 3.9 * w, 1.7, sg * -0.15 * w, Math.PI, TAU); ctx.fill();
      ctx.strokeStyle = skinD; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(hx(sg * 9.6, 3.4), -6.4); ctx.lineTo(hx(sg * 1.6, 10.4), -3.4); ctx.stroke();
      ctx.restore();
    }
    if (noseAfter) nose();
    // irve: lai suu, ülemised hambad ja kaks alumist kihvakat (iga punkt ainult siis, kui see on vaatajapoolsel küljel)
    const open = 2.2 + chuckle * 2.4, low = [], up = [];
    for (let i = 0; i <= 10; i++) { const s = i / 10, a = -9 + 18 * s, q = 4 * s * (1 - s); const lo = facePt(a, 3.4 + open * 1.1 * q), hi = facePt(a, 3.4 - 0.5 * q); if (lo.z > 0.15) { low.push([lo.x, 3.4 + open * 1.1 * q]); up.push([hi.x, 3.4 - 0.5 * q]); } }
    if (low.length > 2) { ctx.fillStyle = '#3a1020'; ctx.beginPath(); low.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); for (let i = up.length - 1; i >= 0; i--) ctx.lineTo(up[i][0], up[i][1]); ctx.closePath(); ctx.fill(); }
    const tw = clamp(Math.abs(hC) * 0.8 + 0.35, 0.35, 1);
    if (hC > 0.25) { ctx.fillStyle = '#e0707f'; ctx.beginPath(); ctx.ellipse(hx(0, 9.2), 3.4 + open * 1.5, 3.6 * hC, 1.2 + open * 0.3, 0, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#fff8e6';
    for (let i = 0; i < 6; i++) { const a = -7 + i * 2.8, yb = 3.5 - 0.5 * Math.abs(a) / 8, p = facePt(a, yb); if (p.z > 0.3) { ctx.beginPath(); ctx.moveTo(p.x - 1.1 * tw, yb); ctx.lineTo(p.x, 5.6 + (i === 1 || i === 4 ? 1.1 : 0)); ctx.lineTo(p.x + 1.1 * tw, yb); ctx.closePath(); ctx.fill(); } }
    for (const a of [-4.2, 4.2]) { const yb = 3 + open * 1.9, p = facePt(a, yb); if (p.z > 0.3) { ctx.beginPath(); ctx.moveTo(p.x - 1 * tw, yb); ctx.lineTo(p.x, yb - 3); ctx.lineTo(p.x + 1 * tw, yb); ctx.closePath(); ctx.fill(); } }
    // vahumüts peas
    ctx.fillStyle = foam; for (const [fa2, fy, fb, fr] of [[-5, -10, -2.5, 4.4], [1, -12.5, 1.5, 5], [6.5, -9.6, -1, 3.8], [-1, -8.6, 3, 3.4]]) { const r = fr * (0.2 + 0.8 * g.foam); ctx.beginPath(); ctx.arc(hx(fa2, fb), fy - r * 0.35, r, 0, TAU); ctx.fill(); }
    ctx.restore();
    // vahumullid tõusevad ülespoole
    if (!this.reduced) {
      ctx.strokeStyle = rgba(foam, 0.8); ctx.lineWidth = 1;
      for (let i = 0; i < 7; i++) { const u = (t * 0.28 + i / 7) % 1; ctx.globalAlpha = e * Math.sin(Math.PI * u) * 0.8; ctx.beginPath(); ctx.arc(Math.sin(i * 2.1 + t) * 16 + (i - 3) * 2.6, -30 - u * 46, 1.6 + (i % 3) * 0.9, 0, TAU); ctx.stroke(); }
      // vahel itsitab
      const lk = (t % 7) / 7;
      if (lk < 0.24) {
        ctx.globalAlpha = e * Math.sin(lk / 0.24 * Math.PI); ctx.fillStyle = mix('#2f7a2a', '#a8e08a', dark); ctx.font = "italic 800 10px 'Plus Jakarta Sans', sans-serif"; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillText('hihii!', 16, -62 - lk * 30);
      }
    }
    ctx.restore();
  }

  // ---- toaõhk: tolmukesed ja CO₂ udu
  drawRoomAir(ctx, { dark }, dt) {
    const a = this.a, n = Math.round(24 + a.co2 * 86), p = this.motes;
    if (a.co2 > 0.05) { ctx.fillStyle = `rgba(150,170,90,${0.22 * a.co2})`; ctx.fillRect(LIVING_X + 2, 444, 1038 - LIVING_X, 254); }
    // Tolmukesed kogume värvi ja läbipaistvuse astme järgi – 110 üksiktäitmise asemel paar joonistust.
    const groups = new Map();
    for (let i = 0; i < n; i++) {
      const m = p[i];
      if (!this.reduced) { m.x += (m.vx + Math.sin(this.t * 0.7 + m.p) * 4) * dt * (0.4 + a.air); m.y += (m.vy + Math.cos(this.t * 0.6 + m.p) * 4) * dt * (0.4 + a.air); m.on += dt * 0.25; }
      if (m.x < LIVING_X + 6 || m.x > 1034 || m.y < 448 || m.y > 696 || m.on > 1) { m.x = LIVING_X + 14 + this.rng() * (1034 - LIVING_X - 14); m.y = 456 + this.rng() * 232; m.on = 0; }
      const co2 = a.co2 > 0.35, al = Math.sin(clamp(m.on) * Math.PI) * (0.25 + a.co2 * 0.55) * (co2 ? 1 : 0.8);
      const key = `${co2 ? '196,210,120' : '255,248,230'}|${Math.round(al * 10)}`;
      let list = groups.get(key); if (!list) groups.set(key, list = []);
      list.push(m);
    }
    for (const [key, list] of groups) {
      const [col, q] = key.split('|');
      ctx.fillStyle = `rgba(${col},${(q / 10).toFixed(1)})`; ctx.beginPath();
      for (const m of list) { const r = m.r * (0.8 + a.co2 * 0.6); ctx.moveTo(m.x + r, m.y); ctx.arc(m.x, m.y, r, 0, TAU); }
      ctx.fill();
    }
  }

  // ---- esiplaan: rohi, jäätunud sädelus, jaanimardikad
  drawForeground(ctx, { dark, ground, season }, dt) {
    const wind = Math.min(2.2, Math.sin(this.t * 0.6) * 0.5 + 0.5 + this.a.wind * 2);
    const cover = clamp(Math.max(this.a.snowCover, this.a.drift * 0.9)), blade = 1 - cover * 0.88;
    // Rohulibled kogume värvi järgi: ühe joonega saab korraga tõmmata kümneid libedaid.
    const tufts = new Map();
    for (const g of this.grass) {
      const inHouse = g.x > HOUSE_X0 && g.x < HOUSE_X1;
      // maja ees (vundamendi all) on muru madalam ja algab vundamendist allpool; majasse ega vundamendile muru ei kasva
      const y0 = inHouse ? FOUNDATION_BOTTOM + 8 + g.l * 14 : GROUND + 6 + g.l * 34, hh = g.h * (inHouse ? 0.6 : 1) * blade;
      if (hh < 2.5) continue;
      const sw = Math.sin(this.t * 1.6 + g.p + g.x * 0.01) * (3 + wind * 5) * blade;
      const col = qHex(mix(mix(mix(ground.top, '#9cc26a', 0.35), '#08101a', dark * 0.65 + g.l * 0.1), '#e6eef6', cover * 0.4), 8);
      let list = tufts.get(col); if (!list) tufts.set(col, list = []);
      list.push([g.x, y0, hh, sw]);
    }
    ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (const [col, list] of tufts) {
      ctx.strokeStyle = col; ctx.beginPath();
      for (const [x, y0, hh, sw] of list) { ctx.moveTo(x, y0); ctx.quadraticCurveTo(x + sw * 0.4, y0 - hh * 0.6, x + sw, y0 - hh); }
      ctx.stroke();
    }
    // Hanged kasvavad eraldi, aeglase akumulatsiooni (drift) järgi; lumikate annab vaid madala algpiiri.
    const dl = Math.max(this.a.drift, this.a.snowCover * 0.3);
    if (dl > 0.03) this.drawDrifts(ctx, dark, dl);
    if (ground.frost > 0.15) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 60; i++) { const r = mulberry32(i * 31 + 7), x = -100 + r() * (W + 200), y = GROUND + 6 + r() * 70, tw = Math.max(0, Math.sin(this.t * (1 + r() * 2) + r() * 9)); if (tw > 0.6 && !(x > HOUSE_X0 && x < HOUSE_X1 && y < FOUNDATION_BOTTOM)) { ctx.fillStyle = `rgba(230,245,255,${(tw - 0.6) * 2.2 * ground.frost})`; ctx.fillRect(x - 1.5, y - 1.5, 3, 3); ctx.fillRect(x - 0.6, y - 4, 1.2, 8); } }
      ctx.restore();
    }
    if (dark > 0.45 && (this.a.outdoor ?? 10) > 8) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (const f of this.fireflies) {
        if (!this.reduced) { f.vx += (Math.sin(this.t * 0.8 + f.p) * 20 - f.vx) * dt; f.vy += (Math.cos(this.t * 0.9 + f.p * 2) * 14 - f.vy) * dt; f.x += f.vx * dt * f.s; f.y += f.vy * dt * f.s; }
        if (f.x < 40 || f.x > 470) f.vx *= -1; if (f.y < 540 || f.y > 700) f.vy *= -1;
        const pu = Math.pow(Math.max(0, Math.sin(this.t * 1.7 * f.s + f.p)), 3) * dark;
        this.glow(ctx, '#d7ff78', f.x, f.y, 16, 0.9 * pu);
      }
      ctx.restore();
    }
  }

  // Hanged: pehmed künkad maa peal, maja ees madalamad (vundament jääb nähtavaks); kõrgus kasvab sajuga.
  drawDrifts(ctx, dark, lvl) {
    const base = GROUND + 78, snow = mix('#f6fafe', '#4d5a78', dark * 0.72), deep = mix('#c4d3e4', '#2c3654', dark * 0.72);
    const profile = x => {
      let h = 0; for (const m of this.mounds) { const d = (x - m.c) / m.w; if (d > -3 && d < 3) h += m.a * Math.exp(-d * d); }
      const inside = smooth(clamp((x - (HOUSE_X0 - 30)) / 50)) * smooth(clamp((HOUSE_X1 + 30 - x) / 50));
      return lvl * (16 + 58 * Math.min(1.5, h)) * (1 - inside * 0.68) + (x < 320 || x > 1300 ? lvl * 12 : 0);
    };
    const g = ctx.createLinearGradient(0, base - 100, 0, base); g.addColorStop(0, snow); g.addColorStop(1, deep);
    ctx.save();
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-320, base);
    for (let x = -320; x <= W + 320; x += 8) ctx.lineTo(x, base - profile(x));
    ctx.lineTo(W + 320, base); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = rgba(mix('#ffffff', '#6f82a8', dark * 0.7), 0.9); ctx.lineWidth = 2; ctx.beginPath();
    for (let x = -320; x <= W + 320; x += 8) { const y = base - profile(x) - 1; x === -320 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.stroke();
    ctx.restore();
  }

  // Hiirega seadme kohal: heleneb, ümber tekib pulseeriv kontuur ja sissepoole hõõgub pehme valgus.
  drawHover(ctx, { dark }) {
    for (const [id, h] of Object.entries(HOTSPOTS)) {
      const v = this.hv[id]; if (v < 0.01) continue;
      const pulse = this.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(this.t * 4), grow = 3 + 4 * v + 2 * pulse * v;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = rgba(h.color, 0.16 * v); rr(ctx, h.x, h.y, h.w, h.h, h.r); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.shadowColor = rgba(h.color, 0.85 * v); ctx.shadowBlur = 26 * v + 8 * pulse * v;
      ctx.strokeStyle = rgba(mix(h.color, '#ffffff', 0.35), 0.95 * v); ctx.lineWidth = 3;
      rr(ctx, h.x - grow, h.y - grow, h.w + grow * 2, h.h + grow * 2, h.r + grow); ctx.stroke();
      ctx.restore();
    }
  }

  // vihm ja lumi langevad ainult maja katuse ja seinte ümber (lõige on avatud, sees ei sadu)
  clipOutsideHouse(ctx) {
    ctx.beginPath(); ctx.rect(-500, -300, W + 1000, GROUND + 700);
    ctx.moveTo(ROOF.x0 - 6, roofTop(ROOF.x0) + 6); ctx.lineTo(ROOF.apexX, ROOF.apexY - 8); ctx.lineTo(ROOF.x1 + 6, roofTop(ROOF.x1) + 6); ctx.lineTo(ROOF.x1 + 6, GROUND + 52); ctx.lineTo(ROOF.x0 - 6, GROUND + 52); ctx.closePath();
    ctx.clip('evenodd');
  }

  drawPrecip(ctx, { dark }, dt) {
    const a = this.a; if (a.rain < 0.02 && a.snow < 0.02) return;
    ctx.save(); this.clipOutsideHouse(ctx);
    if (a.rain > 0.02) {
      const n = Math.round(340 * a.rain), slant = 0.1 + a.wind * 0.55, tone = dark > 0.4 ? '185,205,235' : '170,195,230';
      ctx.lineCap = 'round'; ctx.lineWidth = 1.3 + a.rain * 0.7; ctx.strokeStyle = `rgba(${tone},${(0.34 + 0.3 * a.rain).toFixed(3)})`; ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const d = this.drops2[i];
        if (!this.reduced) { d.y += d.v * dt; d.x += d.v * slant * dt; }
        if (d.y > d.gy) { const sp = this.rainSplash.find(z => z.a <= 0.03); if (sp && d.gy > GROUND + 6) Object.assign(sp, { x: d.x, y: d.gy, r: 1, a: 0.5 }); d.y = -30 - this.rng() * 120; d.x = -300 + this.rng() * (W + 600) - slant * 300; d.gy = GROUND + 8 + this.rng() * 96; }
        ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - slant * d.l, d.y - d.l);
      }
      ctx.stroke();
      ctx.lineWidth = 1.2;
      for (const sp of this.rainSplash) { if (sp.a > 0.03) { sp.r += dt * 38; sp.a *= 1 - dt * 3.6; ctx.strokeStyle = `rgba(200,220,245,${sp.a.toFixed(3)})`; ctx.beginPath(); ctx.ellipse(sp.x, sp.y, sp.r, sp.r * 0.3, 0, 0, TAU); ctx.stroke(); } }
    }
    if (a.snow > 0.02) {
      const n = Math.round(240 * Math.min(1, a.snow * 1.5)), tone = dark > 0.4 ? '225,235,250' : '255,255,255';
      ctx.fillStyle = `rgba(${tone},${(0.72 + 0.2 * a.snow).toFixed(3)})`; ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const f = this.flakes[i];
        if (!this.reduced) { f.y += f.v * dt * (0.7 + a.snow * 0.6); f.x += (Math.sin(this.t * 0.9 + f.p) * 14 + a.wind * 160) * dt; f.p += dt * 0.8; }
        if (f.y > f.gy) { f.y = -20 - this.rng() * 80; f.x = -300 + this.rng() * (W + 600) - a.wind * 200; f.gy = GROUND + 6 + this.rng() * 90; }
        ctx.moveTo(f.x + f.r, f.y); ctx.arc(f.x, f.y, f.r, 0, TAU);
      }
      ctx.fill();
    }
    ctx.restore();
  }

  drawFog(ctx, { dark, sky }, dt) {
    const a = this.a; if (a.fog < 0.02) return;
    const tone = mix('#dfe6ee', '#3a4458', dark * 0.85);
    ctx.save();
    // udu ainult maja väljas: kärbi välja pööning ja tubade ristlõige
    const { L, R, TOP, FLOOR } = HOUSE_SHELL;
    ctx.beginPath(); ctx.rect(-400, -400, W + 800, GROUND + 404);
    ctx.moveTo(L - 10, FLOOR); ctx.lineTo(L - 10, roofTop(L - 10) + ROOF.thick - 4); ctx.lineTo(ROOF.apexX, ROOF.apexY + ROOF.thick - 4); ctx.lineTo(R + 10, roofTop(R + 10) + ROOF.thick - 4); ctx.lineTo(R + 10, FLOOR); ctx.closePath();
    ctx.clip('evenodd');
    for (const b of this.fogBlobs) {
      if (!this.reduced) { b.x += b.v * dt; if (b.x > W + 400) b.x = -400; }
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r); g.addColorStop(0, rgba(tone, 0.34 * a.fog)); g.addColorStop(1, rgba(tone, 0));
      ctx.save(); ctx.translate(b.x, b.y); ctx.scale(1, 0.42); ctx.translate(-b.x, -b.y); ctx.fillStyle = g; ctx.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2); ctx.restore();
    }
    const h = ctx.createLinearGradient(0, 120, 0, GROUND); h.addColorStop(0, rgba(tone, 0.12 * a.fog)); h.addColorStop(1, rgba(tone, 0.42 * a.fog));
    ctx.fillStyle = h; ctx.fillRect(-400, -200, W + 800, GROUND + 204);
    ctx.restore();
  }

  // äikesevälgatus: sähvatus kogu pildil ja sakiline välk taevas
  drawFlash(ctx, { scale, ox, oy }, dt = 1 / 60) {
    const a = this.a, b = this.bolt;
    if (!this.reduced && a.storm > 0.5) {
      b.cooldown -= dt;
      if (b.t < 0 && b.cooldown < 0) {
        b.t = 0; b.cooldown = 4 + this.rng() * 9; a.flash = 1;
        const pts = []; let x = 300 + this.rng() * 1000, y = -10;
        while (y < GROUND - 70) { pts.push([x, y]); x += (this.rng() - 0.5) * 90; y += 30 + this.rng() * 40; }
        b.pts = pts; b.branch = pts.filter(() => this.rng() < 0.25).map(([px, py]) => [[px, py], [px + (this.rng() - 0.5) * 160, py + 60 + this.rng() * 70]]);
        // Välk lööb: anna kutsujale märku, et saaks mängida äikesehelinat (ainult kui muusika parasjagu mängib).
        if (this.onLightning) this.onLightning();
      }
    }
    if (b.t >= 0) {
      b.t += dt; const k = b.t / 0.35;
      if (k >= 1) b.t = -1;
      else {
        ctx.save(); ctx.translate(ox, oy); ctx.scale(scale, scale); ctx.globalCompositeOperation = 'lighter';
        const al = (k < 0.25 ? 1 : 0.5 + 0.5 * Math.sin(k * 40)) * (1 - k);
        for (const [w, c] of [[9, `rgba(160,190,255,${0.25 * al})`], [3, `rgba(255,255,255,${0.95 * al})`]]) { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineJoin = 'round'; ctx.beginPath(); b.pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); for (const [p, q] of b.branch || []) { ctx.lineWidth = w * 0.5; ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); } }
        ctx.restore();
      }
    }
    if (a.flash > 0.01) { ctx.fillStyle = `rgba(215,228,255,${(a.flash * 0.45).toFixed(3)})`; ctx.fillRect(0, 0, this.w, this.h); a.flash *= this.reduced ? 0 : 0.86; }
  }

}

// Aastaaeg kuupäeva järgi: puu lehed, langevad lehed ja värvid.
export function season(date) {
  const m = date.getMonth(), d = date.getDate(), md = (m + 1) * 100 + d;
  if (md >= 1201 || md <= 314) return { key: 'winter', leaf: false, fall: false, density: 0 };
  if (md <= 531) return { key: 'spring', leaf: true, fall: false, density: 0.9, a: '#9fd06a', b: '#f4b7c8' };
  if (md <= 831) return { key: 'summer', leaf: true, fall: false, density: 1, a: '#3f8f4d', b: '#6fae4a' };
  if (md <= 1115) return { key: 'autumn', leaf: true, fall: true, density: 0.95, a: '#e0892c', b: '#b8432a' };
  return { key: 'late', leaf: true, fall: true, density: 0.4, a: '#9a6a2c', b: '#7a4a24' };
}
