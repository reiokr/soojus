import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Activity, AlertCircle, ArrowRight, BarChart3, Bell, Check, ChevronDown, Clock3, Droplets, Globe, History, LayoutTemplate, Link2, MoreHorizontal, Moon, Monitor, Pencil, RefreshCw, Settings2, SlidersHorizontal, Sun, Thermometer, LayoutDashboard, Waves, Flame, Timer, Repeat2, ArrowUpDown, Fan, Sparkles, ChartLine } from 'lucide-react';
import { api, number, time, enumText, timeTicks } from '../lib.js';
import { t, LOCALES, setLocale, getLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.js';
import HousePlan from './HousePlan.jsx';
const EnergyPage = lazy(() => import('./energy.jsx'));
const HeatingCurvePage = lazy(() => import('./curve.jsx'));
import { co2Quality, climatePoints, climateQuery, readingQuality } from '../ventilation-logic.js';
import { pumpState, formatDuration, daySummary, secondsAsText, dhwQuality, bufferQuality } from './logic.js';
import { buildReportModel, buildReportHtml, buildReportText, buildReportDocument } from './error-report.js';
import './palette.css';
import './next.css';

const LiveHome = lazy(() => import('./live/LiveHome.jsx'));
const NAV = [['overview', 'nav.overview', LayoutDashboard], ['heating', 'nav.heating', Thermometer], ['water', 'nav.water', Droplets], ['ventilation', 'nav.ventilation', Fan, 'nav.air'], ['history', 'nav.history', History]];
const MORE = [['live', 'nav.live', Sparkles], ['energy', 'nav.energy', BarChart3], ['curve', 'nav.curve', ChartLine], ['parameters', 'nav.parameters', SlidersHorizontal], ['alarms', 'nav.alarms', Bell], ['analysis', 'nav.analysis', Activity], ['device', 'nav.device', Monitor], ['settings', 'nav.settings', Settings2]];
const TITLES = { overview: 'titles.overview', heating: 'titles.heating', water: 'titles.water', ventilation: 'titles.ventilation', live: 'titles.live', history: 'titles.history', energy: 'titles.energy', curve: 'titles.curve', parameters: 'titles.parameters', alarms: 'titles.alarms', analysis: 'titles.analysis', device: 'titles.device', settings: 'titles.settings' };
const SUBTITLES = {
  heating: 'subtitles.heating', water: 'subtitles.water', ventilation: 'subtitles.ventilation', history: 'subtitles.history',
  live: 'subtitles.live', energy: 'subtitles.energy', curve: 'subtitles.curve', parameters: 'subtitles.parameters', alarms: 'subtitles.alarms', analysis: 'subtitles.analysis', device: 'subtitles.device', settings: 'subtitles.settings'
};

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
  const kinds = { heat: t('overview.stripHeat'), hw: t('overview.stripWater') };
  return <div className="nx-strip">
    <div className="nx-strip-bar" role="img" aria-label={t('overview.stripAria', { duration: formatDuration(day.runMs), cycles: day.hwCycles })}>
      {day.gaps.map(g => <i key={`g${g.from}`} className="gap" style={{ left: pct(g.from), width: `calc(${pct(g.to)} - ${pct(g.from)})` }}/>)}
      {day.spans.filter(s => s.kind !== 'idle').map(s => <i key={`${s.kind}${s.from}`} className={s.kind} title={`${kinds[s.kind]} ${time(s.from)}–${time(s.to)}`} style={{ left: pct(s.from), width: `max(3px, calc(${pct(s.to)} - ${pct(s.from)}))` }}/>)}
    </div>
    <div className="nx-strip-ticks" aria-hidden="true">{ticks.map(t => <span key={t} style={{ left: pct(t) }}>{time(t)}</span>)}</div>
    <div className="nx-strip-legend"><span><i className="hw"/>{t('overview.stripWater')}</span><span><i className="heat"/>{t('overview.stripHeat')}</span><span><i className="gap"/>{t('overview.stripGap')}</span></div>
  </div>;
}

function Stat({ icon: Icon, label, value, note }) {
  return <div className="nx-stat"><Icon size={18}/><div><small>{label}</small><b>{value}</b>{note && <em>{note}</em>}</div></div>;
}

function Trend({ ctx, initial = 'heat' }) {
  const { HistoryChart } = ctx.parts, { m, points, model, selection, tick, theme, ovHours, pickOvHours } = ctx;
  const heat = [m.supply, m.returnT, m.returnTarget, m.buffer].filter((p, i, l) => p && l.findIndex(x => x?.parameterId === p.parameterId) === i);
  const hasClimate = Boolean(ctx.airobot?.view?.configured && ctx.airobot.view.data && m.outdoor);
  const tabs = [['heat', 'overview.metricHeat', heat], ['water', 'overview.metricWater', [m.water].filter(Boolean)], ['power', 'overview.metricPower', [m.power].filter(Boolean)], ...(hasClimate ? [['climate', 'overview.metricClimate', climatePoints()]] : [])].filter(x => x[2].length);
  const [tab, setTab] = useState(initial);
  const current = tabs.find(t => t[0] === tab) || tabs[0];
  if (!current) return null;
  const pts = current[2], stateId = model === 'WZSV 92H3M' ? '17' : null;
  const targets = current[0] === 'water' ? ctx.targetLines(points, model, pts.map(p => p.parameterId)) : [];
  return <section className="nx-panel nx-trend">
    <div className="nx-panel-head"><h2>{t('overview.trend')}</h2>
      <div className="nx-controls">
        <div className="segmented" role="group" aria-label={t('overview.metricLabel')}>{tabs.map(([id, label]) => <button key={id} type="button" className={current[0] === id ? 'selected' : ''} aria-pressed={current[0] === id} onClick={() => setTab(id)}>{t(label)}</button>)}</div>
        <div className="segmented" role="group" aria-label={t('overview.periodLabel')}>{[[24, 'overview.periodDay'], [168, 'overview.periodWeek'], [720, 'overview.periodMonth']].map(([v, l]) => <button key={v} type="button" className={ovHours === v ? 'selected' : ''} aria-pressed={ovHours === v} onClick={() => pickOvHours(v)}>{t(l)}</button>)}</div>
        <button type="button" className="nx-link" onClick={() => ctx.navigate('history')}>{t('overview.openHistory')} <ArrowRight size={14}/></button>
      </div>
    </div>
    <HistoryChart key={current[0]} name={`nx-${current[0]}`} deviceId={current[0] === 'climate' ? 'climate' : selection} extra={current[0] === 'climate' ? climateQuery(selection, m.outdoor.parameterId) : ''} points={pts} defaultHidden={current[0] === 'heat' ? pts.slice(1).map(p => p.parameterId) : []} hours={ovHours} tick={tick} compact theme={theme} stateId={stateId} targets={targets}/>
  </section>;
}

