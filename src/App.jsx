import React, { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react';
import { LayoutTemplate, Activity, ArrowDownLeft, ArrowRight, ArrowUpRight, Bell, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Clock3, CloudSun, Download, Droplets, ExternalLink, Fan, Flame, Gauge, History, Home, LayoutDashboard, Link2, LoaderCircle, Menu, Minus, Moon, Plus, Power, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal, Snowflake, Star, Sun, Thermometer, Waves, Wifi, WifiOff, X, Zap, AlertCircle, Monitor, CircleDot, LogOut, Save, CalendarDays } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, CartesianGrid, ReferenceArea, XAxis, YAxis, Tooltip } from 'recharts';
import { VentilationPage, useAirobot } from './ventilation.jsx';
import { useWeather } from './weather.js';
import { useLuxtronik, LuxtronikPanel } from './luxtronik.jsx';
import { LocationPanel } from './location.jsx';
import { climate, climatePoints, climateQuery } from './ventilation-logic.js';
import { pumpState } from './next/logic.js';
import { api, number, axisNumber, date, time, enumText, enhance, metric, niceScale, timeTicks, timeTickLabel, mergeSeries, plotKey, estKey, clipSpans, targetKey, targetLines, holdValues, seriesStats, stateSpans, wzsvWorkState } from './lib.js';

const NextUI = lazy(() => import('./next/NextUI.jsx'));

const pages = [
  { id: 'overview', label: 'Ülevaade', icon: LayoutDashboard },
  { id: 'heating', label: 'Küte ja sisekliima', icon: Thermometer },
  { id: 'water', label: 'Soe tarbevesi', icon: Droplets },
  { id: 'ventilation', label: 'Ventilatsioon', icon: Fan },
  { id: 'history', label: 'Ajalugu', icon: History },
  { id: 'parameters', label: 'Kõik parameetrid', icon: SlidersHorizontal },
  { id: 'alarms', label: 'Teavitused', icon: Bell },
  { id: 'device', label: 'Minu seade', icon: Monitor },
  { id: 'settings', label: 'Seaded ja ühendus', icon: Settings2 },
];
function Badge({ children, tone = 'green' }) { return <span className={`badge ${tone}`}><i />{children}</span>; }
function Empty({ icon: Icon = Activity, title, children, action }) { return <div className="empty"><span className="empty-icon"><Icon size={25}/></span><h3>{title}</h3><p>{children}</p>{action}</div>; }
function PanelTitle({ title, subtitle, action }) { return <div className="panel-title"><div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>{action}</div>; }
function Button({ children, icon: Icon, kind = 'secondary', busy, ...props }) { return <button type="button" className={`button ${kind}`} {...props} disabled={props.disabled || busy}>{busy ? <LoaderCircle size={16} className="spin"/> : Icon && <Icon size={16}/>} {children}</button>; }

