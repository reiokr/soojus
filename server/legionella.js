// Legionella (bakterikaitse) programm.
// Seadme enda programm on ainult nädalane. Siin juhime seadme "kõrgendatud tarbevee" funktsiooni
// ise (25001 sisse, siht 6146, kestus 6147), et saaks valida 1 / 2 / 4 nädala rütmi, ja
// lülitame selle pärast kestust kindlasti välja – nii ei jää kuumutus kogemata sisse.

export const LEGIONELLA_WEEKS = [1, 2, 4];
export const LEGIONELLA_DURATIONS = [30, 60, 90, 120];
export const LEGIONELLA_TARGET_MIN = 48, LEGIONELLA_TARGET_MAX = 65;
export const WEEKDAY_NAMES = ['Esmaspäev', 'Teisipäev', 'Kolmapäev', 'Neljapäev', 'Reede', 'Laupäev', 'Pühapäev'];
const DAY = 86400000;
// Kui server oli kauem kui 2 päeva maas, jätame vahelejäänud korra vahele ja ootame järgmist.
const CATCHUP = 2 * DAY;

export const defaultLegionella = () => ({
  enabled: false, weeks: 4, weekday: 6, time: '03:00', target: 60, durationMin: 30,
  nextRun: null, lastRun: null, lastMaxTemp: null, running: null, lastError: null
});

export const parseTime = value => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ''));
  return m ? { h: Number(m[1]), m: Number(m[2]) } : null;
};

// Järgmine valitud nädalapäev + kellaaeg alates ajast `from` (kohalik aeg, 0 = esmaspäev).
export function nextOccurrence(weekday, time, from = Date.now()) {
  const t = parseTime(time);
  if (!t) return null;
  const d = new Date(from);
  d.setHours(t.h, t.m, 0, 0);
  const current = (d.getDay() + 6) % 7;
  let add = ((Number(weekday) - current) % 7 + 7) % 7;
  if (add === 0 && d.getTime() <= from) add = 7;
  d.setDate(d.getDate() + add);
  return d.toISOString();
}

// Pärast jooksu hoiame algse rütmi (nt iga 4 nädala tagant sama nädalapäev), mitte "täna + 4 nädalat".
export function advanceNext(cfg, now = Date.now()) {
  const step = Math.max(1, cfg.weeks) * 7 * DAY;
  let t = Date.parse(cfg.nextRun);
  if (!Number.isFinite(t)) t = now;
  let guard = 0;
  while (t <= now && guard++ < 1000) t += step;
  return new Date(t).toISOString();
}

// Sisendi valideerimine: lubamatud väärtused asendatakse varasemate/vaietega, mitte ei visata viga.
export function normalizeLegionella(input = {}, prev = null, now = Date.now()) {
  const base = { ...defaultLegionella(), ...(prev || {}) };
  const num = (v, fallback) => v == null || v === '' || !Number.isFinite(Number(v)) ? fallback : Number(v);
  const weeks = LEGIONELLA_WEEKS.includes(num(input.weeks, base.weeks)) ? num(input.weeks, base.weeks) : base.weeks;
  const wd = num(input.weekday, base.weekday);
  const weekday = Number.isInteger(wd) && wd >= 0 && wd <= 6 ? wd : base.weekday;
  const time = parseTime(input.time) ? input.time : base.time;
  const target = Math.min(LEGIONELLA_TARGET_MAX, Math.max(LEGIONELLA_TARGET_MIN, Math.round(num(input.target, base.target) * 2) / 2));
  const durationMin = LEGIONELLA_DURATIONS.includes(num(input.durationMin, base.durationMin)) ? num(input.durationMin, base.durationMin) : base.durationMin;
  const enabled = input.enabled == null ? base.enabled : Boolean(input.enabled);
  const scheduleChanged = !prev || weeks !== prev.weeks || weekday !== prev.weekday || time !== prev.time;
  const cfg = { ...base, enabled, weeks, weekday, time, target, durationMin };
  if (scheduleChanged || !cfg.nextRun || (enabled && Date.parse(cfg.nextRun) <= now)) cfg.nextRun = nextOccurrence(weekday, time, now);
  return cfg;
}

