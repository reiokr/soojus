import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, Bell, Clock3, Droplets, History, LayoutTemplate, Link2, MoreHorizontal, Moon, Monitor, Pencil, RefreshCw, Settings2, SlidersHorizontal, Sun, Thermometer, LayoutDashboard, Waves, Flame, Timer, Repeat2, ArrowUpDown, Fan, Sparkles } from 'lucide-react';
import { api, number, time, enumText, timeTicks } from '../lib.js';
import HousePlan from './HousePlan.jsx';
import { co2Quality, climatePoints, climateQuery } from '../ventilation-logic.js';
import { pumpState, stateSentence, formatDuration, daySummary, subscriptionWarning, secondsAsText } from './logic.js';
import './palette.css';
import './next.css';

const LiveHome = lazy(() => import('./live/LiveHome.jsx'));
const NAV = [['overview', 'Plaan', LayoutDashboard], ['heating', 'Küte', Thermometer], ['water', 'Tarbevesi', Droplets], ['ventilation', 'Ventilatsioon', Fan, 'Õhk'], ['history', 'Ajalugu', History]];
const MORE = [['live', 'Elav kodu', Sparkles], ['parameters', 'Parameetrid', SlidersHorizontal], ['alarms', 'Teavitused', Bell], ['device', 'Minu seade', Monitor], ['settings', 'Seaded ja ühendus', Settings2]];
const TITLES = { overview: 'Kodu plaan', heating: 'Küte', water: 'Tarbevesi', ventilation: 'Ventilatsioon', live: 'Elav kodu', history: 'Ajalugu', parameters: 'Kõik parameetrid', alarms: 'Teavitused', device: 'Minu seade', settings: 'Seaded ja ühendus' };
const SUBTITLES = {
  heating: 'Kütteringi seadistused ja näidud.', water: 'Sooja vee temperatuur ja seadistused.', ventilation: 'Airobot ventilatsiooniseadme näidud ja ajalugu.', history: 'Mõõtmiste ajalugu ja trendid.',
  live: 'Kodu päris andmetega: päike, soojus ja õhk liiguvad.', parameters: 'Kõik seadme API kaudu saadaolevad parameetrid.', alarms: 'Aktiivsed ja varasemad seadme teavitused.', device: 'Ühendus, püsivara ja seadme info.', settings: 'Ühendus, liides ja muudatuste ajalugu.'
};

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Head ööd' : h < 11 ? 'Tere hommikust' : h < 17 ? 'Tere päevast' : h < 22 ? 'Tere õhtust' : 'Head ööd';
}

function useDay(deviceId, tick, enabled) {
  const [day, setDay] = useState(null);
  useEffect(() => {
    if (!deviceId || !enabled) { setDay(null); return; }
    const c = new AbortController(), id = encodeURIComponent(deviceId);
    Promise.all([api(`/history/${id}?hours=24&point=17&raw=1`, { signal: c.signal }), api(`/history/${id}?hours=24&point=0`, { signal: c.signal })]).then(([states, hist]) => {
      const to = Date.now(), from = to - 24 * 3600000;
      const gaps = (hist.gaps || []).map(g => ({ from: Date.parse(g.from), to: Date.parse(g.to) })).filter(g => Number.isFinite(g.from) && g.to > from);
      setDay({ ...daySummary(states.rows, gaps, from, to), gaps, from, to });
    }).catch(() => { if (!c.signal.aborted) setDay(null); });
    return () => c.abort();
  }, [deviceId, tick, enabled]);
  return day;
}

function DayStrip({ day }) {
  const span = day.to - day.from, pct = t => `${Math.min(100, Math.max(0, (t - day.from) / span * 100))}%`;
  const { ticks } = timeTicks(day.from, day.to, 5);
  const kinds = { heat: 'Küte', hw: 'Tarbevesi' };
  return <div className="nx-strip">
    <div className="nx-strip-bar" role="img" aria-label={`Viimased 24 tundi: pump töötas ${formatDuration(day.runMs)}, tarbevee tsükleid ${day.hwCycles}`}>
      {day.gaps.map(g => <i key={`g${g.from}`} className="gap" style={{ left: pct(g.from), width: `calc(${pct(g.to)} - ${pct(g.from)})` }}/>)}
      {day.spans.filter(s => s.kind !== 'idle').map(s => <i key={`${s.kind}${s.from}`} className={s.kind} title={`${kinds[s.kind]} ${time(s.from)}–${time(s.to)}`} style={{ left: pct(s.from), width: `max(3px, calc(${pct(s.to)} - ${pct(s.from)}))` }}/>)}
    </div>
    <div className="nx-strip-ticks" aria-hidden="true">{ticks.map(t => <span key={t} style={{ left: pct(t) }}>{time(t)}</span>)}</div>
    <div className="nx-strip-legend"><span><i className="hw"/>Tarbevee kütmine</span><span><i className="heat"/>Küte</span><span><i className="gap"/>Andmeid ei kogutud</span></div>
  </div>;
}

