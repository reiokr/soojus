import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CloudRain, Droplets, Fan, Flame, Home as HomeIcon, MapPin, Maximize2, Minimize2, Moon, Sparkles, Sunrise, Sunset, Thermometer, Wind } from 'lucide-react';
import { number, time } from '../../lib.js';
import { pumpState } from '../logic.js';
import { LiveScene, season, HOTSPOTS, W, VIEW } from './scene.js';
import { buildLiveState, liveSummary, DEMOS } from './state.js';
import { moonName, moonPhase, sunTimes } from './sky.js';
import { compassName, weatherLabel, WEATHER_DEMOS } from '../../weather-logic.js';
import { LocationPanel } from '../../location.jsx';

const dayName = new Intl.DateTimeFormat('et-EE', { weekday: 'long', day: 'numeric', month: 'long' });
const SEASONS = { winter: 'talv', spring: 'kevad', summer: 'suvi', autumn: 'sügis', late: 'hilissügis' };

// embedded: Plaani lehe versioon ainult päris andmetega (ilma demo, kellaaja liuguri, prognoosi ja selgitusteta).
export default function LiveHome({ ctx, embedded = false }) {
  const stageRef = useRef(null), viewRef = useRef(null), canvasRef = useRef(null), sceneRef = useRef(null), hideTimer = useRef(0);
  const [size, setSize] = useState({ w: 0, h: 0 }), [hot, setHot] = useState(null);
  const [demo, setDemo] = useState('off'), [weatherDemo, setWeatherDemo] = useState('off'), [showLoc, setShowLoc] = useState(false), [hour, setHour] = useState(null), [full, setFull] = useState(false), [idle, setIdle] = useState(false), [clock, setClock] = useState(() => new Date());
  useEffect(() => { const timer = setInterval(() => setClock(new Date()), 15000); return () => clearInterval(timer); }, []);
  const vent = ctx.airobot?.view?.configured ? ctx.airobot.view : null;
  const forecast = ctx.weather?.view?.weather ?? null, place = ctx.weather?.place ?? null;
  const live = useMemo(() => buildLiveState({ m: ctx.m, climate: ctx.climate, vent, state: pumpState(ctx.m), now: clock, demo, hour, place, forecast, weatherDemo, lux: ctx.lux?.view?.configured ? ctx.lux.view : null }), [ctx.m, ctx.climate, vent, clock, demo, hour, place, forecast, weatherDemo, ctx.lux?.view]);

  useEffect(() => {
    const canvas = canvasRef.current, scene = new LiveScene(canvas);
    sceneRef.current = scene;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    scene.reduced = Boolean(reduce?.matches);
    const fit = () => { const r = viewRef.current.getBoundingClientRect(); setSize({ w: r.width, h: r.height }); scene.resize(r.width, r.height, Math.min(2, window.devicePixelRatio || 1)); if (scene.reduced || !scene.running) scene.frame(performance.now()); };
    const ro = new ResizeObserver(fit); ro.observe(viewRef.current); fit();
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) scene.start(); else scene.stop(); }, { threshold: 0.05 }); io.observe(viewRef.current);
    const onMotion = () => { scene.reduced = Boolean(reduce.matches); };
    reduce?.addEventListener?.('change', onMotion);
    return () => { ro.disconnect(); io.disconnect(); reduce?.removeEventListener?.('change', onMotion); scene.destroy(); };
  }, []);
  useEffect(() => { sceneRef.current?.setHover(hot); }, [hot]);
  useEffect(() => { sceneRef.current?.setState(live); if (sceneRef.current?.reduced) sceneRef.current.frame(performance.now()); }, [live]);
  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  const wake = () => { setIdle(false); clearTimeout(hideTimer.current); if (full) hideTimer.current = setTimeout(() => setIdle(true), 3500); };
  useEffect(() => { wake(); }, [full]);
  const toggleFull = () => { if (document.fullscreenElement) document.exitFullscreen?.(); else stageRef.current?.requestFullscreen?.(); };

  const sun = useMemo(() => sunTimes(live.time, live.place), [live.time.toDateString(), live.place.lat, live.place.lon]);
  const phase = moonPhase(live.time), seasonKey = season(live.time).key;
  const w = live.weather, days = forecast?.days ?? [];
  const summary = `${liveSummary(live)}${w ? `, ilm: ${w.label}` : ''}${live.demo ? ' (demo)' : ''}`;
  const t = v => v == null ? '—' : `${number(v, 1)} °C`;
  // Asukoht protsentides: brauseri mõõtmised on CSS-i suurendusega (zoom) juba skaleeritud, pikslid läheksid topelt suureks.
  const zoomFactor = (typeof document !== 'undefined' && parseFloat(getComputedStyle(document.documentElement).zoom)) || 1;
  const fitScale = size.w ? Math.min(size.w / W, size.h / VIEW.h) : 0, offX = (size.w - W * fitScale) / 2, offY = (size.h - VIEW.h * fitScale) / 2 - VIEW.y * fitScale;
  const kw = v => `${number(v, 1)} kW`;
  const nowText = {
    pump: live.hwOn && live.heatOn ? `Kütab maja ja tarbevett · ${kw(live.powerKw)}` : live.hwOn ? `Soojendab tarbevett · ${kw(live.powerKw)}` : live.heatOn ? `Kütab maja · ${kw(live.powerKw)}` : live.compressor ? `Kompressor töötab · ${kw(live.powerKw)}` : live.heatDemand || live.hwDemand ? 'Ootab käivitamist' : 'Puhkab',
    ground: live.brine.present ? `Alkohol maast ${number(live.brine.in, 1)} °C, maasse ${number(live.brine.out, 1)} °C${live.compressor ? ` · maa andis ${number(live.brine.in - live.brine.out, 1)} K soojust` : ' · kompressor seisab'}` : live.compressor ? 'Kompressor töötab, alkohol võtab maast soojust' : 'Kompressor seisab',
    vent: live.vent.running ? `${live.vent.modeText || 'Töötab'} · kiirus ${live.vent.level}/10 · CO₂ ${live.vent.co2} ppm` : 'Seisab',
    boiler: live.water == null ? '' : `${number(live.water, 1)} °C${live.waterTarget != null ? ` (siht ${number(live.waterTarget, 0)} °C)` : ''}${live.hwOn ? ' · soojeneb' : ''}`
  };
  const targets = Object.entries(HOTSPOTS).filter(([id]) => id !== 'vent' || live.vent.present);
  const hoursValue = hour ?? live.time.getHours() + live.time.getMinutes() / 60;

  return <section className={`live ${embedded ? 'is-embedded' : ''} ${full ? 'is-full' : ''} ${idle ? 'is-idle' : ''}`} aria-label="Elav kodu" onMouseMove={wake} onTouchStart={wake} onKeyDown={wake}>
    <div className="live-stage" ref={stageRef}>
      <div className="live-view" ref={viewRef}>
      <canvas ref={canvasRef} role="img" aria-label={`Elav kodu: ${summary}. Toas ${t(live.indoor)}, väljas ${t(live.outdoor)}, tarbevesi ${t(live.water)}.`}/>
      {fitScale > 0 && !full && <div className="live-hotspots">{targets.map(([id, h]) => {
        const flip = id === 'boiler';
        return <button key={id} type="button" className={`live-hot ${hot === id ? 'hot' : ''} ${flip ? 'flip' : ''}`} style={{ left: `${(offX + h.x * fitScale) / size.w * 100}%`, top: `${(offY + h.y * fitScale) / size.h * 100}%`, width: `${h.w * fitScale / size.w * 100}%`, height: `${h.h * fitScale / size.h * 100}%`, borderRadius: `${h.r * fitScale / zoomFactor}px`, '--hot': h.color }}
          aria-label={`${h.label}. ${nowText[id]}. ${id === 'ground' && live.brine.present ? 'Alkoholi temperatuurid soojuspumbalt.' : h.info} Ava leht ${h.go}.`} onClick={() => ctx.navigate(h.page)} onMouseEnter={() => setHot(id)} onMouseLeave={() => setHot(null)} onFocus={e => e.currentTarget.matches(':focus-visible') && setHot(id)} onBlur={() => setHot(null)}>
          <span className="live-hot-label" role="tooltip"><b>{h.label}</b><em>{nowText[id]}</em><span>{id === 'ground' && live.brine.present ? 'Toru maa sees, kus alkohol võtab maapinnast soojust ja viib selle pumbani. Temperatuurid tulevad soojuspumba enda kohtvõrguliidesest.' : h.info}</span><i>Ava leht: {h.go} <ArrowRight size={12}/></i></span>
        </button>; })}</div>}
      <div className="live-hud live-clock">
        <b>{time(live.time)}</b>
        <span>{dayName.format(live.time).replace(/^./, c => c.toUpperCase())} · {SEASONS[seasonKey]}</span>
        <small className="live-place"><MapPin size={13}/> {live.place.name}</small>
        <small>{sun.rise && <><Sunrise size={13}/> {time(sun.rise)}</>}{sun.set && <> <Sunset size={13}/> {time(sun.set)}</>} <Moon size={13}/> {moonName(phase)} {Math.round(phase.illumination * 100)}%</small>
      </div>
      <ul className="live-hud live-temps" aria-label="Temperatuurid">
        <li><HomeIcon size={15}/><span>Toas</span><b>{t(live.indoor)}</b></li>
        <li><Thermometer size={15}/><span>Väljas</span><b>{t(live.outdoor)}</b></li>
        <li><Droplets size={15}/><span>Tarbevesi</span><b>{t(live.water)}</b></li>
        {w && <li className="live-weather"><CloudRain size={15}/><span>{live.place.name}: {w.label}</span><b>{t(w.temperature)}</b></li>}
      </ul>
      </div>
      <div className="live-bottom">
      {full && <div className="live-hud live-devices" role="group" aria-label="Seadmete seis">
        <div className="live-device"><span className={`live-dot ${live.heatOn || live.hwOn ? 'on' : ''}`}/><div><small><Flame size={13}/> Maasoojuspump</small><b>{nowText.pump}</b><em>Kompressor {live.compressor ? 'töötab' : 'seisab'} · pealevool {t(live.supply)} · tagasivool {t(live.returnT)}</em></div></div>
        {live.vent.present && <div className="live-device"><span className={`live-dot ${live.vent.running ? 'air' : 'off'}`}/><div><small><Fan size={13}/> Ventilatsioon</small><b>{nowText.vent}</b><em>Õhuvool {number(live.vent.airflow, 0)} m³/h{live.vent.supplyTemp != null && ` · sissepuhe ${t(live.vent.supplyTemp)}`}{live.vent.bypass && ' · möödaviik'}</em></div></div>}
        <div className="live-device"><span className={`live-dot ${live.hwOn ? 'on' : ''}`}/><div><small><Droplets size={13}/> Tarbevesi</small><b>{nowText.boiler}</b><em>Toas {t(live.indoor)} · väljas {t(live.outdoor)}</em></div></div>
        {live.demo && <em className="live-demo-tag">DEMO</em>}
      </div>}
      {!full && <div className="live-hud live-status">
        <span className={`live-dot ${live.heatOn || live.hwOn ? 'on' : ''}`}/>
        <div><b>{liveSummary(live).replace(/^./, c => c.toUpperCase())}</b>{live.vent.present && <small><Fan size={12}/> {live.vent.modeText || 'Ventilatsioon'} · kiirus {live.vent.level}/10 · CO₂ {live.vent.co2} ppm</small>}</div>
        {live.demo && <em>DEMO</em>}
      </div>}
      <div className="live-controls">
        {!embedded && <>
        <div className="live-modes" role="group" aria-label="Demo: näita animatsioone">
          {Object.entries(DEMOS).map(([id, label]) => <button key={id} type="button" className={demo === id ? 'selected' : ''} aria-pressed={demo === id} onClick={() => setDemo(id)}>{id === 'heat' ? <Flame size={13}/> : id === 'water' ? <Droplets size={13}/> : id === 'vent' ? <Fan size={13}/> : null}{label}</button>)}
        </div>
        <label className="live-select"><span>Ilm</span><select value={weatherDemo} onChange={e => setWeatherDemo(e.target.value)} aria-label="Ilma demo">{Object.entries(WEATHER_DEMOS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label className="live-scrub"><span>Kellaaeg</span><input type="range" min="0" max="24" step="0.25" value={hoursValue} onChange={e => setHour(Number(e.target.value))} aria-label="Kellaaeg tundides"/><button type="button" onClick={() => setHour(null)} disabled={hour == null}>Praegu</button></label>
        <button type="button" className="live-loc" onClick={() => setShowLoc(!showLoc)} aria-expanded={showLoc}><MapPin size={14}/>{live.place.name}</button>
        </>}
        {embedded && <button type="button" className="live-loc" onClick={() => ctx.navigate('live')}><Sparkles size={14}/>Demo ja ilmaprognoos</button>}
        <button type="button" className="live-full" onClick={toggleFull} aria-label={full ? 'Välju täisekraanist' : 'Täisekraan'} title={full ? 'Välju täisekraanist' : 'Täisekraan'}>{full ? <Minimize2 size={17}/> : <Maximize2 size={17}/>}</button>
      </div>
      </div>
    </div>
    {!embedded && w && <div className="live-forecast" aria-label="Ilm ja prognoos">
      <div className="live-now-weather"><b>{t(w.temperature)}</b><span>{w.label}{w.feelsLike != null && ` · tuntub nagu ${t(w.feelsLike)}`}</span><small><Wind size={13}/> {number(w.windMs, 1)} m/s {compassName(forecast?.windDirection)}{w.humidity != null && ` · niiskus ${Math.round(w.humidity)} %`}{w.demo && ' · DEMO'}</small>{live.outdoor != null && forecast?.temperature != null && Math.abs(live.outdoor - forecast.temperature) >= 3 && !w.demo && <small>Soojuspumba välisandur näitab {t(live.outdoor)} (ilmateenus {t(forecast.temperature)}).</small>}</div>
      {days.slice(0, 4).map((d, i) => <div key={d.date} className="live-day"><small>{i === 0 ? 'Täna' : new Intl.DateTimeFormat('et-EE', { weekday: 'short' }).format(new Date(`${d.date}T12:00:00`))}</small><span>{weatherLabel(d.code)}</span><b>{d.max == null ? '—' : Math.round(d.max)}° <i>{d.min == null ? '' : `${Math.round(d.min)}°`}</i></b>{d.precipitation > 0.2 && <em>{number(d.precipitation, 1)} mm</em>}</div>)}
    </div>}
    {!embedded && showLoc && ctx.weather && <LocationPanel weather={ctx.weather} notify={ctx.notify} compact/>}
    {!embedded && ctx.weather?.view?.error && !forecast && <p className="live-note" role="status">Ilmaandmeid ei õnnestunud laadida ({ctx.weather.view.error}). Vaade töötab ilma ilmata edasi.</p>}
    {!embedded && <p className="live-note">Taevas, päike ja kuu järgivad päris kellaaega sinu asukoha ({live.place.name}) kohal. Akende hõõgus tuleb toatemperatuurist, torude voolud soojuspumba olekust ja võimsusest, õhuvool ventilatsiooni pööretest ning tolm toas CO₂ tasemest. Pilv, vihm, lumi, udu, äike ja tuul tulevad ilmateenusest Open-Meteo sinu asukoha järgi. Demo-nupud, ilma valik ja kellaaja liugur muudavad ainult pilti, mitte seadmeid.</p>}
  </section>;
}
