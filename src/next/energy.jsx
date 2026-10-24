import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Download } from 'lucide-react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { api, number } from '../lib.js';
import { t } from '../i18n/index.js';

const PRICE_KEY = 'soojus.energy.price';
const DEFAULT_PRICE = 0.19;

const readPrice = () => {
  try {
    const raw = localStorage.getItem(PRICE_KEY);
    if (raw == null) return DEFAULT_PRICE;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : DEFAULT_PRICE;
  } catch { return DEFAULT_PRICE; }
};

function Card({ label, value, unit, hint }) {
  return <div className="en-card"><small>{label}</small><b>{value}{unit && <i>{unit}</i>}</b>{hint && <em>{hint}</em>}</div>;
}

export default function EnergyPage({ ctx }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(true);
  const [price, setPrice] = useState(readPrice);

  useEffect(() => {
    if (!ctx.selection) return;
    let live = true;
    setBusy(true); setError(null);
    api(`/energy?device=${encodeURIComponent(ctx.selection)}&days=${days}`)
      .then(result => { if (live) setData(result); })
      .catch(e => { if (live) setError(e.message); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [ctx.selection, days]);

  const savePrice = value => {
    const next = Math.max(0, Number(value) || 0);
    setPrice(next);
    try { localStorage.setItem(PRICE_KEY, String(next)); } catch { /* privaatne režiim */ }
  };

  const dark = ctx.theme === 'dark';
  const colors = {
    heat: dark ? '#ff9b6a' : '#d9784a',
    electric: dark ? '#7fc4ff' : '#4c8fbf',
    cop: dark ? '#6fe0c8' : '#2f9e83',
    grid: dark ? '#2c3439' : '#e3e9ed',
    tick: dark ? '#a9b8c2' : '#5f7280'
  };
  const totals = data?.totals ?? {};
  const electricKnown = data?.electricKnown !== false;
  const cost = electricKnown && totals.electricKwh != null ? totals.electricKwh * price : null;
  const chartDays = useMemo(() => (data?.days ?? []).map(day => ({
    ...day,
    label: day.day.slice(5),
    electricChart: electricKnown ? day.electricKwh : null
  })), [data, electricKnown]);
  const rows = useMemo(() => [...(data?.days ?? [])].reverse(), [data]);
  const hasData = Boolean(data && (totals.heatKwh > 0 || (totals.electricKwh ?? 0) > 0));

  const exportCsv = () => {
    if (!data) return;
    const head = [t('energy.tableDay'), t('energy.tableHeat'), t('energy.tableElectric'), t('energy.tableCop'), t('energy.tableCost'), t('energy.tableHours'), t('energy.tableOutdoor')];
    const lines = rows.map(day => [
      day.day,
      number(day.heatKwh, 2),
      electricKnown ? number(day.electricKwh, 2) : '',
      electricKnown && day.cop != null ? number(day.cop, 2) : '',
      electricKnown ? number((day.electricKwh ?? 0) * price, 2) : '',
      electricKnown && day.hours != null ? number(day.hours, 1) : '',
      day.outdoor == null ? '' : number(day.outdoor, 1)
    ].join(';'));
    const blob = new Blob(['\uFEFF' + head.join(';') + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `soojus-energia-${days}p.csv`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const period = <div className="segmented en-period" role="group" aria-label={t('energy.period')}>
    {[[7, t('energy.d7')], [30, t('energy.d30')], [90, t('energy.d90')], [365, t('energy.d365')]].map(([value, label]) =>
      <button key={value} type="button" className={days === value ? 'selected' : ''} aria-pressed={days === value} onClick={() => setDays(value)}>{label}</button>)}
  </div>;

  if (error) return <section className="nx-panel"><div className="nx-panel-head"><h2>{t('energy.summary')}</h2>{period}</div><p className="nx-warn"><AlertCircle size={15}/>{t('energy.error')} {error}</p></section>;
  if (!data) return <div className="nx-skeleton" aria-label={t('energy.loading')}><i/><i/><i/></div>;

  return <>
    <section className="nx-panel">
      <div className="nx-panel-head"><h2>{t('energy.summary')}</h2>{period}</div>
      {!electricKnown && <p className="nx-warn"><AlertCircle size={15}/>{t('energy.noElectric')}</p>}
      {hasData ? <>
        <div className="en-cards">
          <Card label={t('energy.heat')} value={number(totals.heatKwh, 1)} unit={t('energy.kwh')}/>
          <Card label={t('energy.electric')} value={electricKnown ? number(totals.electricKwh, 1) : '—'} unit={electricKnown ? t('energy.kwh') : null}/>
          <Card label={t('energy.cop')} value={electricKnown && totals.cop != null ? number(totals.cop, 2) : '—'}/>
          <Card label={t('energy.cost')} value={cost != null ? number(cost, 2) : '—'} unit={cost != null ? '€' : null}/>
          <Card label={t('energy.hours')} value={electricKnown ? number(totals.hours, 1) : '—'} unit={electricKnown ? t('energy.h') : null}/>
        </div>
        <div className="en-price-row">
          <label className="en-price"><span>{t('energy.price')}</span><input type="number" min="0" step="0.01" value={price} onChange={e => savePrice(e.target.value)} aria-label={t('energy.price')}/><b>{t('energy.priceUnit')}</b></label>
          <small>{t('energy.priceHint')}</small>
          <button type="button" className="nx-edit" onClick={exportCsv}><Download size={14}/>{t('energy.export')}</button>
        </div>
      </> : <p className="nx-muted">{t('energy.empty')}</p>}
    </section>

    {hasData && <section className="nx-panel">
      <div className="nx-panel-head"><h2>{t('energy.chartTitle')}</h2><span className="nx-muted">{data.source === 'lux' ? t('energy.sourceLux') : t('energy.sourceUplink')}</span></div>
      <div className="en-chart">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartDays} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={colors.grid} strokeDasharray="3 4"/>
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: colors.grid }} tickMargin={8} tick={{ fontSize: 12, fill: colors.tick }} interval="preserveStartEnd" minTickGap={18}/>
            <YAxis yAxisId="kwh" tickLine={false} axisLine={false} width={40} tick={{ fontSize: 12, fill: colors.tick }} tickFormatter={value => number(value, 0)}/>
            {electricKnown && <YAxis yAxisId="cop" orientation="right" tickLine={false} axisLine={false} width={38} tick={{ fontSize: 12, fill: colors.tick }} domain={[0, 'auto']} tickFormatter={value => number(value, 1)}/>}
            <Tooltip formatter={(value, name) => [value == null ? '—' : `${number(value, name === t('energy.cop') ? 2 : 1)}${name === t('energy.cop') ? '' : ` ${t('energy.kwh')}`}`, name]} labelFormatter={label => label}/>
            <Legend/>
            <Bar yAxisId="kwh" dataKey="heatKwh" name={t('energy.chartHeat')} fill={colors.heat} radius={[3, 3, 0, 0]} maxBarSize={22}/>
            {electricKnown && <Bar yAxisId="kwh" dataKey="electricChart" name={t('energy.chartElectric')} fill={colors.electric} radius={[3, 3, 0, 0]} maxBarSize={22}/>}
            {electricKnown && <Line yAxisId="cop" dataKey="cop" name={t('energy.cop')} stroke={colors.cop} strokeWidth={2} dot={false} connectNulls/>}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>}

    {hasData && <section className="nx-panel">
      <div className="nx-panel-head"><h2>{t('energy.tableTitle')}</h2><span className="nx-muted">{t('energy.total')}: {number(totals.heatKwh, 1)} {t('energy.kwh')}{electricKnown ? ` · ${number(totals.electricKwh, 1)} ${t('energy.kwh')} · COP ${number(totals.cop, 2)}` : ''}</span></div>
      <div className="en-table-wrap">
        <table className="en-table">
          <thead><tr><th>{t('energy.tableDay')}</th><th>{t('energy.tableHeat')}</th><th>{t('energy.tableElectric')}</th><th>{t('energy.tableCop')}</th><th>{t('energy.tableCost')}</th><th>{t('energy.tableHours')}</th><th>{t('energy.tableOutdoor')}</th></tr></thead>
          <tbody>{rows.map(day => <tr key={day.day}>
            <td>{day.day}</td>
            <td>{number(day.heatKwh, 1)}</td>
            <td>{electricKnown ? number(day.electricKwh, 1) : '—'}</td>
            <td>{electricKnown && day.cop != null ? number(day.cop, 2) : '—'}</td>
            <td>{electricKnown ? number((day.electricKwh ?? 0) * price, 2) : '—'}</td>
            <td>{electricKnown && day.hours != null ? number(day.hours, 1) : '—'}</td>
            <td>{day.outdoor == null ? '—' : number(day.outdoor, 1)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="en-note">{t('energy.note')}</p>
    </section>}
  </>;
}
