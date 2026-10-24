import React, { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react';
import { LayoutTemplate, Activity, ArrowDownLeft, ArrowRight, ArrowUpRight, Bell, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Clock3, CloudSun, Download, Droplets, ExternalLink, Fan, Flame, Gauge, History, Home, LayoutDashboard, Link2, LoaderCircle, Menu, Minus, Moon, Plus, Power, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal, Snowflake, Star, Sun, Thermometer, Waves, Wifi, WifiOff, X, Zap, AlertCircle, Monitor, CircleDot, LogOut, Save, CalendarDays } from 'lucide-react';
import { useAirobot } from './ventilation.jsx';
import { t, getLocale } from './i18n/index.js';
import { useLocale } from './i18n/react.js';
import { useWeather } from './weather.js';
import { useLuxtronik } from './luxtronik.jsx';
import { climate, climatePoints, climateQuery } from './ventilation-logic.js';
import { pumpState } from './next/logic.js';
import { api, number, date, time, enumText, enhance, metric, targetLines } from './lib.js';
import { Badge, Button, Empty, PanelTitle, Reading } from './ui.jsx';
import OfflineBanner, { useNetworkStatus } from './offline-banner.jsx';

const NextUI = lazy(() => import('./next/NextUI.jsx'));
const HistoryChart = lazy(() => import('./history-chart.jsx'));
const HistoryPage = lazy(() => import('./history-page.jsx'));
const ControlPage = lazy(() => import('./control.jsx'));
const Parameters = lazy(() => import('./parameters.jsx'));
const AlarmsPage = lazy(() => import('./alarms.jsx'));
const DevicePage = lazy(() => import('./device.jsx'));
const SettingsPage = lazy(() => import('./settings.jsx'));
const VentilationPage = lazy(() => import('./ventilation.jsx').then(module => ({ default: module.VentilationPage })));

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
export default function App() {
  useLocale();
  const networkOnline = useNetworkStatus();
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
  // Kompressori olek otseliidesest, kui see on värske ja kinnitatud; muidu myUplinki punkt 70.
  // Nii kasutavad animatsioon ja tekst sama allikat ega lähe ajutiselt lahku.
  const directCompressor = model === 'WZSV 92H3M' && lux?.view && lux.view.primary !== false ? (lux.view.data?.outputs?.compressor ? 1 : 0) : null;
  const compressor = model === 'WZSV 92H3M'
    ? (directCompressor == null ? metricFor('70') : { ...(metricFor('70') || {}), value: directCompressor })
    : undefined;
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
    const onOnline = () => { if (selection && systemId) refresh(); else bootstrap(); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [selection, systemId, refresh, bootstrap]);
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
      m: { supply, returnT, returnTarget, buffer, water, waterTarget, power, outdoor, heatingState, hwState, workMode, compressor } };
    return <><OfflineBanner online={networkOnline} onRetry={() => selection ? refresh() : bootstrap()}/><Suspense fallback={<div className="loading-grid" aria-label={t('shell.loadingUi')} style={{ padding: 32 }}><div className="skeleton large"/></div>}><NextUI ctx={ctx}/></Suspense>{overlays}</>;
  }

  return <div className="app-shell">
    <OfflineBanner online={networkOnline} onRetry={() => selection ? refresh() : bootstrap()}/>
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
            <div className="overview-grid"><section className="panel flow-panel"><PanelTitle title={t('ov.flowTitle')} subtitle={t('ov.flowSubtitle')} action={<span className="subtle-label"><span className="tiny-dot"/>{t('ov.deviceReadings')}</span>}/><FlowDiagram supply={supply} returnT={returnT} water={water} power={power} heatingState={heatingState} hwState={hwState} workMode={workMode} compressor={compressor} online={online} model={model}/><div className="flow-bottom"><span><ShieldCheck size={16}/>{errors.notices ? t('ov.noticesUnavailable') : system?.hasAlarm || activeNotices.length ? t('ov.alarmActive') : t('ov.noAlarms')}</span><button className="text-button" onClick={() => navigate('device')}>{t('ov.deviceDetails')} <ArrowRight size={15}/></button></div></section>
            <section className="panel quick-panel"><PanelTitle title={t('ov.quickTitle')} subtitle={t('ov.quickSubtitle')}/><div className="quick-control"><span className="square-icon orange"><Flame size={20}/></span><div><b>{t('titles.heating')}</b><small>{points.find(p => p.parameterId === '5003')?.display || heatingState?.display || t('ov.seeSettings')}</small></div><button className="icon-button" aria-label={t('ov.openHeat')} onClick={() => navigate('heating')}><ChevronRight size={19}/></button></div><div className="quick-control"><span className="square-icon blue"><Droplets size={20}/></span><div><b>{t('titles.water')}</b><small>{zones.find(z => /tarbe/i.test(z.name))?.setpointHeat != null ? t('ov.target', { value: number(zones.find(z => /tarbe/i.test(z.name)).setpointHeat) }) : t('ov.seeSettings')}</small></div><button className="icon-button" aria-label={t('ov.openWater')} onClick={() => navigate('water')}><ChevronRight size={19}/></button></div><div className="boost-box"><div><Zap size={19}/><b>{t('ov.quickCharge')}</b></div><p>{t('ov.quickChargeHint')}</p><Button icon={power?.value > 0 ? Zap : Plus} onClick={() => { const p = points.find(p => p.smartHomeCategories?.includes('sh-hwBoost') && p.writable); if (p) setEditing({ type: 'point', point: p }); }} disabled={!points.some(p => p.smartHomeCategories?.includes('sh-hwBoost') && p.writable) || !online}>{points.find(p => p.smartHomeCategories?.includes('sh-hwBoost'))?.value == 1 ? t('ov.manageCharge') : t('ov.setCharge')}</Button></div><button className="text-button quick-all" onClick={() => navigate('parameters')}>{t('ov.allControls')} <ArrowRight size={15}/></button></section></div>
            <div className="overview-bottom"><Suspense fallback={<div className="chart-loading"><LoaderCircle size={22} className="spin"/>{t('chart.loading')}</div>}><section className="panel chart-panel"><PanelTitle title={t('ov.chartTitle')} subtitle={t('ov.chartSubtitle')} action={<div className="panel-actions"><div className="segmented" role="group" aria-label={t('overview.periodLabel')}>{[[24,t('overview.periodDay')],[168,t('overview.periodWeek')],[720,t('overview.periodMonth')]].map(([v,l]) => <button key={v} type="button" className={ovHours === v ? 'selected' : ''} aria-pressed={ovHours === v} onClick={() => pickOvHours(v)}>{l}</button>)}</div><button className="text-button" onClick={() => navigate('history')}>{t('ov.viewHistory')} <ArrowUpRight size={15}/></button></div>}/>{heatPoints.length > 0 && <div className="chart-section"><h4>{t('overview.metricHeat')}</h4><HistoryChart name="heat" deviceId={selection} points={heatPoints} defaultHidden={heatPoints.slice(1).map(p => p.parameterId)} hours={ovHours} tick={tick} compact theme={theme} stateId={model === 'WZSV 92H3M' ? '17' : null} targets={[]}/></div>}{[water].filter(Boolean).length > 0 && <div className="chart-section"><h4>{t('overview.metricWater')}</h4><HistoryChart name="water" footnote={false} deviceId={selection} points={[water].filter(Boolean)} hours={ovHours} tick={tick} compact theme={theme} stateId={model === 'WZSV 92H3M' ? '17' : null} targets={targetLines(points, model, [water].filter(Boolean).map(p => p.parameterId))}/></div>}{airobot.view?.configured && airobot.view.data && outdoor && <div className="chart-section"><h4>{t('overview.metricClimate')}</h4><HistoryChart name="climate" footnote={false} deviceId="climate" extra={climateQuery(selection, outdoor.parameterId)} points={climatePoints()} hours={ovHours} tick={tick} compact theme={theme}/></div>}{[power].filter(Boolean).length > 0 && <div className="chart-section"><h4>{t('overview.metricPower')}</h4><HistoryChart name="power" footnote={false} deviceId={selection} points={[power].filter(Boolean)} hours={ovHours} tick={tick} compact theme={theme} stateId={model === 'WZSV 92H3M' ? '17' : null} targets={[]}/></div>}</section></Suspense><section className="panel health-panel"><PanelTitle title={t('ov.healthTitle')}/><div className="health-heading"><span className={`health-icon ${activeNotices.length ? 'warning' : ''}`}><ShieldCheck size={26}/></span><div><b>{errors.notices ? t('ov.stateUnknown') : system?.hasAlarm || activeNotices.length ? t('ov.needsAttention') : t('ov.allGood')}</b><small>{errors.notices ? t('ov.noticesError') : t('ov.myUplinkOverview')}</small></div></div><dl className="health-list"><div><dt>{t('ov.connection')}</dt><dd><span className={`tiny-dot ${online ? '' : 'gray-dot'}`}/>{online ? t('ov.online') : t('ov.offline')}</dd></div><div><dt>{t('ov.compressorLabel')}</dt><dd>{metricFor('70')?.display || '—'}</dd></div><div><dt>{t('ov.totalHours')}</dt><dd>{number(metricFor('5668')?.value, 0)} h</dd></div><div><dt>{t('ov.firmware')}</dt><dd className="firmware-short">{firmware?.currentFwVersion || '—'}</dd></div></dl><button className="text-button" onClick={() => navigate('alarms')}>{t('ov.viewLog')} <ArrowRight size={15}/></button></section></div>
            {favorites.length > 0 && <section className="panel favorites-panel"><PanelTitle title={t('overview.favorites')} subtitle={t('ov.favoritesSubtitle')}/><div className="reading-grid">{points.filter(p => favorites.includes(`${selection}:${p.parameterId}`)).map(p => <Reading key={p.parameterId} point={p}/>)}</div></section>}
          </>}
          <Suspense fallback={<div className="loading-grid" aria-label={t('shell.loading')}>{[1,2,3,4].map(n => <div key={n} className="skeleton"/>)}<div className="skeleton large"/></div>}>
          {(page === 'heating' || page === 'water') && <ControlPage {...shared} waterPage={page === 'water'} mode={mode} />}
          {page === 'parameters' && <Parameters {...shared} search={search} setSearch={setSearch} favorites={favorites} favorite={favorite}/>}
          {page === 'ventilation' && <VentilationPage tick={tick} theme={theme} HistoryChart={HistoryChart} notify={notify} airobot={airobot} outdoor={outdoor?.value} pumpDeviceId={selection} outdoorPointId={outdoor?.parameterId}/>}
          {page === 'history' && <HistoryPage deviceId={selection} points={points} tick={tick} theme={theme} model={model} stateId={model === 'WZSV 92H3M' ? '17' : null} ventPoints={airobot.view?.configured && airobot.view.data ? airobot.view.points : []} luxPoints={lux.view?.configured && lux.view.data ? lux.view.points : []}/>}
          {page === 'alarms' && <AlarmsPage systemId={system?.systemId} tick={tick}/>}
          {page === 'device' && <DevicePage {...shared} firmware={firmware} aid={aid} subscriptions={subscriptions}/>}
          {page === 'settings' && <SettingsPage status={status} notify={notify} onConnect={bootstrap} tick={tick} navigate={navigate} ui={ui} setUi={setUi} weather={weather} lux={lux}/>}
          </Suspense>
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
