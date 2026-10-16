// Sisseehitatud lood (scripts/make-music.py). Lisaks leiab rakendus kõik helifailid kataloogist dist/audio (vt /api/audio).
// Nimekiri sisaldab ainult neid sisse ehitatud lugusid, mis on kaasas (public/audio); ülejäänud tulevad /api/audio kaudu.
export const TRACKS = [
  { id: 'hubane-lounge', title: 'Hubane lounge', url: '/audio/hubane-lounge.mp3' }
];
const VOLUME_KEY = 'soojus.sound.volume', TRACK_KEY = 'soojus.sound.track', MODE_KEY = 'soojus.sound.mode', ON_KEY = 'soojus.sound.on', PAUSED_KEY = 'soojus.sound.paused', POS_KEY = 'soojus.sound.pos', FADE = 0.45, CROSS = 3, LEAVE_GRACE = 1500;

export const volumeGain = v => Math.max(0, Math.min(1, v)) ** 2;
export function loadVolume(storage = globalThis.localStorage) {
  try { const v = parseFloat(storage?.getItem(VOLUME_KEY)); return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.6; } catch { return 0.6; }
}
export function saveVolume(v, storage = globalThis.localStorage) { try { storage?.setItem(VOLUME_KEY, String(v)); } catch { /* privaatne režiim */ } }
export function loadTrack(storage = globalThis.localStorage) {
  try { const id = storage?.getItem(TRACK_KEY); return TRACKS.some(t => t.id === id) || /^file:./.test(id ?? '') ? id : TRACKS[0].id; } catch { return TRACKS[0].id; }
}
export function saveTrack(id, storage = globalThis.localStorage) { try { storage?.setItem(TRACK_KEY, id); } catch { /* privaatne režiim */ } }

// 'one' = korda ühte lugu, 'all' = kõik lood järjest (viimase järel algab uuesti esimene).
export const MODES = ['one', 'all'];
export function loadMode(storage = globalThis.localStorage) { try { const m = storage?.getItem(MODE_KEY); return MODES.includes(m) ? m : 'one'; } catch { return 'one'; } }
export function saveMode(m, storage = globalThis.localStorage) { try { storage?.setItem(MODE_KEY, m); } catch { /* privaatne režiim */ } }
export function nextTrackId(id, list = TRACKS) { const i = list.findIndex(t => t.id === id); return list[(i + 1) % list.length].id; }
export function prevTrackId(id, list = TRACKS) { const i = list.findIndex(t => t.id === id); return list[(i < 0 ? 0 : i - 1 + list.length) % list.length].id; }

// Failinimest loetav pealkiri: "ohtu_kohvi-2.mp3" -> "Ohtu kohvi 2".
export function titleFromFile(name) {
  const t = name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() || name;
  return t.charAt(0).toLocaleUpperCase('et') + t.slice(1);
}
// Kataloogi failidest lugude nimekiri: sisseehitatud lood oma kaunite pealkirjade ja järjekorraga ees, uued failid tähestikus järel.
// Kui kataloogi pole võimalik lugeda (tühi vastus), jäävad sisseehitatud lood.
export function buildTracks(files) {
  if (!Array.isArray(files) || !files.length) return TRACKS;
  const known = new Map(TRACKS.map(t => [t.url, t]));
  const present = files.map(f => known.get(f.url) ?? { id: `file:${f.name}`, title: titleFromFile(f.name), url: f.url });
  const builtIn = TRACKS.filter(t => present.includes(t)), own = present.filter(t => !known.has(t.url));
  return [...builtIn, ...own];
}

// Mängimise seis jääb brauserisse meelde: kas muusika oli sees, kas oli pausil ja kus kohas lugu oli.
export function loadPlayback(storage = globalThis.localStorage) {
  try {
    const on = storage?.getItem(ON_KEY) === '1', paused = on && storage?.getItem(PAUSED_KEY) === '1';
    let pos = null; try { const p = JSON.parse(storage?.getItem(POS_KEY) ?? 'null'); if (p && typeof p.id === 'string' && Number.isFinite(p.t) && p.t >= 0) pos = { id: p.id, t: p.t }; } catch { /* rikutud väärtus */ }
    return { on, paused, pos };
  } catch { return { on: false, paused: false, pos: null }; }
}
export function savePlayback({ on, paused }, storage = globalThis.localStorage) { try { storage?.setItem(ON_KEY, on ? '1' : '0'); storage?.setItem(PAUSED_KEY, on && paused ? '1' : '0'); } catch { /* privaatne režiim */ } }
export function savePosition(id, t, storage = globalThis.localStorage) { try { storage?.setItem(POS_KEY, JSON.stringify({ id, t: Math.round(t * 10) / 10 })); } catch { /* privaatne režiim */ } }