// Peidetud teated jäävad brauserisse meelde: teade tuleb tagasi alles siis, kui selle sisu muutub oluliselt (nt häirete arv, tähtaeg lähenes või filter vajab vahetust).
const HIDDEN_KEY = 'soojus.notes.hidden';
function useHiddenNotes() {
  const [hidden, setHidden] = useState(() => { try { const v = JSON.parse(localStorage.getItem(HIDDEN_KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } });
  const save = next => { setHidden(next); try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(next)); } catch { /* privaatne režiim */ } };
  return [hidden, save];
}

// Kodu lehe teated (häired, vananenud andmed, filter, tähtaeg jne). Kasutab ka Teavituste leht, kus peidetud teateid saab uuesti nähtavale tuua.
function usePlanNotes(ctx) {
  const { online, stale, activeNotices, errors } = ctx;
  const { view: vent } = ctx.airobot;
  const [hiddenNotes, setHiddenNotes] = useHiddenNotes(), notes = [];
  if (!online) notes.push({ id: 'offline', sig: 'offline', tone: 'warn', text: t('overview.offline') });
  if (errors.notices) notes.push({ id: 'notices', sig: 'unavailable', tone: 'warn', text: t('overview.noticesUnavailable') });
  else if (activeNotices.length) notes.push({ id: 'notices', sig: String(activeNotices.length), tone: 'warn', text: t('overview.activeNotices', { count: activeNotices.length }), action: [t('overview.view'), 'alarms'] });
  if (stale) notes.push({ id: 'stale', sig: 'stale', tone: 'warn', text: t('overview.stale') });
  const lastError = ctx.lux?.view?.errors?.[0];
  const errorAcked = lastError && ctx.lux.view.errorsAck && Date.parse(lastError.time) <= Date.parse(ctx.lux.view.errorsAck);
  const hideError = async () => { try { ctx.lux.setView(await api('/luxtronik/errors/ack', { method: 'POST', body: '{}' })); } catch (e) { ctx.notify?.(e.message, true); } };
  if (lastError && !errorAcked && Date.now() - Date.parse(lastError.time) < 24 * 3600000) notes.push({ custom: true, dismiss: hideError, tone: 'warn', text: t('overview.errorCode', { code: lastError.code, name: lastError.name, time: time(lastError.time) }) + (ctx.lux.view.errors7d > 1 ? t('overview.error7d', { count: ctx.lux.view.errors7d }) : ''), action: [t('overview.view'), 'settings'] });
  if (vent?.configured && vent.data) {
    if (vent.data.switches.filterAlert) notes.push({ id: 'vent', sig: 'filter', tone: 'warn', text: t('overview.ventFilter'), action: [t('nav.ventilation'), 'ventilation'] });
    else if (vent.errors.length) notes.push({ id: 'vent', sig: `error:${vent.errors.join(',')}`, tone: 'warn', text: t('overview.ventError', { errors: vent.errors.join(', ') }), action: [t('nav.ventilation'), 'ventilation'] });
    else if (['high', 'bad'].includes(co2Quality(vent.data.co2).key)) notes.push({ id: 'vent', sig: `co2:${co2Quality(vent.data.co2).key}`, tone: 'warn', text: t('overview.co2High', { value: vent.data.co2 }), action: [t('nav.ventilation'), 'ventilation'] });
  } else if (vent?.configured && vent.error) notes.push({ id: 'vent', sig: 'offline', tone: 'warn', text: t('overview.ventOffline'), action: [t('nav.ventilation'), 'ventilation'] });
  const list = notes.map(n => ({ ...n, hidden: !n.custom && hiddenNotes[n.id] === n.sig }));
  const hide = n => { if (n.custom) n.dismiss(); else setHiddenNotes({ ...hiddenNotes, [n.id]: n.sig }); };
  const show = n => { const rest = { ...hiddenNotes }; delete rest[n.id]; setHiddenNotes(rest); };
  return { notes: list, hide, show };
}

function PlanNotes({ ctx }) {
  const { notes, hide, show } = usePlanNotes(ctx);
  return <section className="nx-panel nx-plannotes">
    <div className="nx-panel-head"><h2>{t('nav.overview')}</h2></div>
    {notes.length > 0 ? <ul className="nx-notes">{notes.map((n, i) => <li key={n.id ?? i} className={n.tone}><AlertCircle size={16}/><span>{n.text}{n.hidden && <em className="nx-hiddentag"> · {t('overview.hidden')}</em>}</span>{n.action && <button type="button" className="nx-link" onClick={() => ctx.navigate(n.action[1])}>{n.action[0]} <ArrowRight size={13}/></button>}<button type="button" className="nx-link" onClick={() => n.hidden ? show(n) : hide(n)}>{n.hidden ? t('overview.show') : t('overview.hide')}</button></li>)}</ul> : <p className="nx-muted">—</p>}
    
  </section>;
}