// Mida järgmise kontrolliga teha: 'start' | 'stop' | 'skip' | 'running' | null.
export function legionellaAction(cfg, now = Date.now()) {
  if (!cfg || !cfg.enabled) return null;
  if (cfg.running) return now >= Date.parse(cfg.running.endsAt) ? 'stop' : 'running';
  const t = Date.parse(cfg.nextRun);
  if (!Number.isFinite(t) || now < t) return null;
  return now - t <= CATCHUP ? 'start' : 'skip';
}

// Käsitsi tehtud kuumutus loetakse selle tsükli täitumiseks: järgmine graafiline kord lükkub
// vähemalt ühe intervalli võrra edasi, et sama nädala sees ei tuleks kahte kuumutust.
export function shiftAfterManual(cfg, now = Date.now()) {
  const min = now + Math.max(1, cfg.weeks) * 7 * DAY - 6 * 3600000;
  let t = Date.parse(cfg.nextRun);
  if (!Number.isFinite(t)) t = now;
  let guard = 0;
  while (t < min && guard++ < 1000) t = Date.parse(nextOccurrence(cfg.weekday, cfg.time, Math.max(t, now)));
  return new Date(t).toISOString();
}

// Seadme enda "ekstra sooja vee kestus" (6147) lõpetab tõstetud sihi varem, kui vesi jõuab
// 63 °C-ni. Seepärast hoiame jooksu ajal sihti perioodiliselt uuesti peal ja peatame alles siis,
// kui siht on saavutatud (või 4 h turvapiir on täis).
export const RUN_MAX_MS = 4 * 3600000;
export const REARM_MS = 10 * 60000;
// Kui temperatuur ei tõuse 30 min jooksul (nt kompressori lagi), lõpetame jooksu mõttetult ringlemast.
export const PLATEAU_MS = 30 * 60000;

const reachedTarget = (cfg, temp) => Number.isFinite(Number(temp)) && Number(temp) >= cfg.running.target - 0.5;

export function legionellaStop(cfg, temp, now = Date.now()) {
  if (!cfg?.running) return false;
  const started = Date.parse(cfg.running.startedAt);
  if (!Number.isFinite(started)) return true;
  if (now >= started + RUN_MAX_MS) return true;
  return reachedTarget(cfg, temp) && now >= started + cfg.durationMin * 60000;
}

export function legionellaPlateau(cfg, temp, now = Date.now()) {
  if (!cfg?.running || temp == null || temp === '' || !Number.isFinite(Number(temp))) return false;
  const at = Date.parse(cfg.running.lastTempAt || cfg.running.startedAt);
  return Number.isFinite(at) && now - at >= PLATEAU_MS;
}

export function legionellaPoke(cfg, temp, now = Date.now()) {
  if (!cfg?.running || reachedTarget(cfg, temp)) return false;
  const last = Date.parse(cfg.running.pokeAt || cfg.running.startedAt);
  return !Number.isFinite(last) || now - last >= REARM_MS;
}

// Jooks algab: seade hoiab kõrgendatud sihti kestuse vältel; meie lülitame iga juhu jaoks
// varuga välja (kestus + 60 min), et kütmine jõuaks lõpuni isegi külma paagi korral.
export function beginRun(cfg, now = Date.now()) {
  const startedAt = new Date(now).toISOString();
  return {
    ...cfg,
    lastRun: startedAt, lastError: null,
    running: { startedAt, endsAt: new Date(now + (cfg.durationMin + 60) * 60000).toISOString(), pokeAt: startedAt, lastTemp: null, lastTempAt: startedAt, target: cfg.target, maxTemp: null }
  };
}

export function endRun(cfg, now = Date.now()) {
  const maxTemp = cfg.running?.maxTemp ?? null;
  return { ...cfg, running: null, lastMaxTemp: maxTemp, nextRun: advanceNext(cfg, now) };
}