const buffers = new Map();
const loadBuffer = (ctx, track) => {
  if (!buffers.has(track.id)) buffers.set(track.id, fetch(track.url).then(r => { if (!r.ok) throw new Error(`Heli laadimine ebaõnnestus (${r.status})`); return r.arrayBuffer(); }).then(b => ctx.decodeAudioData(b)).catch(e => { buffers.delete(track.id); throw e; }));
  return buffers.get(track.id);
};
// Välgulöögi heliefekt (public/sfx, ei ole muusikapalade nimekirjas). Laetakse ja dekodeeritakse üks kord.
const THUNDER_URL = '/sfx/lightning.mp3';
const THUNDER_GAIN = 2.7; // kokku ~2,7× salvestatud tasemest; edasine tõstmine hakkab tippe klippima
let thunderBuffer = null, thunderLoading = null;
function loadThunder(ctx) {
  if (thunderBuffer) return Promise.resolve(thunderBuffer);
  if (!thunderLoading) thunderLoading = fetch(THUNDER_URL).then(r => { if (!r.ok) throw new Error(`Välguheli laadimine ebaõnnestus (${r.status})`); return r.arrayBuffer(); }).then(b => ctx.decodeAudioData(b)).then(buf => (thunderBuffer = buf));
  return thunderLoading.catch(e => { thunderLoading = null; throw e; });
}
// Vihma taust (public/sfx): hakkab kui sajab ja kustub aeglaselt, kui sadu lõpeb. Mängib katkematu 48 s silmusena.
const RAIN_URL = '/sfx/rain.mp3';
const RAIN_GAIN = 0.5;
const RAIN_FADE = 2.5;
let rainBuffer = null, rainLoading = null;
function loadRain(ctx) {
  if (rainBuffer) return Promise.resolve(rainBuffer);
  if (!rainLoading) rainLoading = fetch(RAIN_URL).then(r => { if (!r.ok) throw new Error(`Vihmaheli laadimine ebaõnnestus (${r.status})`); return r.arrayBuffer(); }).then(b => ctx.decodeAudioData(b)).then(buf => (rainBuffer = buf));
  return rainLoading.catch(e => { rainLoading = null; throw e; });
}