// "Kõik korras" teade tõmbub mõne sekundi pärast kokku väikeseks pulseerivaks täpiks.
// Täppi klõpsates saab teksti uuesti mõneks sekundiks nähtavale tuua.
function AllGood({ text }) {
  const [open, setOpen] = useState(true);
  const timer = useRef(null);
  const arm = ms => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), ms); };
  useEffect(() => { arm(5000); return () => clearTimeout(timer.current); }, []);
  const expand = () => { setOpen(true); arm(7000); };
  return <div className={`nx-goodwrap ${open ? 'open' : 'closed'}`}>
    <p className="nx-allgood" role="status" aria-live="polite"><i/>{text}</p>
    <button type="button" className="nx-good-dot" aria-label={text} title={text} aria-hidden={open} tabIndex={open ? -1 : 0} onClick={expand}><i/></button>
  </div>;
}

function Overview({ ctx }) {
  const { m, model, selection, tick, points, favorites } = ctx;
  const state = pumpState(m);
  const hasState = model === 'WZSV 92H3M';
  const day = useDay(selection, tick, hasState);
  const { notes, hide } = usePlanNotes(ctx), shownNotes = notes.filter(n => !n.hidden);
  const dT = m.supply?.value != null && m.returnT?.value != null ? Number(m.supply.value) - Number(m.returnT.value) : null;
  return <>
    <section className="nx-hero">
      {shownNotes.length > 0 ? <ul className="nx-notes">{shownNotes.map((n, i) => <li key={n.id ?? i} className={n.tone}><AlertCircle size={16}/><span>{n.text}</span><button type="button" className="nx-link nx-dismiss" onClick={() => hide(n)} aria-label={n.custom ? t('overview.hideError') : t('overview.hideNote', { text: n.text })}>{t('overview.hide')}</button>{n.action && <button type="button" className="nx-link" onClick={() => ctx.navigate(n.action[1])}>{n.action[0]} <ArrowRight size={13}/></button>}</li>)}</ul> : notes.length === 0 && <AllGood text={t('overview.allgood')}/>}
    </section>
    <div className="nx-overview">
    <Suspense fallback={<section className="nx-panel"><div className="nx-skeleton"><i/></div></section>}><LiveHome ctx={ctx} embedded/></Suspense>
    <section className="nx-panel nx-today">
      <div className="nx-panel-head"><h2>{t('overview.today')}</h2>{day && day.coverage < .9 && <span className="nx-muted">{t('overview.coverage', { percent: Math.round(day.coverage * 100) })}</span>}</div>
      {hasState ? day ? <>
        <div className="nx-stats">
          <Stat icon={Timer} label={t('overview.pumpWorked')} value={formatDuration(day.runMs)} note={day.coverage < .9 ? t('overview.atLeast') : undefined}/>
          <Stat icon={Repeat2} label={t('overview.hwCycles')} value={number(day.hwCycles, 0)} note={day.hwMs ? t('overview.total', { duration: formatDuration(day.hwMs) }) : undefined}/>
          <Stat icon={Flame} label={t('overview.heating')} value={formatDuration(day.heatMs)}/>
          <Stat icon={ArrowUpDown} label={t('overview.delta')} value={dT == null ? '—' : `${number(dT, 1)} °C`} note={t('overview.now')}/>
        </div>
        <DayStrip day={day}/>
      </> : <p className="nx-muted">Laadin ööpäeva kokkuvõtet…</p> : <p className="nx-muted">Ööpäeva kokkuvõte on praegu saadaval ainult mudelile WZSV 92H3M.</p>}
    </section>
    </div>
    <Trend ctx={ctx}/>
    {favorites.length > 0 && <section className="nx-panel"><div className="nx-panel-head"><h2>{t('overview.favorites')}</h2></div><div className="nx-tiles">{points.filter(p => favorites.includes(`${selection}:${p.parameterId}`)).map(p => <Tile key={p.parameterId} point={p}/>)}</div></section>}
  </>;
}

const anDate = iso => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleString(getLocale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; };