function Stat({ icon: Icon, label, value, note }) {
  return <div className="nx-stat"><Icon size={18}/><div><small>{label}</small><b>{value}</b>{note && <em>{note}</em>}</div></div>;
}

function Trend({ ctx, initial = 'heat' }) {
  const { HistoryChart } = ctx.parts, { m, points, model, selection, tick, theme, ovHours, pickOvHours } = ctx;
  const heat = [m.supply, m.returnT, m.returnTarget, m.buffer].filter((p, i, l) => p && l.findIndex(x => x?.parameterId === p.parameterId) === i);
  const hasClimate = Boolean(ctx.airobot?.view?.configured && ctx.airobot.view.data && m.outdoor);
  const tabs = [['heat', 'Küte', heat], ['water', 'Tarbevesi', [m.water].filter(Boolean)], ['power', 'Võimsus', [m.power].filter(Boolean)], ...(hasClimate ? [['climate', 'Toas vs väljas', climatePoints]] : [])].filter(t => t[2].length);
  const [tab, setTab] = useState(initial);
  const current = tabs.find(t => t[0] === tab) || tabs[0];
  if (!current) return null;
  const pts = current[2], stateId = model === 'WZSV 92H3M' ? '17' : null;
  const targets = current[0] === 'water' ? ctx.targetLines(points, model, pts.map(p => p.parameterId)) : [];
  return <section className="nx-panel nx-trend">
    <div className="nx-panel-head"><h2>Trend</h2>
      <div className="nx-controls">
        <div className="segmented" role="group" aria-label="Näit">{tabs.map(([id, label]) => <button key={id} type="button" className={current[0] === id ? 'selected' : ''} aria-pressed={current[0] === id} onClick={() => setTab(id)}>{label}</button>)}</div>
        <div className="segmented" role="group" aria-label="Ajavahemik">{[[24, '24 tundi'], [168, 'Nädal'], [720, 'Kuu']].map(([v, l]) => <button key={v} type="button" className={ovHours === v ? 'selected' : ''} aria-pressed={ovHours === v} onClick={() => pickOvHours(v)}>{l}</button>)}</div>
        <button type="button" className="nx-link" onClick={() => ctx.navigate('history')}>Ajalugu <ArrowRight size={14}/></button>
      </div>
    </div>
    <HistoryChart key={current[0]} name={`nx-${current[0]}`} deviceId={current[0] === 'climate' ? 'climate' : selection} extra={current[0] === 'climate' ? climateQuery(selection, m.outdoor.parameterId) : ''} points={pts} defaultHidden={current[0] === 'heat' ? pts.slice(1).map(p => p.parameterId) : []} hours={ovHours} tick={tick} compact theme={theme} stateId={stateId} targets={targets}/>
  </section>;
}

