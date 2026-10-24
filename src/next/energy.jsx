import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Download } from 'lucide-react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { api, number } from '../lib.js';
import { t } from '../i18n/index.js';
import { DEFAULT_TARIFF, parseTariff, dayCost, totalCost, monthlyCost, effectiveRates, splitElectric, nightHours } from './tariff.js';
import { spotMap, variableCost, dualCost, exchangeCost } from './prices.js';

const TARIFF_KEY = 'soojus.energy.tariff';
const LEGACY_PRICE_KEY = 'soojus.energy.price';
const METER_KEY = 'soojus.energy.meter';
const COMPARE_KEY = 'soojus.energy.compare';

const readTariff = () => {
  try {
    const raw = localStorage.getItem(TARIFF_KEY);
    if (raw) return parseTariff(JSON.parse(raw));
    const legacy = localStorage.getItem(LEGACY_PRICE_KEY);
    if (legacy != null) return parseTariff({ ...DEFAULT_TARIFF, price: Number(legacy) });
  } catch { /* privaatne režiim või vigane salvestus */ }
  return { ...DEFAULT_TARIFF };
};

const readMeter = () => {
  try { const raw = JSON.parse(localStorage.getItem(METER_KEY) || '{}'); return { total: raw.total ?? '', day: raw.day ?? '', night: raw.night ?? '', bill: raw.bill ?? '' }; }
  catch { return { total: '', day: '', night: '', bill: '' }; }
};

const readCompare = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(COMPARE_KEY) || '{}');
    return { fixed: raw.fixed ?? 0.19, day: raw.day ?? 0.22, night: raw.night ?? 0.12, margin: raw.margin ?? 0.01 };
  } catch { return { fixed: 0.19, day: 0.22, night: 0.12, margin: 0.01 }; }
};

const hourOptions = Array.from({ length: 24 }, (_, hour) => hour);
const hourLabel = hour => `${String(hour).padStart(2, '0')}:00`;

function Card({ label, value, unit, hint }) {
  return <div className="en-card"><small>{label}</small><b>{value}{unit && <i>{unit}</i>}</b>{hint && <em>{hint}</em>}</div>;
}

