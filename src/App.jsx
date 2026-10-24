import React, { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react';
import { LayoutTemplate, Activity, ArrowDownLeft, ArrowRight, ArrowUpRight, Bell, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Clock3, CloudSun, Download, Droplets, ExternalLink, Fan, Flame, Gauge, History, Home, LayoutDashboard, Link2, LoaderCircle, Menu, Minus, Moon, Plus, Power, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal, Snowflake, Star, Sun, Thermometer, Waves, Wifi, WifiOff, X, Zap, AlertCircle, Monitor, CircleDot, LogOut, Save, CalendarDays } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, CartesianGrid, ReferenceArea, XAxis, YAxis, Tooltip } from 'recharts';
import { VentilationPage, useAirobot } from './ventilation.jsx';
import { t, LOCALES, setLocale, localeCoverage, missingTranslations, getLocale } from './i18n/index.js';
import { useLocale } from './i18n/react.js';
import { useWeather } from './weather.js';
import { useLuxtronik, LuxtronikPanel } from './luxtronik.jsx';
import { LocationPanel } from './location.jsx';
import { climate, climatePoints, climateQuery } from './ventilation-logic.js';
import { pumpState } from './next/logic.js';
import { api, number, axisNumber, date, time, enumText, enhance, metric, niceScale, timeTicks, timeTickLabel, mergeSeries, plotKey, estKey, clipSpans, targetKey, targetLines, holdValues, seriesStats, stateSpans, wzsvWorkState, pointNameText, groupText } from './lib.js';

const NextUI = lazy(() => import('./next/NextUI.jsx'));

const pages = [
  { id: 'overview', label: 'titles.overview', icon: LayoutDashboard },
  { id: 'heating', label: 'titles.heating', icon: Thermometer },
  { id: 'water', label: 'titles.water', icon: Droplets },
  { id: 'ventilation', label: 'titles.ventilation', icon: Fan },
  { id: 'history', label: 'titles.history', icon: History },
  { id: 'parameters', label: 'titles.parameters', icon: SlidersHorizontal },
  { id: 'alarms', label: 'titles.alarms', icon: Bell },
  { id: 'device', label: 'titles.device', icon: Monitor },
  { id: 'settings', label: 'titles.settings', icon: Settings2 },
];
function Badge({ children, tone = 'green' }) { return <span className={`badge ${tone}`}><i />{children}</span>; }
function Empty({ icon: Icon = Activity, title, children, action }) { return <div className="empty"><span className="empty-icon"><Icon size={25}/></span><h3>{title}</h3><p>{children}</p>{action}</div>; }
function PanelTitle({ title, subtitle, action }) { return <div className="panel-title"><div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>{action}</div>; }
function Button({ children, icon: Icon, kind = 'secondary', busy, ...props }) { return <button type="button" className={`button ${kind}`} {...props} disabled={props.disabled || busy}>{busy ? <LoaderCircle size={16} className="spin"/> : Icon && <Icon size={16}/>} {children}</button>; }