function Overview({ ctx }) {
  const { m, online, stale, activeNotices, subscriptions, model, selection, tick, points, errors, favorites } = ctx;
  const state = pumpState(m);
  const hasState = model === 'WZSV 92H3M';
  const day = useDay(selection, tick, hasState);
  const { view: vent } = ctx.airobot;
  const subs = Array.isArray(subscriptions) ? subscriptions.flatMap(s => s.subscriptions || []) : subscriptions?.subscriptions || [];
  const warning = subscriptionWarning(subs);
  const notes = [];
  if (errors.notices) notes.push({ tone: 'warn', text: 'Häirete olek pole hetkel saadaval.' });
  else if (activeNotices.length) notes.push({ tone: 'warn', text: `Aktiivseid häireid: ${activeNotices.length}.`, action: ['Vaata', 'alarms'] });
  if (stale) notes.push({ tone: 'warn', text: 'Seadme mõõtmised on vanemad kui 15 minutit.' });
  const lastError = ctx.lux?.view?.errors?.[0];
  const errorAcked = lastError && ctx.lux.view.errorsAck && Date.parse(lastError.time) <= Date.parse(ctx.lux.view.errorsAck);
  const hideError = async () => { try { ctx.lux.setView(await api('/luxtronik/errors/ack', { method: 'POST', body: '{}' })); } catch (e) { ctx.notify?.(e.message, true); } };
  if (lastError && !errorAcked && Date.now() - Date.parse(lastError.time) < 24 * 3600000) notes.push({ dismiss: hideError, tone: 'warn', text: `Pump andis veakoodi ${lastError.code} (${lastError.name}) kell ${time(lastError.time)}${ctx.lux.view.errors7d > 1 ? `; viimase 7 päeva jooksul ${ctx.lux.view.errors7d} korda` : ''}.`, action: ['Vaata', 'settings'] });
  if (vent?.configured && vent.data) {
    if (vent.data.switches.filterAlert) notes.push({ tone: 'warn', text: 'Ventilatsiooni filter vajab vahetust.', action: ['Ventilatsioon', 'ventilation'] });
    else if (vent.errors.length) notes.push({ tone: 'warn', text: `Ventilatsiooni viga: ${vent.errors.join(', ')}.`, action: ['Ventilatsioon', 'ventilation'] });
    else if (['high', 'bad'].includes(co2Quality(vent.data.co2).key)) notes.push({ tone: 'warn', text: `CO₂ on kõrge (${vent.data.co2} ppm).`, action: ['Ventilatsioon', 'ventilation'] });
  } else if (vent?.configured && vent.error) notes.push({ tone: 'warn', text: 'Ventilatsiooniseadmega puudub ühendus.', action: ['Ventilatsioon', 'ventilation'] });
  if (warning) notes.push({ tone: 'warn', text: warning.days > 0 ? `${warning.name} kehtib veel ${warning.days} päeva.` : `${warning.name} on aegunud.`, action: ['Minu seade', 'device'] });
  const dT = m.supply?.value != null && m.returnT?.value != null ? Number(m.supply.value) - Number(m.returnT.value) : null;
  return <>
    <section className="nx-hero">
      <div>
        <p className="nx-eyebrow">{greeting()}</p>
        <h2>{stateSentence(state, online)}</h2>
        <p className="nx-lead">{ctx.climate.indoor != null ? `Toas ${number(ctx.climate.indoor, 1)} °C · ` : ''}väljas {number(ctx.climate.outdoor, 1)} °C · tarbevesi {number(m.water?.value, 1)} °C{Number.isFinite(m.waterTarget) ? ` (siht ${number(m.waterTarget, 0)} °C)` : ''}{m.power?.value > 0 ? ` · võimsus ${number(m.power.value, 1)} kW` : ''}.</p>
      </div>
      {notes.length > 0 ? <ul className="nx-notes">{notes.map((n, i) => <li key={i} className={n.tone}><AlertCircle size={16}/><span>{n.text}</span>{n.dismiss && <button type="button" className="nx-link nx-dismiss" onClick={n.dismiss} aria-label="Peida see veateade (logi jääb Seadetesse)">Peida</button>}{n.action && <button type="button" className="nx-link" onClick={() => ctx.navigate(n.action[1])}>{n.action[0]} <ArrowRight size={13}/></button>}</li>)}</ul> : <p className="nx-allgood"><i/>Häireid ei ole, andmed on värsked.</p>}
    </section>
    <div className="nx-overview">
    <Suspense fallback={<section className="nx-panel"><div className="nx-skeleton"><i/></div></section>}><LiveHome ctx={ctx} embedded/></Suspense>
    <section className="nx-panel nx-today">
      <div className="nx-panel-head"><h2>Viimased 24 tundi</h2>{day && day.coverage < .9 && <span className="nx-muted">Andmeid on {Math.round(day.coverage * 100)}% ajast</span>}</div>
      {hasState ? day ? <>
        <div className="nx-stats">
          <Stat icon={Timer} label="Pump töötas" value={formatDuration(day.runMs)} note={day.coverage < .9 ? 'vähemalt' : undefined}/>
          <Stat icon={Repeat2} label="Tarbevee tsükleid" value={number(day.hwCycles, 0)} note={day.hwMs ? `kokku ${formatDuration(day.hwMs)}` : undefined}/>
          <Stat icon={Flame} label="Kütmine" value={formatDuration(day.heatMs)}/>
          <Stat icon={ArrowUpDown} label="Pealevool − tagasivool" value={dT == null ? '—' : `${number(dT, 1)} °C`} note="praegu"/>
        </div>
        <DayStrip day={day}/>
      </> : <p className="nx-muted">Laadin ööpäeva kokkuvõtet…</p> : <p className="nx-muted">Ööpäeva kokkuvõte on praegu saadaval ainult mudelile WZSV 92H3M.</p>}
    </section>
    </div>
    <Trend ctx={ctx}/>
    {favorites.length > 0 && <section className="nx-panel"><div className="nx-panel-head"><h2>Lemmiknäidud</h2></div><div className="nx-tiles">{points.filter(p => favorites.includes(`${selection}:${p.parameterId}`)).map(p => <Tile key={p.parameterId} point={p}/>)}</div></section>}
  </>;
}