// Üks silmus korraga: AudioBufferSourceNode.loop on näidistäpne ja sisseehitatud lugudes on kaja saba algusesse tagasi keeratud.
// Iga lugu mängib oma helitugevuse sõlmega, nii saab lugude vahel sujuvalt üle minna.
// Heli on kogu rakenduse peale üks ühine objekt (getAmbience): lehtede vahel liikudes (Kodu ⇄ Elav kodu) muusika ei katke ega alga otsast.
// Kui ühelgi lehel pole enam muusikanuppu, jääb muusika pausile ja jätkub samast kohast, kui nupp tagasi tuleb.
export class Ambience {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.ctx = null; this.master = null; this.voice = null; this.tracks = TRACKS;
    this.volume = loadVolume(storage); this.trackId = loadTrack(storage); this.mode = loadMode(storage);
    const pb = loadPlayback(storage);
    this.want = pb.on; this.paused = pb.paused; this.savedPos = pb.pos;
    this.busy = false; this.error = ''; this.held = false; this.mounts = 0; this.restored = false;
    this.rainWanted = false; this.rain = null;
    this.token = 0; this.timer = 0; this.pauseTimer = 0; this.leaveTimer = 0; this.posTimer = 0; this.lastRefresh = 0;
    this.listeners = new Set(); this.snap = null; this.gestureBound = false;
    this.subscribe = fn => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
    this.getSnapshot = () => this.snap ??= this.makeSnapshot();
    this.onGesture = () => {
      for (const ev of ['pointerdown', 'keydown', 'touchend']) document.removeEventListener(ev, this.onGesture, true);
      this.gestureBound = false;
      if (this.ctx && this.want && !this.paused && !this.held) this.ctx.resume().catch(() => {});
    };
    this.savePos = () => { if (this.voice) { this.savedPos = { id: this.trackId, t: this.position() }; savePosition(this.savedPos.id, this.savedPos.t, this.storage); } };
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.savePos);
      document.addEventListener('visibilitychange', () => { if (document.hidden) this.savePos(); });
    }
  }

  get track() { return this.tracks.find(t => t.id === this.trackId) ?? this.tracks[0]; }
  get playing() { return this.want && !this.paused; }
  makeSnapshot() {
    const blocked = Boolean(this.ctx && this.ctx.state !== 'running' && this.playing && !this.held && !this.busy && this.voice);
    return { on: this.want, paused: this.paused, busy: this.busy, error: this.error, blocked, trackId: this.track.id, tracks: this.tracks, mode: this.mode, volume: this.volume };
  }
  emit() { this.snap = null; for (const fn of this.listeners) fn(); }
  persist() { savePlayback({ on: this.want, paused: this.paused }, this.storage); }
  position() { const v = this.voice; return v && this.ctx ? (v.offset + (this.ctx.currentTime - v.t0)) % v.duration : 0; }

  setTracks(list) {
    if (!list.length) return;
    this.tracks = list;
    if (!list.some(t => t.id === this.trackId) && !this.playing) this.trackId = list[0].id;
    this.emit();
  }
  async refresh() {
    if (Date.now() - this.lastRefresh < 1500) return;
    this.lastRefresh = Date.now();
    try { const r = await fetch('/api/audio'); if (!r.ok) return; const { files } = await r.json(); this.setTracks(buildTracks(files)); } catch { /* ei ole serverit või kataloogi: sisseehitatud lood jäävad */ }
  }

  // Muusikanupp ilmus lehele / kadus lehelt. Esimesel ilmumisel taastatakse eelmine seis (kui muusika oli sees, algab see uuesti samast kohast).
  attach() {
    this.mounts++; clearTimeout(this.leaveTimer);
    this.refresh();
    if (!this.restored) { this.restored = true; if (this.playing) this.begin(FADE, this.resumeOffset(), false); }
    else if (this.held) { this.held = false; this.resumeAudio(); }
    return () => this.detach();
  }
  detach() {
    this.mounts = Math.max(0, this.mounts - 1);
    if (this.mounts) return;
    this.leaveTimer = setTimeout(() => { if (this.mounts === 0 && this.voice && this.playing && !this.held) { this.savePos(); this.held = true; this.fadeAndSuspend(); this.emit(); } }, LEAVE_GRACE);
  }
  resumeOffset() { return this.savedPos && this.savedPos.id === this.track.id ? this.savedPos.t : 0; }

  retire(voice, fade = FADE) {
    if (!voice) return;
    voice.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    voice.gain.gain.setTargetAtTime(0, this.ctx.currentTime, fade / 3);
    setTimeout(() => { try { voice.source.stop(); } catch { /* juba peatatud */ } voice.source.disconnect(); voice.gain.disconnect(); }, fade * 1000 * 2);
  }
  // Järjestikuses režiimis liigub järgmise loo juurde sujuva ülemineku ajal, kui praegusel on CROSS sekundit järel.
  schedule() {
    clearTimeout(this.timer);
    const v = this.voice;
    if (!v || !this.playing || this.held || this.mode !== 'all') return;
    const remaining = v.ended ? 0 : v.duration - (v.offset + (this.ctx.currentTime - v.t0)) % v.duration;
    this.timer = setTimeout(() => this.advance(), Math.max(0, remaining - CROSS) * 1000);
  }
  async advance() {
    if (!this.playing || this.mode !== 'all') return;
    await this.refresh();
    let error = null;
    for (let i = 0; i < this.tracks.length; i++) {
      this.trackId = nextTrackId(this.trackId, this.tracks); saveTrack(this.trackId, this.storage); this.savedPos = { id: this.trackId, t: 0 };
      try { await this.begin(CROSS, 0, true); return; } catch (e) { error = e; }
    }
    this.error = error?.message || 'Järgmist lugu ei õnnestunud laadida.'; this.emit();
  }

  // blocking=false: taastamisel pärast lehe uuesti laadimist ei oota brauser veel kasutaja klõpsu; heli algab esimese klõpsu/klahvivajutusega.
  async begin(fade = FADE, offset = 0, blocking = true) {
    const token = ++this.token;
    clearTimeout(this.pauseTimer);
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) throw new Error('See brauser ei toeta heli esitamist.');
    if (!this.ctx) {
      this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.gain.value = volumeGain(this.volume); this.master.connect(this.ctx.destination);
      this.ctx.onstatechange = () => { this.emit(); this.syncRain(); };
    }
    this.held = false;
    if (blocking) await this.ctx.resume();
    else { this.ctx.resume().catch(() => {}); if (this.ctx.state !== 'running' && !this.gestureBound && typeof document !== 'undefined') { this.gestureBound = true; for (const ev of ['pointerdown', 'keydown', 'touchend']) document.addEventListener(ev, this.onGesture, true); } }
    let buffer;
    try { buffer = await loadBuffer(this.ctx, this.track); } catch (e) { if (!blocking) { this.error = e.message; this.emit(); return; } throw e; }
    if (token !== this.token) return;
    const source = this.ctx.createBufferSource(), gain = this.ctx.createGain(), duration = buffer.duration;
    const start = duration > 1 ? offset % duration : 0;
    source.buffer = buffer; source.loop = this.mode === 'one'; source.loopStart = 0; source.loopEnd = duration;
    gain.gain.value = 0; source.connect(gain); gain.connect(this.master); source.start(0, start);
    gain.gain.setTargetAtTime(1, this.ctx.currentTime, fade / 3);
    this.retire(this.voice, fade);
    const voice = this.voice = { source, gain, duration, offset: start, t0: this.ctx.currentTime, ended: false };
    source.onended = () => { voice.ended = true; if (this.voice === voice && this.playing && this.mode === 'all') this.advance(); };
    this.want = true; this.paused = false; this.persist();
    clearInterval(this.posTimer); this.posTimer = setInterval(this.savePos, 3000);
    if (this.rainWanted) this.startRain();
    if (!this.mounts) { this.held = true; this.fadeAndSuspend(); }
    else this.schedule();
    if (this.mode === 'all') loadBuffer(this.ctx, this.tracks.find(t => t.id === nextTrackId(this.trackId, this.tracks))).catch(() => {});
    this.emit();
  }

  async toggle() {
    this.error = '';
    if (this.want) { this.stop(); return; }
    this.busy = true; this.emit();
    try { this.want = true; await this.begin(FADE, 0, true); } catch (e) { this.want = false; this.persist(); this.error = e.message || 'Heli ei käivitunud.'; } finally { this.busy = false; this.emit(); }
  }
  stop() {
    const token = ++this.token;
    this.want = false; this.paused = false; this.held = false; this.persist();
    clearTimeout(this.timer); clearTimeout(this.pauseTimer); clearInterval(this.posTimer);
    this.stopRain();
    this.savedPos = { id: this.trackId, t: 0 }; savePosition(this.trackId, 0, this.storage);
    if (this.ctx) {
      const { ctx } = this;
      if (this.ctx.state !== 'running') { try { this.voice?.source.stop(); } catch { /* juba peatatud */ } this.voice?.source.disconnect(); }
      else this.retire(this.voice);
      this.voice = null;
      setTimeout(() => { if (token === this.token && !this.want) ctx.suspend?.().catch(() => {}); }, FADE * 1000 * 2.2);
    }
    this.emit();
  }
  // Paus peatab kogu helikonteksti (ka selle kella), seega jätkub lugu täpselt samast kohast ja järjestikuse režiimi taimer jääb õigeks.
  fadeAndSuspend() {
    clearTimeout(this.timer); clearTimeout(this.pauseTimer);
    const { ctx, voice } = this;
    voice.gain.gain.cancelScheduledValues(ctx.currentTime);
    voice.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.06);
    this.pauseTimer = setTimeout(() => ctx.suspend?.().catch(() => {}), 350);
  }
  async resumeAudio() {
    clearTimeout(this.pauseTimer);
    const { ctx, voice } = this;
    await ctx.resume();
    voice.gain.gain.cancelScheduledValues(ctx.currentTime);
    voice.gain.gain.setTargetAtTime(1, ctx.currentTime, 0.1);
    this.syncRain();
    this.schedule();
  }
  pause() {
    if (!this.want || this.paused) return;
    this.paused = true; this.persist();
    clearInterval(this.posTimer);
    if (this.voice) { this.savePos(); this.fadeAndSuspend(); }
    this.emit();
  }
  async resume() {
    if (!this.want || !this.paused) return;
    this.paused = false; this.persist(); this.error = '';
    if (this.voice) { this.posTimer = setInterval(this.savePos, 3000); await this.resumeAudio(); this.emit(); return; }
    this.busy = true; this.emit();
    try { await this.begin(FADE, this.resumeOffset(), true); } catch (e) { this.paused = true; this.persist(); this.error = e.message || 'Heli ei käivitunud.'; } finally { this.busy = false; this.emit(); }
  }
  togglePause() { return this.paused ? this.resume() : this.pause(); }

  // Välgulöögi ajal: mängib äikesehelinat, kuid ainult siis, kui muusika parasjagu mängib (muidu jääb vaikselt vahele).
  // Heli läheb sama master-võimenduse kaudu, seega järgib muusika helitugevust.
  async playLightning() {
    if (!this.ctx || this.ctx.state !== 'running' || !this.playing || this.held) return;
    try {
      const buffer = await loadThunder(this.ctx);
      if (!this.ctx || this.ctx.state !== 'running' || !this.playing || this.held) return;
      const source = this.ctx.createBufferSource(), gain = this.ctx.createGain();
      source.buffer = buffer; gain.gain.value = THUNDER_GAIN;
      source.connect(gain); gain.connect(this.master);
      source.onended = () => { source.disconnect(); gain.disconnect(); };
      source.start();
    } catch { /* heliefekti pole saadaval: jätame vahele */ }
  }

  // Vihma taust: mängib silmusena kogu aja, kui ilm näitab sadu ja muusika parasjagu käib; algus ja lõpp hajuvad üle.
  setRain(on) {
    on = Boolean(on);
    if (on === this.rainWanted) return;
    this.rainWanted = on;
    if (on) this.startRain(); else this.stopRain();
  }
  syncRain() { if (this.rainWanted && !this.rain) this.startRain(); }
  async startRain() {
    if (!this.rainWanted || this.rain || !this.ctx || this.ctx.state !== 'running' || !this.playing || this.held) return;
    try {
      const buffer = await loadRain(this.ctx);
      if (!this.rainWanted || this.rain || !this.ctx || this.ctx.state !== 'running' || !this.playing || this.held) return;
      const source = this.ctx.createBufferSource(), gain = this.ctx.createGain();
      source.buffer = buffer; source.loop = true;
      gain.gain.value = 0; source.connect(gain); gain.connect(this.master); source.start();
      gain.gain.setTargetAtTime(RAIN_GAIN, this.ctx.currentTime, RAIN_FADE / 3);
      this.rain = { source, gain };
    } catch { /* vihmaheli pole saadaval: jätame vahele */ }
  }
  stopRain() {
    const rain = this.rain; if (!rain) return;
    this.rain = null;
    if (!this.ctx) { try { rain.source.stop(); } catch { /* juba peatatud */ } rain.source.disconnect(); rain.gain.disconnect(); return; }
    const now = this.ctx.currentTime;
    rain.gain.gain.cancelScheduledValues(now);
    rain.gain.gain.setTargetAtTime(0, now, RAIN_FADE / 3);
    setTimeout(() => { try { rain.source.stop(); } catch { /* juba peatatud */ } rain.source.disconnect(); rain.gain.disconnect(); }, RAIN_FADE * 1000 * 2);
  }

  async setTrack(id) {
    if (!this.tracks.some(t => t.id === id) || id === this.trackId) return;
    this.trackId = id; saveTrack(id, this.storage); this.savedPos = { id, t: 0 }; this.error = '';
    if (!this.want) { this.emit(); return; }
    this.busy = true; this.emit();
    try { await this.begin(FADE, 0, true); } catch (e) { this.error = e.message || 'Lugu ei õnnestunud laadida.'; } finally { this.busy = false; this.emit(); }
  }
  // Käsitsi järgmine/eelmine lugu (ringiga). Kui muusika mängib, läheb sujuva üleminekuga üle; kui seisab, valib lihtsalt loo.
  next() { return this.stepTrack(1); }
  prev() { return this.stepTrack(-1); }
  async stepTrack(delta) {
    if (this.tracks.length < 2) return;
    const id = delta > 0 ? nextTrackId(this.trackId, this.tracks) : prevTrackId(this.trackId, this.tracks);
    await this.setTrack(id);
  }
  setMode(mode) {
    if (!MODES.includes(mode)) return;
    this.mode = mode; saveMode(mode, this.storage);
    if (this.voice) { this.voice.source.loop = mode === 'one'; this.schedule(); }
    this.emit();
  }
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    saveVolume(this.volume, this.storage);
    if (this.ctx) { this.master.gain.cancelScheduledValues(this.ctx.currentTime); this.master.gain.setTargetAtTime(volumeGain(this.volume), this.ctx.currentTime, 0.04); }
    this.emit();
  }
}

let shared = null;
export const getAmbience = () => shared ??= new Ambience();
