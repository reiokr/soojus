import React, { useEffect, useState } from 'react';
import { Download, History, LoaderCircle, X } from 'lucide-react';
import { api, date, pointNameText, targetLines, time } from './lib.js';
import { t } from './i18n/index.js';
import { Empty, PanelTitle } from './ui.jsx';
import HistoryChart from './history-chart.jsx';

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


export default HistoryPage;