function Tile({ point }) {
  const text = point.enumValues?.length || (typeof point.value === 'string' && !Number.isFinite(Number(point.value))) ? point.display : `${number(point.value, 2)} ${point.parameterUnit || ''}`;
  return <div className="nx-tile"><small>{point.label}</small><b>{text}</b><em>{time(point.timestamp)}</em></div>;
}

function valueText(p) {
  if (p.enumValues?.length) return p.display;
  if (p.parameterId === '6147') return secondsAsText(p.value);
  return `${number(p.value)} ${p.parameterUnit || ''}`.trim();
}
function hintText(p) {
  if (p.enumValues?.length) return `${p.enumValues.length} valikut`;
  if (p.parameterId === '6147') return 'samm 30 min';
  return `${number(p.min)}–${number(p.max)} ${p.parameterUnit || ''} · samm ${number(p.step, 3)}`.replace(/\s+/g, ' ');
}

function Control({ ctx, water }) {
  const { points, zones, online, setEditing, categories, mode, errors, m } = ctx;
  const group = water ? 'Tarbevesi' : 'Küte';
  const writable = points.filter(p => p.group === group && p.writable);
  const readings = points.filter(p => p.group === group && !p.writable);
  const lt = ctx.lux?.view?.data?.temperatures, cl = ctx.climate, extra = water ? [] : [lt?.brineIn != null && { label: 'Alkohol maast', value: `${number(lt.brineIn, 1)} °C` }, lt?.brineOut != null && { label: 'Alkohol maasse', value: `${number(lt.brineOut, 1)} °C` }, lt?.hotGas != null && { label: 'Kuumgaas', value: `${number(lt.hotGas, 1)} °C` }, cl.indoor != null && { label: 'Sisetemperatuur (ventilatsioon)', value: `${number(cl.indoor, 1)} °C` }, cl.outdoor != null && { label: `Välisõhk (${cl.outdoorSource})`, value: `${number(cl.outdoor, 1)} °C` }].filter(Boolean);
  const waterZones = water ? zones : [];
  const state = pumpState(m);
  return <>
    <div className="nx-split">
      <section className="nx-panel nx-plan-card small nx-a-plan">
        <HousePlan view={water ? 'water' : 'heat'} {...m} state={state} onOpen={ctx.navigate}/>
      </section>
      {(readings.length > 0 || extra.length > 0) && <section className="nx-panel nx-a-read"><div className="nx-panel-head"><h2>Näidud</h2><span className="nx-muted">Seadme raporteeritud väärtused</span></div><div className="nx-tiles">{extra.map(e => <div key={e.label} className="nx-tile"><small>{e.label}</small><b>{e.value}</b><em>praegu</em></div>)}{readings.map(p => <Tile key={p.parameterId} point={p}/>)}</div></section>}
      <section className="nx-panel nx-a-set">
        <div className="nx-panel-head"><h2>Seadistused</h2><span className="nx-muted">{writable.length + waterZones.length + (!water && categories['sh-smartMode'] ? 1 : 0)} muudetavat</span></div>
        <ul className="nx-rows">
          {writable.map(p => <li key={p.parameterId}><div><b>{p.label}</b><small>{hintText(p)}</small></div><strong>{valueText(p)}</strong><button type="button" className="nx-edit" disabled={!online} onClick={() => setEditing({ type: 'point', point: p })} aria-label={`Muuda: ${p.label}`}><Pencil size={15}/>Muuda</button></li>)}
          {!water && categories['sh-smartMode'] && <li><div><b>Kodurežiim</b><small>Kogu kodu režiim</small></div><strong>{enumText(mode)}</strong><button type="button" className="nx-edit" disabled={!online} onClick={() => setEditing({ type: 'mode', mode })} aria-label="Muuda kodurežiimi"><Pencil size={15}/>Muuda</button></li>}
          {waterZones.map(z => <li key={z.zoneId}><div><b>{z.name}</b><small>{z.commandOnly ? 'Ainult käsklused' : `Hetkel ${number(z.temperature)} °${z.isCelsius ? 'C' : 'F'}`}</small></div><strong>{enumText(z.mode)}{!z.commandOnly && z.setpointHeat != null ? ` · siht ${number(z.setpointHeat)} °` : ''}</strong><button type="button" className="nx-edit" disabled={!online} onClick={() => setEditing({ type: 'zone', zone: z })} aria-label={`Tsooni seadistused: ${z.name}`}><Pencil size={15}/>Muuda</button></li>)}
        </ul>
        {!writable.length && !waterZones.length && <p className="nx-muted">Selles valdkonnas ei paku seade avaliku API kaudu muudetavaid seadistusi.</p>}
        {water && errors.zones && <p className="nx-warn"><AlertCircle size={15}/>Tsoonid: {errors.zones}</p>}
      </section>
    </div>
    <Trend ctx={ctx} initial={water ? 'water' : 'heat'}/>
  </>;
}

