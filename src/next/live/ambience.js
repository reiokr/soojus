// Sisseehitatud lood (scripts/make-music.py). Lisaks leiab rakendus kõik helifailid kataloogist dist/audio (vt /api/audio).
export const TRACKS = [
  { id: 'hubane-lounge', title: 'Hubane lounge', url: '/audio/hubane-lounge.mp3' },
  { id: 'pehme-jazz', title: 'Pehme jazz', url: '/audio/pehme-jazz.mp3' },
  { id: 'ohtune-rahu', title: 'Õhtune rahu', url: '/audio/ohtune-rahu.mp3' },
  { id: 'kitarriohtu', title: 'Kitarriõhtu', url: '/audio/kitarriohtu.mp3' },
  { id: 'puhapaeva-hommik', title: 'Pühapäeva hommik', url: '/audio/puhapaeva-hommik.mp3' }
];
const VOLUME_KEY = 'soojus.sound.volume', TRACK_KEY = 'soojus.sound.track', MODE_KEY = 'soojus.sound.mode', FADE = 0.45, CROSS = 3;

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

const buffers = new Map();
const loadBuffer = (ctx, track) => {
  if (!buffers.has(track.id)) buffers.set(track.id, fetch(track.url).then(r => { if (!r.ok) throw new Error(`Heli laadimine ebaõnnestus (${r.status})`); return r.arrayBuffer(); }).then(b => ctx.decodeAudioData(b)).catch(e => { buffers.delete(track.id); throw e; }));
  return buffers.get(track.id);
};

// Üks silmus korraga: AudioBufferSourceNode.loop on näidistäpne ja sisseehitatud lugudes on kaja saba algusesse tagasi keeratud.
// Iga lugu mängib oma helitugevuse sõlmega, nii saab lugude vahel sujuvalt üle minna.
export class Ambience {
  constructor() { this.ctx = null; this.master = null; this.voice = null; this.volume = loadVolume(); this.trackId = loadTrack(); this.mode = loadMode(); this.token = 0; this.playing = false; this.timer = 0; this.onTrack = null; this.onError = null; this.onTracks = null; this.tracks = TRACKS; }
  get track() { return this.tracks.find(t => t.id === this.trackId) ?? this.tracks[0]; }
  setTracks(list) {
    if (!list.length) return;
    this.tracks = list;
    if (!list.some(t => t.id === this.trackId) && !this.playing) this.trackId = list[0].id;
    this.onTracks?.(list);
  }
  async refresh() {
    if (Date.now() - (this.lastRefresh ?? 0) < 1500) return;
    this.lastRefresh = Date.now();
    try { const r = await fetch('/api/audio'); if (!r.ok) return; const { files } = await r.json(); this.setTracks(buildTracks(files)); } catch { /* ei ole serverit või kataloogi: sisseehitatud lood jäävad */ }
  }
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
    if (!v || !this.playing || this.mode !== 'all') return;
    const remaining = v.ended ? 0 : v.duration - (this.ctx.currentTime - v.t0) % v.duration;
    this.timer = setTimeout(() => this.advance(), Math.max(0, remaining - CROSS) * 1000);
  }
  async advance() {
    if (!this.playing || this.mode !== 'all') return;
    await this.refresh();
    let error = null;
    for (let i = 0; i < this.tracks.length; i++) {
      this.trackId = nextTrackId(this.trackId, this.tracks); saveTrack(this.trackId); this.onTrack?.(this.trackId);
      try { await this.start(CROSS); return; } catch (e) { error = e; }
    }
    this.onError?.(error);
  }
  async start(fade = FADE) {
    const token = ++this.token;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) throw new Error('See brauser ei toeta heli esitamist.');
    if (!this.ctx) { this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.gain.value = volumeGain(this.volume); this.master.connect(this.ctx.destination); }
    await this.ctx.resume();
    const track = this.track, buffer = await loadBuffer(this.ctx, track);
    if (token !== this.token) return;
    const source = this.ctx.createBufferSource(), gain = this.ctx.createGain();
    const duration = buffer.duration;
    source.buffer = buffer; source.loop = this.mode === 'one'; source.loopStart = 0; source.loopEnd = duration;
    gain.gain.value = 0; source.connect(gain); gain.connect(this.master); source.start(0, 0);
    gain.gain.setTargetAtTime(1, this.ctx.currentTime, fade / 3);
    this.retire(this.voice, fade);
    const voice = this.voice = { source, gain, duration, t0: this.ctx.currentTime, ended: false };
    source.onended = () => { voice.ended = true; if (this.voice === voice && this.playing && this.mode === 'all') this.advance(); };
    this.playing = true;
    this.schedule();
    if (this.mode === 'all') loadBuffer(this.ctx, this.tracks.find(t => t.id === nextTrackId(this.trackId, this.tracks))).catch(() => {});
  }
  stop() {
    const token = ++this.token;
    this.playing = false;
    clearTimeout(this.timer);
    if (!this.ctx) return;
    const { ctx } = this;
    this.retire(this.voice); this.voice = null;
    setTimeout(() => { if (token === this.token) ctx.suspend?.().catch(() => {}); }, FADE * 1000 * 2.2);
  }
  async setTrack(id) {
    if (!this.tracks.some(t => t.id === id) || id === this.trackId) return;
    this.trackId = id; saveTrack(id);
    if (this.playing) await this.start();
  }
  setMode(mode) {
    if (!MODES.includes(mode)) return;
    this.mode = mode; saveMode(mode);
    if (this.voice) { this.voice.source.loop = mode === 'one'; this.schedule(); }
  }
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    saveVolume(this.volume);
    if (this.ctx) { this.master.gain.cancelScheduledValues(this.ctx.currentTime); this.master.gain.setTargetAtTime(volumeGain(this.volume), this.ctx.currentTime, 0.04); }
  }
  destroy() { this.token++; this.playing = false; clearTimeout(this.timer); try { this.voice?.source.stop(); } catch { /* juba peatatud */ } this.ctx?.close?.().catch(() => {}); this.ctx = this.master = this.voice = null; }
}