export default function App() {
  const [page, setPage] = useState(new URLSearchParams(location.search).get('page') || 'overview');
  const [status, setStatus] = useState(null), [systems, setSystems] = useState([]), [selection, setSelection] = useState(localStorage.getItem('soojus.device') || '');
  const [rawPoints, setRawPoints] = useState([]), [detail, setDetail] = useState(null), [zones, setZones] = useState([]), [categories, setCategories] = useState({}), [firmware, setFirmware] = useState(null), [aid, setAid] = useState(null), [mode, setMode] = useState(null), [subscriptions, setSubscriptions] = useState(null);
  const [notices, setNotices] = useState([]), [errors, setErrors] = useState({}), [loading, setLoading] = useState(true), [refreshing, setRefreshing] = useState(false), [lastFetch, setLastFetch] = useState(null), [tick, setTick] = useState(0);
  const [mobile, setMobile] = useState(false), [search, setSearch] = useState(''), [toast, setToast] = useState(null), [editing, setEditing] = useState(null);
  const [ovHours, setOvHours] = useState(() => { try { const v = Number(localStorage.getItem('soojus.ovHours')); return [24, 168, 720].includes(v) ? v : 24; } catch { return 24; } });
  const pickOvHours = h => { setOvHours(h); try { localStorage.setItem('soojus.ovHours', String(h)); } catch {} };
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('soojus.theme') || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); } catch { return 'light'; } });
  const [favorites, setFavorites] = useState(() => { try { return JSON.parse(localStorage.getItem('soojus.favorites') || '[]'); } catch { return []; } });
  const [ui, setUiState] = useState(() => { try { const q = new URLSearchParams(location.search).get('ui'); if (q === 'next' || q === 'classic') localStorage.setItem('soojus.ui', q); return localStorage.getItem('soojus.ui') === 'next' ? 'next' : 'classic'; } catch { return 'classic'; } });
  const setUi = v => { setUiState(v); try { localStorage.setItem('soojus.ui', v); const u = new URL(location.href); u.searchParams.delete('ui'); history.replaceState({}, '', u); } catch {} };
  useEffect(() => { document.documentElement.dataset.ui = ui; }, [ui]);
  const airobot = useAirobot(tick);
  const weather = useWeather();
  const lux = useLuxtronik(tick);
  const requestId = useRef(0);
  const system = systems.find(s => s.devices?.some(d => d.id === selection));
  const systemId = system?.systemId;
  const device = system?.devices?.find(d => d.id === selection);
  const model = device?.product?.name || detail?.product?.name || '';
  const points = enhance(rawPoints, model);
  const online = (detail?.connectionState || device?.connectionState) === 'Connected';
  const activeNotices = notices.filter(n => n.status === 'Active');
  const metricFor = (id, cat, pattern) => metric(points, model, id, cat, pattern);
  const supply = metricFor('0', 'sh-supplyTemp', /^pealev\./i), outdoor = metricFor('5', 'sh-outdoorTemp'), water = metricFor('6', 'sh-hwTemp'), power = metricFor('21', 'sh-electricPowerUsedCurrently'), returnT = metricFor('1', 'sh-returnTemp');
  const heatingState = metricFor('45', 'sh-heatMode', /kütte olek/i);
  const hwState = metricFor('46', '', /tarbevee olek/i);
  const workMode = metricFor('17', '', /töörežiimi olukord/i);
  const returnTarget = metricFor('2', '', /tagasivoolu siht/i), buffer = metricFor('3', '', /akupaak/i);
  const heatPoints = [supply, returnT, returnTarget, buffer].filter((p, i, list) => p && list.findIndex(x => x?.parameterId === p.parameterId) === i);
  const latestSample = points.map(p => Date.parse(p.timestamp)).filter(Number.isFinite).sort((a,b) => b-a)[0];
  const stale = latestSample && Date.now() - latestSample > 15 * 60000;
  const notify = (text, error = false) => setToast({ text, error });
  const navigate = id => { setPage(id); setMobile(false); const u = new URL(location.href); u.searchParams.set('page', id); history.replaceState({}, '', u); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const bootstrap = useCallback(async () => {
    try {
      const s = await api('/status'); setStatus(s);
      if (!s.configured || !s.connected) { setSystems([]); setRawPoints([]); setLoading(false); return; }
      const list = await api('/systems'); setSystems(list);
      setSelection(prev => list.some(s => s.devices?.some(d => d.id === prev)) ? prev : list[0]?.devices?.[0]?.id || '');
      setErrors(prev => ({ ...prev, global: null }));
      if (!list.length) setLoading(false);
    } catch (e) { setErrors(prev => ({ ...prev, global: e.message })); setLoading(false); }
  }, []);
  useEffect(() => { bootstrap(); }, [bootstrap]);
  const refresh = useCallback(async () => {
    if (!selection || !systemId) return;
    const rid = ++requestId.current;
    setRefreshing(true);
    const sid = encodeURIComponent(systemId), did = encodeURIComponent(selection);
    const jobs = [
      ['points', `/devices/${did}/points`, setRawPoints], ['device', `/devices/${did}`, setDetail],
      ['zones', `/devices/${did}/smart-home-zones`, setZones], ['categories', `/devices/${did}/smart-home-categories`, setCategories],
      ['firmware', `/devices/${did}/firmware-info`, setFirmware], ['aid', `/devices/${did}/aidMode`, setAid],
      ['mode', `/systems/${sid}/mode`, d => setMode(d?.smartHomeMode)], ['subscriptions', `/systems/${sid}/subscriptions`, setSubscriptions],
      ['notices', `/systems/${sid}/notifications?active=true`, d => setNotices(d.notifications || [])],
    ];
    const results = await Promise.allSettled(jobs.map(async ([key, url, setter]) => { const value = await api(url); if (rid === requestId.current) setter(value); }));
    if (rid !== requestId.current) return;
    setErrors(prev => ({ global: prev.global, ...Object.fromEntries(results.map((r,i) => [jobs[i][0], r.status === 'rejected' ? r.reason.message : null])) }));
    setLastFetch(new Date().toISOString()); setTick(t => t+1); setLoading(false); setRefreshing(false);
  }, [selection, systemId]);
  useEffect(() => {
    setRawPoints([]); setDetail(null); setZones([]); setCategories({}); setFirmware(null); setAid(null); setMode(null); setSubscriptions(null); setNotices([]); setLastFetch(null);
    if (selection) { localStorage.setItem('soojus.device', selection); setLoading(true); refresh(); }
    const timer = setInterval(refresh, 60000);
    return () => { clearInterval(timer); requestId.current++; };
  }, [refresh, selection]);
  // Kui soojuspumba otseandmed on põhiallikas, värskenda näite tihedamini (ainult näidud, mitte kogu leht ega graafikud).
  const directPrimary = Boolean(lux.view?.primary);
  useEffect(() => {
    if (!directPrimary || !selection || !systemId) return;
    const did = encodeURIComponent(selection), timer = setInterval(async () => { try { const fresh = await api(`/devices/${did}/points`); if (Array.isArray(fresh)) setRawPoints(fresh); } catch {} }, 10000);
    return () => clearInterval(timer);
  }, [directPrimary, selection, systemId]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 6500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('soojus.theme', theme); } catch {} }, [theme]);
  function favorite(id) { const next = favorites.includes(id) ? favorites.filter(x => x !== id) : [...favorites,id]; setFavorites(next); localStorage.setItem('soojus.favorites', JSON.stringify(next)); }
  const shared = { points, device, model, system, detail, zones, categories, errors, notify, setEditing, refresh, selection, online };
  const waterTarget = Number(metricFor('5105')?.value ?? metricFor('7', '', /tarbevesi.*peab/i)?.value ?? zones.find(z => /tarbe/i.test(z.name))?.setpointHeat);
  const overlays = <>
    {editing && <EditModal item={editing} deviceId={selection} systemId={system?.systemId} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} notify={notify}/>}
    {toast && <div className={`toast ${toast.error ? 'toast-error' : ''}`} role="status">{toast.error ? <AlertCircle size={20}/> : <CheckCheck size={20}/>}<span>{toast.text}</span><button className="icon-button" onClick={() => setToast(null)} aria-label="Sulge teade"><X size={16}/></button></div>}
  </>;
  if (ui === 'next') {
    const ctx = { page, navigate, status, systems, selection, setSelection, points, device, model, system, detail, zones, categories, firmware, aid, mode, subscriptions, activeNotices, errors, loading, refreshing, lastFetch, tick, refresh, bootstrap, online, stale, theme, setTheme, favorites, favorite, search, setSearch, setEditing, notify, ovHours, pickOvHours, setUi, shared, targetLines, rawCount: rawPoints.length, airobot, weather, lux, climate: climate(outdoor?.value, airobot.view),
      m: { supply, returnT, returnTarget, buffer, water, waterTarget, power, outdoor, heatingState, hwState, workMode, compressor: model === 'WZSV 92H3M' ? metricFor('70') : undefined },
      parts: { Empty, Button, HistoryChart, HistoryPage, Parameters, AlarmsPage, DevicePage, SettingsPage, VentilationPage } };
    return <><Suspense fallback={<div className="loading-grid" aria-label="Laadin uut liidest" style={{ padding: 32 }}><div className="skeleton large"/></div>}><NextUI ctx={ctx}/></Suspense>{overlays}</>;
  }

  return <div className="app-shell">
    {mobile && <button type="button" aria-label="Sulge navigeerimismenüü" className="nav-backdrop" onClick={() => setMobile(false)}/>}
    <aside className={`sidebar ${mobile ? 'open' : ''}`}>
      <a className="brand" href="/" onClick={e => { e.preventDefault(); navigate('overview'); }}><span className="brand-mark"><Waves size={25}/></span><span>soojus<span className="brand-dot">.</span></span></a>
      <div className="home-label"><span className="eyebrow">MINU KODU</span><span className="tiny-dot"/></div>
      <div className="device-selector"><span className="selector-icon"><Home size={19}/></span><div><b>{model || 'Soojuspump'}</b><small>{system?.country === 'Estonia' ? 'Eesti' : system?.country || 'Kodu juhtimiskeskus'}</small></div><ChevronDown size={15}/><select aria-label="Vali soojuspump" value={selection} onChange={e => setSelection(e.target.value)}>{systems.flatMap(s => (s.devices || []).map(d => <option key={d.id} value={d.id}>{s.name} · {d.product?.name}</option>))}{!systems.length && <option value="">Ühenda myUplink</option>}</select></div>
      <nav aria-label="Põhinavigatsioon">{pages.map((p, i) => <React.Fragment key={p.id}>{p.id === 'device' && <div className="nav-heading">SÜSTEEM</div>}<button className={`nav-item ${page === p.id ? 'active' : ''}`} onClick={() => navigate(p.id)}><p.icon size={19}/><span>{p.label}</span>{p.id === 'alarms' && activeNotices.length > 0 && <b className="count">{activeNotices.length}</b>}{page === p.id && <span className="nav-active-dot"/>}</button></React.Fragment>)}</nav>
      <div className="sidebar-bottom"><div className="connection-summary"><span className={`connection-symbol ${status?.connected ? 'connected' : ''}`}><Link2 size={17}/></span><div><b>myUplink</b><small>{status?.connected ? 'Turvaliselt ühendatud' : 'Ühendus seadistamata'}</small></div><i className={status?.connected ? 'tiny-dot' : 'tiny-dot gray-dot'}/></div><div className="sidebar-footer"><span>v1.0</span></div></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Ava menüü" onClick={() => setMobile(true)}><Menu size={21}/></button><Home size={15}/><span>Minu kodu</span><ChevronRight size={13}/><b>{pages.find(p => p.id === page)?.label || 'Ülevaade'}</b></div><div className="topbar-right"><span className="topbar-date"><CalendarDays size={15}/>{new Intl.DateTimeFormat('et-EE', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())}</span><button className="icon-button theme-toggle" aria-label={theme === 'dark' ? 'Lülita hele teema' : 'Lülita tume teema'} aria-pressed={theme === 'dark'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={19}/> : <Moon size={19}/>}</button><button className="icon-button" aria-label="Lülita uus liides (Kodu-plaan)" title="Uus liides (Kodu-plaan)" onClick={() => setUi('next')}><LayoutTemplate size={19}/></button><button className="icon-button notification-button" aria-label="Vaata teavitusi" onClick={() => navigate('alarms')}><Bell size={19}/>{activeNotices.length > 0 && <i/>}</button><span className="avatar">MK</span></div></header>
      <main id="main">
        <div className="page-heading"><div><h1>{pages.find(p => p.id === page)?.label || 'Ülevaade'}</h1><p>{({ overview: 'Soojuspumba tööolek, temperatuurid ja süsteemi näidud.', heating: 'Kütteringi olek ja seadistused.', water: 'Tarbevee temperatuur ja seadistused.', ventilation: 'Airobot ventilatsiooniseadme näidud ja ajalugu.', history: 'Mõõtmiste ajalugu ja trendid.', parameters: 'Seadme API kaudu saadaolevad parameetrid.', alarms: 'Aktiivsed ja varasemad seadme teavitused.', device: 'Ühendus, püsivara ja seadme info.', settings: 'myUplinki ühenduse seaded ja muudatuste ajalugu.' })[page]}</p></div><div className="heading-actions">{page === 'overview' && <span className="weather-chip"><CloudSun size={22}/>{number(outdoor?.value)}<span>°C väljas</span>{climate(outdoor?.value, airobot.view).indoor != null && <>{' · '}{number(climate(outdoor?.value, airobot.view).indoor)}<span>°C toas</span></>}</span>}<Button icon={RefreshCw} busy={refreshing} onClick={() => selection ? refresh() : bootstrap()}>Värskenda</Button></div></div>
        {(errors.global || errors.points) && <div role="alert" className="error-banner"><AlertCircle size={19}/><span>{errors.global || errors.points} {rawPoints.length > 0 && 'Kuvatud on viimased kättesaadavad näidud.'}</span><Button onClick={bootstrap}>Proovi uuesti</Button></div>}
        {stale && <div className="info-banner warning"><Clock3 size={18}/><span>Seadme viimased mõõtmised on vanemad kui 15 minutit. Näite ei esitata reaalajana.</span></div>}
        {page !== 'settings' && page !== 'ventilation' && (!status?.connected || !device) && !loading ? <div className="panel"><Empty icon={Link2} title={status?.connected ? 'Kontol pole seadmeid' : 'Sinu kodu ootab ühendamist'} action={<Button kind="primary" icon={ArrowRight} onClick={() => navigate('settings')}>Ava ühenduse seaded</Button>}>Ühenda myUplinki konto, et näha soojuspumba tegelikke näite ja juhtida selle seadistusi.</Empty></div> : loading && page !== 'settings' && page !== 'ventilation' ? <div className="loading-grid" aria-label="Laadin seadme andmeid">{[1,2,3,4].map(n => <div key={n} className="skeleton"/>)}<div className="skeleton large"/></div> : <>
          {page === 'overview' && <>
            <div className="status-strip"><div><Badge tone={online && !stale ? 'green' : 'amber'}>{online ? stale ? 'Viimased näidud' : 'Seade on võrgus' : 'Seade on võrguühenduseta'}</Badge><span className="status-model">{model}</span><span className="status-divider"/><span>{heatingState?.display || 'Seadme ülevaade'}</span></div><span className="update-time"><RefreshCw size={12}/>{errors.points ? 'Värskendus ebaõnnestus' : `Päring ${time(lastFetch)}`} · iga 60 sek</span></div>
            <div className="metric-grid"><MetricCard title="Pealevool" point={supply} icon={Thermometer} tone="orange" detail={`Tagasivool ${number(returnT?.value)} °C`} hint="KÜTTERING"/><MetricCard title="Soe tarbevesi" point={water} icon={Droplets} tone="blue" detail={`Sihttemperatuur ${number(metricFor('7', '', /tarbevesi.*peab/i)?.value ?? zones.find(z => /tarbe/i.test(z.name))?.setpointHeat)} °C`} hint="TARBEVESI"/><MetricCard title="Hetkevõimsus" point={power} icon={Zap} tone="purple" detail={metricFor('70')?.display ? `Kompressor ${metricFor('70').display.toLowerCase()}` : 'Seadme raporteeritud võimsus'} hint="VÕIMSUS"/><MetricCard title="Välisõhk" point={outdoor} icon={CloudSun} tone="teal" detail={`Keskmine ${number(metricFor('39')?.value)} °C`} hint="VÄLISKLIIMA"/></div>
            <div className="overview-grid"><section className="panel flow-panel"><PanelTitle title="Kodu soojusring" subtitle="Soojus liigub sinna, kus seda vajad." action={<span className="subtle-label"><span className="tiny-dot"/>Seadme näidud</span>}/><FlowDiagram supply={supply} returnT={returnT} water={water} power={power} heatingState={heatingState} hwState={hwState} workMode={workMode} compressor={model === 'WZSV 92H3M' ? metricFor('70') : undefined} online={online} model={model}/><div className="flow-bottom"><span><ShieldCheck size={16}/>{errors.notices ? 'Häirete olek pole saadaval' : system?.hasAlarm || activeNotices.length ? 'Süsteemis on aktiivne häire' : 'Aktiivseid häireid pole'}</span><button className="text-button" onClick={() => navigate('device')}>Seadme üksikasjad <ArrowRight size={15}/></button></div></section>
            <section className="panel quick-panel"><PanelTitle title="Kiirjuhtimine" subtitle="Kõige vajalikum käeulatuses."/><div className="quick-control"><span className="square-icon orange"><Flame size={20}/></span><div><b>Küte</b><small>{points.find(p => p.parameterId === '5003')?.display || heatingState?.display || 'Vaata seadistusi'}</small></div><button className="icon-button" aria-label="Ava kütte seaded" onClick={() => navigate('heating')}><ChevronRight size={19}/></button></div><div className="quick-control"><span className="square-icon blue"><Droplets size={20}/></span><div><b>Soe tarbevesi</b><small>{zones.find(z => /tarbe/i.test(z.name))?.setpointHeat != null ? `Siht ${number(zones.find(z => /tarbe/i.test(z.name)).setpointHeat)} °C` : 'Vaata seadistusi'}</small></div><button className="icon-button" aria-label="Ava tarbevee seaded" onClick={() => navigate('water')}><ChevronRight size={19}/></button></div><div className="boost-box"><div><Zap size={19}/><b>Tarbevee kiirlaadimine</b></div><p>Kui tavapärasest sooja vee kogusest ei piisa.</p><Button icon={power?.value > 0 ? Zap : Plus} onClick={() => { const p = points.find(p => p.smartHomeCategories?.includes('sh-hwBoost') && p.writable); if (p) setEditing({ type: 'point', point: p }); }} disabled={!points.some(p => p.smartHomeCategories?.includes('sh-hwBoost') && p.writable) || !online}>{points.find(p => p.smartHomeCategories?.includes('sh-hwBoost'))?.value == 1 ? 'Halda kiirlaadimist' : 'Seadista kiirlaadimine'}</Button></div><button className="text-button quick-all" onClick={() => navigate('parameters')}>Kõik juhtimisvõimalused <ArrowRight size={15}/></button></section></div>
            <div className="overview-bottom"><section className="panel chart-panel"><PanelTitle title="Temperatuuride ajalugu" subtitle="Kohalikult kogutud mõõtmised" action={<div className="panel-actions"><div className="segmented" role="group" aria-label="Ajavahemik">{[[24,'24 tundi'],[168,'Nädal'],[720,'Kuu']].map(([v,l]) => <button key={v} type="button" className={ovHours === v ? 'selected' : ''} aria-pressed={ovHours === v} onClick={() => pickOvHours(v)}>{l}</button>)}</div><button className="text-button" onClick={() => navigate('history')}>Vaata ajalugu <ArrowUpRight size={15}/></button></div>}/>{heatPoints.length > 0 && <div className="chart-section"><h4>Küte</h4><HistoryChart name="heat" deviceId={selection} points={heatPoints} defaultHidden={heatPoints.slice(1).map(p => p.parameterId)} hours={ovHours} tick={tick} compact theme={theme} stateId={model === 'WZSV 92H3M' ? '17' : null} targets={[]}/></div>}{[water].filter(Boolean).length > 0 && <div className="chart-section"><h4>Tarbevesi</h4><HistoryChart name="water" footnote={false} deviceId={selection} points={[water].filter(Boolean)} hours={ovHours} tick={tick} compact theme={theme} stateId={model === 'WZSV 92H3M' ? '17' : null} targets={targetLines(points, model, [water].filter(Boolean).map(p => p.parameterId))}/></div>}{airobot.view?.configured && airobot.view.data && outdoor && <div className="chart-section"><h4>Toas ja väljas</h4><HistoryChart name="climate" footnote={false} deviceId="climate" extra={climateQuery(selection, outdoor.parameterId)} points={climatePoints} hours={ovHours} tick={tick} compact theme={theme}/></div>}{[power].filter(Boolean).length > 0 && <div className="chart-section"><h4>Võimsus</h4><HistoryChart name="power" footnote={false} deviceId={selection} points={[power].filter(Boolean)} hours={ovHours} tick={tick} compact theme={theme} stateId={model === 'WZSV 92H3M' ? '17' : null} targets={[]}/></div>}</section><section className="panel health-panel"><PanelTitle title="Süsteemi seisund"/><div className="health-heading"><span className={`health-icon ${activeNotices.length ? 'warning' : ''}`}><ShieldCheck size={26}/></span><div><b>{errors.notices ? 'Olek teadmata' : system?.hasAlarm || activeNotices.length ? 'Vajab tähelepanu' : 'Kõik on korras'}</b><small>{errors.notices ? 'Teavituste päring ebaõnnestus' : 'myUplinki häirete ülevaade'}</small></div></div><dl className="health-list"><div><dt>Ühendus</dt><dd><span className={`tiny-dot ${online ? '' : 'gray-dot'}`}/>{online ? 'Võrgus' : 'Võrguühenduseta'}</dd></div><div><dt>Kompressor</dt><dd>{metricFor('70')?.display || '—'}</dd></div><div><dt>Töötunde kokku</dt><dd>{number(metricFor('5668')?.value, 0)} h</dd></div><div><dt>Püsivara</dt><dd className="firmware-short">{firmware?.currentFwVersion || '—'}</dd></div></dl><button className="text-button" onClick={() => navigate('alarms')}>Vaata sündmuste logi <ArrowRight size={15}/></button></section></div>
            {favorites.length > 0 && <section className="panel favorites-panel"><PanelTitle title="Sinu lemmiknäidud" subtitle="Parameetrid, millel soovid silma peal hoida."/><div className="reading-grid">{points.filter(p => favorites.includes(`${selection}:${p.parameterId}`)).map(p => <Reading key={p.parameterId} point={p}/>)}</div></section>}
          </>}
          {(page === 'heating' || page === 'water') && <ControlPage {...shared} waterPage={page === 'water'} mode={mode} />}
          {page === 'parameters' && <Parameters {...shared} search={search} setSearch={setSearch} favorites={favorites} favorite={favorite}/>}
          {page === 'ventilation' && <VentilationPage tick={tick} theme={theme} HistoryChart={HistoryChart} notify={notify} airobot={airobot} outdoor={outdoor?.value} pumpDeviceId={selection} outdoorPointId={outdoor?.parameterId}/>}
          {page === 'history' && <HistoryPage deviceId={selection} points={points} tick={tick} theme={theme} model={model} stateId={model === 'WZSV 92H3M' ? '17' : null} ventPoints={airobot.view?.configured && airobot.view.data ? airobot.view.points : []} luxPoints={lux.view?.configured && lux.view.data ? lux.view.points : []}/>}
          {page === 'alarms' && <AlarmsPage systemId={system?.systemId} tick={tick}/>}
          {page === 'device' && <DevicePage {...shared} firmware={firmware} aid={aid} subscriptions={subscriptions}/>}
          {page === 'settings' && <SettingsPage status={status} notify={notify} onConnect={bootstrap} tick={tick} navigate={navigate} ui={ui} setUi={setUi} weather={weather} lux={lux}/>}
        </>}
        <footer className="main-footer"><span><Waves size={14}/> SOOJUS</span><span>Andmed: {directPrimary ? `soojuspump otse kohtvõrgust, myUplink varuks${lux.view?.upstreamProblem ? ' (praegu ei vasta)' : ''}` : 'myUplink Public API'} <span className="footer-divider">·</span> {lastFetch ? `Viimane päring ${time(lastFetch)}` : 'Turvaline serveripoolne ühendus'}</span></footer>
      </main>
    </div>
    {overlays}
  </div>;
}