export default function App() {
  useLocale();
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
    const run = async ([key, url, setter]) => {
      try { const value = await api(url); if (rid === requestId.current) setter(value); return [key, null]; }
      catch (e) { return [key, e.message]; }
    };
    // Esmalt ootame ainult põhinäite; ülejäänud (seade, tsoonid, teated, tellimused)
    // laaditakse taustal, et aeglane pilv ei hoiaks tervet lehte kinni.
    const core = jobs.filter(([key]) => key === 'points');
    const secondary = jobs.filter(([key]) => key !== 'points');
    for (const job of secondary) run(job).then(([key, error]) => { if (rid === requestId.current) setErrors(prev => ({ ...prev, [key]: error })); });
    const results = await Promise.all(core.map(run));
    if (rid !== requestId.current) return;
    setErrors(prev => ({ ...prev, global: prev.global, ...Object.fromEntries(results) }));
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
  // Elav kodu ja maja skeem peavad näitama tegelikku sihti (7), mis tõuseb ka kõrgendatud tarbevee ajal;
  // 5105 on kasutaja tavaline sihttase ja jääks boosti ajal tegelikust madalamaks.
  const waterTarget = Number(metricFor('7', '', /tarbevesi.*peab/i)?.value ?? metricFor('5105')?.value ?? zones.find(z => /tarbe/i.test(z.name))?.setpointHeat);
  const overlays = <>
    {editing && <EditModal item={editing} deviceId={selection} systemId={system?.systemId} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} notify={notify}/>}
    {toast && <div className={`toast ${toast.error ? 'toast-error' : ''}`} role="status">{toast.error ? <AlertCircle size={20}/> : <CheckCheck size={20}/>}<span>{toast.text}</span><button className="icon-button" onClick={() => setToast(null)} aria-label="Sulge teade"><X size={16}/></button></div>}
  </>;
  if (ui === 'next') {
    const ctx = { page, navigate, status, systems, selection, setSelection, points, device, model, system, detail, zones, categories, firmware, aid, mode, subscriptions, activeNotices, errors, loading, refreshing, lastFetch, tick, refresh, bootstrap, online, stale, theme, setTheme, favorites, favorite, search, setSearch, setEditing, notify, ovHours, pickOvHours, setUi, shared, targetLines, rawCount: rawPoints.length, airobot, weather, lux, climate: climate(outdoor?.value, airobot.view),
      m: { supply, returnT, returnTarget, buffer, water, waterTarget, power, outdoor, heatingState, hwState, workMode, compressor: model === 'WZSV 92H3M' ? metricFor('70') : undefined },
      parts: { Empty, Button, HistoryChart, HistoryPage, Parameters, AlarmsPage, DevicePage, SettingsPage, VentilationPage } };
    return <><Suspense fallback={<div className="loading-grid" aria-label={t('shell.loadingUi')} style={{ padding: 32 }}><div className="skeleton large"/></div>}><NextUI ctx={ctx}/></Suspense>{overlays}</>;
  }

  return <div className="app-shell">
    {mobile && <button type="button" aria-label={t('shell.closeNav')} className="nav-backdrop" onClick={() => setMobile(false)}/>}
    <aside className={`sidebar ${mobile ? 'open' : ''}`}>
      <a className="brand" href="/" onClick={e => { e.preventDefault(); navigate('overview'); }}><span className="brand-mark"><Waves size={25}/></span><span>soojus<span className="brand-dot">.</span></span></a>
      <div className="home-label"><span className="eyebrow">{t('shell.myHome')}</span><span className="tiny-dot"/></div>
      <div className="device-selector"><span className="selector-icon"><Home size={19}/></span><div><b>{model || t('shell.heatPump')}</b><small>{system?.country === 'Estonia' ? t('shell.estonia') : system?.country || t('shell.homeHub')}</small></div><ChevronDown size={15}/><select aria-label={t('shell.selectPump')} value={selection} onChange={e => setSelection(e.target.value)}>{systems.flatMap(s => (s.devices || []).map(d => <option key={d.id} value={d.id}>{s.name} · {d.product?.name}</option>))}{!systems.length && <option value="">{t('shell.connectMyUplink')}</option>}</select></div>
      <nav aria-label={t('shell.mainNav')}>{pages.map((p, i) => <React.Fragment key={p.id}>{p.id === 'device' && <div className="nav-heading">{t('shell.system')}</div>}<button className={`nav-item ${page === p.id ? 'active' : ''}`} onClick={() => navigate(p.id)}><p.icon size={19}/><span>{t(p.label)}</span>{p.id === 'alarms' && activeNotices.length > 0 && <b className="count">{activeNotices.length}</b>}{page === p.id && <span className="nav-active-dot"/>}</button></React.Fragment>)}</nav>
      <div className="sidebar-bottom"><div className="connection-summary"><span className={`connection-symbol ${status?.connected ? 'connected' : ''}`}><Link2 size={17}/></span><div><b>myUplink</b><small>{status?.connected ? t('shell.connectedSecurely') : t('shell.notConfigured')}</small></div><i className={status?.connected ? 'tiny-dot' : 'tiny-dot gray-dot'}/></div><div className="sidebar-footer"><span>v1.0</span></div></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label={t('shell.openMenu')} onClick={() => setMobile(true)}><Menu size={21}/></button><Home size={15}/><span>{t('shell.myHome')}</span><ChevronRight size={13}/><b>{t(pages.find(p => p.id === page)?.label || 'titles.overview')}</b></div><div className="topbar-right"><span className="topbar-date"><CalendarDays size={15}/>{new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())}</span><button className="icon-button theme-toggle" aria-label={theme === 'dark' ? t('shell.themeLight') : t('shell.themeDark')} aria-pressed={theme === 'dark'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={19}/> : <Moon size={19}/>}</button><button className="icon-button" aria-label={t('shell.nextUi')} title={t('shell.nextUi')} onClick={() => setUi('next')}><LayoutTemplate size={19}/></button><button className="icon-button notification-button" aria-label={t('shell.notifications')} onClick={() => navigate('alarms')}><Bell size={19}/>{activeNotices.length > 0 && <i/>}</button><span className="avatar">MK</span></div></header>
      <main id="main">
        <div className="page-heading"><div><h1>{t(pages.find(p => p.id === page)?.label || 'titles.overview')}</h1><p>{t(`subtitles.${page}`)}</p></div><div className="heading-actions">{page === 'overview' && <span className="weather-chip"><CloudSun size={22}/>{number(outdoor?.value)}<span>{t('shell.weatherOut')}</span>{climate(outdoor?.value, airobot.view).indoor != null && <>{' · '}{number(climate(outdoor?.value, airobot.view).indoor)}<span>{t('shell.weatherIn')}</span></>}</span>}<Button icon={RefreshCw} busy={refreshing} onClick={() => selection ? refresh() : bootstrap()}>{t('shell.refreshAction')}</Button></div></div>
        {(errors.global || errors.points) && <div role="alert" className="error-banner"><AlertCircle size={19}/><span>{errors.global || errors.points} {rawPoints.length > 0 && t('shell.latestShown')}</span><Button onClick={bootstrap}>Proovi uuesti</Button></div>}
        {stale && <div className="info-banner warning"><Clock3 size={18}/><span>{t('shell.staleBanner')}</span></div>}
        {page !== 'settings' && page !== 'ventilation' && (!status?.connected || !device) && !loading ? <div className="panel"><Empty icon={Link2} title={status?.connected ? t('shell.noDevicesTitle') : t('shell.notConnectedTitle')} action={<Button kind="primary" icon={ArrowRight} onClick={() => navigate('settings')}>{t('shell.connectAction')}</Button>}>{t('shell.connectHint')}</Empty></div> : loading && page !== 'settings' && page !== 'ventilation' ? <div className="loading-grid" aria-label={t('shell.loading')}>{[1,2,3,4].map(n => <div key={n} className="skeleton"/>)}<div className="skeleton large"/></div> : <>
          {page === 'overview' && <>
            <div className="status-strip"><div><Badge tone={online && !stale ? 'green' : 'amber'}>{online ? stale ? t('shell.stale') : t('shell.online') : t('shell.offline')}</Badge><span className="status-model">{model}</span><span className="status-divider"/><span>{heatingState?.display || 'Seadme ülevaade'}</span></div><span className="update-time"><RefreshCw size={12}/>{errors.points ? t('ov.requestFailed') : t('ov.requestTime', { time: time(lastFetch) })} · {t('ov.every60')}</span></div>
            <div className="metric-grid"><MetricCard title={t('point.supply')} point={supply} icon={Thermometer} tone="orange" detail={t('ov.returnDetail', { value: number(returnT?.value) })} hint={t('ov.hintHeat')}/><MetricCard title={t('titles.water')} point={water} icon={Droplets} tone="blue" detail={t('ov.waterTarget', { value: number(metricFor('7', '', /tarbevesi.*peab/i)?.value ?? zones.find(z => /tarbe/i.test(z.name))?.setpointHeat) })} hint={t('ov.hintWater')}/><MetricCard title={t('point.power')} point={power} icon={Zap} tone="purple" detail={metricFor('70')?.display ? t('ov.compressor', { value: metricFor('70').display.toLowerCase() }) : t('ov.reportedPower')} hint={t('ov.hintPower')}/><MetricCard title={t('plan.outdoor')} point={outdoor} icon={CloudSun} tone="teal" detail={t('ov.outdoorAvg', { value: number(metricFor('39')?.value) })} hint={t('ov.hintClimate')}/></div>
            <div className="overview-grid"><section className="panel flow-panel"><PanelTitle title={t('ov.flowTitle')} subtitle={t('ov.flowSubtitle')} action={<span className="subtle-label"><span className="tiny-dot"/>{t('ov.deviceReadings')}</span>}/><FlowDiagram supply={supply} returnT={returnT} water={water} power={power} heatingState={heatingState} hwState={hwState} workMode={workMode} compressor={model === 'WZSV 92H3M' ? metricFor('70') : undefined} online={online} model={model}/><div className="flow-bottom"><span><ShieldCheck size={16}/>{errors.notices ? t('ov.noticesUnavailable') : system?.hasAlarm || activeNotices.length ? t('ov.alarmActive') : t('ov.noAlarms')}</span><button className="text-button" onClick={() => navigate('device')}>{t('ov.deviceDetails')} <ArrowRight size={15}/></button></div></section>
            <section className="panel quick-panel"><PanelTitle title={t('ov.quickTitle')} subtitle={t('ov.quickSubtitle')}/><div className="quick-control"><span className="square-icon orange"><Flame size={20}/></span><div><b>{t('titles.heating')}</b><small>{points.find(p => p.parameterId === '5003')?.display || heatingState?.display || t('ov.seeSettings')}</small></div><button className="icon-button" aria-label={t('ov.openHeat')} onClick={() => navigate('heating')}><ChevronRight size={19}/></button></div><div className="quick-control"><span className="square-icon blue"><Droplets size={20}/></span><div><b>{t('titles.water')}</b><small>{zones.find(z => /tarbe/i.test(z.name))?.setpointHeat != null ? t('ov.target', { value: number(zones.find(z => /tarbe/i.test(z.name)).setpointHeat) }) : t('ov.seeSettings')}</small></div><button className="icon-button" aria-label={t('ov.openWater')} onClick={() => navigate('water')}><ChevronRight size={19}/></button></div><div className="boost-box"><div><Zap size={19}/><b>{t('ov.quickCharge')}</b></div><p>{t('ov.quickChargeHint')}</p><Button icon={power?.value > 0 ? Zap : Plus} onClick={() => { const p = points.find(p => p.smartHomeCategories?.includes('sh-hwBoost') && p.writable); if (p) setEditing({ type: 'point', point: p }); }} disabled={!points.some(p => p.smartHomeCategories?.includes('sh-hwBoost') && p.writable) || !online}>{points.find(p => p.smartHomeCategories?.includes('sh-hwBoost'))?.value == 1 ? t('ov.manageCharge') : t('ov.setCharge')}</Button></div><button className="text-button quick-all" onClick={() => navigate('parameters')}>{t('ov.allControls')} <ArrowRight size={15}/></button></section></div>
            <div className="overview-bottom"><section className="panel chart-panel"><PanelTitle title={t('ov.chartTitle')} subtitle={t('ov.chartSubtitle')} action={<div className="panel-actions"><div className="segmented" role="group" aria-label={t('overview.periodLabel')}>{[[24,t('overview.periodDay')],[168,t('overview.periodWeek')],[720,t('overview.periodMonth')]].map(([v,l]) => <button key={v} type="button" className={ovHours === v ? 'selected' : ''} aria-pressed={ovHours === v} onClick={() => pickOvHours(v)}>{l}</button>)}</div><button className="text-button" onClick={() => navigate('history')}>{t('ov.viewHistory')} <ArrowUpRight size={15}/></button></div>}/>{heatPoints.length > 0 && <div className="chart-section"><h4>{t('overview.metricHeat')}</h4><HistoryChart name="heat" deviceId={selection} points={heatPoints} defaultHidden={heatPoints.slice(1).map(p => p.parameterId)} hours={ovHours} tick={tick} compact theme={theme} stateId={model === 'WZSV 92H3M' ? '17' : null} targets={[]}/></div>}{[water].filter(Boolean).length > 0 && <div className="chart-section"><h4>{t('overview.metricWater')}</h4><HistoryChart name="water" footnote={false} deviceId={selection} points={[water].filter(Boolean)} hours={ovHours} tick={tick} compact theme={theme} stateId={model === 'WZSV 92H3M' ? '17' : null} targets={targetLines(points, model, [water].filter(Boolean).map(p => p.parameterId))}/></div>}{airobot.view?.configured && airobot.view.data && outdoor && <div className="chart-section"><h4>{t('overview.metricClimate')}</h4><HistoryChart name="climate" footnote={false} deviceId="climate" extra={climateQuery(selection, outdoor.parameterId)} points={climatePoints()} hours={ovHours} tick={tick} compact theme={theme}/></div>}{[power].filter(Boolean).length > 0 && <div className="chart-section"><h4>{t('overview.metricPower')}</h4><HistoryChart name="power" footnote={false} deviceId={selection} points={[power].filter(Boolean)} hours={ovHours} tick={tick} compact theme={theme} stateId={model === 'WZSV 92H3M' ? '17' : null} targets={[]}/></div>}</section><section className="panel health-panel"><PanelTitle title={t('ov.healthTitle')}/><div className="health-heading"><span className={`health-icon ${activeNotices.length ? 'warning' : ''}`}><ShieldCheck size={26}/></span><div><b>{errors.notices ? t('ov.stateUnknown') : system?.hasAlarm || activeNotices.length ? t('ov.needsAttention') : t('ov.allGood')}</b><small>{errors.notices ? t('ov.noticesError') : t('ov.myUplinkOverview')}</small></div></div><dl className="health-list"><div><dt>{t('ov.connection')}</dt><dd><span className={`tiny-dot ${online ? '' : 'gray-dot'}`}/>{online ? t('ov.online') : t('ov.offline')}</dd></div><div><dt>{t('ov.compressorLabel')}</dt><dd>{metricFor('70')?.display || '—'}</dd></div><div><dt>{t('ov.totalHours')}</dt><dd>{number(metricFor('5668')?.value, 0)} h</dd></div><div><dt>{t('ov.firmware')}</dt><dd className="firmware-short">{firmware?.currentFwVersion || '—'}</dd></div></dl><button className="text-button" onClick={() => navigate('alarms')}>{t('ov.viewLog')} <ArrowRight size={15}/></button></section></div>
            {favorites.length > 0 && <section className="panel favorites-panel"><PanelTitle title={t('overview.favorites')} subtitle={t('ov.favoritesSubtitle')}/><div className="reading-grid">{points.filter(p => favorites.includes(`${selection}:${p.parameterId}`)).map(p => <Reading key={p.parameterId} point={p}/>)}</div></section>}
          </>}
          {(page === 'heating' || page === 'water') && <ControlPage {...shared} waterPage={page === 'water'} mode={mode} />}
          {page === 'parameters' && <Parameters {...shared} search={search} setSearch={setSearch} favorites={favorites} favorite={favorite}/>}
          {page === 'ventilation' && <VentilationPage tick={tick} theme={theme} HistoryChart={HistoryChart} notify={notify} airobot={airobot} outdoor={outdoor?.value} pumpDeviceId={selection} outdoorPointId={outdoor?.parameterId}/>}
          {page === 'history' && <HistoryPage deviceId={selection} points={points} tick={tick} theme={theme} model={model} stateId={model === 'WZSV 92H3M' ? '17' : null} ventPoints={airobot.view?.configured && airobot.view.data ? airobot.view.points : []} luxPoints={lux.view?.configured && lux.view.data ? lux.view.points : []}/>}
          {page === 'alarms' && <AlarmsPage systemId={system?.systemId} tick={tick}/>}
          {page === 'device' && <DevicePage {...shared} firmware={firmware} aid={aid} subscriptions={subscriptions}/>}
          {page === 'settings' && <SettingsPage status={status} notify={notify} onConnect={bootstrap} tick={tick} navigate={navigate} ui={ui} setUi={setUi} weather={weather} lux={lux}/>}
        </>}
        <footer className="main-footer"><span><Waves size={14}/> SOOJUS</span><span>{t('shell.footerData')}: {directPrimary ? `${t('shell.footerDirect')}${lux.view?.upstreamProblem ? t('shell.footerDown') : ''}` : t('shell.footerApi')} <span className="footer-divider">·</span> {lastFetch ? `${t('shell.footerLast')} ${time(lastFetch)}` : t('shell.footerServer')}</span></footer>
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
  const activity = hwOn && heatOn ? t('flow.heatingBoth') : hwOn ? t('flow.heatingWater') : heatOn ? t('flow.heatingHeat') : heatDemand || hwDemand ? t('flow.waiting') : heatingState?.display || model;
  const aria = t('flow.aria', { supply: number(supply?.value), returnT: number(returnT?.value), water: number(water?.value), waterOn: hwOn ? t('flow.ariaWaterOn') : '', heatOn: heatOn ? t('flow.ariaHeatOn') : '' });
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
    <g className="diagram-label"><rect x="241" y="66" width="81" height="36" rx="7" fill="#fff" stroke="#ede2d7"/><text x="281" y="89" textAnchor="middle" fill="#b57746" fontSize="17" fontWeight="600">{number(supply?.value)}°</text><text x="281" y="53" textAnchor="middle" fill="#7b8b98" fontSize="10">{t('flow.supply')}</text><rect x="241" y="144" width="81" height="35" rx="7" fill="#fff" stroke="#dce9ed"/><text x="281" y="167" textAnchor="middle" fill="#427e90" fontSize="17" fontWeight="600">{number(returnT?.value)}°</text><text x="551" y="135" textAnchor="middle" fill="#427e90" fontSize="17" fontWeight="600">{number(water?.value)}°</text></g>
    <text x="157" y="246" textAnchor="middle" fill="#526c7e" fontSize="11" fontWeight="600">{t('flow.pump')}</text><text x="449" y="200" textAnchor="middle" fill="#526c7e" fontSize="10" fontWeight="600">{t('flow.circuit')}</text><text x="551" y="246" textAnchor="middle" fill="#526c7e" fontSize="10" fontWeight="600">{t('flow.water')}</text>
  </svg><div className="diagram-legend"><span><i className="legend-dot orange-dot"/>{t('flow.supplyLegend')}</span><span><i className="legend-dot blue-dot"/>{t('flow.returnLegend')}</span><span className={`diagram-state ${hwOn || heatOn ? 'active' : heatDemand || hwDemand ? 'demand' : ''}`}><CircleDot size={12}/>{activity}</span></div></div>;
}