export default function EnergyPage({ ctx }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tariff, setTariff] = useState(readTariff);
  const [meter, setMeter] = useState(readMeter);
  const [compare, setCompare] = useState(readCompare);
  const [prices, setPrices] = useState(null);
  const [pricesBusy, setPricesBusy] = useState(true);
  const [pricesError, setPricesError] = useState(null);

  useEffect(() => {
    if (!ctx.selection) return;
    let live = true;
    setError(null);
    api(`/energy?device=${encodeURIComponent(ctx.selection)}&days=${days}`)
      .then(result => { if (live) setData(result); })
      .catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [ctx.selection, days]);

  useEffect(() => {
    let live = true, timer = null, attempts = 0;
    setPricesBusy(true); setPricesError(null);
    const load = () => api(`/prices?days=${days}`).then(result => {
      if (!live) return;
      setPrices(result);
      if (result.syncing && attempts < 5) { attempts += 1; timer = setTimeout(load, 1500); }
      else setPricesBusy(false);
    }).catch(e => { if (live) { setPricesError(e.message); setPricesBusy(false); } });
    load();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [days]);

  const updateMeter = patch => {
    const next = { ...meter, ...patch };
    setMeter(next);
    try { localStorage.setItem(METER_KEY, JSON.stringify(next)); } catch { /* privaatne režiim */ }
  };

  const updateTariff = patch => {
    const next = parseTariff({ ...tariff, ...patch });
    setTariff(next);
    try { localStorage.setItem(TARIFF_KEY, JSON.stringify(next)); } catch { /* privaatne režiim */ }
  };

  const updateCompare = patch => {
    const next = { ...compare, ...patch };
    setCompare(next);
    try { localStorage.setItem(COMPARE_KEY, JSON.stringify(next)); } catch { /* privaatne režiim */ }
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
  const dual = tariff.type === 'dual';
  const detail = tariff.type === 'detail';
  const splitMode = dual || detail;
  const rates = effectiveRates(tariff);
  const fixedCost = monthlyCost(tariff, days);
  const cost = electricKnown && data ? totalCost(data.days, tariff, days) : null;
  const meterTotal = Number(meter.total) || (Number(meter.day) || 0) + (Number(meter.night) || 0);
  const meterDay = Number(meter.day) || 0, meterNight = Number(meter.night) || 0;
  const hasMeter = meterTotal > 0;
  const billTotal = Number(meter.bill) || null;
  const wholeFixed = detail ? (tariff.monthlyNetwork + tariff.monthlySeller) * (1 + tariff.vat / 100) * days / 30.44 : 0;
  const wholeVariable = !hasMeter ? null : tariff.type === 'single' ? meterTotal * tariff.price : (meterDay + meterNight > 0 ? (detail ? meterDay * rates.day + meterNight * rates.night : meterDay * tariff.dayPrice + meterNight * tariff.nightPrice) : null);
  const wholeCost = wholeVariable == null ? null : wholeVariable + wholeFixed;
  const pumpCost = electricKnown && data ? (data.days ?? []).reduce((sum, day) => sum + (dayCost(day, tariff) ?? 0), 0) : null;
  const coverage = data?.totals?.coverage ?? null;
  const ventKwh = data?.ventilation?.kwh ?? null;
  const ventCoverage = data?.ventilation?.coverage ?? null;
  const nightHoursCount = nightHours(tariff.nightStart, tariff.nightEnd).length;
  const ventRate = (rates.day * (24 - nightHoursCount) + rates.night * nightHoursCount) / 24;
  const ventCost = ventKwh != null ? ventKwh * ventRate : null;
  const pumpEstimate = coverage != null && coverage > 0.05 && totals.electricKwh != null ? totals.electricKwh / coverage : null;
  const pumpCostEstimate = coverage != null && coverage > 0.05 && pumpCost != null ? pumpCost / coverage : null;
  const effectivePumpKwh = pumpEstimate ?? totals.electricKwh;
  const effectivePumpCost = pumpCostEstimate ?? pumpCost;
  const otherKwh = hasMeter && effectivePumpKwh != null ? Math.max(0, meterTotal - effectivePumpKwh) : null;
  const otherCost = wholeCost != null && effectivePumpCost != null ? Math.max(0, wholeCost - effectivePumpCost) : null;
  const pumpShare = hasMeter && effectivePumpKwh != null ? effectivePumpKwh / meterTotal : null;
  const estimated = coverage != null && coverage < 0.9;
  const billDiff = billTotal != null && wholeCost != null ? wholeCost - billTotal : null;
  const currentVariable = data ? variableCost(data.days, tariff) : null;
  const fixedTotal = totals.electricKwh != null ? totals.electricKwh * Number(compare.fixed) : null;
  const dualResult = data ? dualCost(data.days, Number(compare.day), Number(compare.night), tariff.nightStart, tariff.nightEnd) : null;
  const spot = useMemo(() => spotMap(prices?.prices), [prices]);
  const exchange = data && prices?.prices?.length ? exchangeCost(data.days, spot, tariff, Number(compare.margin)) : null;
  const avgPrice = value => value != null && totals.electricKwh > 0 ? value / totals.electricKwh : null;
  const diffCell = value => value == null || currentVariable == null ? '—' : <span className={value < currentVariable ? 'cheaper' : value > currentVariable ? 'dearer' : ''}>{value > currentVariable ? '+' : ''}{number(value - currentVariable, 2)} €</span>;
  const split = useMemo(() => (data?.days ?? []).reduce((sum, day) => {
    const value = splitElectric(day, tariff.nightStart, tariff.nightEnd);
    return { day: sum.day + value.dayKwh, night: sum.night + value.nightKwh };
  }, { day: 0, night: 0 }), [data, tariff.nightStart, tariff.nightEnd]);
  const chartDays = useMemo(() => (data?.days ?? []).map(day => ({
    ...day,
    label: day.day.slice(5),
    electricChart: electricKnown ? day.electricKwh : null
  })), [data, electricKnown]);
  const rows = useMemo(() => [...(data?.days ?? [])].reverse(), [data]);
  const hasData = Boolean(data && (totals.heatKwh > 0 || (totals.electricKwh ?? 0) > 0));

  const exportCsv = () => {
    if (!data) return;
    const head = [t('energy.tableDay'), t('energy.tableHeat'), ...(splitMode ? [t('energy.tableDayKwh'), t('energy.tableNightKwh')] : [t('energy.tableElectric')]), t('energy.tableCop'), t('energy.tableCost'), t('energy.tableHours'), t('energy.tableOutdoor')];
    const lines = rows.map(day => {
      const value = splitMode ? splitElectric(day, tariff.nightStart, tariff.nightEnd) : null;
      return [
        day.day,
        number(day.heatKwh, 2),
        ...(splitMode ? [number(value.dayKwh, 2), number(value.nightKwh, 2)] : [electricKnown ? number(day.electricKwh, 2) : '']),
        electricKnown && day.cop != null ? number(day.cop, 2) : '',
        electricKnown ? number(dayCost(day, tariff), 2) : '',
        electricKnown && day.hours != null ? number(day.hours, 1) : '',
        day.outdoor == null ? '' : number(day.outdoor, 1)
      ].join(';');
    });
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

  const tariffFields = <div className="en-tariff">
    <div className="segmented en-tariff-type" role="group" aria-label={t('energy.tariff')}>
      <button type="button" className={tariff.type === 'single' ? 'selected' : ''} aria-pressed={tariff.type === 'single'} onClick={() => updateTariff({ type: 'single' })}>{t('energy.single')}</button>
      <button type="button" className={dual ? 'selected' : ''} aria-pressed={dual} onClick={() => updateTariff({ type: 'dual' })}>{t('energy.dual')}</button>
      <button type="button" className={detail ? 'selected' : ''} aria-pressed={detail} onClick={() => updateTariff({ type: 'detail' })}>{t('energy.detail')}</button>
    </div>
    {tariff.type === 'single' && <label className="en-price"><span>{t('energy.price')}</span><input type="number" min="0" step="0.01" value={tariff.price} onChange={e => updateTariff({ price: e.target.value })} aria-label={t('energy.price')}/><b>{t('energy.priceUnit')}</b></label>}
    {dual && <>
      <label className="en-price"><span>{t('energy.dayPrice')}</span><input type="number" min="0" step="0.01" value={tariff.dayPrice} onChange={e => updateTariff({ dayPrice: e.target.value })} aria-label={t('energy.dayPrice')}/><b>{t('energy.priceUnit')}</b></label>
      <label className="en-price"><span>{t('energy.nightPrice')}</span><input type="number" min="0" step="0.01" value={tariff.nightPrice} onChange={e => updateTariff({ nightPrice: e.target.value })} aria-label={t('energy.nightPrice')}/><b>{t('energy.priceUnit')}</b></label>
      <label className="en-price"><span>{t('energy.nightStart')}</span><select value={tariff.nightStart} onChange={e => updateTariff({ nightStart: Number(e.target.value) })} aria-label={t('energy.nightStart')}>{hourOptions.map(hour => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}</select></label>
      <label className="en-price"><span>{t('energy.nightEnd')}</span><select value={tariff.nightEnd} onChange={e => updateTariff({ nightEnd: Number(e.target.value) })} aria-label={t('energy.nightEnd')}>{hourOptions.map(hour => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}</select></label>
    </>}
    {detail && <>
      <div className="en-detail-grid">
        {[
          ['energyPrice', 'energy.energyPrice', tariff.energyPrice, '0.00001'],
          ['networkDay', 'energy.networkDay', tariff.networkDay, '0.00001'],
          ['networkNight', 'energy.networkNight', tariff.networkNight, '0.00001'],
          ['security', 'energy.security', tariff.security, '0.00001'],
          ['excise', 'energy.excise', tariff.excise, '0.00001'],
          ['renewable', 'energy.renewable', tariff.renewable, '0.00001'],
          ['vat', 'energy.vat', tariff.vat, '1'],
          ['monthlyNetwork', 'energy.monthlyNetwork', tariff.monthlyNetwork, '0.01'],
          ['monthlySeller', 'energy.monthlySeller', tariff.monthlySeller, '0.01']
        ].map(([field, key, value, step]) => <label className="en-price" key={field}><span>{t(key)}</span><input type="number" min="0" max={field === 'vat' ? 100 : undefined} step={step} value={value} onChange={e => updateTariff({ [field]: e.target.value })} aria-label={t(key)}/></label>)}
        <label className="en-price"><span>{t('energy.nightStart')}</span><select value={tariff.nightStart} onChange={e => updateTariff({ nightStart: Number(e.target.value) })} aria-label={t('energy.nightStart')}>{hourOptions.map(hour => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}</select></label>
        <label className="en-price"><span>{t('energy.nightEnd')}</span><select value={tariff.nightEnd} onChange={e => updateTariff({ nightEnd: Number(e.target.value) })} aria-label={t('energy.nightEnd')}>{hourOptions.map(hour => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}</select></label>
      </div>
      <label className="en-check"><input type="checkbox" checked={tariff.includeMonthly} onChange={e => updateTariff({ includeMonthly: e.target.checked })}/>{t('energy.includeMonthly')}</label>
      <small className="en-monthly-hint">{t('energy.monthlyHint')}</small>
    </>}
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
          <Card label={t('energy.electric')} value={electricKnown ? number(totals.electricKwh, 1) : '—'} unit={electricKnown ? t('energy.kwh') : null} hint={splitMode && electricKnown ? t('energy.split', { day: number(split.day, 1), night: number(split.night, 1) }) : null}/>
          <Card label={t('energy.cop')} value={electricKnown && totals.cop != null ? number(totals.cop, 2) : '—'}/>
          <Card label={t('energy.cost')} value={cost != null ? number(cost, 2) : '—'} unit={cost != null ? '€' : null} hint={detail && electricKnown && fixedCost > 0 ? t('energy.includesFixed', { value: number(fixedCost, 2) }) : null}/>
          <Card label={t('energy.hours')} value={electricKnown ? number(totals.hours, 1) : '—'} unit={electricKnown ? t('energy.h') : null}/>
          {ventKwh != null && <Card label={t('energy.ventilation')} value={number(ventKwh, 1)} unit={t('energy.kwh')} hint={`${ventCost != null ? `${number(ventCost, 2)} €` : ''}${ventCoverage != null && ventCoverage < 0.9 ? ` · ${t('energy.ventCoverage', { percent: Math.round(ventCoverage * 100) })}` : ''}`}/>}
        </div>
        {coverage != null && <p className="en-coverage">{t('energy.coverage', { percent: Math.round(coverage * 100) })}{coverage < 0.9 ? ` · ${t('energy.coverageWarn')}` : ''}</p>}
        {tariffFields}
        <div className="en-tariff-foot">
          <small>{detail ? `${t('energy.detailHint')} ${t('energy.effective', { day: number(rates.day, 4), night: number(rates.night, 4) })}${rates.fixedMonthly > 0 ? ` · ${t('energy.fixed', { value: number(rates.fixedMonthly, 2) })}` : ''}` : `${t('energy.priceHint')}${tariff.type !== 'single' ? ` ${t('energy.nightHint', { start: hourLabel(tariff.nightStart), end: hourLabel(tariff.nightEnd) })}` : ''}`}</small>
          <button type="button" className="nx-edit" onClick={exportCsv}><Download size={14}/>{t('energy.export')}</button>
        </div>
      </> : <p className="nx-muted">{t('energy.empty')}</p>}
    </section>

    {hasData && <section className="nx-panel">
      <div className="nx-panel-head"><h2>{t('meter.title')}</h2><span className="nx-muted">{t('meter.hint')}</span></div>
      <div className="en-meter-inputs">
        <label className="en-price"><span>{t('meter.total')}</span><input type="number" min="0" step="0.1" value={meter.total} onChange={e => updateMeter({ total: e.target.value })} aria-label={t('meter.total')}/></label>
        <label className="en-price"><span>{t('meter.day')}</span><input type="number" min="0" step="0.1" value={meter.day} onChange={e => updateMeter({ day: e.target.value })} aria-label={t('meter.day')}/></label>
        <label className="en-price"><span>{t('meter.night')}</span><input type="number" min="0" step="0.1" value={meter.night} onChange={e => updateMeter({ night: e.target.value })} aria-label={t('meter.night')}/></label>
        <label className="en-price"><span>{t('meter.bill')}</span><input type="number" min="0" step="0.01" value={meter.bill} onChange={e => updateMeter({ bill: e.target.value })} aria-label={t('meter.bill')}/></label>
      </div>
      {!hasMeter ? <p className="nx-muted">{t('meter.empty')}</p> : <>
        {wholeVariable == null && tariff.type !== 'single' && <p className="nx-warn"><AlertCircle size={15}/>{t('meter.needSplit')}</p>}
        <dl className="en-meter-list">
          <div><dt>{t('meter.whole')}</dt><dd>{number(meterTotal, 1)} kWh{wholeCost != null ? ` · ${number(wholeCost, 2)} €` : ''}</dd></div>
          <div><dt>{t('meter.pump')}</dt><dd>{totals.electricKwh != null ? `${number(totals.electricKwh, 1)} kWh` : '—'}{pumpCost != null ? ` · ${number(pumpCost, 2)} €` : ''}</dd></div>
          <div><dt>{estimated ? t('meter.otherEstimated') : t('meter.other')}</dt><dd>{otherKwh != null ? `${number(otherKwh, 1)} kWh` : '—'}{otherCost != null ? ` · ${number(otherCost, 2)} €` : ''}</dd></div>
          {pumpShare != null && <div><dt>{estimated ? t('meter.shareEstimated') : t('meter.share')}</dt><dd>{number(pumpShare * 100, 0)}%</dd></div>}
        </dl>
        {estimated && pumpEstimate != null && <p className="en-meter-bill">{t('meter.estimate', { kwh: number(pumpEstimate, 1), cost: number(pumpCostEstimate ?? 0, 2) })}</p>}
        {wholeFixed > 0 && <p className="en-meter-bill">{t('energy.includesFixed', { value: number(wholeFixed, 2) })}</p>}
        {billDiff != null && <p className="en-meter-bill">{t('meter.billLine', { bill: number(billTotal, 2), computed: number(wholeCost, 2), diff: `${billDiff > 0 ? '+' : ''}${number(billDiff, 2)}` })}</p>}
      </>}
    </section>}

    {hasData && <section className="nx-panel">
      <div className="nx-panel-head"><h2>{t('compare.title')}</h2><span className="nx-muted">{t('compare.subtitle')}</span></div>
      <div className="en-compare-inputs">
        <label className="en-price"><span>{t('compare.fixedPrice')}</span><input type="number" min="0" step="0.01" value={compare.fixed} onChange={e => updateCompare({ fixed: e.target.value })} aria-label={t('compare.fixedPrice')}/></label>
        <label className="en-price"><span>{t('compare.dayPrice')}</span><input type="number" min="0" step="0.01" value={compare.day} onChange={e => updateCompare({ day: e.target.value })} aria-label={t('compare.dayPrice')}/></label>
        <label className="en-price"><span>{t('compare.nightPrice')}</span><input type="number" min="0" step="0.01" value={compare.night} onChange={e => updateCompare({ night: e.target.value })} aria-label={t('compare.nightPrice')}/></label>
        <label className="en-price"><span>{t('compare.margin')}</span><input type="number" min="0" step="0.001" value={compare.margin} onChange={e => updateCompare({ margin: e.target.value })} aria-label={t('compare.margin')}/></label>
      </div>
      {pricesError && <p className="nx-warn"><AlertCircle size={15}/>{t('compare.noPrices')}</p>}
      <div className="en-table-wrap">
        <table className="en-table en-compare">
          <thead><tr><th>{t('compare.package')}</th><th>{t('compare.cost')}</th><th>{t('compare.average')}</th><th>{t('compare.difference')}</th></tr></thead>
          <tbody>
            <tr className="current"><td>{t('compare.current')}</td><td>{currentVariable != null ? `${number(currentVariable, 2)} €` : '—'}</td><td>{avgPrice(currentVariable) != null ? `${number(avgPrice(currentVariable), 3)} €/kWh` : '—'}</td><td>—</td></tr>
            <tr><td>{t('compare.fixed')}</td><td>{fixedTotal != null ? `${number(fixedTotal, 2)} €` : '—'}</td><td>{avgPrice(fixedTotal) != null ? `${number(avgPrice(fixedTotal), 3)} €/kWh` : '—'}</td><td>{diffCell(fixedTotal)}</td></tr>
            <tr><td>{t('compare.dual')}</td><td>{dualResult != null ? `${number(dualResult.cost, 2)} €` : '—'}</td><td>{avgPrice(dualResult?.cost) != null ? `${number(avgPrice(dualResult.cost), 3)} €/kWh` : '—'}</td><td>{diffCell(dualResult?.cost)}</td></tr>
            <tr><td>{t('compare.exchange')}{exchange && exchange.coverage < 0.95 ? <small>{t('compare.coverage', { percent: Math.round(exchange.coverage * 100) })}</small> : null}</td><td>{pricesBusy ? '…' : exchange ? `${number(exchange.cost, 2)} €` : '—'}</td><td>{exchange?.average != null ? `${number(exchange.average, 3)} €/kWh` : '—'}</td><td>{exchange ? diffCell(exchange.cost) : '—'}</td></tr>
          </tbody>
        </table>
      </div>
      <p className="en-note">{t('compare.note')}</p>
    </section>}

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
      <div className="nx-panel-head"><h2>{t('energy.tableTitle')}</h2><span className="nx-muted">{t('energy.total')}: {number(totals.heatKwh, 1)} {t('energy.kwh')}{electricKnown ? ` · ${number(totals.electricKwh, 1)} ${t('energy.kwh')} · COP ${number(totals.cop, 2)}${cost != null ? ` · ${number(cost, 2)} €` : ''}` : ''}</span></div>
      <div className="en-table-wrap">
        <table className="en-table">
          <thead><tr><th>{t('energy.tableDay')}</th><th>{t('energy.tableHeat')}</th>{splitMode ? <><th>{t('energy.tableDayKwh')}</th><th>{t('energy.tableNightKwh')}</th></> : <th>{t('energy.tableElectric')}</th>}<th>{t('energy.tableCop')}</th><th>{t('energy.tableCost')}</th><th>{t('energy.tableHours')}</th><th>{t('energy.tableOutdoor')}</th></tr></thead>
          <tbody>{rows.map(day => {
            const splitDay = splitMode ? splitElectric(day, tariff.nightStart, tariff.nightEnd) : null;
            return <tr key={day.day}>
              <td>{day.day}</td>
              <td>{number(day.heatKwh, 1)}</td>
              {splitMode ? <><td>{number(splitDay.dayKwh, 1)}</td><td>{number(splitDay.nightKwh, 1)}</td></> : <td>{electricKnown ? number(day.electricKwh, 1) : '—'}</td>}
              <td>{electricKnown && day.cop != null ? number(day.cop, 2) : '—'}</td>
              <td>{electricKnown ? number(dayCost(day, tariff), 2) : '—'}</td>
              <td>{electricKnown && day.hours != null ? number(day.hours, 1) : '—'}</td>
              <td>{day.outdoor == null ? '—' : number(day.outdoor, 1)}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <p className="en-note">{t('energy.note')}{detail ? ` ${t('energy.detailNote')}` : ''} {t('energy.ventNote')}</p>
    </section>}
  </>;
}