function MetricCard({ title, point, icon: Icon, tone, detail, hint }) {
  return <section className="metric-card"><div className="metric-top"><span className={`square-icon ${tone}`}><Icon size={20}/></span><span className="metric-hint">{hint}</span></div><p>{title}</p><div className="metric-value">{number(point?.value)}<span>{point?.parameterUnit || '—'}</span></div><div className="metric-detail"><span className={`little-line ${tone}`}/>{detail}</div></section>;
}

function FlowDiagram({ supply, returnT, water, power, heatingState, hwState, workMode, compressor, online, model }) {
  const { heatOn, hwOn, heatDemand, hwDemand } = pumpState({ workMode, heatingState, hwState, compressor });
  const heatPipes = ['M210 116H325Q339 116 339 101V84H422', 'M422 176H348Q327 176 327 195H209'];
  const hwPipes = ['M339 116H512Q530 116 530 134V160', 'M557 186V210Q557 222 540 222H244Q224 222 224 195H210'];
  const activity = hwOn && heatOn ? 'Kütab kütet ja tarbevett' : hwOn ? 'Kütab tarbevett' : heatOn ? 'Kütab kütet' : heatDemand || hwDemand ? 'Ootab küttevajadust' : heatingState?.display || model;
  const aria = `Kütteringi skeem: pealevool ${number(supply?.value)}, tagasivool ${number(returnT?.value)}, tarbevesi ${number(water?.value)} kraadi${hwOn ? '. Tarbevett köetakse' : ''}${heatOn ? '. Kütet köetakse' : ''}`;
  return <div className="flow-diagram"><svg viewBox="0 0 680 274" role="img" aria-label={aria}>
    <defs><pattern id="grid" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="#d9e3e7"/></pattern><linearGradient id="pump" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#fff"/><stop offset="1" stopColor="#eef3f5"/></linearGradient><linearGradient id="water" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#f7b075" stopOpacity=".22"/><stop offset="1" stopColor="#7cb7ca" stopOpacity=".14"/></linearGradient><clipPath id="tankClip"><rect x="523" y="151" width="56" height="60" rx="9"/></clipPath><filter id="flowGlow" x="-60%" y="-60%" width="220%" height="220%"><feDropShadow dx="0" dy="0" stdDeviation="1.1" flood-color="#0b3b49" flood-opacity=".55"/></filter></defs>
    <rect x="0" y="0" width="680" height="274" rx="8" fill="url(#grid)"/>
    <path d={heatPipes[0]} className="hot-pipe"/><path d={heatPipes[1]} className="cold-pipe"/>
    <path d={hwPipes[0]} className="hot-pipe"/><path d={hwPipes[1]} className="cold-pipe"/>
    {(heatOn || heatDemand) && <g className={`pipe-flow ${heatOn ? 'fast' : 'slow'}`} filter="url(#flowGlow)">{heatPipes.map(d => <path key={d} d={d} className="flow hot"/>)}</g>}
    {(hwOn || hwDemand) && <g className={`pipe-flow ${hwOn ? 'fast' : 'slow'}`} filter="url(#flowGlow)">{hwPipes.map(d => <path key={d} d={d} className="flow cold"/>)}</g>}
    <polygon points="299,112 305,116 299,120" fill="#d79664"/><polygon points="267,191 261,195 267,199" fill="#63a4b1"/>
    <rect x="105" y="52" width="105" height="165" rx="7" fill="url(#pump)" stroke="#cbd8df" strokeWidth="1.5"/><path d="M105 155H210" stroke="#d6e0e5"/><rect x="121" y="70" width="72" height="34" rx="3" fill="#233f50"/><circle cx="180" cy="83" r="2" fill={online ? '#92d4be' : '#afb9c0'}/><text x="131" y="88" fill="#d9e9ed" fontSize="10" fontWeight="600">{number(power?.value)} kW</text><rect x="121" y="110" width="27" height="3" rx="1.5" fill="#d5dfe3"/><rect x="121" y="118" width="42" height="3" rx="1.5" fill="#d5dfe3"/><text x="157" y="192" fill="#6b8997" textAnchor="middle" fontSize="12" fontWeight="600">soojus.</text><path d="M117 217V222M198 217V222" stroke="#8da5b1" strokeWidth="3"/>
    <path d="M387 65L449 23L511 65" fill="none" stroke="#9fb4bf" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M399 66V178H498V67" fill="#fff" fillOpacity=".7" stroke="#c7d6de" strokeWidth="1.5"/>
    {heatOn && <rect x="413" y="74" width="72" height="93" rx="10" className="unit-halo"/>}
    <rect x="421" y="82" width="56" height="77" rx="5" fill="#fff" stroke="#e2c0a7" strokeWidth="1.5"/>{[430,441,452,463].map(x => <path key={x} d={`M${x} 91V149`} className={`heater-bar ${heatOn ? 'glow' : heatDemand ? 'glow demand' : ''}`} strokeWidth="4" strokeLinecap="round"/>)}
    {hwOn && <rect x="511" y="139" width="80" height="84" rx="18" className="unit-halo"/>}
    <rect x="519" y="147" width="64" height="68" rx="12" fill="url(#water)" stroke="#a9c1ce" strokeWidth="1.5"/><path d="M530 170C546 159 555 182 572 170M530 178C546 167 555 190 572 178" stroke="#7bafbf" strokeWidth="1.7" fill="none"/>
    {(hwOn || hwDemand) && <g className={`bubbles ${hwOn ? 'fast' : 'slow'}`} clipPath="url(#tankClip)">{[531, 538, 546, 553, 561, 568, 574].map((cx, i) => <circle key={cx} cx={cx} cy={197 + (i % 3) * 4} r={i % 2 ? 2.2 : 3} className="bubble" style={{ animationDelay: `${(i * 0.31).toFixed(2)}s` }}/>)}</g>}
    <g className="diagram-label"><rect x="241" y="66" width="81" height="36" rx="7" fill="#fff" stroke="#ede2d7"/><text x="281" y="89" textAnchor="middle" fill="#b57746" fontSize="17" fontWeight="600">{number(supply?.value)}°</text><text x="281" y="53" textAnchor="middle" fill="#7b8b98" fontSize="10">PEALEVOOL</text><rect x="241" y="144" width="81" height="35" rx="7" fill="#fff" stroke="#dce9ed"/><text x="281" y="167" textAnchor="middle" fill="#427e90" fontSize="17" fontWeight="600">{number(returnT?.value)}°</text><text x="551" y="135" textAnchor="middle" fill="#427e90" fontSize="17" fontWeight="600">{number(water?.value)}°</text></g>
    <text x="157" y="246" textAnchor="middle" fill="#526c7e" fontSize="11" fontWeight="600">SOOJUSPUMP</text><text x="449" y="200" textAnchor="middle" fill="#526c7e" fontSize="10" fontWeight="600">KÜTTERING</text><text x="551" y="246" textAnchor="middle" fill="#526c7e" fontSize="10" fontWeight="600">TARBEVESI</text>
  </svg><div className="diagram-legend"><span><i className="legend-dot orange-dot"/>Pealevool</span><span><i className="legend-dot blue-dot"/>Tagasivool</span><span className={`diagram-state ${hwOn || heatOn ? 'active' : heatDemand || hwDemand ? 'demand' : ''}`}><CircleDot size={12}/>{activity}</span></div></div>;
}

