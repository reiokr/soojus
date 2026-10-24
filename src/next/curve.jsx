import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Minus, Plus } from 'lucide-react';
import { ComposedChart, Line, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ReferenceDot, ResponsiveContainer } from 'recharts';
import { api, number } from '../lib.js';
import { t } from '../i18n/index.js';
import { fitCurve } from './curve-fit.js';

export default function HeatingCurvePage({ ctx }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);
  const [preview, setPreview] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ctx.selection) return;
    let live = true;
    setError(null);
    api(`/heating-curve?device=${encodeURIComponent(ctx.selection)}&days=${days}`)
      .then(result => { if (!live) return; setData(result); setPreview(Number(result.latest?.offset ?? 0)); })
      .catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [ctx.selection, days, reload]);

  const dark = ctx.theme === 'dark';
  const colors = { curve: dark ? '#7fc4ff' : '#2f6f9f', preview: dark ? '#ffb36b' : '#c06a2c', scatter: dark ? '#6fe0c8' : '#2f9e83', grid: dark ? '#2c3439' : '#e3e9ed', tick: dark ? '#a9b8c2' : '#5f7280' };
  const latest = data?.latest ?? {};
  const limit = latest.limit == null ? null : Number(latest.limit);
  // Üle välisõhupiiri on küttetarve 0 ja siht langeb miinimumini – see ei kuulu küttekõvera hulka.
  const fitPoints = useMemo(() => (data?.points ?? []).filter(point => limit == null || point.outdoor <= limit), [data, limit]);
  const fit = useMemo(() => fitCurve(fitPoints), [fitPoints]);
  const dataMin = fitPoints.length ? Math.min(...fitPoints.map(point => point.outdoor)) : -20;
  const dataMax = fitPoints.length ? Math.max(...fitPoints.map(point => point.outdoor)) : 20;
  const min = Math.floor(dataMin) - 1;
  const max = Math.max(Math.ceil(dataMax) + 1, limit != null ? limit + 2 : 20);
  const fitMax = limit == null ? max : Math.min(max, limit);
  const curveData = useMemo(() => {
    if (!fit) return [];
    const line = [];
    for (let x = Math.ceil(min * 2) / 2; x <= fitMax; x += 0.5) line.push({ outdoor: x, target: Math.round(fit.predict(x) * 10) / 10 });
    return line;
  }, [fit, min, fitMax]);
  const shift = Number(preview) - Number(latest.offset ?? 0);
  const previewData = curveData.map(point => ({ outdoor: point.outdoor, preview: Math.round((point.target + shift) * 10) / 10 }));
  const compressorOn = Number(latest.compressor) > 0.5;
  const deviation = compressorOn && latest.return != null && latest.target != null ? Number(latest.return) - Number(latest.target) : null;
  const enough = (data?.points?.length ?? 0) >= 3;

  const saveOffset = async () => {
    if (latest.offset == null || !window.confirm(t('curve.confirmOffset', { value: number(preview, 1), current: number(latest.offset, 1) }))) return;
    setBusy(true);
    try {
      await api(`/devices/${encodeURIComponent(ctx.selection)}/points`, { method: 'PATCH', body: JSON.stringify({ '5001': String(preview) }) });
      ctx.notify?.(t('curve.saved'));
      setReload(value => value + 1);
    } catch (e) { ctx.notify?.(e.message, true); } finally { setBusy(false); }
  };

  const period = <div className="segmented" role="group" aria-label={t('curve.period')}>{[[30, t('energy.d30')], [90, t('energy.d90')], [365, t('energy.d365')]].map(([value, label]) => <button key={value} type="button" className={days === value ? 'selected' : ''} aria-pressed={days === value} onClick={() => setDays(value)}>{label}</button>)}</div>;

  if (error) return <section className="nx-panel"><div className="nx-panel-head"><h2>{t('curve.title')}</h2>{period}</div><p className="nx-warn"><AlertCircle size={15}/>{error}</p></section>;
  if (!data) return <div className="nx-skeleton" aria-label={t('curve.loading')}><i/><i/><i/></div>;

  return <>
    <section className="nx-panel">
      <div className="nx-panel-head"><h2>{t('curve.summary')}</h2>{period}</div>
      <div className="en-cards">
        <div className="en-card"><small>{t('curve.outdoor')}</small><b>{latest.outdoor == null ? '—' : number(latest.outdoor, 1)}<i>°C</i></b></div>
        <div className="en-card"><small>{t('curve.target')}</small><b>{latest.target == null ? '—' : number(latest.target, 1)}<i>°C</i></b></div>
        <div className="en-card"><small>{t('curve.returnNow')}</small><b>{latest.return == null ? '—' : number(latest.return, 1)}<i>°C</i></b>{deviation != null ? <em>{t('curve.deviation')}: {deviation > 0 ? '+' : ''}{number(deviation, 1)} K</em> : !compressorOn ? <em>{t('curve.compressorOff')}</em> : null}</div>
        <div className="en-card"><small>{t('curve.offset')}</small><b>{latest.offset == null ? '—' : number(latest.offset, 1)}<i>K</i></b></div>
        <div className="en-card"><small>{t('curve.limit')}</small><b>{latest.limit == null ? '—' : number(latest.limit, 1)}<i>°C</i></b></div>
      </div>
      <p className="en-note">{t('curve.hint')}</p>
    </section>

    {enough ? <section className="nx-panel">
      <div className="nx-panel-head"><h2>{t('curve.chartTitle')}</h2><span className="nx-muted">{t('curve.points', { count: data.points.length })}</span></div>
      <div className="en-chart curve-chart">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={colors.grid} strokeDasharray="3 4"/>
            <XAxis dataKey="outdoor" type="number" domain={[Math.floor(min), Math.ceil(max)]} tickLine={false} axisLine={{ stroke: colors.grid }} tick={{ fontSize: 12, fill: colors.tick }} tickFormatter={value => `${number(value, 0)}°`} label={{ value: t('curve.outdoor'), position: 'insideBottom', offset: -4, fill: colors.tick, fontSize: 11 }}/>
            <YAxis domain={[15, 45]} tickLine={false} axisLine={false} width={38} tick={{ fontSize: 12, fill: colors.tick }} tickFormatter={value => `${number(value, 0)}°`}/>
            <Tooltip formatter={(value, name) => [`${number(value, 1)} °C`, name]} labelFormatter={value => `${t('curve.outdoor')}: ${number(value, 1)} °C`}/>
            <Legend/>
            <Scatter data={(data.scatter ?? []).filter(point => limit == null || point.outdoor <= limit)} dataKey="return" name={t('curve.scatter')} fill={colors.scatter} fillOpacity={0.45} isAnimationActive={false}/>
            {curveData.length > 0 && <Line data={curveData} dataKey="target" name={t('curve.fit')} stroke={colors.curve} strokeWidth={2.5} dot={false} isAnimationActive={false}/>}
            {Math.abs(shift) > 0.001 && <Line data={previewData} dataKey="preview" name={t('curve.preview')} stroke={colors.preview} strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false}/>}
            {latest.limit != null && <ReferenceLine x={Number(latest.limit)} stroke={colors.tick} strokeDasharray="4 4" label={{ value: t('curve.limit'), fill: colors.tick, fontSize: 11 }}/>}
            {latest.outdoor != null && latest.target != null && <ReferenceDot x={Number(latest.outdoor)} y={Number(latest.target)} r={5} fill={colors.curve} stroke={dark ? '#12171a' : '#fff'} strokeWidth={2}/>}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="curve-offset">
        <span>{t('curve.offsetPreview')}: <b>{preview > 0 ? '+' : ''}{number(preview, 1)} K</b></span>
        <button type="button" className="icon-button" aria-label="-0.5" onClick={() => setPreview(value => Math.max(-5, Number(value) - 0.5))}><Minus size={15}/></button>
        <input type="range" min="-5" max="5" step="0.5" value={preview} onChange={e => setPreview(Number(e.target.value))} aria-label={t('curve.offsetPreview')}/>
        <button type="button" className="icon-button" aria-label="+0.5" onClick={() => setPreview(value => Math.min(5, Number(value) + 0.5))}><Plus size={15}/></button>
        <button type="button" className="button primary" disabled={busy || Math.abs(shift) < 0.001} onClick={saveOffset}>{t('curve.saveOffset')}</button>
      </div>
      <p className="en-note">{t('curve.note')}</p>
    </section> : <section className="nx-panel"><p className="nx-muted">{t('curve.empty')}</p></section>}
  </>;
}