function ErrorAnalysis({ ctx }) {
  const [days, setDays] = useState(90), [data, setData] = useState(null), [error, setError] = useState(null), [code, setCode] = useState(null), [notes, setNotes] = useState('');
  useEffect(() => {
    let live = true; setError(null);
    api(`/analysis/errors?days=${days}`).then(d => {
      if (!live) return;
      setData(d); setCode(c => (c && d.codes.some(x => x.code === c) ? c : d.codes[0]?.code ?? null));
    }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [days]);
  const period = <div className="segmented" role="group" aria-label={t('an.period')}>{[[30, t('an.d30')], [90, t('an.d90')], [365, t('an.d365')]].map(([v, l]) => <button key={v} type="button" className={days === v ? 'selected' : ''} aria-pressed={days === v} onClick={() => setDays(v)}>{l}</button>)}</div>;
  if (error) return <section className="nx-panel"><div className="nx-panel-head"><h2>{t('an.title')}</h2>{period}</div><p className="nx-warn"><AlertCircle size={15}/>{error}</p></section>;
  if (!data) return <div className="nx-skeleton" aria-label={t('an.loading')}><i/><i/><i/></div>;
  const cmp = data.compare.find(c => c.code === code);
  const total = data.codes.reduce((n, c) => n + c.n, 0);
  const counts = Object.fromEntries(data.daily.map(d => [d.day, d.n]));
  const series = [];
  for (let d = new Date(data.from); d.getTime() <= Date.now(); d.setDate(d.getDate() + 1)) series.push({ day: d.toISOString().slice(0, 10), n: counts[d.toISOString().slice(0, 10)] || 0 });
  const max = Math.max(1, ...series.map(d => d.n));
  const cmpN = cmp ? Math.max(0, ...Object.values(cmp.params).map(v => v?.n || 0)) : 0;
  const device = { model: ctx?.model, serial: ctx?.device?.product?.serialNumber, firmware: ctx?.firmware?.currentFwVersion };
  const model = buildReportModel({ data, code, device, notes, now: new Date() });
  const reportHtml = buildReportHtml(model);
  const reportText = buildReportText(model);
  const reportDoc = buildReportDocument(model);
  const copyReport = async () => {
    try {
      if (navigator.clipboard?.write && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([reportDoc], { type: 'text/html' }), 'text/plain': new Blob([reportText], { type: 'text/plain' }) })]);
      } else await navigator.clipboard.writeText(reportText);
      ctx?.notify?.(t('an.copied'));
    } catch { ctx?.notify?.(t('an.copyFailed'), true); }
  };
  const downloadReport = () => {
    const url = URL.createObjectURL(new Blob([reportDoc], { type: 'text/html;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `soojus-vigade-raport-${new Date().toISOString().slice(0, 10)}.html`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const printReport = () => {
    const w = window.open('', '_blank'); if (!w) return;
    w.document.write(reportDoc); w.document.close(); w.focus(); w.print();
  };
  const emailReport = () => { window.location.href = `mailto:?subject=${encodeURIComponent(t('an.emailSubject'))}&body=${encodeURIComponent(reportText)}`; };
  return <>
    <section className="nx-panel">
      <div className="nx-panel-head"><h2>{t('an.summary')}</h2>{period}</div>
      {total === 0 ? <p className="nx-muted">{t('an.none')}</p> : <>
        <div className="an-summary">
          <span className="nx-muted">{t('an.total', { total, time: anDate(data.codes[0]?.last) })}</span>
          {data.codes.map(c => <button key={c.code} type="button" className={`an-chip ${c.code === code ? 'selected' : ''}`} aria-pressed={c.code === code} onClick={() => setCode(c.code)}><b>{c.code}</b> {c.name.replace(/\s*\(.*$/, '')} <em>{c.n}×</em></button>)}
        </div>
        <div className="an-bars" aria-hidden="true">{series.map(d => <i key={d.day} style={{ height: `${d.n ? Math.max(8, (d.n / max) * 100) : 0}%` }} title={t('an.barTitle', { day: d.day, n: d.n })}/>)}</div>
        <div className="an-axis"><span>{series[0]?.day}</span><span>{series.at(-1)?.day}</span></div>
      </>}
    </section>
    {cmp && <section className="nx-panel">
      <div className="nx-panel-head"><h2>{t('an.contextTitle', { code: cmp.code })}</h2><span className="nx-muted">{t('an.contextMeta')}</span></div>
      <div className="an-scroll">
      <table className="an-table an-compare">
        <thead><tr><th>{t('an.colParam')}</th><th>{t('an.colError')}</th><th>{t('an.colBase')}</th><th>{t('an.colDelta')}</th></tr></thead>
        <tbody>{data.params.map(p => {
          const v = cmp.params[p.id]; if (!v) return null;
          const d = v.base == null ? null : v.error - v.base;
          return <tr key={p.id}><td>{p.label}</td><td className="num">{number(v.error, 1)} {p.unit}</td><td className="num">{v.base == null ? '—' : `${number(v.base, 1)} ${p.unit}`}</td><td className="num an-delta">{d == null ? '—' : `${d > 0 ? '+' : ''}${number(d, 1)} ${p.unit}`}</td></tr>;
        })}</tbody>
      </table>
      </div>
      <p className="an-note">{t('an.note', { count: cmpN })}</p>
    </section>}
    <section className="nx-panel">
      <div className="nx-panel-head"><h2>{t('an.errorsTitle')}</h2><span className="nx-muted">{t('an.errorsMeta', { count: data.errors.length })}</span></div>
      <div className="an-scroll">
        <table className="an-table">
          <thead><tr><th>{t('an.colTime')}</th><th>{t('an.colCode')}</th><th>{t('an.colMode')}</th><th>{t('an.colBrine')}</th><th>{t('an.colSpread')}</th><th>{t('an.colSuction')}</th><th>{t('an.colLow')}</th><th>{t('an.colHigh')}</th><th>{t('an.colPower')}</th><th>{t('an.colOutdoor')}</th></tr></thead>
          <tbody>{data.errors.map(e => <tr key={`${e.time}-${e.code}`} className={e.code === code ? 'sel' : ''}>
            <td>{anDate(e.time)}</td><td><b>{e.code}</b></td><td>{e.mode ? enumText(e.mode) : '—'}</td>
            <td className="num">{e.ctx.brine_in == null ? '—' : number(e.ctx.brine_in, 1)}</td>
            <td className="num">{e.ctx.brine_spread == null ? '—' : number(e.ctx.brine_spread, 1)}</td>
            <td className="num">{e.ctx.suction_comp == null ? '—' : number(e.ctx.suction_comp, 1)}</td>
            <td className="num">{e.ctx.pressure_low == null ? '—' : number(e.ctx.pressure_low, 2)}</td>
            <td className="num">{e.ctx.pressure_high == null ? '—' : number(e.ctx.pressure_high, 2)}</td>
            <td className="num">{e.ctx['21'] == null ? '—' : number(e.ctx['21'], 2)}</td>
            <td className="num">{e.ctx['5'] == null ? '—' : number(e.ctx['5'], 1)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
    <section className="nx-panel">
      <div className="nx-panel-head"><h2>{t('an.reportTitle')}</h2><span className="nx-muted">{t('an.reportMeta')}</span></div>
      <div className="an-paper" dangerouslySetInnerHTML={{ __html: reportHtml }}/>
      <label className="an-notes-field"><span>{t('an.notesLabel')}</span><textarea className="an-notes" value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder={t('an.notesPlaceholder')}/></label>
      <div className="an-actions">
        <button type="button" className="nx-edit" onClick={copyReport}>{t('an.copy')}</button>
        <button type="button" className="nx-edit" onClick={downloadReport}>{t('an.download')}</button>
        <button type="button" className="nx-edit" onClick={printReport}>{t('an.print')}</button>
        <button type="button" className="nx-edit" onClick={emailReport}>{t('an.email')}</button>
      </div>
    </section>
  </>;
}

function Tile({ point, quality }) {
  const text = point.enumValues?.length || (typeof point.value === 'string' && !Number.isFinite(Number(point.value))) ? point.display : `${number(point.value, 2)} ${point.parameterUnit || ''}`;
  return <div className={`nx-tile ${quality?.key || ''}`}><small>{point.label}</small><b>{text}</b>{quality && <span className="nx-tile-state">{quality.label}</span>}<em>{time(point.timestamp)}</em></div>;
}

function valueText(p) {
  if (p.enumValues?.length) return p.display;
  if (p.parameterId === '6147') return secondsAsText(p.value);
  return `${number(p.value)} ${p.parameterUnit || ''}`.trim();
}
function hintText(p) {
  if (p.enumValues?.length) return t('hint.choices', { count: p.enumValues.length });
  if (p.parameterId === '6147') return t('hint.step30');
  return t('hint.range', { min: number(p.min), max: number(p.max), unit: p.parameterUnit || '', step: number(p.step, 3) }).replace(/\s+/g, ' ');
}

const zoneLabel = name => /tarbeveetootmine/i.test(name) ? t('zone.hwProduction') : /kõrgendatud/i.test(name) ? t('zone.hwBoost') : name;

function Control({ ctx, water }) {
  const { points, zones, online, setEditing, categories, mode, errors, m } = ctx;
  // Legionella programmi seis: kui kuumutus parasjagu käib, näitame seda ka "Näidud" kaartidel.
  const [leg, setLeg] = useState(null);
  useEffect(() => {
    if (!water) return undefined;
    let live = true;
    const load = () => api('/legionella').then(v => { if (live) setLeg(v); }).catch(() => {});
    load(); const timer = setInterval(load, 60000);
    return () => { live = false; clearInterval(timer); };
  }, [water]);
  const group = water ? 'Tarbevesi' : 'Küte';
  const writable = points.filter(p => p.group === group && p.writable);
  // 40010 on sama paagiandur tsooni "Kõrgendatud tarbevesi" kaudu (vt README): kaart on duplikaat
  // ja näidatakse ainult siis, kui väärtus kunagi päris tarbevee temperatuurist erineb.
  const readings = points.filter(p => p.group === group && !p.writable)
    .filter(p => !(water && p.parameterId === '40010' && (m.water?.value == null || p.value == null || Math.abs(Number(p.value) - Number(m.water.value)) < 0.3)));
  const lt = ctx.lux?.view?.data?.temperatures, cl = ctx.climate;
  // Boost-tsooni temperatuur on sama mis paagil, seega näitame selle asemel režiimi – aga ainult siis,
  // kui kõrgendatud tarbevesi on päriselt sisse lülitatud. Väljas olekus piisab seadistuste reast.
  const boost = water ? zones.find(z => /kõrgendatud|ekstra/i.test(z.name) || z.zoneId === '40008') : null;
  const boostOn = Boolean(boost && boost.mode && boost.mode !== 'off');
  const legRunning = Boolean(water && leg?.running);
  const extra = water
    ? [(boostOn || legRunning) && {
        label: legRunning ? t('legionella.runningTitle') : t('point.boost'),
        value: legRunning ? `siht ${number(leg.running.target ?? m.waterTarget, 0)} °C · lõpeb ${time(leg.running.endsAt)}` : `${enumText(boost.mode)}${boost.setpointHeat != null ? ` · siht ${number(boost.setpointHeat)} °C` : ''}`,
        quality: { key: 'key', label: legRunning ? 'legionella' : 'aktiivne' }
      }].filter(Boolean)
    : [lt?.brineIn != null && { label: t('control.brineIn'), value: `${number(lt.brineIn, 1)} °C` }, lt?.brineOut != null && { label: t('control.brineOut'), value: `${number(lt.brineOut, 1)} °C` }, lt?.hotGas != null && { label: t('control.hotGas'), value: `${number(lt.hotGas, 1)} °C` }, cl.indoor != null && { label: t('control.indoorTemp'), value: `${number(cl.indoor, 1)} °C`, quality: readingQuality('temp', cl.indoor) }, cl.outdoor != null && { label: t('control.outdoorTemp', { source: cl.outdoorSource === 'soojuspump' ? t('control.sourcePump') : t('control.sourceVent') }), value: `${number(cl.outdoor, 1)} °C` }].filter(Boolean);
  const waterZones = water ? zones : [];
  const state = pumpState(m);
  // Värv ainult seal, kus on võrreldav norm. Pealevool ja tagasivool jäävad teadlikult neutraalseks,
  // sest tarbevee kütmise ajal muutuvad need ajutiselt. Sihtväärtus on eraldi (teal) märgitud.
  const waterTargetPoint = water ? readings.find(p => p.parameterId === '7' || /siht|peab/i.test(p.label) || /siht|peab/i.test(p.parameterName || '')) : null;
  const qById = {};
  if (water) {
    // Legionella ajal on siht teadlikult kõrge (63 °C) – tavaline "alla sihi" punane oleks eksitav.
    if (m.water) qById[m.water.parameterId] = legRunning ? { key: 'key', label: t('control.heatingUp') } : dhwQuality(m.water.value, m.waterTarget);
    if (waterTargetPoint) qById[waterTargetPoint.parameterId] = { key: 'key', label: legRunning ? t('control.legionellaTarget') : t('control.setpoint') };
  } else {
    if (m.buffer) qById[m.buffer.parameterId] = bufferQuality(m.buffer.value, m.returnTarget?.value);
    if (m.returnTarget) qById[m.returnTarget.parameterId] = { key: 'key', label: t('control.setpoint') };
  }
  return <>
    <div className="nx-split">
      <section className="nx-panel nx-plan-card small nx-a-plan">
        <HousePlan view={water ? 'water' : 'heat'} {...m} state={state} onOpen={ctx.navigate}/>
      </section>
      {(readings.length > 0 || extra.length > 0) && <section className="nx-panel nx-a-read"><div className="nx-panel-head"><h2>{t('control.readings')}</h2><span className="nx-muted">{t('control.deviceReadings')}</span></div><div className="nx-tiles">{extra.map(e => <div key={e.label} className={`nx-tile ${e.quality?.key || ''}`}><small>{e.label}</small><b>{e.value}</b>{e.quality && <span className="nx-tile-state">{e.quality.label}</span>}<em>{t('overview.now')}</em></div>)}{readings.map(p => <Tile key={p.parameterId} point={p} quality={qById[p.parameterId]}/>)}</div></section>}
      <section className="nx-panel nx-a-set">
        <div className="nx-panel-head"><h2>{t('control.settings')}</h2><span className="nx-muted">{t('control.editable', { count: writable.length + waterZones.length + (!water && categories['sh-smartMode'] ? 1 : 0) })}</span></div>
        <ul className="nx-rows">
          {writable.map(p => <li key={p.parameterId}><div><b>{p.label}</b><small>{hintText(p)}</small></div><strong>{valueText(p)}</strong><button type="button" className="nx-edit" disabled={!online} onClick={() => setEditing({ type: 'point', point: p })} aria-label={t('control.editAria', { label: p.label })}><Pencil size={15}/>{t('control.edit')}</button></li>)}
          {!water && categories['sh-smartMode'] && <li><div><b>{t('control.homeMode')}</b><small>{t('control.homeModeHint')}</small></div><strong>{enumText(mode)}</strong><button type="button" className="nx-edit" disabled={!online} onClick={() => setEditing({ type: 'mode', mode })} aria-label={t('control.editHomeAria')}><Pencil size={15}/>{t('control.edit')}</button></li>}
          {waterZones.map(z => <li key={z.zoneId}><div><b>{zoneLabel(z.name)}</b><small>{z.commandOnly ? t('control.zoneOnlyCommands') : t('control.zoneNow', { temp: `${number(z.temperature)} °${z.isCelsius ? 'C' : 'F'}` })}</small></div><strong>{enumText(z.mode)}{!z.commandOnly && z.setpointHeat != null ? ` · ${t('control.zoneSetpoint', { temp: number(z.setpointHeat) })}` : ''}</strong><button type="button" className="nx-edit" disabled={!online} onClick={() => setEditing({ type: 'zone', zone: z })} aria-label={t('control.editZoneAria', { name: z.name })}><Pencil size={15}/>{t('control.edit')}</button></li>)}
        </ul>
        {!writable.length && !waterZones.length && <p className="nx-muted">{t('control.noSettings')}</p>}
        {water && errors.zones && <p className="nx-warn"><AlertCircle size={15}/>{t('control.zonesError', { error: errors.zones })}</p>}
      </section>
    </div>
    {water && <LegionellaPanel notify={ctx.notify}/>}
    <Trend ctx={ctx} initial={water ? 'water' : 'heat'}/>
  </>;
}

// Legionella programm: seadme oma programm on ainult nädalane, siin saab 1 / 2 / 4 nädalat
// ja programm lülitab kõrgendatud tarbevee ise välja.
const LG_WEEKS = [1, 2, 4];
const LG_DURATIONS = [30, 60, 90, 120];
const LG_TARGETS = Array.from({ length: 11 }, (_, i) => 60 + i * 0.5);
const lgWhen = iso => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleString(getLocale(), { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; };

const lgPick = c => ({ enabled: c.enabled, weeks: c.weeks, weekday: c.weekday, time: c.time, target: c.target, durationMin: c.durationMin });

function LegionellaPanel({ notify }) {
  const [cfg, setCfg] = useState(null), [draft, setDraft] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const dirtyRef = useRef(false);
  const apply = c => { dirtyRef.current = false; setCfg(c); setDraft(lgPick(c)); };
  // Värskendame seisu minutiga (kas programm parasjagu töötab), aga ei kirjuta üle pooleli olevat muudatust.
  useEffect(() => {
    let live = true;
    const load = () => api('/legionella').then(c => { if (!live) return; setCfg(c); setDraft(d => dirtyRef.current && d ? d : lgPick(c)); }).catch(e => { if (live) setError(e.message); });
    load(); const timer = setInterval(load, 60000);
    return () => { live = false; clearInterval(timer); };
  }, []);
  if (!cfg || !draft) return error ? <p className="nx-warn"><AlertCircle size={15}/>{error}</p> : null;
  const days = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(getLocale(), { weekday: 'long' }).format(new Date(2024, 0, 1 + i)));
  const changed = ['enabled', 'weeks', 'weekday', 'time', 'target', 'durationMin'].some(k => draft[k] !== cfg[k]);
  const set = patch => { dirtyRef.current = true; setDraft({ ...draft, ...patch }); };
  const save = async () => {
    setBusy(true); setError(null);
    try { apply(await api('/legionella', { method: 'POST', body: JSON.stringify(draft) })); notify?.(t('legionella.saved')); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const runNow = async () => {
    const t = number(draft.target, 1);
    if (!window.confirm(t('legionella.confirm', { target: t }))) return;
    setBusy(true); setError(null);
    try {
      // Kui väljad on muudetud, salvesta enne – muidu kuumutaks vanade väärtustega.
      if (changed) { const saved = await api('/legionella', { method: 'POST', body: JSON.stringify(draft) }); dirtyRef.current = false; setCfg(saved); }
      apply(await api('/legionella/run', { method: 'POST', body: '{}' }));
      notify?.(t('legionella.started', { target: t }));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const running = cfg.running;
  const status = running ? t('legionella.running', { time: lgWhen(running.endsAt) }) : cfg.enabled && cfg.nextRun ? t('legionella.next', { time: lgWhen(cfg.nextRun) }) : t('legionella.currentlyOff');
  return <section className="nx-panel nx-legionella">
    <div className="nx-panel-head"><h2>{t('legionella.title')}</h2><span className="nx-muted">{t('legionella.hint')}</span></div>
    <div className="lg-row">
      <div className="segmented" role="group" aria-label={t('legionella.interval')}>
        <button type="button" className={!draft.enabled ? 'selected' : ''} aria-pressed={!draft.enabled} onClick={() => set({ enabled: false })}>{t('legionella.off')}</button>
        {LG_WEEKS.map(weeks => <button key={weeks} type="button" className={draft.enabled && draft.weeks === weeks ? 'selected' : ''} aria-pressed={draft.enabled && draft.weeks === weeks} onClick={() => set({ enabled: true, weeks })}>{t('common.weeks', { count: weeks })}</button>)}
      </div>
      <label className="lg-field"><span>{t('legionella.weekday')}</span><select value={draft.weekday} disabled={!draft.enabled} onChange={e => set({ weekday: Number(e.target.value) })}>{days.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label>
      <label className="lg-field"><span>{t('legionella.time')}</span><input type="time" value={draft.time} disabled={!draft.enabled} onChange={e => set({ time: e.target.value })}/></label>
      <label className="lg-field"><span>{t('legionella.target')}</span><select value={draft.target} onChange={e => set({ target: Number(e.target.value) })}>{LG_TARGETS.map(t => <option key={t} value={t}>{number(t, 1)} °C</option>)}</select></label>
      <label className="lg-field"><span>{t('legionella.duration')}</span><select value={draft.durationMin} onChange={e => set({ durationMin: Number(e.target.value) })}>{LG_DURATIONS.map(m => <option key={m} value={m}>{t('common.minutesShort', { count: m })}</option>)}</select></label>
      <button type="button" className="nx-edit" disabled={busy || !changed} onClick={save}>{t('legionella.save')}</button>
      <button type="button" className="nx-edit lg-now" disabled={busy || Boolean(running)} onClick={runNow}><Flame size={14}/>{t('legionella.runNow')}</button>
    </div>
    <p className="lg-status"><b>{status}</b>{cfg.lastRun && <> · {t('legionella.last', { time: lgWhen(cfg.lastRun) })}{cfg.lastMaxTemp != null ? t('legionella.max', { value: number(cfg.lastMaxTemp, 1) }) : ''}</>}{running?.maxTemp != null && t('legionella.now', { value: number(running.maxTemp, 1) })}</p>
    {cfg.lastError && <p className="nx-warn"><AlertCircle size={15}/>{t('legionella.failed', { error: cfg.lastError })}</p>}
    {error && <p className="nx-warn"><AlertCircle size={15}/>{error}</p>}
  </section>;
}

function LanguageMenu() {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return <div className="nx-lang" ref={ref}>
    <button type="button" className="nx-lang-btn" aria-haspopup="menu" aria-expanded={open} aria-label={t('settings.language.title')} title={t('settings.language.title')} onClick={() => setOpen(!open)}>
      <Globe size={16}/><span>{locale.toUpperCase()}</span><ChevronDown size={13}/>
    </button>
    {open && <div className="nx-menu nx-lang-menu" role="menu">
      {LOCALES.map(([code, label]) => <button key={code} type="button" role="menuitemradio" aria-checked={locale === code} className={locale === code ? 'active' : ''} onClick={() => { setLocale(code); setOpen(false); }}>{label}{locale === code && <Check size={14}/>}</button>)}
    </div>}
  </div>;
}

export default function NextUI({ ctx }) {
  const { page, navigate, status, systems, selection, setSelection, device, model, system, activeNotices, errors, loading, refreshing, lastFetch, online, stale, theme, setTheme, setUi, parts, shared, rawCount } = ctx;
  const locale = useLocale();
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
  if (notConnected) body = <section className="nx-panel"><Empty icon={Link2} title={status?.connected ? t('shell.noDevicesTitle') : t('shell.notConnectedTitle')} action={<Button kind="primary" icon={ArrowRight} onClick={() => go('settings')}>{t('shell.connectAction')}</Button>}>{t('shell.connectHint')}</Empty></section>;
  else if (loading && !standalone) body = <div className="nx-skeleton" aria-label={t('shell.loading')}><i/><i/><i/></div>;
  else body = <>
    {page === 'overview' && <Overview ctx={ctx}/>}
    {(page === 'heating' || page === 'water') && <Control ctx={ctx} water={page === 'water'} key={page}/>}
    {page === 'ventilation' && <parts.VentilationPage tick={ctx.tick} theme={theme} HistoryChart={parts.HistoryChart} notify={ctx.notify} airobot={ctx.airobot} outdoor={ctx.m.outdoor?.value} pumpDeviceId={selection} outdoorPointId={ctx.m.outdoor?.parameterId}/>}
    {page === 'live' && <Suspense fallback={<div className="nx-skeleton"><i/></div>}><LiveHome ctx={ctx}/></Suspense>}
    {page === 'energy' && <Suspense fallback={<div className="nx-skeleton" aria-label={t('energy.loading')}><i/><i/><i/></div>}><EnergyPage ctx={ctx}/></Suspense>}
    {page === 'curve' && <Suspense fallback={<div className="nx-skeleton" aria-label={t('curve.loading')}><i/><i/><i/></div>}><HeatingCurvePage ctx={ctx}/></Suspense>}
    {page === 'history' && <parts.HistoryPage deviceId={selection} points={ctx.points} tick={ctx.tick} theme={theme} model={model} stateId={model === 'WZSV 92H3M' ? '17' : null} ventPoints={ctx.airobot?.view?.configured && ctx.airobot.view.data ? ctx.airobot.view.points : []} luxPoints={ctx.lux?.view?.configured && ctx.lux.view.data ? ctx.lux.view.points : []}/>}
    {page === 'parameters' && <parts.Parameters {...shared} search={ctx.search} setSearch={ctx.setSearch} favorites={ctx.favorites} favorite={ctx.favorite}/>}
    {page === 'alarms' && <><parts.AlarmsPage systemId={system?.systemId} tick={ctx.tick}/><PlanNotes ctx={ctx}/></>}
    {page === 'analysis' && <ErrorAnalysis ctx={ctx}/>}
    {page === 'device' && <parts.DevicePage {...shared} firmware={ctx.firmware} aid={ctx.aid} subscriptions={ctx.subscriptions}/>}
    {page === 'settings' && <parts.SettingsPage status={status} notify={ctx.notify} onConnect={ctx.bootstrap} tick={ctx.tick} navigate={navigate} ui="next" setUi={setUi} weather={ctx.weather} lux={ctx.lux}/>}
  </>;
  return <div className="nx" data-page={page}>
    <header className="nx-top">
      <a className="nx-brand" href="/" onClick={e => { e.preventDefault(); go('overview'); }}><Waves size={22}/><span>soojus<i>.</i></span></a>
      <nav className="nx-tabs" aria-label={t('shell.mainNav')}>
        {NAV.map(([id, label, Icon]) => <button key={id} type="button" className={page === id ? 'active' : ''} aria-current={page === id ? 'page' : undefined} onClick={() => go(id)}><Icon size={17}/>{t(label)}</button>)}
        <div className="nx-more" ref={moreRef}>
          <button type="button" className={inMore ? 'active' : ''} aria-expanded={more} aria-haspopup="menu" onClick={() => setMore(!more)}><MoreHorizontal size={17}/>{t('shell.more')}{activeNotices.length > 0 && <b className="nx-count">{activeNotices.length}</b>}</button>
          {more && <div className="nx-menu" role="menu">{MORE.map(([id, label, Icon]) => <button key={id} role="menuitem" type="button" className={page === id ? 'active' : ''} onClick={() => go(id)}><Icon size={16}/>{t(label)}{id === 'alarms' && activeNotices.length > 0 && <b className="nx-count">{activeNotices.length}</b>}</button>)}</div>}
        </div>
      </nav>
      <div className="nx-tools">
        {systems.length > 1 && <select aria-label={t('shell.selectPump')} value={selection} onChange={e => setSelection(e.target.value)}>{systems.flatMap(s => (s.devices || []).map(d => <option key={d.id} value={d.id}>{s.name} · {d.product?.name}</option>))}</select>}
        <span className={`nx-status ${online && !stale ? 'ok' : 'warn'}`}><i/>{online ? stale ? t('shell.stale') : t('shell.online') : t('shell.offline')}</span>
        <button type="button" className="nx-icon" aria-label={t('shell.refresh')} onClick={() => selection ? ctx.refresh() : ctx.bootstrap()}><RefreshCw size={17} className={refreshing ? 'spin' : ''}/></button>
        <button type="button" className="nx-icon" aria-label={theme === 'dark' ? t('shell.themeLight') : t('shell.themeDark')} aria-pressed={theme === 'dark'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={17}/> : <Moon size={17}/>}</button>
        <button type="button" className="nx-icon" aria-label={t('shell.classic')} title={t('shell.classicTitle')} onClick={() => setUi('classic')}><LayoutTemplate size={17}/></button>
        <button type="button" className="nx-icon bell" aria-label={t('shell.notifications')} onClick={() => go('alarms')}><Bell size={17}/>{activeNotices.length > 0 && <i/>}</button>
<LanguageMenu/>
      </div>
    </header>
    <main className="nx-main" id="main">
      {page !== 'overview' && <div className="nx-title"><h1>{t(TITLES[page])}</h1>{SUBTITLES[page] && <p>{t(SUBTITLES[page])}</p>}</div>}
      {page === 'overview' && <h1 className="nx-sr">{t(TITLES.overview)}</h1>}
      {(errors.global || errors.points) && <div role="alert" className="nx-banner error"><AlertCircle size={18}/><span>{errors.global || errors.points} {rawCount > 0 && t('shell.latestShown')}</span><Button onClick={ctx.bootstrap}>{t('shell.retry')}</Button></div>}
      {stale && page !== 'overview' && <div className="nx-banner"><Clock3 size={18}/><span>{t('shell.staleBanner')}</span></div>}
      {body}
      <footer className="nx-foot"><span><Waves size={13}/> soojus · {model}</span><span>{t('shell.footerData')}: {ctx.lux?.view?.primary ? `${t('shell.footerDirect')}${ctx.lux.view.upstreamProblem ? t('shell.footerDown') : ''}` : t('shell.footerApi')} · {lastFetch ? `${t('shell.footerLast')} ${time(lastFetch)}` : t('shell.footerServer')}</span></footer>
    </main>
    <nav className="nx-dock" aria-label={t('shell.quickNav')}>
      {NAV.map(([id, label, Icon, short]) => <button key={id} type="button" className={page === id ? 'active' : ''} onClick={() => go(id)}><Icon size={21}/><span>{t(short || label)}</span></button>)}
      <button type="button" className={inMore || more ? 'active' : ''} aria-expanded={more} onClick={() => setMore(!more)}><MoreHorizontal size={21}/><span>{t('shell.more')}</span></button>
    </nav>
    {more && <div className="nx-sheet" role="menu">{MORE.map(([id, label, Icon]) => <button key={id} role="menuitem" type="button" onClick={() => go(id)}><Icon size={18}/>{t(label)}{id === 'alarms' && activeNotices.length > 0 && <b className="nx-count">{activeNotices.length}</b>}</button>)}</div>}
  </div>;
}
