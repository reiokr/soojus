import React, { useEffect, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertCircle, Clock3, History, LoaderCircle } from 'lucide-react';
import { api, axisNumber, clipSpans, date, estKey, holdValues, mergeSeries, niceScale, number, plotKey, seriesStats, stateSpans, targetKey, time, timeTickLabel, timeTicks, wzsvWorkState } from './lib.js';
import { t } from './i18n/index.js';
import { Empty } from './ui.jsx';

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


export default HistoryChart;