const chartPalette = { light: ['#d55e00', '#0072b2', '#009e73', '#b0468a', '#6c757d'], dark: ['#ff8a3d', '#56b4e9', '#2fd0a0', '#e58fc0', '#b6bec4'] };
const PREV = 'p:';
const stateStyle = { heat: { labelKey: 'chart.stateHeat', color: '#e6a800' }, hw: { labelKey: 'chart.stateHw', color: '#8b6fd0' } };

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
    {prevItems.length > 0 && <div className="chart-tip-note">{t('chart.previousLabel', { date: date(label - prevShift, { weekday: 'short' }) })}</div>}
    {prevItems.map(e => { const i = points.findIndex(p => plotKey(PREV + p.parameterId) === e.dataKey), p = points[i]; return <div key={e.dataKey} className="chart-tip-prev"><i style={{ background: colors[i % colors.length] }}/><span>{p.label}</span><strong>{number(e.value, 2)} {p.parameterUnit}</strong></div>; })}
    {estimates.map(e => { const i = points.findIndex(p => estKey(p.parameterId) === e.dataKey), p = points[i]; return <div key={e.dataKey}><i style={{ background: 'transparent', borderColor: colors[i % colors.length] }}/><span>{t('chart.estimate', { label: p.label })}</span><strong>≈ {number(e.value, 1)} {p.parameterUnit}</strong></div>; })}
    {inGap && <div className="chart-tip-note">{t('chart.noData')}</div>}
    {targets.map(tg => { const v = payload.find(e => e.dataKey === targetKey(tg.id))?.value; return v == null ? null : <div key={tg.id}><i style={{ background: 'transparent', borderColor: tg.color }}/><span>{tg.label}</span><strong>{number(v, 2)} {tg.unit}</strong></div>; })}
    {stateKnown && !inGap && <div className="chart-tip-state"><i style={{ background: state ? state.color : 'transparent', borderColor: state ? state.color : 'currentColor' }}/><span>{t('chart.deviceState')}</span><strong>{state ? t(state.labelKey) : t('chart.idle')}</strong></div>}
  </div>;
}