const chartPalette = { light: ['#d55e00', '#0072b2', '#009e73', '#b0468a', '#6c757d'], dark: ['#ff8a3d', '#56b4e9', '#2fd0a0', '#e58fc0', '#b6bec4'] };
const PREV = 'p:';
const stateStyle = { heat: { label: 'Küte', color: '#e6a800' }, hw: { label: 'Tarbevee kütmine', color: '#8b6fd0' } };

function ChartTip({ active, payload, label, points, colors, spans, stateKnown, targets = [], gaps = [], prevShift = 0 }) {
  const items = active ? (payload || []).filter(e => e.value != null && points.some(p => plotKey(p.parameterId) === e.dataKey)) : [];
  const estimates = active && !items.length ? (payload || []).filter(e => e.value != null && points.some(p => estKey(p.parameterId) === e.dataKey)) : [];
  const inGap = gaps.some(g => label >= g.from && label <= g.to);
  const prevItems = active && prevShift ? (payload || []).filter(e => e.value != null && points.some(p => plotKey(PREV + p.parameterId) === e.dataKey)) : [];
  if (!items.length && !estimates.length && !prevItems.length) return null;
  const span = spans.find(s => label >= s.from && label < s.to), state = span ? stateStyle[span.kind] : null;
  return <div className="chart-tip">
    <b>{date(label, { weekday: 'short' })}</b>
    {items.map(e => { const i = points.findIndex(p => plotKey(p.parameterId) === e.dataKey), p = points[i]; return <div key={e.dataKey}><i style={{ background: colors[i % colors.length] }}/><span>{p.label}</span><strong>{number(e.value, 2)} {p.parameterUnit}</strong></div>; })}
    {prevItems.length > 0 && <div className="chart-tip-note">Eelmine periood ({date(label - prevShift, { weekday: 'short' })})</div>}
    {prevItems.map(e => { const i = points.findIndex(p => plotKey(PREV + p.parameterId) === e.dataKey), p = points[i]; return <div key={e.dataKey} className="chart-tip-prev"><i style={{ background: colors[i % colors.length] }}/><span>{p.label}</span><strong>{number(e.value, 2)} {p.parameterUnit}</strong></div>; })}
    {estimates.map(e => { const i = points.findIndex(p => estKey(p.parameterId) === e.dataKey), p = points[i]; return <div key={e.dataKey}><i style={{ background: 'transparent', borderColor: colors[i % colors.length] }}/><span>{p.label} (hinnang)</span><strong>≈ {number(e.value, 1)} {p.parameterUnit}</strong></div>; })}
    {inGap && <div className="chart-tip-note">Andmeid ei kogutud</div>}
    {targets.map(tg => { const v = payload.find(e => e.dataKey === targetKey(tg.id))?.value; return v == null ? null : <div key={tg.id}><i style={{ background: 'transparent', borderColor: tg.color }}/><span>{tg.label}</span><strong>{number(v, 2)} {tg.unit}</strong></div>; })}
    {stateKnown && !inGap && <div className="chart-tip-state"><i style={{ background: state ? state.color : 'transparent', borderColor: state ? state.color : 'currentColor' }}/><span>Seadme olek</span><strong>{state ? state.label : 'Seisab'}</strong></div>}
  </div>;
}

