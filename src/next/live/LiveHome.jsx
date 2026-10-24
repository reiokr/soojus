import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CloudRain, Droplets, Fan, Flame, Home as HomeIcon, MapPin, Maximize2, Minimize2, Moon, Sparkles, Sunrise, Sunset, Thermometer } from 'lucide-react';
import { number, time } from '../../lib.js';
import { greeting, pumpState } from '../logic.js';
import { LiveScene, season, HOTSPOTS, W, VIEW } from './scene.js';
import { buildLiveState, liveSummary, DEMOS } from './state.js';
import { darkness, moonName, moonPhase, sunPosition, sunTimes } from './sky.js';
import { WEATHER_DEMOS } from '../../weather-logic.js';
import WeatherPanel from './WeatherPanel.jsx';
import ForecastRail from './ForecastRail.jsx';
import SoundControl from './SoundControl.jsx';
import { getAmbience } from './ambience.js';
import { LocationPanel } from '../../location.jsx';
import { t as tr, getLocale } from '../../i18n/index.js';

const dayName = date => new Intl.DateTimeFormat(getLocale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
const SEASONS = { winter: 'live.seasonWinter', spring: 'live.seasonSpring', summer: 'live.seasonSummer', autumn: 'live.seasonAutumn', late: 'live.seasonLate' };
const HOT_KEYS = { pump: 'live.hotspotPump', ground: 'live.hotspotGround', vent: 'live.hotspotVent', boiler: 'live.hotspotBoiler' };
const INFO_KEYS = { pump: 'live.infoPump', vent: 'live.infoVent', boiler: 'live.infoBoiler' };
const VENT_MODES = { Automaatne: 'vent.automatic', Manuaalne: 'vent.manual', Õhutus: 'vent.boost', Ülerõhk: 'vent.overpressure' };
// Täisekraanis ei ole pildi peal klõpsatavaid seadmeid (hotspotid on peidetud), seepärast saab ülaservast hiireliigutusel (nagu muusikanupud) otse lehtedele liikuda.
const FULL_NAV = [['heating', 'nav.heating', Thermometer], ['water', 'nav.water', Droplets], ['ventilation', 'nav.ventilation', Fan]];

// embedded: Kodu lehe versioon ainult päris andmetega (ilma demo, kellaaja liuguri, prognoosi ja selgitusteta).
export default function LiveHome({ ctx, embedded = false }) {
  const stageRef = useRef(null), viewRef = useRef(null), canvasRef = useRef(null), sceneRef = useRef(null), hideTimer = useRef(0);
  const [size, setSize] = useState({ w: 0, h: 0 }), [hot, setHot] = useState(null);
  const [demo, setDemo] = useState('off'), [weatherDemo, setWeatherDemo] = useState('off'), [showLoc, setShowLoc] = useState(false), [hour, setHour] = useState(null), [full, setFull] = useState(false), [idle, setIdle] = useState(false), [clock, setClock] = useState(() => new Date());
  useEffect(() => { const timer = setInterval(() => setClock(new Date()), 15000); return () => clearInterval(timer); }, []);
  const vent = ctx.airobot?.view?.configured ? ctx.airobot.view : null;
  const forecast = ctx.weather?.view?.weather ?? null, place = ctx.weather?.place ?? null;
  const live = useMemo(() => buildLiveState({ m: ctx.m, climate: ctx.climate, vent, state: pumpState(ctx.m), now: clock, demo, hour, place, forecast, weatherDemo, lux: ctx.lux?.view && ctx.lux.view.primary !== false ? ctx.lux.view : null }), [ctx.m, ctx.climate, vent, clock, demo, hour, place, forecast, weatherDemo, ctx.lux?.view]);

  useEffect(() => {
    const canvas = canvasRef.current, scene = new LiveScene(canvas);
    sceneRef.current = scene;
    // Äikese ajal: iga välgulöök annab märku; heli mängib ambience, kuid ainult siis, kui muusika parasjagu käib.
    scene.onLightning = () => getAmbience().playLightning();
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    scene.reduced = Boolean(reduce?.matches);
    const fit = () => { const r = viewRef.current.getBoundingClientRect(); setSize({ w: r.width, h: r.height }); scene.resize(r.width, r.height, Math.min(1.5, window.devicePixelRatio || 1)); if (scene.reduced || !scene.running) scene.frame(performance.now()); };
    // Kaadrisagedus sõltub tähelepanust: aktiivselt vaadates 24 fps, 15 s tegevusetuse järel 8 fps,
    // 90 s järel 2 fps (vaade jääb elama, aga ei köeta). Akna taustal samuti 2 fps.
    const ACTIVE = 24, IDLE = 8, SLEEP = 2;
    let level = 0, idleTimer = 0, sleepTimer = 0;
    const apply = () => scene.setFps(!document.hasFocus() ? SLEEP : level === 2 ? SLEEP : level === 1 ? IDLE : ACTIVE);
    const rest = () => {
      clearTimeout(idleTimer); clearTimeout(sleepTimer);
      idleTimer = setTimeout(() => { level = 1; apply(); }, 15000);
      sleepTimer = setTimeout(() => { level = 2; apply(); }, 90000);
    };
    const wake = () => { if (level) { level = 0; apply(); } rest(); };
    apply(); rest();
    const active = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'scroll', 'touchstart'];
    for (const ev of active) window.addEventListener(ev, wake, { passive: true });
    const onFocus = () => apply();
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onFocus);
    const ro = new ResizeObserver(fit); ro.observe(viewRef.current); fit();
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) scene.start(); else scene.stop(); }, { threshold: 0.05 }); io.observe(viewRef.current);
    const onMotion = () => { scene.reduced = Boolean(reduce.matches); };
    reduce?.addEventListener?.('change', onMotion);
    return () => {
      ro.disconnect(); io.disconnect(); clearTimeout(idleTimer); clearTimeout(sleepTimer);
      for (const ev of active) window.removeEventListener(ev, wake);
      window.removeEventListener('focus', onFocus); window.removeEventListener('blur', onFocus);
      reduce?.removeEventListener?.('change', onMotion); scene.destroy();
    };
  }, []);
  useEffect(() => { sceneRef.current?.setHover(hot); }, [hot]);
  // Täisekraanil hotspot-nupud eemaldatakse, mistõttu hiirest lahkumise sündmust ei tule: ilma selleta jääks viimane esiletõst (nt maakontuur) kinni.
  useEffect(() => { setHot(null); sceneRef.current?.setFullscreen(full); }, [full]);
  useEffect(() => { sceneRef.current?.setState(live); if (sceneRef.current?.reduced) sceneRef.current.frame(performance.now()); }, [live]);
  // Vihma taust: kui ilm näitab sadu, laseb ambience selle sisse ja kui sadu lõpeb, hajub välja.
  // Elava kodu vaate lahkumisel lõpetame vihma, et see ei jääks mängima, kui ilma enam ei jälgita.
  const raining = Boolean(live.weather && live.weather.rain > 0.05);
  useEffect(() => { const amb = getAmbience(); amb.setRain(raining); return () => amb.setRain(false); }, [raining]);
  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  const wake = () => { setIdle(false); clearTimeout(hideTimer.current); if (full) hideTimer.current = setTimeout(() => setIdle(true), 3500); };
  useEffect(() => { wake(); }, [full]);
  const toggleFull = () => { if (document.fullscreenElement) document.exitFullscreen?.(); else stageRef.current?.requestFullscreen?.(); };
  // Täisekraanilt siirdumine: lahku kõigepealt täisekraanist, muidu jääks vana täisekraani element kohe eemalduma.
  const openPage = id => { if (document.fullscreenElement) document.exitFullscreen?.(); ctx.navigate(id); };

  const sun = useMemo(() => sunTimes(live.time, live.place), [live.time.toDateString(), live.place.lat, live.place.lon]);
  const phase = moonPhase(live.time), seasonKey = season(live.time).key;
  // Vinjett on CSS-kihis (compositor joonistab selle GPU-l), mitte canvas'es – see oli üks suuremaid kaadrikulusid.
  const dark = useMemo(() => darkness(sunPosition(live.time, live.place).elevation), [live.time, live.place.lat, live.place.lon]);
  const w = live.weather, days = forecast?.days ?? [];
  const summary = `${liveSummary(live)}${w ? `, ilm: ${w.label}` : ''}${live.demo ? ' (demo)' : ''}`;
  const temp = v => v == null ? '—' : `${number(v, 1)} °C`;
  // Asukoht protsentides: brauseri mõõtmised on CSS-i suurendusega (zoom) juba skaleeritud, pikslid läheksid topelt suureks.
  const zoomFactor = (typeof document !== 'undefined' && parseFloat(getComputedStyle(document.documentElement).zoom)) || 1;
  const fitScale = size.w ? Math.min(size.w / W, size.h / VIEW.h) : 0, offX = (size.w - W * fitScale) / 2, offY = (size.h - VIEW.h * fitScale) / 2 - VIEW.y * fitScale;
  const kw = v => `${number(v, 1)} kW`;
  const ventMode = live.vent.modeText ? (VENT_MODES[live.vent.modeText] ? tr(VENT_MODES[live.vent.modeText]) : live.vent.modeText) : tr('live.ventLabel');
  const nowText = {
    pump: live.hwOn && live.heatOn ? tr('live.pumpBoth', { kw: kw(live.powerKw) }) : live.hwOn ? tr('live.pumpWater', { kw: kw(live.powerKw) }) : live.heatOn ? tr('live.pumpHeat', { kw: kw(live.powerKw) }) : live.running ? tr('live.pumpCompressor', { kw: kw(live.powerKw) }) : live.heatDemand || live.hwDemand ? tr('live.pumpWaiting') : tr('live.pumpResting'),
    ground: live.brine.present ? tr('live.groundPresent', { in: number(live.brine.in, 1), out: number(live.brine.out, 1) }) + (live.running ? tr('live.groundGave', { delta: number(live.brine.in - live.brine.out, 1) }) : tr('live.groundIdle')) : live.running ? tr('live.groundRunning') : tr('live.groundStopped'),
    vent: live.vent.running ? tr('live.ventStatus', { mode: ventMode, level: live.vent.level, co2: live.vent.co2 }) : tr('live.ventStopped'),
    boiler: live.water == null ? '' : tr('live.boiler', { water: number(live.water, 1), target: live.waterTarget == null ? '—' : number(live.waterTarget, 0) }) + (live.hwOn ? tr('live.boilerHeating') : '')
  };
  const targets = Object.entries(HOTSPOTS).filter(([id]) => id !== 'vent' || live.vent.present);
  const hoursValue = hour ?? live.time.getHours() + live.time.getMinutes() / 60;

  return <section className={`live ${embedded ? 'is-embedded' : ''} ${full ? 'is-full' : ''} ${idle ? 'is-idle' : ''}`} aria-label={tr('nav.live')} onMouseMove={wake} onTouchStart={wake} onKeyDown={wake}>
    <div className="live-stage" ref={stageRef}>
      <div className="live-view" ref={viewRef}>
      <canvas ref={canvasRef} role="img" aria-label={tr('live.aria', { summary, indoor: temp(live.indoor), outdoor: temp(live.outdoor), water: temp(live.water) })}/>
      <div className="live-vignette" aria-hidden="true" style={{ '--vig': (0.28 + dark * 0.3).toFixed(3) }}/>
      {fitScale > 0 && !full && <div className="live-hotspots">{targets.map(([id, h]) => {
        const flip = id === 'boiler';
        return <button key={id} type="button" className={`live-hot ${hot === id ? 'hot' : ''} ${flip ? 'flip' : ''}`} style={{ left: `${(offX + h.x * fitScale) / size.w * 100}%`, top: `${(offY + h.y * fitScale) / size.h * 100}%`, width: `${h.w * fitScale / size.w * 100}%`, height: `${h.h * fitScale / size.h * 100}%`, borderRadius: `${h.r * fitScale / zoomFactor}px`, '--hot': h.color }}
          aria-label={`${tr(HOT_KEYS[id])}. ${nowText[id]}. ${id === 'ground' && live.brine.present ? tr('live.groundTag') : id === 'ground' ? tr('live.infoGround') : tr(INFO_KEYS[id])} ${tr('live.openPageAria', { page: tr('nav.' + h.page) })}.`} onClick={() => ctx.navigate(h.page)} onMouseEnter={() => !full && setHot(id)} onMouseLeave={() => setHot(null)} onFocus={e => e.currentTarget.matches(':focus-visible') && setHot(id)} onBlur={() => setHot(null)}>
          <span className="live-hot-label" role="tooltip"><b>{tr(HOT_KEYS[id])}</b><em>{nowText[id]}</em><span>{id === 'ground' && live.brine.present ? tr('live.groundInfo') : id === 'ground' ? tr('live.infoGround') : tr(INFO_KEYS[id])}</span><i>{tr('live.openPage', { page: tr('nav.' + h.page) })} <ArrowRight size={12}/></i></span>
        </button>; })}</div>}
      <div className="live-hud live-clock">
        <em className="live-greeting">{greeting(live.time)}</em>
        <b>{time(live.time)}</b>
        <span>{dayName(live.time).replace(/^./, c => c.toUpperCase())} · {tr(SEASONS[seasonKey])}</span>
        <small className="live-place"><MapPin size={13}/> {live.place.name}</small>
        <small>{sun.rise && <><Sunrise size={13}/> {time(sun.rise)}</>}{sun.set && <> <Sunset size={13}/> {time(sun.set)}</>} <Moon size={13}/> {moonName(phase)} {Math.round(phase.illumination * 100)}%</small>
      </div>
      <ul className="live-hud live-temps" aria-label={tr('live.temperatures')}>
        <li><HomeIcon size={15}/><span>{tr('live.indoor')}</span><b>{temp(live.indoor)}</b></li>
        <li><Thermometer size={15}/><span>{tr('live.outdoor')}</span><b>{temp(live.outdoor)}</b></li>
        <li><Droplets size={15}/><span>{tr('live.water')}</span><b>{temp(live.water)}</b></li>
        {w && <li className="live-weather"><CloudRain size={15}/><span>{live.place.name}: {w.label}</span><b>{temp(w.temperature)}</b></li>}
      </ul>
      {full && <nav className="live-topnav" aria-label={tr('live.fullscreenNav')}>
        {FULL_NAV.map(([id, label, Icon]) => <button key={id} type="button" onClick={() => openPage(id)} aria-label={tr('live.openPageAria', { page: tr(label) })} title={tr('live.openPageAria', { page: tr(label) })}><Icon size={16}/><span>{tr(label)}</span></button>)}
      </nav>}
      {full && w && <ForecastRail scene={w} forecast={forecast} place={live.place}/>}
      </div>
      <div className="live-bottom">
      {full && <div className="live-hud live-devices" role="group" aria-label={tr('live.devices')}>
        <div className="live-device"><span className={`live-dot ${live.running ? 'on' : ''}`}/><div><small><Flame size={13}/> {tr('live.hotspotPump')}</small><b>{nowText.pump}</b><em>{tr('live.compressorState', { state: tr(live.running ? 'live.compressorOn' : 'live.compressorOff'), supply: temp(live.supply), return: temp(live.returnT) })}</em></div></div>
        {live.vent.present && <div className="live-device"><span className={`live-dot ${live.vent.running ? 'air' : 'off'}`}/><div><small><Fan size={13}/> {tr('live.ventLabel')}</small><b>{nowText.vent}</b><em>{tr('live.airflow', { value: number(live.vent.airflow, 0) })}{live.vent.humidity != null ? tr('live.humidity', { value: number(live.vent.humidity, 0) }) : ''}{live.vent.bypass ? tr('live.bypass', { state: live.vent.bypassOpen == null ? tr('live.bypassAuto') : live.vent.bypassOpen ? tr('live.bypassOpen') : tr('live.bypassClosed') }) : ''}</em></div></div>}
        <div className="live-device"><span className={`live-dot ${live.hwOn ? 'on' : ''}`}/><div><small><Droplets size={13}/> {tr('live.water')}</small><b>{nowText.boiler}</b><em>{tr('live.indoor')} {temp(live.indoor)} · {tr('live.outdoor')} {temp(live.outdoor)}</em></div></div>
        {live.demo && <em className="live-demo-tag">DEMO</em>}
      </div>}
      {!full && <div className="live-hud live-status">
        <span className={`live-dot ${live.running ? 'on' : ''}`}/>
        <div><b>{liveSummary(live).replace(/^./, c => c.toUpperCase())}</b>{live.vent.present && <small><Fan size={12}/> {tr('live.ventLine', { mode: ventMode, level: live.vent.level, co2: live.vent.co2 })}</small>}</div>
        {live.demo && <em>DEMO</em>}
      </div>}
      <div className="live-controls">
        {!embedded && <>
        <div className="live-modes" role="group" aria-label={tr('live.demoGroup')}>
          {Object.entries(DEMOS).map(([id, label]) => <button key={id} type="button" className={demo === id ? 'selected' : ''} aria-pressed={demo === id} onClick={() => setDemo(id)}>{id === 'heat' ? <Flame size={13}/> : id === 'water' ? <Droplets size={13}/> : id === 'vent' ? <Fan size={13}/> : null}{tr(label)}</button>)}
        </div>
        <label className="live-select"><span>{tr('live.weather')}</span><select value={weatherDemo} onChange={e => setWeatherDemo(e.target.value)} aria-label={tr('live.weatherDemo')}>{Object.entries(WEATHER_DEMOS).map(([id, label]) => <option key={id} value={id}>{tr(label)}</option>)}</select></label>
        <label className="live-scrub"><span>{tr('live.clock')}</span><input type="range" min="0" max="24" step="0.25" value={hoursValue} onChange={e => setHour(Number(e.target.value))} aria-label={tr('live.clockAria')}/><button type="button" onClick={() => setHour(null)} disabled={hour == null}>{tr('live.nowBtn')}</button></label>
        <button type="button" className="live-loc" onClick={() => setShowLoc(!showLoc)} aria-expanded={showLoc}><MapPin size={14}/>{live.place.name}</button>
        </>}
        {embedded && <button type="button" className="live-loc" onClick={() => ctx.navigate('live')}><Sparkles size={14}/>{tr('live.demo')}</button>}
        <SoundControl/>
        <button type="button" className="live-full" onClick={toggleFull} aria-label={full ? tr('live.exitFullscreen') : tr('live.fullscreen')} title={full ? tr('live.exitFullscreen') : tr('live.fullscreen')}>{full ? <Minimize2 size={17}/> : <Maximize2 size={17}/>}</button>
      </div>
      </div>
    </div>
    {!embedded && w && <WeatherPanel scene={w} forecast={forecast} place={live.place} sensor={live.outdoor}/>}
    {!embedded && showLoc && ctx.weather && <LocationPanel weather={ctx.weather} notify={ctx.notify} compact/>}
    {!embedded && ctx.weather?.view?.error && !forecast && <p className="live-note" role="status">{tr('live.weatherError', { error: ctx.weather.view.error })}</p>}
    {!embedded && <p className="live-note">{tr('live.note', { place: live.place.name })}</p>}
  </section>;
}