function HistoryChart({ deviceId, points, hours, tick, compact = false, theme, stateId = null, targets = [], name = null, footnote = true, defaultHidden = [], range = null, onZoom = null, compare = false, extra = '', auxDeviceId = null, src = null }) {
  const chartId = name || (compact ? 'small' : 'big');
  const [rows, setRows] = useState([]), [bucket, setBucket] = useState(0), [error, setError] = useState(null), [busy, setBusy] = useState(true), [limited, setLimited] = useState(false);
  const [stateRows, setStateRows] = useState([]), [hidden, setHidden] = useState(defaultHidden), [gapList, setGapList] = useState([]), [sinceMs, setSinceMs] = useState(NaN), [prevRows, setPrevRows] = useState([]), [drag, setDrag] = useState(null);
  const auxId = auxDeviceId || deviceId;
  const winQ = range ? `from=${encodeURIComponent(new Date(range.from).toISOString())}&to=${encodeURIComponent(new Date(range.to).toISOString())}` : `hours=${hours}`, winKey = range ? `${range.from}-${range.to}` : `h${hours}`;
  const winMs = range ? range.to - range.from : hours * 3600000;
  const pointsKey = points.map(p => p.parameterId).join(',');
  useEffect(() => { if (!deviceId && !src) return; const c = new AbortController(); setBusy(true); const pointQuery = !src && points.length ? `&points=${encodeURIComponent(pointsKey)}` : ''; api(src ? `${src}&${winQ}` : `/history/${encodeURIComponent(deviceId)}?${winQ}${extra}${pointQuery}`, { signal: c.signal }).then(d => { setRows(d.rows); setBucket(d.bucketSeconds || 0); setGapList(d.gaps || []); setSinceMs(Date.parse(d.since)); setLimited(d.limited); setError(null); }).catch(e => { if (!c.signal.aborted) setError(e.message); }).finally(() => { if (!c.signal.aborted) setBusy(false); }); return () => c.abort(); }, [deviceId, winKey, tick, extra, src, pointsKey]);
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
  if (error) return <Empty icon={AlertCircle} title={t('chart.unavailable')}>{error}</Empty>;
  if (busy && !data.length) return <div className="chart-loading"><LoaderCircle className="spin" size={22}/> {t('chart.loading')}</div>;
  return <div className={compact ? 'chart-wrap compact' : 'chart-wrap'}>{realCount < 2 ? range ? <Empty icon={History} title={t('chart.noRange')}>{t('chart.noRangeHint')}</Empty> : <Empty icon={History} title={t('chart.collecting')}>{t('chart.collectingHint')}</Empty> : <>
    <div className="chart-legend">
      {points.map((p, i) => { const last = seriesStats(data, p.parameterId)?.last, off = hidden.includes(p.parameterId); return <button type="button" key={p.parameterId} className={off ? 'off' : ''} aria-pressed={!off} title={off ? t('chart.showOnChart') : t('chart.hideFromChart')} onClick={() => toggle(p.parameterId)}><span className="swatch" style={{ background: colors[i % colors.length] }}/>{p.label}{last != null && <b>{number(last, 1)} {p.parameterUnit}</b>}</button>; })}
      {unit && <span className="chart-unit">{unit}</span>}
    </div>
    <div className={onZoom && !compact ? 'chart-canvas zoomable' : 'chart-canvas'} onDoubleClick={() => range && onZoom?.(null)} role="img" aria-label={t('chart.aria', { series: shown.map(p => p.label).join(', '), from: date(from), to: date(to) })}><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }} {...zoomHandlers}>
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
    {(spans.length > 0 || targetLinesShown.length > 0 || gaps.length > 0 || compareOn) && <div className="chart-bands">{compareOn && <span><i className="ghost"/>{t('chart.previous', { from: date(from - winMs), to: date(from) })}{prevRows.length === 0 ? t('chart.previousEmpty') : ''}</span>}{gaps.length > 0 && <span><i className="hatch"/>{t('chart.noDataEstimate')}</span>}{targetLinesShown.map(tg => <span key={tg.id}><i className="dash" style={{ borderColor: tg.color }}/>{tg.label} ({number(data.at(-1)[targetKey(tg.id)], 1)} {tg.unit})</span>)}{Object.entries(stateStyle).filter(([k]) => spans.some(s => s.kind === k)).map(([k, v]) => <span key={k}><i style={{ background: v.color }}/>{t(v.labelKey)}</span>)}</div>}
    {stats.length > 0 && <div className="table-scroll"><table className="chart-stats"><caption>{t('chart.summary')}{bucket > 60 ? t('chart.summaryBuckets') : ''}</caption><thead><tr><th scope="col">{t('chart.metric')}</th><th scope="col">{t('chart.min')}</th><th scope="col">{t('chart.avg')}</th><th scope="col">{t('chart.max')}</th><th scope="col">{t('chart.last')}</th>{compareOn && <><th scope="col">{t('chart.prevAvg')}</th><th scope="col">{t('chart.change')}</th></>}</tr></thead><tbody>{stats.map(({ p, s, prev, i }) => <tr key={p.parameterId}><th scope="row"><span className="swatch" style={{ background: colors[i % colors.length] }}/>{p.label}</th>{[s.min, s.avg, s.max, s.last].map((v, k) => <td key={k}>{number(v, 1)} {p.parameterUnit}</td>)}{compareOn && (prev ? <><td>{number(prev.avg, 1)} {p.parameterUnit}</td><td>{s.avg - prev.avg > 0 ? '+' : ''}{number(s.avg - prev.avg, 1)} {p.parameterUnit}</td></> : <><td>—</td><td>—</td></>)}</tr>)}</tbody></table></div>}
    {footnote && <div className="chart-footnote"><Clock3 size={12}/>{date(from)} – {spanH > 24 ? date(to) : time(to)} <span>{t('chart.buckets', { count: realCount, bucket: bucket <= 60 ? '1 min' : bucket <= 600 ? '10 min' : bucket <= 3600 ? '1 h' : '1 d' })}{data.some(r => r.gap) ? t('chart.gapsConnected') : ''}{limited ? t('chart.limited') : ''}</span></div>}
  </>}</div>;
}

function Reading({ point }) { return <div className="reading"><span>{point.label}</span><b>{point.enumValues?.length || typeof point.value === 'string' && !Number.isFinite(Number(point.value)) ? point.display : <>{number(point.value,2)} <small>{point.parameterUnit}</small></>}</b><small>{time(point.timestamp)}</small></div>; }