function HistoryChart({ deviceId, points, hours, tick, compact = false, theme, stateId = null, targets = [], name = null, footnote = true, defaultHidden = [], range = null, onZoom = null, compare = false, extra = '', auxDeviceId = null, src = null }) {
  const chartId = name || (compact ? 'small' : 'big');
  const [rows, setRows] = useState([]), [bucket, setBucket] = useState(0), [error, setError] = useState(null), [busy, setBusy] = useState(true), [limited, setLimited] = useState(false);
  const [stateRows, setStateRows] = useState([]), [hidden, setHidden] = useState(defaultHidden), [gapList, setGapList] = useState([]), [sinceMs, setSinceMs] = useState(NaN), [prevRows, setPrevRows] = useState([]), [drag, setDrag] = useState(null);
  const auxId = auxDeviceId || deviceId;
  const winQ = range ? `from=${encodeURIComponent(new Date(range.from).toISOString())}&to=${encodeURIComponent(new Date(range.to).toISOString())}` : `hours=${hours}`, winKey = range ? `${range.from}-${range.to}` : `h${hours}`;
  const winMs = range ? range.to - range.from : hours * 3600000;
  useEffect(() => { if (!deviceId && !src) return; const c = new AbortController(); setBusy(true); api(src ? `${src}&${winQ}` : `/history/${encodeURIComponent(deviceId)}?${winQ}${extra}`, { signal: c.signal }).then(d => { setRows(d.rows); setBucket(d.bucketSeconds || 0); setGapList(d.gaps || []); setSinceMs(Date.parse(d.since)); setLimited(d.limited); setError(null); }).catch(e => { if (!c.signal.aborted) setError(e.message); }).finally(() => { if (!c.signal.aborted) setBusy(false); }); return () => c.abort(); }, [deviceId, winKey, tick, extra, src]);
  useEffect(() => {
    if (!deviceId || !compare || compact) { setPrevRows([]); return; }
    const end = range ? range.from : Date.now() - winMs, c = new AbortController();
    api(`/history/${encodeURIComponent(deviceId)}?from=${encodeURIComponent(new Date(end - winMs).toISOString())}&to=${encodeURIComponent(new Date(end).toISOString())}${extra}`, { signal: c.signal })
      .then(d => setPrevRows(d.rows.map(r => ({ ...r, point: PREV + r.point, time: new Date(Date.parse(r.time) + winMs).toISOString() })))).catch(() => { if (!c.signal.aborted) setPrevRows([]); });
    return () => c.abort();
  }, [deviceId, winKey, compare, compact, tick, extra]);
  useEffect(() => {
    if (!deviceId || !stateId) { setStateRows([]); return; }
    const c = new AbortController();
    api(`/history/${encodeURIComponent(auxId)}?${winQ}&point=${encodeURIComponent(stateId)}&raw=1`, { signal: c.signal }).then(d => setStateRows(d.rows)).catch(() => { if (!c.signal.aborted) setStateRows([]); });
    return () => c.abort();
  }, [deviceId, auxId, winKey, tick, stateId]);
  const targetIds = targets.map(x => x.id).join(',');
  const [targetRows, setTargetRows] = useState({});
  useEffect(() => {
    if (!deviceId || !targetIds) { setTargetRows({}); return; }
    const c = new AbortController();
    Promise.all(targetIds.split(',').map(id => api(`/history/${encodeURIComponent(auxId)}?${winQ}&point=${encodeURIComponent(id)}&raw=1`, { signal: c.signal }).then(d => [id, d.rows]))).then(list => setTargetRows(Object.fromEntries(list))).catch(() => { if (!c.signal.aborted) setTargetRows({}); });
    return () => c.abort();
  }, [deviceId, auxId, winKey, tick, targetIds]);
  const dark = theme === 'dark', colors = chartPalette[dark ? 'dark' : 'light'];
  const gridStroke = dark ? '#2c3439' : '#e3e9ed', tickFill = dark ? '#a9b8c2' : '#5f7280', surface = dark ? '#232a2e' : '#fff';
  const ids = points.map(p => p.parameterId);
  // Puuduv mõõtmine katkestab joone, mitte ei joonista sirget, mis näitaks olematuid andmeid.
  const compareOn = compare && !compact;
  const lastAny = rows.reduce((m, r) => Math.max(m, Date.parse(r.time) || 0), 0);
  const fillFrom = range ? range.from : sinceMs, fillTo = range ? range.to : lastAny;
  const fillTimes = Number.isFinite(fillFrom) && fillTo > fillFrom ? Array.from({ length: 241 }, (_, i) => fillFrom + i * (fillTo - fillFrom) / 240) : [];
  const data = mergeSeries(compareOn ? [...rows, ...prevRows] : rows, compareOn ? [...ids, ...ids.map(id => PREV + id)] : ids, bucket, fillTimes);
  const targetLinesShown = targets.filter(tg => targetRows[tg.id]?.length && !hidden.includes(tg.forId)).map(tg => ({ ...tg, index: points.findIndex(p => p.parameterId === tg.forId), color: colors[2] })).filter(tg => tg.index >= 0);
  for (const tg of targetLinesShown) holdValues(targetRows[tg.id], data.map(r => r.time)).forEach((v, i) => { if (v != null) data[i][targetKey(tg.id)] = v; });
  const realCount = data.filter(r => ids.some(id => r[id] != null)).length;
  const stride = Math.max(1, Math.ceil(data.length / 700));
  const chartData = data.filter((r, i) => i % stride === 0 || i === data.length - 1 || r.gap);
  const shown = points.filter(p => !hidden.includes(p.parameterId));
  // Esimese nähtava seeria ühik on vasak telg, teine ühik (nt kW) läheb paremale teljele.
  const units = [...new Set(shown.map(p => p.parameterUnit))];
  const sideOf = p => p.parameterUnit === units[0] ? 'left' : 'right';
  const axisOf = p => sideOf(p) === 'right' ? 'right' : 0;
  const scaleFor = side => {
    const v = data.flatMap(r => [...shown.filter(p => sideOf(p) === side).flatMap(p => compareOn ? [r[p.parameterId], r[PREV + p.parameterId]] : [r[p.parameterId]]), ...targetLinesShown.filter(tg => sideOf(points[tg.index]) === side).map(tg => r[targetKey(tg.id)])]).filter(x => x != null);
    return v.length ? niceScale(Math.min(...v), Math.max(...v), compact ? 4 : 5, side === 'left' && units[0] === '°C' ? 2 : 0) : null;
  };
  const yScale = scaleFor('left') || niceScale(0, 1), yRight = units.length > 1 ? scaleFor('right') : null;
  // Kõigil graafikutel sama ajatelg: algus on perioodi algus, lõpp viimane mõõtmine mis tahes näidul.
  const from = range ? range.from : Number.isFinite(sinceMs) && data.length ? Math.min(sinceMs, data[0].time) : data[0]?.time, to = range ? range.to : data.length ? Math.max(data.at(-1).time, lastAny) : undefined;
  const spanH = (to - from) / 3600000;
  const narrow = typeof window !== 'undefined' && window.innerWidth < 700;
  const xScale = timeTicks(from, to, compact || narrow ? 4 : 7);
  const gaps = gapList.map(g => ({ from: Date.parse(g.from), to: Date.parse(g.to) })).filter(g => Number.isFinite(g.from) && g.to > from && g.from < to);
  const spans = stateId && from != null ? clipSpans(stateSpans(stateRows, from, to, wzsvWorkState), gaps).filter(s => s.kind !== 'idle') : [];
  const stateKnown = Boolean(stateId) && stateRows.length > 0;
  const single = shown.length === 1;
  const unit = units.join(' · ');
  const toggle = id => setHidden(h => h.includes(id) ? h.filter(x => x !== id) : shown.length > 1 ? [...h, id] : h);
  const stats = compact ? [] : shown.map(p => ({ p, s: seriesStats(data, p.parameterId), prev: compareOn ? seriesStats(data, PREV + p.parameterId) : null, i: points.indexOf(p) })).filter(x => x.s);
  const dotFor = (id, color, few) => {
    const key = plotKey(id), lonely = new Set(chartData.filter((r, i) => r[id] != null && chartData[i - 1]?.[key] == null && chartData[i + 1]?.[key] == null).map(r => r.time));
    return ({ cx, cy, payload, index }) => <circle key={index} cx={cx} cy={cy} r={payload[id] != null && (few || lonely.has(payload.time)) ? 3 : 0} fill={color}/>;
  };
  const labelAt = s => s?.activeLabel ?? chartData[Number(s?.activeTooltipIndex)]?.time;
  const finishDrag = apply => {
    if (drag && apply) { const a = Math.min(drag.a, drag.b), b = Math.max(drag.a, drag.b); if (b - a >= 10 * 60000) onZoom({ from: Math.round(a), to: Math.round(b) }); }
    setDrag(null);
  };
  const zoomHandlers = onZoom && !compact ? {
    onMouseDown: s => { const x = labelAt(s); if (Number.isFinite(x)) setDrag({ a: x, b: x }); },
    onMouseMove: s => { const x = labelAt(s); if (drag && Number.isFinite(x)) setDrag(d => d && { ...d, b: x }); },
    onMouseUp: () => finishDrag(true),
    onMouseLeave: () => finishDrag(false)
  } : {};
  if (error) return <Empty icon={AlertCircle} title="Ajalugu pole kättesaadav">{error}</Empty>;
  if (busy && !data.length) return <div className="chart-loading"><LoaderCircle className="spin" size={22}/> Laadin mõõtmisi…</div>;
  return <div className={compact ? 'chart-wrap compact' : 'chart-wrap'}>{realCount < 2 ? range ? <Empty icon={History} title="Sellel ajavahemikul pole mõõtmisi">Vali teine ajavahemik või lähtesta suum.</Empty> : <Empty icon={History} title="Ajalugu hakkab kogunema">Salvestame uued mõõtmised iga minuti järel, kuni Soojuse server töötab. Graafik ilmub pärast vähemalt kaht mõõtmisaega.</Empty> : <>
    <div className="chart-legend">
      {points.map((p, i) => { const last = seriesStats(data, p.parameterId)?.last, off = hidden.includes(p.parameterId); return <button type="button" key={p.parameterId} className={off ? 'off' : ''} aria-pressed={!off} title={off ? 'Näita graafikul' : 'Peida graafikult'} onClick={() => toggle(p.parameterId)}><span className="swatch" style={{ background: colors[i % colors.length] }}/>{p.label}{last != null && <b>{number(last, 1)} {p.parameterUnit}</b>}</button>; })}
      {unit && <span className="chart-unit">{unit}</span>}
    </div>
    <div className={onZoom && !compact ? 'chart-canvas zoomable' : 'chart-canvas'} onDoubleClick={() => range && onZoom?.(null)} role="img" aria-label={`Graafik: ${shown.map(p => p.label).join(', ')}, ${date(from)} – ${date(to)}`}><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }} {...zoomHandlers}>
      <defs><pattern id={`hatch-${chartId}`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill={tickFill} fillOpacity=".07"/><line x1="0" y1="0" x2="0" y2="7" stroke={tickFill} strokeOpacity=".28" strokeWidth="1.5"/></pattern>{points.map((p, i) => <linearGradient id={`fill-${chartId}-${p.parameterId}`} key={p.parameterId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={colors[i % colors.length]} stopOpacity={.22}/><stop offset="100%" stopColor={colors[i % colors.length]} stopOpacity={0}/></linearGradient>)}</defs>
      <CartesianGrid vertical={false} stroke={gridStroke} strokeDasharray="3 4"/>
      {gaps.map(g => <ReferenceArea key={`gap-${g.from}`} x1={Math.max(g.from, from)} x2={Math.min(g.to, to)} fill={`url(#hatch-${chartId})`} stroke="none" ifOverflow="hidden"/>)}
      {spans.map(s => <ReferenceArea key={`${s.kind}-${s.from}`} x1={s.from} x2={s.to} fill={stateStyle[s.kind].color} fillOpacity={dark ? .2 : .16} stroke="none" ifOverflow="hidden"/>)}
      <XAxis dataKey="time" type="number" domain={[from, to]} ticks={xScale.ticks} interval={0} tickFormatter={v => timeTickLabel(v, xScale.step)} tickLine={false} axisLine={{ stroke: gridStroke }} tickMargin={8} tick={{ fontSize: 12, fill: tickFill }}/>
      <YAxis domain={yScale.domain} ticks={yScale.ticks} interval={0} width={Math.max(30, 12 + 8 * Math.max(...(yScale.ticks || [0]).map(v => axisNumber(v, yScale.decimals).length)))} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: tickFill }} tickFormatter={v => axisNumber(v, yScale.decimals)}/>
      {yRight && <YAxis yAxisId="right" orientation="right" domain={yRight.domain} ticks={yRight.ticks} interval={0} width={Math.max(30, 12 + 8 * Math.max(...yRight.ticks.map(v => `${axisNumber(v, yRight.decimals)} ${units[1]}`.length)))} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: tickFill }} tickFormatter={v => `${axisNumber(v, yRight.decimals)} ${units[1]}`}/>}
      <Tooltip isAnimationActive={false} cursor={{ stroke: tickFill, strokeWidth: 1, strokeDasharray: '4 3' }} content={props => drag ? null : <ChartTip {...props} points={points} colors={colors} spans={spans} stateKnown={stateKnown} targets={targetLinesShown} gaps={gaps} prevShift={compareOn ? winMs : 0}/>}/>
      {drag && drag.a !== drag.b && <ReferenceArea x1={drag.a} x2={drag.b} fill={tickFill} fillOpacity={.18} stroke={tickFill} strokeOpacity={.5} ifOverflow="hidden"/>}
      {compareOn && shown.map(p => <Area key={`g${p.parameterId}`} yAxisId={axisOf(p)} type="monotone" dataKey={plotKey(PREV + p.parameterId)} stroke={colors[points.indexOf(p) % colors.length]} strokeOpacity={.4} strokeWidth={1.75} fill="none" dot={false} activeDot={false} connectNulls={false} isAnimationActive={false}/>)}
      {targetLinesShown.map(tg => <Area key={`t${tg.id}`} yAxisId={axisOf(points[tg.index])} type="stepAfter" dataKey={targetKey(tg.id)} stroke={tg.color} strokeDasharray="6 4" strokeWidth={1.5} fill="none" dot={false} activeDot={false} isAnimationActive={false}/>)}
      {shown.map(p => <Area key={`e${p.parameterId}`} yAxisId={axisOf(p)} type="stepAfter" dataKey={estKey(p.parameterId)} stroke={colors[points.indexOf(p) % colors.length]} strokeOpacity={.75} strokeDasharray="2 5" strokeLinecap="round" strokeWidth={2} fill="none" dot={false} activeDot={false} connectNulls={false} isAnimationActive={false}/>)}
      {shown.map(p => { const i = points.indexOf(p), color = colors[i % colors.length]; return <Area key={p.parameterId} yAxisId={axisOf(p)} type="monotone" dataKey={plotKey(p.parameterId)} stroke={color} fill={single ? `url(#fill-${chartId}-${p.parameterId})` : 'none'} strokeWidth={2} connectNulls={false} isAnimationActive={false} dot={dotFor(p.parameterId, color, realCount < 12)} activeDot={{ r: 5, fill: color, stroke: surface, strokeWidth: 2 }}/>; })}
    </AreaChart></ResponsiveContainer></div>
    {(spans.length > 0 || targetLinesShown.length > 0 || gaps.length > 0 || compareOn) && <div className="chart-bands">{compareOn && <span><i className="ghost"/>Eelmine periood: {date(from - winMs)} – {date(from)}{prevRows.length === 0 ? ' (andmeid pole)' : ''}</span>}{gaps.length > 0 && <span><i className="hatch"/>Andmeid ei kogutud · punktiir on hinnang</span>}{targetLinesShown.map(tg => <span key={tg.id}><i className="dash" style={{ borderColor: tg.color }}/>{tg.label} ({number(data.at(-1)[targetKey(tg.id)], 1)} {tg.unit})</span>)}{Object.entries(stateStyle).filter(([k]) => spans.some(s => s.kind === k)).map(([k, v]) => <span key={k}><i style={{ background: v.color }}/>{v.label}</span>)}</div>}
    {stats.length > 0 && <div className="table-scroll"><table className="chart-stats"><caption>Perioodi kokkuvõte{bucket > 60 ? ' (koondatud keskmistest)' : ''}</caption><thead><tr><th scope="col">Näit</th><th scope="col">Min</th><th scope="col">Keskmine</th><th scope="col">Max</th><th scope="col">Viimane</th>{compareOn && <><th scope="col">Eelmine keskmine</th><th scope="col">Muutus</th></>}</tr></thead><tbody>{stats.map(({ p, s, prev, i }) => <tr key={p.parameterId}><th scope="row"><span className="swatch" style={{ background: colors[i % colors.length] }}/>{p.label}</th>{[s.min, s.avg, s.max, s.last].map((v, k) => <td key={k}>{number(v, 1)} {p.parameterUnit}</td>)}{compareOn && (prev ? <><td>{number(prev.avg, 1)} {p.parameterUnit}</td><td>{s.avg - prev.avg > 0 ? '+' : ''}{number(s.avg - prev.avg, 1)} {p.parameterUnit}</td></> : <><td>—</td><td>—</td></>)}</tr>)}</tbody></table></div>}
    {footnote && <div className="chart-footnote"><Clock3 size={12}/>{date(from)} – {spanH > 24 ? date(to) : time(to)} <span>{realCount} ajavahemikku · {bucket <= 60 ? '1 min' : bucket <= 600 ? '10 min' : bucket <= 3600 ? '1 h' : '1 päev'} keskmised{data.some(r => r.gap) ? ' · mõõtmisteta vahemikud on punktiirjoonega ühendatud' : ''}{limited ? ' · päringu piir saavutatud' : ''}</span></div>}
  </>}</div>;
}

function Reading({ point }) { return <div className="reading"><span>{point.label}</span><b>{point.enumValues?.length || typeof point.value === 'string' && !Number.isFinite(Number(point.value)) ? point.display : <>{number(point.value,2)} <small>{point.parameterUnit}</small></>}</b><small>{time(point.timestamp)}</small></div>; }