export default function NextUI({ ctx }) {
  const { page, navigate, status, systems, selection, setSelection, device, model, system, activeNotices, errors, loading, refreshing, lastFetch, online, stale, theme, setTheme, setUi, parts, shared, rawCount } = ctx;
  const [more, setMore] = useState(false);
  const moreRef = useRef(null);
  useEffect(() => {
    if (!more) return;
    const close = e => { if (!moreRef.current?.contains(e.target) && !e.target.closest?.('.nx-dock, .nx-sheet')) setMore(false); };
    const esc = e => { if (e.key === 'Escape') setMore(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [more]);
  const go = id => { setMore(false); navigate(id); };
  const { Empty, Button } = parts;
  const standalone = page === 'settings' || page === 'ventilation';
  const notConnected = !standalone && (!status?.connected || !device) && !loading;
  const inMore = MORE.some(([id]) => id === page);
  let body;
  if (notConnected) body = <section className="nx-panel"><Empty icon={Link2} title={status?.connected ? 'Kontol pole seadmeid' : 'Sinu kodu ootab ühendamist'} action={<Button kind="primary" icon={ArrowRight} onClick={() => go('settings')}>Ava ühenduse seaded</Button>}>Ühenda myUplinki konto, et näha soojuspumba tegelikke näite.</Empty></section>;
  else if (loading && !standalone) body = <div className="nx-skeleton" aria-label="Laadin seadme andmeid"><i/><i/><i/></div>;
  else body = <>
    {page === 'overview' && <Overview ctx={ctx}/>}
    {(page === 'heating' || page === 'water') && <Control ctx={ctx} water={page === 'water'} key={page}/>}
    {page === 'ventilation' && <parts.VentilationPage tick={ctx.tick} theme={theme} HistoryChart={parts.HistoryChart} notify={ctx.notify} airobot={ctx.airobot} outdoor={ctx.m.outdoor?.value} pumpDeviceId={selection} outdoorPointId={ctx.m.outdoor?.parameterId}/>}
    {page === 'live' && <Suspense fallback={<div className="nx-skeleton"><i/></div>}><LiveHome ctx={ctx}/></Suspense>}
    {page === 'history' && <parts.HistoryPage deviceId={selection} points={ctx.points} tick={ctx.tick} theme={theme} model={model} stateId={model === 'WZSV 92H3M' ? '17' : null} ventPoints={ctx.airobot?.view?.configured && ctx.airobot.view.data ? ctx.airobot.view.points : []} luxPoints={ctx.lux?.view?.configured && ctx.lux.view.data ? ctx.lux.view.points : []}/>}
    {page === 'parameters' && <parts.Parameters {...shared} search={ctx.search} setSearch={ctx.setSearch} favorites={ctx.favorites} favorite={ctx.favorite}/>}
    {page === 'alarms' && <parts.AlarmsPage systemId={system?.systemId} tick={ctx.tick}/>}
    {page === 'device' && <parts.DevicePage {...shared} firmware={ctx.firmware} aid={ctx.aid} subscriptions={ctx.subscriptions}/>}
    {page === 'settings' && <parts.SettingsPage status={status} notify={ctx.notify} onConnect={ctx.bootstrap} tick={ctx.tick} navigate={navigate} ui="next" setUi={setUi} weather={ctx.weather} lux={ctx.lux}/>}
  </>;
  return <div className="nx" data-page={page}>
    <header className="nx-top">
      <a className="nx-brand" href="/" onClick={e => { e.preventDefault(); go('overview'); }}><Waves size={22}/><span>soojus<i>.</i></span></a>
      <nav className="nx-tabs" aria-label="Põhinavigatsioon">
        {NAV.map(([id, label, Icon]) => <button key={id} type="button" className={page === id ? 'active' : ''} aria-current={page === id ? 'page' : undefined} onClick={() => go(id)}><Icon size={17}/>{label}</button>)}
        <div className="nx-more" ref={moreRef}>
          <button type="button" className={inMore ? 'active' : ''} aria-expanded={more} aria-haspopup="menu" onClick={() => setMore(!more)}><MoreHorizontal size={17}/>Veel{activeNotices.length > 0 && <b className="nx-count">{activeNotices.length}</b>}</button>
          {more && <div className="nx-menu" role="menu">{MORE.map(([id, label, Icon]) => <button key={id} role="menuitem" type="button" className={page === id ? 'active' : ''} onClick={() => go(id)}><Icon size={16}/>{label}{id === 'alarms' && activeNotices.length > 0 && <b className="nx-count">{activeNotices.length}</b>}</button>)}</div>}
        </div>
      </nav>
      <div className="nx-tools">
        {systems.length > 1 && <select aria-label="Vali soojuspump" value={selection} onChange={e => setSelection(e.target.value)}>{systems.flatMap(s => (s.devices || []).map(d => <option key={d.id} value={d.id}>{s.name} · {d.product?.name}</option>))}</select>}
        <span className={`nx-status ${online && !stale ? 'ok' : 'warn'}`}><i/>{online ? stale ? 'Vanad näidud' : 'Võrgus' : 'Võrguühenduseta'}</span>
        <button type="button" className="nx-icon" aria-label="Värskenda andmeid" onClick={() => selection ? ctx.refresh() : ctx.bootstrap()}><RefreshCw size={17} className={refreshing ? 'spin' : ''}/></button>
        <button type="button" className="nx-icon" aria-label={theme === 'dark' ? 'Lülita hele teema' : 'Lülita tume teema'} aria-pressed={theme === 'dark'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={17}/> : <Moon size={17}/>}</button>
        <button type="button" className="nx-icon" aria-label="Lülita klassikaline liides" title="Klassikaline liides" onClick={() => setUi('classic')}><LayoutTemplate size={17}/></button>
        <button type="button" className="nx-icon bell" aria-label="Vaata teavitusi" onClick={() => go('alarms')}><Bell size={17}/>{activeNotices.length > 0 && <i/>}</button>
      </div>
    </header>
    <main className="nx-main" id="main">
      {page !== 'overview' && <div className="nx-title"><h1>{TITLES[page]}</h1><p>{SUBTITLES[page]}</p></div>}
      {page === 'overview' && <h1 className="nx-sr">{TITLES.overview}</h1>}
      {(errors.global || errors.points) && <div role="alert" className="nx-banner error"><AlertCircle size={18}/><span>{errors.global || errors.points} {rawCount > 0 && 'Kuvatud on viimased kättesaadavad näidud.'}</span><Button onClick={ctx.bootstrap}>Proovi uuesti</Button></div>}
      {stale && page !== 'overview' && <div className="nx-banner"><Clock3 size={18}/><span>Seadme viimased mõõtmised on vanemad kui 15 minutit.</span></div>}
      {body}
      <footer className="nx-foot"><span><Waves size={13}/> soojus · {model}</span><span>Andmed: {ctx.lux?.view?.primary ? `soojuspump otse kohtvõrgust, myUplink varuks${ctx.lux.view.upstreamProblem ? ' (praegu ei vasta)' : ''}` : 'myUplink Public API'} · {lastFetch ? `viimane päring ${time(lastFetch)}` : 'serveripoolne ühendus'}</span></footer>
    </main>
    <nav className="nx-dock" aria-label="Kiirnavigatsioon">
      {NAV.map(([id, label, Icon, short]) => <button key={id} type="button" className={page === id ? 'active' : ''} onClick={() => go(id)}><Icon size={21}/><span>{short || label}</span></button>)}
      <button type="button" className={inMore || more ? 'active' : ''} aria-expanded={more} onClick={() => setMore(!more)}><MoreHorizontal size={21}/><span>Veel</span></button>
    </nav>
    {more && <div className="nx-sheet" role="menu">{MORE.map(([id, label, Icon]) => <button key={id} role="menuitem" type="button" onClick={() => go(id)}><Icon size={18}/>{label}{id === 'alarms' && activeNotices.length > 0 && <b className="nx-count">{activeNotices.length}</b>}</button>)}</div>}
  </div>;
}