function ControlPage({ waterPage, points, zones, online, setEditing, categories, mode, errors }) {
  const group = waterPage ? 'Tarbevesi' : 'Küte';
  const filtered = points.filter(p => p.group === group);
  const writable = filtered.filter(p => p.writable);
  return <>
    <div className="control-intro"><div className={`control-intro-icon ${waterPage ? 'blue' : 'orange'}`}>{waterPage ? <Droplets size={30}/> : <Flame size={30}/>}</div><div><h2>{waterPage ? t('cp.waterTitle') : t('cp.heatTitle')}</h2><p>{waterPage ? t('cp.waterLead') : t('cp.heatLead')}</p></div><Badge tone={online ? 'green':'amber'}>{online ? t('cp.ready') : t('cp.offline')}</Badge></div>
    <h2 className="section-heading">{t('cp.settings')} <span>{t('cp.params', { count: writable.length })}</span></h2>
    <div className="control-grid">{writable.map(p => <section className="panel control-card" key={p.parameterId}><div className="control-card-top"><span className={`square-icon ${waterPage ? 'blue':'orange'}`}>{p.enumValues?.length ? <Power size={19}/> : <Thermometer size={19}/>}</span><span className="param-id">#{p.parameterId}</span></div><h3>{p.label}</h3><div className="control-current">{p.enumValues?.length ? p.display : <>{number(p.value)} <small>{p.parameterUnit || (p.parameterId === '6147' ? 'sek' : '')}</small></>}</div><p>{p.parameterId === '6147' ? t('cp.hours30', { hours: number(Number(p.value)/3600) }) : p.enumValues?.length ? t('cp.allowedChoices', { count: p.enumValues.length }) : t('cp.range', { min: number(p.min), max: number(p.max), unit: p.parameterUnit, step: number(p.step, 3) })}</p><Button icon={SlidersHorizontal} onClick={() => setEditing({ type:'point', point:p })} disabled={!online}>{t('cp.editSetting')}</Button></section>)}</div>
    {!writable.length && <section className="panel"><Empty icon={SlidersHorizontal} title={t('cp.emptyTitle')}>{t('cp.emptyBody')}</Empty></section>}
    {waterPage && zones.length > 0 && <><h2 className="section-heading">{t('cp.zones')} <span>{t('cp.zoneCount', { count: zones.length })}</span></h2><div className="zone-grid">{zones.map(z => <section className="panel zone-card" key={z.zoneId}><div><span className="square-icon blue"><Droplets size={21}/></span><h3>{z.name}</h3><Badge tone={z.mode==='off' ? 'gray':'blue'}>{enumText(z.mode)}</Badge></div><div className="zone-values"><span>{t('cp.now')}<b>{z.commandOnly ? '—' : number(z.temperature)}<small>{z.commandOnly ? '' : z.isCelsius ? '°C':'°F'}</small></b></span><span>{t('cp.target')}<b>{number(z.setpointHeat)}<small>{z.commandOnly ? '' : z.isCelsius ? '°C':'°F'}</small></b></span></div><Button icon={Settings2} onClick={() => setEditing({ type:'zone', zone:z })} disabled={!online}>{t('cp.zoneSettings')}</Button></section>)}</div></>}
    {waterPage && errors.zones && <div className="info-banner warning"><AlertCircle size={17}/>Tsoonid: {errors.zones}</div>}
    {!waterPage && categories['sh-smartMode'] && <section className="panel smart-mode"><PanelTitle title={t('cp.homeMode')} subtitle={t('cp.current', { mode: enumText(mode) })}/><Button onClick={() => setEditing({ type:'mode', mode })} disabled={!online}>{t('cp.editHome')}</Button></section>}
    <section className="panel readings-panel"><PanelTitle title={waterPage ? t('cp.readingsWater') : t('cp.readingsHeat')} subtitle={t('cp.reported')}/><div className="reading-grid">{filtered.filter(p => !p.writable).map(p => <Reading key={p.parameterId} point={p}/>)}</div></section>
    <div className="info-banner"><CircleHelp size={18}/><span>{t('cp.scheduleNote')}</span></div>
  </>;
}

function Parameters({ points, search, setSearch, setEditing, favorites, favorite, selection, online }) {
  const [group,setGroup] = useState('Kõik'), [onlyWritable,setOnlyWritable] = useState(false), [onlyFavorites,setOnlyFavorites] = useState(false);
  const groups = ['Kõik', ...new Set(points.map(p => p.group))];
  const visible = points.filter(p => (group==='Kõik' || p.group===group) && (!onlyWritable || p.writable) && (!onlyFavorites || favorites.includes(`${selection}:${p.parameterId}`)) && `${p.label} ${p.parameterName} ${p.parameterId}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="panel parameters-panel"><div className="table-toolbar"><label className="search-input"><Search size={17}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('params.searchPlaceholder')} aria-label={t('params.searchAria')}/>{search && <button className="icon-button" onClick={() => setSearch('')} aria-label={t('params.clearSearch')}><X size={15}/></button>}</label><label className="check-filter"><input type="checkbox" checked={onlyWritable} onChange={e => setOnlyWritable(e.target.checked)}/>{t('params.onlyWritable')}</label><button className={`button ${onlyFavorites ? 'selected':'secondary'}`} onClick={() => setOnlyFavorites(!onlyFavorites)}><Star size={15}/>{t('params.favorites')}</button></div><div className="filter-tabs">{groups.map(g => <button className={group===g ? 'selected':''} key={g} onClick={() => setGroup(g)}>{g==='Kõik'?t('params.all'):groupText(g)}<span>{g==='Kõik'?points.length:points.filter(p => p.group===g).length}</span></button>)}</div><div className="table-scroll"><table><thead><tr><th aria-label="Lemmik"/><th>{t('params.colParam')}</th><th>{t('params.colValue')}</th><th>{t('params.colLast')}</th><th>{t('params.colRights')}</th><th/></tr></thead><tbody>{visible.map(p => <tr key={p.parameterId}><td><button className={`icon-button star-button ${favorites.includes(`${selection}:${p.parameterId}`) ? 'is-favorite':''}`} aria-label={`${favorites.includes(`${selection}:${p.parameterId}`) ? t('params.favoriteRemove') : t('params.favoriteAdd')}: ${p.label}`} onClick={() => favorite(`${selection}:${p.parameterId}`)}><Star size={16}/></button></td><td><b>{p.label}</b><small>#{p.parameterId} · {groupText(p.group)}</small></td><td className="table-value">{p.display}</td><td className="table-date">{date(p.timestamp)}</td><td><span className={`permission ${p.writable ? 'writable':''}`}>{p.writable ? t('params.writable') : t('params.readonly')}</span></td><td>{p.writable && <button className="text-button" disabled={!online} onClick={() => setEditing({ type:'point', point:p })}>{t('params.edit')} <ChevronRight size={14}/></button>}</td></tr>)}</tbody></table></div>{!visible.length && <Empty icon={Search} title={t('params.emptyTitle')}>{t('params.emptyBody')}</Empty>}<div className="table-footer">{t('params.shown', { visible: visible.length, total: points.length })}<span>{t('params.editableCount', { count: points.filter(p=>p.writable).length })}</span></div></section>;
}

// Arhiivivaatur: vali arhiivifail ja seeriad, graafik loetakse otse CSV-failist (ainult lugemine).
function ArchiveViewer({ tick, theme }) {
  const [files, setFiles] = useState(null), [name, setName] = useState(''), [meta, setMeta] = useState(null), [picked, setPicked] = useState([]), [error, setError] = useState(null);
  useEffect(() => { api('/archive').then(d => { setFiles(d.files); if (!name && d.files[0]) setName(d.files[0].name); }).catch(e => setError(e.message)); }, [tick]);
  useEffect(() => { if (!name) return; setMeta(null); setPicked([]); api(`/archive/${encodeURIComponent(name)}`).then(setMeta).catch(e => setError(e.message)); }, [name, tick]);
  if (error) return <p className="inline-error" role="alert">{error}</p>;
  if (!files) return <div className="chart-loading"><LoaderCircle className="spin"/>{t('hist.archiveLoading')}</div>;
  if (!files.length) return <section className="panel history-panel"><PanelTitle title={t('hist.archiveTitle')} subtitle={t('hist.archiveSubtitle')}/><Empty icon={History} title={t('hist.archiveEmptyTitle')}>{t('hist.archiveEmptyBody')}</Empty></section>;
  const series = meta?.series || [];
  const points = picked.map(t => { const s = series.find(x => x.token === t); return { parameterId: t, label: s.label, parameterUnit: s.unit }; });
  const src = name && picked.length ? `/archive/${encodeURIComponent(name)}/history?s=${encodeURIComponent(picked.join(','))}` : null;
  const range = meta?.from && meta?.to ? { from: Date.parse(meta.from), to: Date.parse(meta.to) + 1000 } : null;
  const toggle = t => setPicked(p => p.includes(t) ? p.filter(x => x !== t) : p.length < 5 ? [...p, t] : p);
  return <section className="panel history-panel">
    <PanelTitle title={t('hist.archiveTitle')} subtitle={t('hist.archiveCount', { count: files.length })}/>
    <div className="history-toolbar"><label className="field"><span>{t('hist.archiveFile')}</span><select value={name} onChange={e => setName(e.target.value)} aria-label="Arhiivifail">{files.map(f => <option key={f.name} value={f.name}>{f.name} · {(f.bytes / 1024).toFixed(0)} KB</option>)}</select></label>{range && <span className="muted">{date(new Date(range.from))} – {date(new Date(range.to))}</span>}</div>
    {meta && <>
      <div className="point-picker">{series.map(s => <button key={s.token} type="button" className={picked.includes(s.token) ? 'selected' : ''} aria-pressed={picked.includes(s.token)} onClick={() => toggle(s.token)}>{s.label}<span>{s.unit}</span></button>)}</div>
      {src ? <HistoryChart key={`${name}-${picked.join(',')}`} name={`arch-${name}`} deviceId="archive" src={src} points={points} hours={24} range={range} tick={tick} theme={theme} footnote={false}/> : <p className="muted">{t('hist.archivePick')}</p>}
    </>}
  </section>;
}

function HistoryPage({ deviceId, points, tick, theme, stateId, model, ventPoints = [], luxPoints = [] }) {
  const [hours, setHours] = useState(24), [ids, setIds] = useState([]), [range, setRange] = useState(null), [compare, setCompare] = useState(false), [mode, setMode] = useState('active');
  const isNumeric = p => p.value != null && p.value !== '' && Number.isFinite(Number(p.value)) && !p.enumValues?.length;
  const pumpPoints = points.filter(isNumeric);
  // Ventilatsiooni näidud saavad eesliite a:, et need ei läheks soojuspumba numbriliste id-dega segi.
  const vent = ventPoints.filter(isNumeric).map(p => ({ ...p, parameterId: `a:${p.parameterId}`, ext: true, label: pointNameText(p.label) }));
  const lx = luxPoints.filter(isNumeric).map(p => ({ ...p, parameterId: `l:${p.parameterId}`, ext: true, label: pointNameText(p.label) }));
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
  return <><div className="segmented" role="group" aria-label={t('hist.view')}><button type="button" className={mode==='active'?'selected':''} onClick={()=>setMode('active')}>{t('hist.active')}</button><button type="button" className={mode==='archive'?'selected':''} onClick={()=>setMode('archive')}>{t('hist.archive')}</button></div>{mode === 'archive' ? <ArchiveViewer tick={tick} theme={theme}/> : <><div className="history-toolbar"><div className="history-controls"><div className="segmented">{[[6,t('hist.h6')],[24,t('hist.h24')],[168,t('hist.d7')],[720,t('hist.d30')],[8760,t('hist.y1')],[43800,t('hist.y5')],[87600,t('hist.y10')]].map(([v,l])=><button key={v} className={!range && hours===v?'selected':''} onClick={()=>{setHours(v);setRange(null);}}>{l}</button>)}</div><button type="button" className={`button ${compare?'selected':'secondary'}`} aria-pressed={compare} onClick={()=>setCompare(!compare)}><History size={16}/>{t('hist.compare')}</button>{range&&<button type="button" className="button secondary" onClick={()=>setRange(null)}><X size={16}/>{t('hist.resetZoom', { from: date(range.from), to: time(range.to) })}</button>}</div><a className="button secondary" href={csvHref}><Download size={16}/>{t('hist.exportCsv')}</a></div><section className="panel history-panel"><PanelTitle title={t('hist.title')} subtitle={t('hist.subtitle', { unit: unit || t('hist.valueUnit'), all: vent.length || lx.length ? t('hist.allDevices') : '' })}/><div className="point-picker">{(vent.length > 0 || lx.length > 0) && <span className="point-group">{t('hist.groupPump')}</span>}{pumpPoints.map(pick)}{vent.length > 0 && <span className="point-group">{t('hist.groupVent')}</span>}{vent.map(pick)}{lx.length > 0 && <span className="point-group">{t('hist.groupLocal')}</span>}{lx.map(pick)}</div><HistoryChart key={mixed ? 'mix' : 'pump'} deviceId={mixed ? 'mix' : deviceId} auxDeviceId={deviceId} extra={mixed ? mixQuery : ''} points={chartPoints} hours={hours} tick={tick} theme={theme} stateId={stateId} range={range} onZoom={setRange} compare={compare} targets={targets}/></section><div className="info-banner"><History size={19}/><div><b>{t('hist.noteTitle')}</b><p>{t('hist.noteBody')}</p></div></div></>}</>;
}

function AlarmsPage({ systemId, tick }) {
  const [active,setActive] = useState(true), [page,setPage]=useState(1), [data,setData]=useState(null), [error,setError]=useState(null), [busy,setBusy]=useState(false);
  useEffect(()=>{if(!systemId)return;const c=new AbortController();setBusy(true);api(`/systems/${encodeURIComponent(systemId)}/notifications?active=${active}&page=${page}`,{signal:c.signal}).then(d=>{setData(d);setError(null);}).catch(e=>{if(!c.signal.aborted)setError(e.message);}).finally(()=>{if(!c.signal.aborted)setBusy(false);});return()=>c.abort();},[systemId,active,page,tick]);
  return <section className="panel"><PanelTitle title={t('alarms.title')} subtitle={t('alarms.subtitle')} action={<div className="segmented"><button className={active?'selected':''} onClick={()=>{setActive(true);setPage(1);}}>{t('alarms.active')}</button><button className={!active?'selected':''} onClick={()=>{setActive(false);setPage(1);}}>{t('alarms.all')}</button></div>}/>{error?<Empty icon={AlertCircle} title={t('alarms.loadError')}>{error}</Empty>:busy?<div className="chart-loading"><LoaderCircle className="spin"/>{t('alarms.loading')}</div>:!data?.notifications?.length?<Empty icon={ShieldCheck} title={active ? t('alarms.noneActiveTitle') : t('alarms.noneTitle')}>{active ? t('alarms.noneActiveBody') : t('alarms.noneBody')}</Empty>:<div className="alarm-list">{[...data.notifications].sort((a,b)=>String(b.createdDatetime).localeCompare(String(a.createdDatetime))).map(n=><article className="alarm-row" key={n.id}><span className={`square-icon ${n.status==='Active'?'orange':'teal'}`}>{n.status==='Active'?<AlertCircle size={20}/>:<CheckCheck size={20}/>}</span><div><h3>{n.header || t('alarms.alarm', { number: n.alarmNumber })}</h3><p>{n.description}</p><small>#{n.alarmNumber} · {date(n.createdDatetime)}</small></div><Badge tone={n.status==='Active'?'amber':'gray'}>{n.status==='Active' ? t('alarms.activeState') : t('alarms.ended')}</Badge></article>)}</div>}<div className="table-footer"><span>{t('alarms.count', { count: data?.numItems || 0 })}</span><div className="pagination"><button disabled={page<=1||busy} onClick={()=>setPage(p=>p-1)}>{t('alarms.previous')}</button><span>{t('alarms.page', { page })}</span><button disabled={!data || page*20>=data.numItems||busy} onClick={()=>setPage(p=>p+1)}>{t('alarms.next')}</button></div></div><div className="panel-note">{t('alarms.noteBefore')} <a href="https://myuplink.com/system-profile?tab=event-log" target="_blank" rel="noreferrer">{t('alarms.eventLog')} <ExternalLink size={12}/></a> {t('alarms.noteAfter')}</div></section>;
}

function DevicePage({ device, model, detail, firmware, aid, subscriptions, categories, zones, points, online, errors }) {
  const subs = Array.isArray(subscriptions) ? subscriptions.flatMap(s=>s.subscriptions||[]) : subscriptions?.subscriptions||[];
  return <><section className="panel device-hero"><div className="device-portrait"><div className="mini-pump"><span>soojus.</span><div className="pump-screen"><Activity size={26}/></div><i/><i/><div className="pump-bottom"/></div></div><div className="device-hero-info"><span className="eyebrow">{t('device.eyebrow')}</span><h2>{model}</h2><p>{t('device.connectedTo')}</p><Badge tone={online?'green':'amber'}>{online ? t('device.online') : t('device.offline')}</Badge><div className="device-facts"><div><small>{t('device.serial')}</small><b>{device?.product?.serialNumber || '—'}</b></div><div><small>{t('device.params')}</small><b>{points.length}</b></div><div><small>{t('device.zones')}</small><b>{zones.length}</b></div></div></div></section><div className="two-columns"><section className="panel"><PanelTitle title={t('device.firmwareTitle')}/><dl className="detail-list"><div><dt>{t('device.currentVersion')}</dt><dd>{firmware?.currentFwVersion || '—'}</dd></div><div><dt>{t('device.availableVersion')}</dt><dd>{firmware?.desiredFwVersion || '—'}</dd></div><div><dt>{t('device.firmwareType')}</dt><dd>{firmware?.firmwareId || '—'}</dd></div><div><dt>{t('device.vendor')}</dt><dd>{firmware?.brand || '—'}</dd></div><div><dt>{t('device.aidMode')}</dt><dd>{aid?.aidMode ? enumText(aid.aidMode) : '—'}</dd></div><div><dt>{t('device.deviceId')}</dt><dd className="id-value">{device?.id}</dd></div></dl>{errors.firmware&&<p className="inline-error">{errors.firmware}</p>}<div className="button-row">{firmware?.firmwareId && firmware?.desiredFwVersion && <a className="button secondary" href={`/api/firmware/${encodeURIComponent(firmware.firmwareId)}/${encodeURIComponent(firmware.desiredFwVersion)}/download`}><Download size={16}/>{t('device.downloadFw')}</a>}<a className="text-button" href="https://myuplink.com/update-firmware" target="_blank" rel="noreferrer">{t('device.updateIn')} <ExternalLink size={14}/></a></div></section><section className="panel"><PanelTitle title={t('device.subsTitle')} subtitle={t('device.subsSubtitle')}/>{errors.subscriptions?<p className="inline-error">{errors.subscriptions}</p>:subs.length?subs.map((s,i)=><div className="subscription-row" key={i}><span className="square-icon teal"><ShieldCheck size={21}/></span><div><h3>{s.type==='manage' ? t('subscription.manage') : s.type==='history' ? t('subscription.history') : s.type}</h3><p>{t('device.validUntil', { date: date(s.validUntil,{hour:undefined,minute:undefined}) })}</p></div><Badge tone={Date.parse(s.validUntil)>Date.now()?'green':'gray'}>{Date.parse(s.validUntil)>Date.now() ? t('device.active') : t('device.expired')}</Badge></div>):<p className="muted">{t('device.noSubs')}</p>}<p className="muted">{t('subscription.renewHint')}</p><div className="panel-note">{t('device.subsNote')}</div></section></div><section className="panel capabilities-panel"><PanelTitle title={t('device.capTitle')} subtitle={t('device.capSubtitle')}/><div className="capabilities">{[[t('device.capHwBoost'),categories['sh-hwBoost']],[t('device.capHwMode'),categories['sh-hwMode']],[t('device.capTemp'),points.some(p=>p.writable&&p.parameterUnit==='°C')],[t('device.capZones'),zones.length>0],[t('device.capOutdoor'),categories['sh-outdoorTemp']],[t('device.capModes'),categories['sh-smartMode']],[t('device.capEnergy'),categories['sh-energyMetered']],[t('device.capVent'),categories['sh-ventMode']],[t('device.capPool'),categories['sh-poolTemp']],[t('device.capSolar'),categories['sh-solarEnergyProducedDay']],[t('device.capSchedules'),detail?.availableFeatures?.getScheduleWeekly]].map(([name,enabled])=><div className={enabled?'supported':'unsupported'} key={name}><span>{enabled?<Check size={15}/>:<Minus size={15}/>}</span>{name}<small>{enabled ? t('device.supported') : t('device.unsupported')}</small></div>)}</div></section></>;
}

function SettingsPage({ status, notify, onConnect, tick, navigate, ui = 'classic', setUi, weather, lux }) {
  const locale = useLocale();
  const downloadMissing = code => {
    const data = missingTranslations(code);
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `soojus-i18n-${code}-missing.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const [clientId,setClientId]=useState(''),[secret,setSecret]=useState(''),[busy,setBusy]=useState(false),[audit,setAudit]=useState([]),[auditError,setAuditError]=useState(null),[testing,setTesting]=useState(false),[archiving,setArchiving]=useState(false),[archiveMsg,setArchiveMsg]=useState(null),[archiveBefore,setArchiveBefore]=useState(()=>new Date(Date.now()-365*86400000).toISOString().slice(0,10));
  const archiveMax = new Date(Date.now()-365*86400000).toISOString().slice(0,10);
  useEffect(()=>{api('/audit').then(setAudit).catch(e=>setAuditError(e.message));},[tick]);
  async function connect(e){e.preventDefault();setBusy(true);try{await api('/connect',{method:'POST',body:JSON.stringify(clientId&&secret?{clientId,clientSecret:secret}:{})});setSecret('');notify(t('settings.notify.connected'));await onConnect();navigate('overview');}catch(e){notify(e.message,true);}finally{setBusy(false);}}
  async function disconnect(){try{await api('/disconnect',{method:'POST',body:'{}'});await onConnect();notify(t('settings.notify.disconnected'));}catch(e){notify(e.message,true);}}
  async function archive(){if(!archiveBefore)return;if(!window.confirm(t('settings.notify.archiveConfirm', { date: archiveBefore })))return;setArchiving(true);setArchiveMsg(null);try{const r=await api('/archive',{method:'POST',body:JSON.stringify({before:archiveBefore})});setArchiveMsg(t('settings.notify.archiveResult', { file: r.file, mb: (r.bytes/1048576).toFixed(1), rows: r.rows, removed: r.removed }));notify(t('settings.notify.archived'));}catch(e){setArchiveMsg(e.message);notify(e.message,true);}finally{setArchiving(false);}}
  return <><section className="panel"><PanelTitle title={t('settings.language.title')} subtitle={t('settings.language.hint')}/><div className="lang-cards">{LOCALES.map(([code, label]) => { const cov = localeCoverage(code), active = locale === code; return <div key={code} className={`lang-card ${active ? 'active' : ''}`}><div className="lang-card-head"><b>{label}</b><span>{code.toUpperCase()}</span>{active && <em>{t('settings.language.current')}</em>}</div><div className="lang-bar"><i style={{ width: `${cov.total ? (cov.translated / cov.total) * 100 : 0}%` }}/></div><small>{cov.translated}/{cov.total} {t('settings.language.strings')}{cov.missing.length ? ` · ${cov.missing.length} ${t('settings.language.missing')}` : ''}</small><div className="lang-card-actions">{active ? <span className="lang-current">{t('settings.language.inUse')}</span> : <button type="button" className="button" onClick={() => setLocale(code)}>{t('settings.language.use')}</button>}{cov.missing.length > 0 && <button type="button" className="text-button" onClick={() => downloadMissing(code)}>{t('settings.language.exportMissing')}</button>}</div></div>; })}</div></section><section className="panel nx-liide"><PanelTitle title={t('settings.ui.title')} subtitle={t('settings.ui.subtitle')}/><div className="segmented" role="group" aria-label={t('settings.ui.aria')}>{[['classic',t('settings.ui.classic')],['next',t('settings.ui.next')]].map(([v,l]) => <button key={v} type="button" className={ui===v?'selected':''} aria-pressed={ui===v} onClick={() => setUi?.(v)}>{l}</button>)}</div></section>{weather && <LocationPanel weather={weather} notify={notify}/>}{lux && <LuxtronikPanel lux={lux} notify={notify}/>}<div className="two-columns"><section className="panel connection-panel"><PanelTitle title={t('settings.conn.title')} subtitle={t('settings.conn.subtitle')} action={<Badge tone={status?.connected?'green':'gray'}>{status?.connected ? t('settings.conn.connected') : t('settings.conn.disconnected')}</Badge>}/>{new URLSearchParams(location.search).has('authError')&&<p className="inline-error">{t('settings.conn.authError')}</p>}<form onSubmit={connect}><label className="field">Client Identifier<input autoComplete="off" value={clientId} onChange={e=>setClientId(e.target.value)} placeholder={status?.configured ? t('settings.conn.idSaved') : t('settings.conn.idPlaceholder')}/></label><label className="field">Client Secret<input type="password" autoComplete="new-password" value={secret} onChange={e=>setSecret(e.target.value)} placeholder={status?.configured ? t('settings.conn.secretSaved') : t('settings.conn.secretPlaceholder')}/></label><div className="button-row"><Button kind="primary" icon={Link2} busy={busy} type="submit">{status?.connected ? t('settings.conn.update') : t('settings.conn.connect')}</Button>{status?.connected&&<Button icon={LogOut} type="button" onClick={disconnect}>{t('settings.conn.disconnect')}</Button>}</div></form><div className="oauth-option"><span>{t('settings.conn.alt')}</span><a className="text-button" href="/auth/start">{t('settings.conn.signIn')} <ExternalLink size={14}/></a></div></section><section className="panel"><PanelTitle title={t('settings.conn.guideTitle')}/><ol className="setup-steps"><li><span>1</span><div><b>{t('settings.conn.step1Title')}</b><p><a href="https://dev.myuplink.com/apps" target="_blank" rel="noreferrer">{t('settings.conn.portal')} <ExternalLink size={12}/></a></p></div></li><li><span>2</span><div><b>{t('settings.conn.step2Title')}</b><code>{status?.callbackUrl || 'http://localhost:3210/auth/callback'}</code></div></li><li><span>3</span><div><b>{t('settings.conn.step3Title')}</b><p>{t('settings.conn.step3Body')}</p></div></li></ol><div className="button-row"><Button icon={Activity} busy={testing} onClick={async()=>{setTesting(true);try{await api('/ping');notify(t('settings.notify.ping'));}catch(e){notify(e.message,true);}finally{setTesting(false);}}}>{t('settings.conn.test')}</Button></div></section></div><section className="panel storage-panel"><PanelTitle title={t('settings.storage.title')}/><div className="storage-grid"><div><Clock3 size={20}/><span>{t('settings.storage.interval')}<b>{t('settings.storage.intervalValue')}</b></span></div><div><History size={20}/><span>{t('settings.storage.retention')}<b>{t('settings.storage.retentionValue')}</b></span></div><div><ShieldCheck size={20}/><span>{t('settings.storage.location')}<b>{t('settings.storage.locationValue')}</b></span></div></div><div className="button-row"><label className="field"><span>{t('settings.storage.archiveBefore')}</span><input type="date" value={archiveBefore} max={archiveMax} onChange={e=>setArchiveBefore(e.target.value)} aria-label={t('settings.storage.archiveAria')}/></label><Button icon={Download} busy={archiving} type="button" onClick={archive}>{t('settings.storage.archiveButton')}</Button></div>{archiveMsg && <p className="muted">{archiveMsg}</p>}{status?.collectorError && <p className="inline-error">{t('settings.storage.collectorNote', { error: status.collectorError })}</p>}<p className="muted">{t('settings.storage.note')}</p></section><section className="panel"><PanelTitle title={t('settings.audit.title')} subtitle={t('settings.audit.subtitle')}/>{auditError?<p className="inline-error">{auditError}</p>:!audit.length?<Empty icon={History} title={t('settings.audit.emptyTitle')}>{t('settings.audit.emptyBody')}</Empty>:<div className="audit-list">{audit.map(a=><details key={a.id}><summary><span>{a.action}</span><small>{date(a.time)}</small><ChevronDown size={15}/></summary><pre>{JSON.stringify(JSON.parse(a.detail),null,2)}</pre></details>)}</div>}</section></>;
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
      if(!result.allModified)throw new Error(t('edit.confirmFailed', { statuses: result.results.map(r=>r.status).join(', ') }));
    }else if(item.type==='zone'){
      const body={};if(z.setpointHeat!=null&&String(z.setpointHeat)!==heat)body.setpointHeat=Number(heat);if(z.setpointCool!=null&&String(z.setpointCool)!==cool)body.setpointCool=Number(cool);if(z.mode!==zoneMode)body.mode=zoneMode;
      const d=await api(`/devices/${encodeURIComponent(deviceId)}/zones/${encodeURIComponent(z.zoneId)}`,{method:'PATCH',body:JSON.stringify(body)});
      if(d.result && Object.values(d.result).some(v=>String(v).toLowerCase()!=='modified'))throw new Error(t('edit.zoneFailed'));
    }else await api(`/systems/${encodeURIComponent(systemId)}/mode`,{method:'PUT',body:JSON.stringify({smartHomeMode:value})});
    notify(t('edit.sent'));onSaved();
  }catch(e){setError(e.message);}finally{setBusy(false);}}
  const title=p?.label||z?.name||t('edit.homeMode');
  return <dialog ref={dialog} className="edit-dialog" onCancel={e=>{e.preventDefault();if(!busy)onClose();}} onClick={e=>{if(e.target===dialog.current&&!busy)onClose();}}><div className="modal-heading"><span className="square-icon teal"><Settings2 size={22}/></span><button className="icon-button" disabled={busy} aria-label={t('edit.close')} onClick={onClose}><X size={21}/></button></div><h2>{title}</h2><p className="muted">{t('edit.sending')}</p><form onSubmit={save}>
    {item.type==='point'&&<><div className="current-setting"><span>{t('edit.currentValue')}</span><b>{p.display}</b></div><label className="field">{t('edit.newValue')}{p.enumValues?.length?<select autoFocus value={value} onChange={e=>setValue(e.target.value)}>{p.enumValues.map(v=><option key={v.value} value={v.value}>{enumText(v.text)}</option>)}</select>:<div className="number-field"><button type="button" aria-label={t('edit.decrease')} onClick={()=>setValue(String(Math.max(p.min??-Infinity,Number((Number(value)-(p.step||1)).toFixed(8)))))}><Minus size={19}/></button><input autoFocus required type="number" min={p.min??undefined} max={p.max??undefined} step={p.step||'any'} value={value} onChange={e=>setValue(e.target.value)} aria-label={t('edit.newValue')}/><span>{p.parameterUnit}</span><button type="button" aria-label={t('edit.increase')} onClick={()=>setValue(String(Math.min(p.max??Infinity,Number((Number(value)+(p.step||1)).toFixed(8)))))}><Plus size={19}/></button></div>}</label>{!p.enumValues?.length&&<p className="field-help">{t('edit.allowed', { min: number(p.min), max: number(p.max), unit: p.parameterUnit, step: number(p.step, 3) })}</p>}<small className="field-help">{t('edit.parameter', { id: p.parameterId, name: p.parameterName })}</small></>}
    {item.type==='zone'&&<>{z.setpointHeat!=null&&<label className="field">{t('edit.heatSetpoint')} {z.commandOnly?'':z.isCelsius?'(°C)':'(°F)'}<input required autoFocus type="number" min={z.setpointRangeMin??undefined} max={z.setpointRangeMax??undefined} step="any" value={heat} onChange={e=>setHeat(e.target.value)}/></label>}{z.setpointCool!=null&&<label className="field">{t('edit.coolSetpoint')}<input required type="number" min={z.setpointRangeMin??undefined} max={z.setpointRangeMax??undefined} step="any" value={cool} onChange={e=>setCool(e.target.value)}/></label>}{z.supportedModes&&<label className="field">{t('edit.workMode')}<select value={zoneMode} onChange={e=>setZoneMode(e.target.value)}>{z.supportedModes.split(/[,;\s]+/).filter(Boolean).map(m=><option key={m} value={m}>{enumText(m)}</option>)}</select></label>}</>}
    {item.type==='mode'&&<label className="field">{t('edit.homeMode')}<select value={value} onChange={e=>setValue(e.target.value)}>{['Default','Normal','Home','Away','Vacation'].map(m=><option key={m} value={m}>{enumText(m)}</option>)}</select></label>}
    {error&&<p role="alert" className="inline-error">{error}</p>}<div className="modal-actions"><Button type="button" disabled={busy} onClick={onClose}>{t('edit.cancel')}</Button><Button type="submit" kind="primary" icon={Check} busy={busy} disabled={!changed}>{t('edit.save')}</Button></div></form></dialog>;
}