function ControlPage({ waterPage, points, zones, online, setEditing, categories, mode, errors }) {
  const group = waterPage ? 'Tarbevesi' : 'Küte';
  const filtered = points.filter(p => p.group === group);
  const writable = filtered.filter(p => p.writable);
  return <>
    <div className="control-intro"><div className={`control-intro-icon ${waterPage ? 'blue' : 'orange'}`}>{waterPage ? <Droplets size={30}/> : <Flame size={30}/>}</div><div><h2>{waterPage ? 'Soe vesi igaks päevaks' : 'Tasakaalus kodukliima'}</h2><p>{waterPage ? 'Juhi tarbevee tootmist ja vajadusel lisa sooja vee varu.' : 'Kohanda kütte temperatuuri nihet, töörežiimi ja välisõhupiiri.'}</p></div><Badge tone={online ? 'green':'amber'}>{online ? 'Juhtimiseks valmis' : 'Seade pole võrgus'}</Badge></div>
    <h2 className="section-heading">Seadistused <span>{writable.length} parameetrit</span></h2>
    <div className="control-grid">{writable.map(p => <section className="panel control-card" key={p.parameterId}><div className="control-card-top"><span className={`square-icon ${waterPage ? 'blue':'orange'}`}>{p.enumValues?.length ? <Power size={19}/> : <Thermometer size={19}/>}</span><span className="param-id">#{p.parameterId}</span></div><h3>{p.label}</h3><div className="control-current">{p.enumValues?.length ? p.display : <>{number(p.value)} <small>{p.parameterUnit || (p.parameterId === '6147' ? 'sek' : '')}</small></>}</div><p>{p.parameterId === '6147' ? `${number(Number(p.value)/3600)} tundi · 30 minuti kaupa` : p.enumValues?.length ? `${p.enumValues.length} seadme lubatud valikut` : `Vahemik ${number(p.min)}–${number(p.max)} ${p.parameterUnit} · samm ${number(p.step,3)}`}</p><Button icon={SlidersHorizontal} onClick={() => setEditing({ type:'point', point:p })} disabled={!online}>Muuda seadistust</Button></section>)}</div>
    {!writable.length && <section className="panel"><Empty icon={SlidersHorizontal} title="Muudetavaid parameetreid ei leitud">Selle valdkonna seadistusi sinu seade avaliku API kaudu ei paku. Kõik saadaolevad näidud on parameetrite vaates.</Empty></section>}
    {waterPage && zones.length > 0 && <><h2 className="section-heading">Tarbeveetsoonid <span>{zones.length} tsooni</span></h2><div className="zone-grid">{zones.map(z => <section className="panel zone-card" key={z.zoneId}><div><span className="square-icon blue"><Droplets size={21}/></span><h3>{z.name}</h3><Badge tone={z.mode==='off' ? 'gray':'blue'}>{enumText(z.mode)}</Badge></div><div className="zone-values"><span>Hetkel<b>{z.commandOnly ? '—' : number(z.temperature)}<small>{z.commandOnly ? '' : z.isCelsius ? '°C':'°F'}</small></b></span><span>Siht<b>{number(z.setpointHeat)}<small>{z.commandOnly ? '' : z.isCelsius ? '°C':'°F'}</small></b></span></div><Button icon={Settings2} onClick={() => setEditing({ type:'zone', zone:z })} disabled={!online}>Tsooni seadistused</Button></section>)}</div></>}
    {waterPage && errors.zones && <div className="info-banner warning"><AlertCircle size={17}/>Tsoonid: {errors.zones}</div>}
    {!waterPage && categories['sh-smartMode'] && <section className="panel smart-mode"><PanelTitle title="Kodu režiim" subtitle={`Praegu: ${enumText(mode)}`}/><Button onClick={() => setEditing({ type:'mode', mode })} disabled={!online}>Muuda kodurežiimi</Button></section>}
    <section className="panel readings-panel"><PanelTitle title={waterPage ? 'Tarbevee näidud' : 'Kütteringi näidud'} subtitle="Seadme raporteeritud väärtused"/><div className="reading-grid">{filtered.filter(p => !p.writable).map(p => <Reading key={p.parameterId} point={p}/>)}</div></section>
    <div className="info-banner"><CircleHelp size={18}/><span>Ajagraafikuid see seade avaliku API kaudu ei paku. Ajastust saad hallata seadme enda juhtpaneelilt.</span></div>
  </>;
}

function Parameters({ points, search, setSearch, setEditing, favorites, favorite, selection, online }) {
  const [group,setGroup] = useState('Kõik'), [onlyWritable,setOnlyWritable] = useState(false), [onlyFavorites,setOnlyFavorites] = useState(false);
  const groups = ['Kõik', ...new Set(points.map(p => p.group))];
  const visible = points.filter(p => (group==='Kõik' || p.group===group) && (!onlyWritable || p.writable) && (!onlyFavorites || favorites.includes(`${selection}:${p.parameterId}`)) && `${p.label} ${p.parameterName} ${p.parameterId}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="panel parameters-panel"><div className="table-toolbar"><label className="search-input"><Search size={17}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Otsi nime või parameetri ID järgi…" aria-label="Otsi parameetreid"/>{search && <button className="icon-button" onClick={() => setSearch('')} aria-label="Tühjenda otsing"><X size={15}/></button>}</label><label className="check-filter"><input type="checkbox" checked={onlyWritable} onChange={e => setOnlyWritable(e.target.checked)}/>Ainult muudetavad</label><button className={`button ${onlyFavorites ? 'selected':'secondary'}`} onClick={() => setOnlyFavorites(!onlyFavorites)}><Star size={15}/>Lemmikud</button></div><div className="filter-tabs">{groups.map(g => <button className={group===g ? 'selected':''} key={g} onClick={() => setGroup(g)}>{g}<span>{g==='Kõik'?points.length:points.filter(p => p.group===g).length}</span></button>)}</div><div className="table-scroll"><table><thead><tr><th aria-label="Lemmik"/><th>PARAMEETER</th><th>VÄÄRTUS</th><th>VIIMANE MÕÕTMINE</th><th>ÕIGUSED</th><th/></tr></thead><tbody>{visible.map(p => <tr key={p.parameterId}><td><button className={`icon-button star-button ${favorites.includes(`${selection}:${p.parameterId}`) ? 'is-favorite':''}`} aria-label={`${favorites.includes(`${selection}:${p.parameterId}`) ? 'Eemalda lemmikutest':'Lisa lemmikuks'}: ${p.label}`} onClick={() => favorite(`${selection}:${p.parameterId}`)}><Star size={16}/></button></td><td><b>{p.label}</b><small>#{p.parameterId} · {p.group}</small></td><td className="table-value">{p.display}</td><td className="table-date">{date(p.timestamp)}</td><td><span className={`permission ${p.writable ? 'writable':''}`}>{p.writable ? 'Muudetav':'Ainult lugemine'}</span></td><td>{p.writable && <button className="text-button" disabled={!online} onClick={() => setEditing({ type:'point', point:p })}>Muuda <ChevronRight size={14}/></button>}</td></tr>)}</tbody></table></div>{!visible.length && <Empty icon={Search} title="Sobivaid parameetreid ei leitud">Muuda otsingut või eemalda mõni filter.</Empty>}<div className="table-footer">Kuvatud {visible.length} / {points.length} parameetrit<span>{points.filter(p=>p.writable).length} muudetavat seadistust</span></div></section>;
}

// Arhiivivaatur: vali arhiivifail ja seeriad, graafik loetakse otse CSV-failist (ainult lugemine).
function ArchiveViewer({ tick, theme }) {
  const [files, setFiles] = useState(null), [name, setName] = useState(''), [meta, setMeta] = useState(null), [picked, setPicked] = useState([]), [error, setError] = useState(null);
  useEffect(() => { api('/archive').then(d => { setFiles(d.files); if (!name && d.files[0]) setName(d.files[0].name); }).catch(e => setError(e.message)); }, [tick]);
  useEffect(() => { if (!name) return; setMeta(null); setPicked([]); api(`/archive/${encodeURIComponent(name)}`).then(setMeta).catch(e => setError(e.message)); }, [name, tick]);
  if (error) return <p className="inline-error" role="alert">{error}</p>;
  if (!files) return <div className="chart-loading"><LoaderCircle className="spin"/>Laadin arhiivi…</div>;
  if (!files.length) return <section className="panel history-panel"><PanelTitle title="Arhiiv" subtitle="Ainult lugemine"/><Empty icon={History} title="Arhiivifaile pole veel">Arhiveeri vanemad andmed lehel „Seaded ja ühendus“.</Empty></section>;
  const series = meta?.series || [];
  const points = picked.map(t => { const s = series.find(x => x.token === t); return { parameterId: t, label: s.label, parameterUnit: s.unit }; });
  const src = name && picked.length ? `/archive/${encodeURIComponent(name)}/history?s=${encodeURIComponent(picked.join(','))}` : null;
  const range = meta?.from && meta?.to ? { from: Date.parse(meta.from), to: Date.parse(meta.to) + 1000 } : null;
  const toggle = t => setPicked(p => p.includes(t) ? p.filter(x => x !== t) : p.length < 5 ? [...p, t] : p);
  return <section className="panel history-panel">
    <PanelTitle title="Arhiiv" subtitle={`${files.length} faili · ainult lugemine · vali kuni viis seeriat`}/>
    <div className="history-toolbar"><label className="field"><span>Arhiivifail</span><select value={name} onChange={e => setName(e.target.value)} aria-label="Arhiivifail">{files.map(f => <option key={f.name} value={f.name}>{f.name} · {(f.bytes / 1024).toFixed(0)} KB</option>)}</select></label>{range && <span className="muted">{date(new Date(range.from))} – {date(new Date(range.to))}</span>}</div>
    {meta && <>
      <div className="point-picker">{series.map(s => <button key={s.token} type="button" className={picked.includes(s.token) ? 'selected' : ''} aria-pressed={picked.includes(s.token)} onClick={() => toggle(s.token)}>{s.label}<span>{s.unit}</span></button>)}</div>
      {src ? <HistoryChart key={`${name}-${picked.join(',')}`} name={`arch-${name}`} deviceId="archive" src={src} points={points} hours={24} range={range} tick={tick} theme={theme} footnote={false}/> : <p className="muted">Vali ülalt kuni viis seeriat, mida graafikul näidata.</p>}
    </>}
  </section>;
}

function HistoryPage({ deviceId, points, tick, theme, stateId, model, ventPoints = [], luxPoints = [] }) {
  const [hours, setHours] = useState(24), [ids, setIds] = useState([]), [range, setRange] = useState(null), [compare, setCompare] = useState(false), [mode, setMode] = useState('active');
  const isNumeric = p => p.value != null && p.value !== '' && Number.isFinite(Number(p.value)) && !p.enumValues?.length;
  const pumpPoints = points.filter(isNumeric);
  // Ventilatsiooni näidud saavad eesliite a:, et need ei läheks soojuspumba numbriliste id-dega segi.
  const vent = ventPoints.filter(isNumeric).map(p => ({ ...p, parameterId: `a:${p.parameterId}`, ext: true }));
  const lx = luxPoints.filter(isNumeric).map(p => ({ ...p, parameterId: `l:${p.parameterId}`, ext: true }));
  const numerical = [...pumpPoints, ...vent, ...lx];
  const chosen = ids.length ? numerical.filter(p => ids.includes(p.parameterId)) : [];
  const selected = chosen.length ? chosen : pumpPoints.filter(p => p.parameterUnit === '°C').slice(0, 3);
  const unit = selected[0]?.parameterUnit, mixed = selected.some(p => p.ext);
  const chartPoints = mixed ? selected.map(p => p.ext ? p : { ...p, parameterId: `p:${p.parameterId}` }) : selected;
  const enc = encodeURIComponent, mixQuery = `&pump=${enc(deviceId)}&s=${chartPoints.map(p => enc(p.parameterId)).join(',')}`;
  const windowQuery = range ? `from=${enc(new Date(range.from).toISOString())}&to=${enc(new Date(range.to).toISOString())}` : `hours=${hours}`;
  const csvHref = `/api/history/${mixed ? 'mix' : enc(deviceId)}?${windowQuery}${mixed ? mixQuery : ''}&format=csv`;
  const targets = targetLines(points, model, selected.filter(p => !p.ext).map(p => p.parameterId)).map(t => mixed ? { ...t, forId: `p:${t.forId}` } : t);
  function toggle(p) {
    const current = selected.map(x => x.parameterId);
    if (current.includes(p.parameterId)) { if (current.length > 1) setIds(current.filter(x => x !== p.parameterId)); }
    else if (p.parameterUnit !== unit) setIds([p.parameterId]);
    else if (current.length < 5) setIds([...current, p.parameterId]);
  }
  const pick = p => <button key={p.parameterId} type="button" className={selected.some(s => s.parameterId === p.parameterId) ? 'selected' : ''} onClick={() => toggle(p)}>{p.label}<span>{p.parameterUnit}</span></button>;
  return <><div className="segmented" role="group" aria-label="Ajaloo vaade"><button type="button" className={mode==='active'?'selected':''} onClick={()=>setMode('active')}>Aktiivne ajalugu</button><button type="button" className={mode==='archive'?'selected':''} onClick={()=>setMode('archive')}>Arhiiv</button></div>{mode === 'archive' ? <ArchiveViewer tick={tick} theme={theme}/> : <><div className="history-toolbar"><div className="history-controls"><div className="segmented">{[[6,'6 tundi'],[24,'24 tundi'],[168,'7 päeva'],[720,'30 päeva'],[8760,'Aasta'],[43800,'5 aastat'],[87600,'10 aastat']].map(([v,t])=><button key={v} className={!range && hours===v?'selected':''} onClick={()=>{setHours(v);setRange(null);}}>{t}</button>)}</div><button type="button" className={`button ${compare?'selected':'secondary'}`} aria-pressed={compare} onClick={()=>setCompare(!compare)}><History size={16}/>Võrdle eelmise perioodiga</button>{range&&<button type="button" className="button secondary" onClick={()=>setRange(null)}><X size={16}/>Lähtesta suum · {date(range.from)} – {time(range.to)}</button>}</div><a className="button secondary" href={csvHref}><Download size={16}/>Ekspordi CSV</a></div><section className="panel history-panel"><PanelTitle title="Mõõtmiste ajalugu" subtitle={`Ühik: ${unit || 'arvväärtus'} · vali kuni viis sama ühikuga näitu${vent.length || lx.length ? ' (kõik seadmed)' : ''} · suumimiseks lohista hiirega üle graafiku, lähtestamiseks tee topeltklõps`}/><div className="point-picker">{(vent.length > 0 || lx.length > 0) && <span className="point-group">Soojuspump</span>}{pumpPoints.map(pick)}{vent.length > 0 && <span className="point-group">Ventilatsioon (Airobot)</span>}{vent.map(pick)}{lx.length > 0 && <span className="point-group">Soojuspump, kohtvõrk (soojakandja)</span>}{lx.map(pick)}</div><HistoryChart key={mixed ? 'mix' : 'pump'} deviceId={mixed ? 'mix' : deviceId} auxDeviceId={deviceId} extra={mixed ? mixQuery : ''} points={chartPoints} hours={hours} tick={tick} theme={theme} stateId={stateId} range={range} onZoom={setRange} compare={compare} targets={targets}/></section><div className="info-banner"><History size={19}/><div><b>Ajalugu koguneb alates rakenduse ühendamisest.</b><p>Soojus salvestab tegelikud andmed kohalikku andmebaasi kord minutis. Server peab kogumiseks töötama. Säilitame kuni 10 aastat; vanemad andmed koondatakse päevakeskmisteks. Varasemat myUplinki ajalugu avalik API ei väljasta.</p></div></div></>}</>;
}

function AlarmsPage({ systemId, tick }) {
  const [active,setActive] = useState(true), [page,setPage]=useState(1), [data,setData]=useState(null), [error,setError]=useState(null), [busy,setBusy]=useState(false);
  useEffect(()=>{if(!systemId)return;const c=new AbortController();setBusy(true);api(`/systems/${encodeURIComponent(systemId)}/notifications?active=${active}&page=${page}`,{signal:c.signal}).then(d=>{setData(d);setError(null);}).catch(e=>{if(!c.signal.aborted)setError(e.message);}).finally(()=>{if(!c.signal.aborted)setBusy(false);});return()=>c.abort();},[systemId,active,page,tick]);
  return <section className="panel"><PanelTitle title="Sündmuste logi" subtitle="Seadme teavitused myUplinkist" action={<div className="segmented"><button className={active?'selected':''} onClick={()=>{setActive(true);setPage(1);}}>Aktiivsed</button><button className={!active?'selected':''} onClick={()=>{setActive(false);setPage(1);}}>Kõik sündmused</button></div>}/>{error?<Empty icon={AlertCircle} title="Teavitusi ei saanud laadida">{error}</Empty>:busy?<div className="chart-loading"><LoaderCircle className="spin"/>Laadin teavitusi…</div>:!data?.notifications?.length?<Empty icon={ShieldCheck} title={active?'Aktiivseid häireid pole':'Sündmusi ei leitud'}>{active?'Soojuspump pole edastanud ühtegi aktiivset häiret. Varasemaid teateid näed kõigi sündmuste alt.':'Selles vaates teavitused puuduvad.'}</Empty>:<div className="alarm-list">{[...data.notifications].sort((a,b)=>String(b.createdDatetime).localeCompare(String(a.createdDatetime))).map(n=><article className="alarm-row" key={n.id}><span className={`square-icon ${n.status==='Active'?'orange':'teal'}`}>{n.status==='Active'?<AlertCircle size={20}/>:<CheckCheck size={20}/>}</span><div><h3>{n.header || `Häire ${n.alarmNumber}`}</h3><p>{n.description}</p><small>#{n.alarmNumber} · {date(n.createdDatetime)}</small></div><Badge tone={n.status==='Active'?'amber':'gray'}>{n.status==='Active'?'Aktiivne':'Lõppenud'}</Badge></article>)}</div>}<div className="table-footer"><span>{data?.numItems || 0} sündmust</span><div className="pagination"><button disabled={page<=1||busy} onClick={()=>setPage(p=>p-1)}>Eelmine</button><span>Leht {page}</span><button disabled={!data || page*20>=data.numItems||busy} onClick={()=>setPage(p=>p+1)}>Järgmine</button></div></div><div className="panel-note">Häirete lähtestamiseks ava <a href="https://myuplink.com/system-profile?tab=event-log" target="_blank" rel="noreferrer">myUplinki sündmuste logi <ExternalLink size={12}/></a> või kasuta seadme juhtpaneeli.</div></section>;
}

function DevicePage({ device, model, detail, firmware, aid, subscriptions, categories, zones, points, online, errors }) {
  const subs = Array.isArray(subscriptions) ? subscriptions.flatMap(s=>s.subscriptions||[]) : subscriptions?.subscriptions||[];
  return <><section className="panel device-hero"><div className="device-portrait"><div className="mini-pump"><span>soojus.</span><div className="pump-screen"><Activity size={26}/></div><i/><i/><div className="pump-bottom"/></div></div><div className="device-hero-info"><span className="eyebrow">SINU SOOJUSPUMP</span><h2>{model}</h2><p>Ühendatud kodu juhtimiskeskusega</p><Badge tone={online?'green':'amber'}>{online?'Võrgus':'Võrguühenduseta'}</Badge><div className="device-facts"><div><small>SEERIANUMBER</small><b>{device?.product?.serialNumber || '—'}</b></div><div><small>PARAMEETREID</small><b>{points.length}</b></div><div><small>JUHITAVAID TSOONE</small><b>{zones.length}</b></div></div></div></section><div className="two-columns"><section className="panel"><PanelTitle title="Püsivara ja ühendus"/><dl className="detail-list"><div><dt>Praegune versioon</dt><dd>{firmware?.currentFwVersion || '—'}</dd></div><div><dt>Saadaolev versioon</dt><dd>{firmware?.desiredFwVersion || '—'}</dd></div><div><dt>Püsivara tüüp</dt><dd>{firmware?.firmwareId || '—'}</dd></div><div><dt>Tootja</dt><dd>{firmware?.brand || '—'}</dd></div><div><dt>Abirežiim</dt><dd>{aid?.aidMode ? enumText(aid.aidMode) : '—'}</dd></div><div><dt>Seadme ID</dt><dd className="id-value">{device?.id}</dd></div></dl>{errors.firmware&&<p className="inline-error">{errors.firmware}</p>}<div className="button-row">{firmware?.firmwareId && firmware?.desiredFwVersion && <a className="button secondary" href={`/api/firmware/${encodeURIComponent(firmware.firmwareId)}/${encodeURIComponent(firmware.desiredFwVersion)}/download`}><Download size={16}/>Laadi püsivara alla</a>}<a className="text-button" href="https://myuplink.com/update-firmware" target="_blank" rel="noreferrer">Uuendamine myUplinkis <ExternalLink size={14}/></a></div></section><section className="panel"><PanelTitle title="Tellimused ja õigused" subtitle="Konto teenused myUplinkis"/>{errors.subscriptions?<p className="inline-error">{errors.subscriptions}</p>:subs.length?subs.map((s,i)=><div className="subscription-row" key={i}><span className="square-icon teal"><ShieldCheck size={21}/></span><div><h3>{s.type==='manage'?'Kaugjuhtimine':s.type==='history'?'Ajalugu':s.type}</h3><p>Kehtiv kuni {date(s.validUntil,{hour:undefined,minute:undefined})}</p></div><Badge tone={Date.parse(s.validUntil)>Date.now()?'green':'gray'}>{Date.parse(s.validUntil)>Date.now()?'Aktiivne':'Aegunud'}</Badge></div>):<p className="muted">Aktiivseid tellimusi ei tagastatud.</p>}<div className="panel-note">Funktsioonide kasutatavus sõltub seadme toest ja sinu konto õigustest.</div></section></div><section className="panel capabilities-panel"><PanelTitle title="Seadme API-võimalused" subtitle="Võimekused tuvastatakse sinu seadmelt automaatselt."/><div className="capabilities">{[['Tarbevee kiirlaadimine',categories['sh-hwBoost']],['Tarbevee töörežiim',categories['sh-hwMode']],['Temperatuuri seadistamine',points.some(p=>p.writable&&p.parameterUnit==='°C')],['Tsoonide juhtimine',zones.length>0],['Välisõhu mõõtmine',categories['sh-outdoorTemp']],['Kodurežiimid',categories['sh-smartMode']],['Elektrienergia arvesti',categories['sh-energyMetered']],['Ventilatsiooni juhtimine',categories['sh-ventMode']],['Basseiniküte',categories['sh-poolTemp']],['Päikeseenergia',categories['sh-solarEnergyProducedDay']],['Ajagraafikud',detail?.availableFeatures?.getScheduleWeekly]].map(([name,enabled])=><div className={enabled?'supported':'unsupported'} key={name}><span>{enabled?<Check size={15}/>:<Minus size={15}/>}</span>{name}<small>{enabled?'Saadaval':'Ei ole toetatud'}</small></div>)}</div></section></>;
}

function SettingsPage({ status, notify, onConnect, tick, navigate, ui = 'classic', setUi, weather, lux }) {
  const [clientId,setClientId]=useState(''),[secret,setSecret]=useState(''),[busy,setBusy]=useState(false),[audit,setAudit]=useState([]),[auditError,setAuditError]=useState(null),[testing,setTesting]=useState(false),[archiving,setArchiving]=useState(false),[archiveMsg,setArchiveMsg]=useState(null),[archiveBefore,setArchiveBefore]=useState(()=>new Date(Date.now()-365*86400000).toISOString().slice(0,10));
  const archiveMax = new Date(Date.now()-365*86400000).toISOString().slice(0,10);
  useEffect(()=>{api('/audit').then(setAudit).catch(e=>setAuditError(e.message));},[tick]);
  async function connect(e){e.preventDefault();setBusy(true);try{await api('/connect',{method:'POST',body:JSON.stringify(clientId&&secret?{clientId,clientSecret:secret}:{})});setSecret('');notify('myUplinki ühendus on loodud.');await onConnect();navigate('overview');}catch(e){notify(e.message,true);}finally{setBusy(false);}}
  async function disconnect(){try{await api('/disconnect',{method:'POST',body:'{}'});await onConnect();notify('myUplinki ühendus on katkestatud.');}catch(e){notify(e.message,true);}}
  async function archive(){if(!archiveBefore)return;if(!window.confirm(`Arhiveerida kõik andmed enne ${archiveBefore}? Need eemaldatakse aktiivsest andmebaasist ja salvestatakse CSV-faili (data/archive/).`))return;setArchiving(true);setArchiveMsg(null);try{const r=await api('/archive',{method:'POST',body:JSON.stringify({before:archiveBefore})});setArchiveMsg(`Arhiiv: ${r.file} · ${(r.bytes/1048576).toFixed(1)} MB · ${r.rows} rida · eemaldatud ${r.removed}`);notify('Vanemad andmed arhiveeriti.');}catch(e){setArchiveMsg(e.message);notify(e.message,true);}finally{setArchiving(false);}}
  return <><section className="panel nx-liide"><PanelTitle title="Liides" subtitle="Vali, kuidas rakendus välja näeb. Andmed ja seadistused on mõlemas samad."/><div className="segmented" role="group" aria-label="Liides">{[['classic','Klassikaline'],['next','Uus · Kodu-plaan']].map(([v,l]) => <button key={v} type="button" className={ui===v?'selected':''} aria-pressed={ui===v} onClick={() => setUi?.(v)}>{l}</button>)}</div></section>{weather && <LocationPanel weather={weather} notify={notify}/>}{lux && <LuxtronikPanel lux={lux} notify={notify}/>}<div className="two-columns"><section className="panel connection-panel"><PanelTitle title="myUplinki ühendus" subtitle="Rakenduse võtmed jäävad kohalikku serverisse." action={<Badge tone={status?.connected?'green':'gray'}>{status?.connected?'Ühendatud':'Ühendamata'}</Badge>}/>{new URLSearchParams(location.search).has('authError')&&<p className="inline-error">Sisselogimist ei õnnestunud lõpetada. Alusta ühendamist uuesti.</p>}<form onSubmit={connect}><label className="field">Client Identifier<input autoComplete="off" value={clientId} onChange={e=>setClientId(e.target.value)} placeholder={status?.configured?'Rakenduse ID on salvestatud':'Sisesta rakenduse ID'}/></label><label className="field">Client Secret<input type="password" autoComplete="new-password" value={secret} onChange={e=>setSecret(e.target.value)} placeholder={status?.configured?'Võti on turvaliselt salvestatud':'Sisesta rakenduse salajane võti'}/></label><div className="button-row"><Button kind="primary" icon={Link2} busy={busy} type="submit">{status?.connected?'Uuenda ühendust':'Ühenda myUplink'}</Button>{status?.connected&&<Button icon={LogOut} type="button" onClick={disconnect}>Katkesta ühendus</Button>}</div></form><div className="oauth-option"><span>Alternatiivina kasutaja nõusolekuga:</span><a className="text-button" href="/auth/start">Logi sisse myUplinkiga <ExternalLink size={14}/></a></div></section><section className="panel"><PanelTitle title="Ühendamise juhend"/><ol className="setup-steps"><li><span>1</span><div><b>Loo API-rakendus</b><p>Ava <a href="https://dev.myuplink.com/apps" target="_blank" rel="noreferrer">myUplinki arendajaportaal <ExternalLink size={12}/></a> ja vali „Create New Application”.</p></div></li><li><span>2</span><div><b>Määra tagasisuunamise aadress</b><code>{status?.callbackUrl || 'http://localhost:3210/auth/callback'}</code></div></li><li><span>3</span><div><b>Ühenda oma soojuspump</b><p>Sisesta Client Identifier ja Client Secret. Oma konto jaoks piisab otseühendusest.</p></div></li></ol><div className="button-row"><Button icon={Activity} busy={testing} onClick={async()=>{setTesting(true);try{await api('/ping');notify('myUplink vastab. Ühendus töötab.');}catch(e){notify(e.message,true);}finally{setTesting(false);}}}>Testi ühendust</Button></div></section></div><section className="panel storage-panel"><PanelTitle title="Kohalik andmelogi"/><div className="storage-grid"><div><Clock3 size={20}/><span>Kogumise intervall<b>60 sekundit</b></span></div><div><History size={20}/><span>Säilitusaeg<b>10 aastat</b></span></div><div><ShieldCheck size={20}/><span>Salvestuskoht<b>Sinu arvuti · SQLite</b></span></div></div><div className="button-row"><label className="field"><span>Arhiveeri andmed enne</span><input type="date" value={archiveBefore} max={archiveMax} onChange={e=>setArchiveBefore(e.target.value)} aria-label="Arhiveerimise kuupäev"/></label><Button icon={Download} busy={archiving} type="button" onClick={archive}>Arhiveeri ja eemalda</Button></div>{archiveMsg && <p className="muted">{archiveMsg}</p>}{status?.collectorError && <p className="inline-error">Kogumise teade: {status.collectorError}</p>}<p className="muted">Vanemad kui 45 päeva andmed koondatakse päevakeskmisteks, et päringud püsiksid kiired. Kogumine jätkub ka suletud brauseriga, kui Soojuse server töötab.</p></section><section className="panel"><PanelTitle title="Muudatuste ajalugu" subtitle="Selle rakenduse kaudu saadetud juhtimiskäsklused"/>{auditError?<p className="inline-error">{auditError}</p>:!audit.length?<Empty icon={History} title="Ühtegi seadistust pole veel muudetud">Siia salvestame tehtud muudatused koos aja ja myUplinki vastusega.</Empty>:<div className="audit-list">{audit.map(a=><details key={a.id}><summary><span>{a.action}</span><small>{date(a.time)}</small><ChevronDown size={15}/></summary><pre>{JSON.stringify(JSON.parse(a.detail),null,2)}</pre></details>)}</div>}</section></>;
}

function EditModal({ item, deviceId, systemId, onClose, onSaved, notify }) {
  const p=item.point,z=item.zone;
  const [value,setValue]=useState(String(p?.value??item.mode??'')),[heat,setHeat]=useState(String(z?.setpointHeat??'')),[cool,setCool]=useState(String(z?.setpointCool??'')),[zoneMode,setZoneMode]=useState(z?.mode||''),[busy,setBusy]=useState(false),[error,setError]=useState(null);
  const dialog=useRef(null);
  useEffect(()=>{const prev=document.activeElement;dialog.current?.showModal();return()=>prev?.focus();},[]);
  const changed = item.type==='point' ? String(p.value)!==value : item.type==='mode' ? item.mode!==value : String(z.setpointHeat??'')!==heat || String(z.setpointCool??'')!==cool || z.mode!==zoneMode;
  async function save(e){e.preventDefault();setBusy(true);setError(null);try{
    if(item.type==='point'){
      const result=await api(`/devices/${encodeURIComponent(deviceId)}/points`,{method:'PATCH',body:JSON.stringify({[p.parameterId]:value})});
      if(!result.allModified)throw new Error(`myUplink ei kinnitanud muudatust: ${result.results.map(r=>r.status).join(', ')}. Kontrolli seadme näitu.`);
    }else if(item.type==='zone'){
      const body={};if(z.setpointHeat!=null&&String(z.setpointHeat)!==heat)body.setpointHeat=Number(heat);if(z.setpointCool!=null&&String(z.setpointCool)!==cool)body.setpointCool=Number(cool);if(z.mode!==zoneMode)body.mode=zoneMode;
      const d=await api(`/devices/${encodeURIComponent(deviceId)}/zones/${encodeURIComponent(z.zoneId)}`,{method:'PATCH',body:JSON.stringify(body)});
      if(d.result && Object.values(d.result).some(v=>String(v).toLowerCase()!=='modified'))throw new Error('myUplink ei kinnitanud kõiki tsooni muudatusi. Kontrolli seadme näite.');
    }else await api(`/systems/${encodeURIComponent(systemId)}/mode`,{method:'PUT',body:JSON.stringify({smartHomeMode:value})});
    notify('Käsk on myUplinkile saadetud. Seadme näit uueneb järgmiste päringutega.');onSaved();
  }catch(e){setError(e.message);}finally{setBusy(false);}}
  const title=p?.label||z?.name||'Kodu režiim';
  return <dialog ref={dialog} className="edit-dialog" onCancel={e=>{e.preventDefault();if(!busy)onClose();}} onClick={e=>{if(e.target===dialog.current&&!busy)onClose();}}><div className="modal-heading"><span className="square-icon teal"><Settings2 size={22}/></span><button className="icon-button" disabled={busy} aria-label="Sulge" onClick={onClose}><X size={21}/></button></div><h2>{title}</h2><p className="muted">Muudatus saadetakse sinu soojuspumbale.</p><form onSubmit={save}>
    {item.type==='point'&&<><div className="current-setting"><span>Praegune väärtus</span><b>{p.display}</b></div><label className="field">Uus väärtus{p.enumValues?.length?<select autoFocus value={value} onChange={e=>setValue(e.target.value)}>{p.enumValues.map(v=><option key={v.value} value={v.value}>{enumText(v.text)}</option>)}</select>:<div className="number-field"><button type="button" aria-label="Vähenda väärtust" onClick={()=>setValue(String(Math.max(p.min??-Infinity,Number((Number(value)-(p.step||1)).toFixed(8)))))}><Minus size={19}/></button><input autoFocus required type="number" min={p.min??undefined} max={p.max??undefined} step={p.step||'any'} value={value} onChange={e=>setValue(e.target.value)} aria-label="Uus väärtus"/><span>{p.parameterUnit}</span><button type="button" aria-label="Suurenda väärtust" onClick={()=>setValue(String(Math.min(p.max??Infinity,Number((Number(value)+(p.step||1)).toFixed(8)))))}><Plus size={19}/></button></div>}</label>{!p.enumValues?.length&&<p className="field-help">Lubatud {number(p.min)}–{number(p.max)} {p.parameterUnit}, samm {number(p.step,3)}.</p>}<small className="field-help">Parameeter #{p.parameterId} · {p.parameterName}</small></>}
    {item.type==='zone'&&<>{z.setpointHeat!=null&&<label className="field">Kütte sihtväärtus {z.commandOnly?'':z.isCelsius?'(°C)':'(°F)'}<input required autoFocus type="number" min={z.setpointRangeMin??undefined} max={z.setpointRangeMax??undefined} step="any" value={heat} onChange={e=>setHeat(e.target.value)}/></label>}{z.setpointCool!=null&&<label className="field">Jahutuse sihtväärtus<input required type="number" min={z.setpointRangeMin??undefined} max={z.setpointRangeMax??undefined} step="any" value={cool} onChange={e=>setCool(e.target.value)}/></label>}{z.supportedModes&&<label className="field">Töörežiim<select value={zoneMode} onChange={e=>setZoneMode(e.target.value)}>{z.supportedModes.split(/[,;\s]+/).filter(Boolean).map(m=><option key={m} value={m}>{enumText(m)}</option>)}</select></label>}</>}
    {item.type==='mode'&&<label className="field">Kodu režiim<select value={value} onChange={e=>setValue(e.target.value)}>{['Default','Normal','Home','Away','Vacation'].map(m=><option key={m} value={m}>{enumText(m)}</option>)}</select></label>}
    {error&&<p role="alert" className="inline-error">{error}</p>}<div className="modal-actions"><Button type="button" disabled={busy} onClick={onClose}>Tühista</Button><Button type="submit" kind="primary" icon={Check} busy={busy} disabled={!changed}>Salvesta muudatus</Button></div></form></dialog>;
}
