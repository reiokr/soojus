import React, { useCallback, useEffect, useId, useState } from 'react';
import { AlertCircle, ChevronDown, Fan, Flame, Gauge, Info, Link2, LoaderCircle, RefreshCw, Trash2, Wind } from 'lucide-react';
import { api, number, time } from './lib.js';
import { bypassOpen, climate, climatePoints, climateQuery, co2Quality, daysWithMonths, filterInfo, MODE_INFO, readingQuality, ventilationSentence, ventModeText } from './ventilation-logic.js';
import { t } from './i18n/index.js';
import { pointNameText } from './lib.js';

export function useAirobot(tick, enabled = true) {
  const [view, setView] = useState(null), [error, setError] = useState(null);
  const load = useCallback(async () => { if (!enabled) return; try { setView(await api('/airobot')); setError(null); } catch (e) { setError(e.message); } }, [enabled]);
  useEffect(() => { load(); }, [load, tick]);
  useEffect(() => { if (!enabled) return; const timer = setInterval(load, 30000); return () => clearInterval(timer); }, [load, enabled]);
  return { view, error, reload: load, setView };
}

function Tile({ label, value, unit, note, quality, info }) {
  const tipId = useId();
  return <div className={`vent-tile ${quality?.key || ''}`}>
    <div className="vent-tile-head">
      <small>{label}</small>
      {info && <button type="button" className="vent-info" aria-label={t('vent.explain', { label })} aria-describedby={tipId}><Info size={13}/></button>}
    </div>
    <b>{value}{unit && <i>{unit}</i>}</b>
    {quality && <span className="vent-tile-state">{quality.label}</span>}
    {note && <em>{note}</em>}
    {info && <span id={tipId} className="vent-tip" role="tooltip">{info}</span>}
  </div>;
}

function Setup({ onDone, notify, current }) {
  const [host, setHost] = useState(current || ''), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  async function save(e) {
    e.preventDefault(); setBusy(true); setError(null);
    try { const view = await api('/airobot', { method: 'POST', body: JSON.stringify({ host }) }); notify?.(t('vent.connected')); onDone(view); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <section className="panel vent-setup">
    <div className="vent-setup-head"><span className="vent-icon"><Fan size={26}/></span><div><h3>{t('vent.setupTitle')}</h3><p>{t('vent.setupLead')}</p></div></div>
    <ol className="vent-steps">
      <li>{t('vent.setupStep1a')} <b>Menu → Settings → Other → Modbus TCP</b> {t('vent.setupStep1b')} <b>ON</b>{t('vent.setupStep1c')}</li>
      <li>{t('vent.setupStep2a')} <code>Airobot-Ventilation</code>{t('vent.setupStep2b')}</li>
      <li>{t('vent.setupStep3')}</li>
    </ol>
    <form onSubmit={save} className="vent-form">
      <label className="field"><span>{t('vent.deviceIp')}</span><input value={host} onChange={e => setHost(e.target.value)} placeholder="192.168.100.2" inputMode="decimal" autoComplete="off" required/></label>
      <button type="submit" className="button primary" disabled={busy || !host}>{busy ? <LoaderCircle size={16} className="spin"/> : <Link2 size={16}/>}{t('vent.connectTest')}</button>
    </form>
    {error && <p className="inline-error" role="alert">{error}</p>}
  </section>;
}

const MODE_ICONS = { auto: Gauge, manual: Fan, boost: Wind, overpressure: Flame };

function Control({ view, notify, onView }) {
  const d = view.data, s = d.settings;
  const clampFan = v => Math.min(10, Math.max(1, Number(v) || 1));
  const [pick, setPick] = useState(view.mode), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const [co2, setCo2] = useState(s.co2Setpoint), [fan, setFan] = useState(clampFan(s.manualFanLevel)), [minutes, setMinutes] = useState(Math.min(60, Math.max(3, Math.round(s.boostTimeout / 60)) || 20));
  useEffect(() => { if (!dirty) { setPick(view.mode); setCo2(s.co2Setpoint); setFan(clampFan(s.manualFanLevel)); } }, [view.mode, s.co2Setpoint, s.manualFanLevel, dirty]);
  const touch = fn => v => { setDirty(true); fn(v); };
  const body = pick === 'auto' ? { mode: pick, co2Setpoint: Number(co2) } : pick === 'manual' ? { mode: pick, fanLevel: Number(fan) } : { mode: pick, minutes: Number(minutes) };
  async function apply(e) {
    e.preventDefault(); setBusy(true); setError(null);
    try { const next = await api('/airobot/control', { method: 'POST', body: JSON.stringify(body) }); onView(next); setDirty(false); notify?.(t('vent.modeSet', { mode: t(MODE_INFO[pick].label) })); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  const changed = pick !== view.mode || (pick === 'auto' && Number(co2) !== s.co2Setpoint) || (pick === 'manual' && Number(fan) !== clampFan(s.manualFanLevel)) || pick === 'boost' || pick === 'overpressure';
  return <section className="panel vent-control" aria-labelledby="vent-control-title">
    <div className="vent-now">
      <div><small>{t('vent.now')}</small><h3 id="vent-control-title">{ventModeText(view.modeText)}</h3></div>
      <div className="vent-speed" aria-label={t('vent.speedAria', { level: d.fans.supplyLevel })}><b>{d.fans.supplyLevel}</b><span>/ 10</span><small>{t('vent.speed')}</small></div>
    </div>
    <form onSubmit={apply}>
      <div className="vent-modes" role="radiogroup" aria-label={t('vent.modeAria')}>
        {Object.entries(MODE_INFO).map(([key, info]) => { const Icon = MODE_ICONS[key]; return <button key={key} type="button" role="radio" aria-checked={pick === key} className={`${pick === key ? 'selected' : ''} ${view.mode === key ? 'current' : ''}`} onClick={() => touch(setPick)(key)}><Icon size={22}/><b>{t(info.label)}</b><small>{t(info.hint)}</small>{view.mode === key && <em>{t('vent.current')}</em>}</button>; })}
      </div>
      <div className="vent-param">
        {pick === 'auto' && <label className="vent-range"><span>{t('vent.co2Threshold')} <b>{co2} ppm</b></span><input type="range" min="450" max="2000" step="50" value={co2} onChange={e => touch(setCo2)(e.target.value)} aria-label={t('vent.co2ThresholdAria')}/><small>{t('vent.co2Now', { co2: d.co2 })}</small></label>}
        {pick === 'manual' && <div className="vent-range"><span>{t('vent.fanSpeed')} <b>{fan}</b> / 10</span><div className="vent-levels" role="radiogroup" aria-label={t('vent.fanSpeedAria')}>{Array.from({ length: 10 }, (_, i) => i + 1).map(n => <button key={n} type="button" role="radio" aria-checked={Number(fan) === n} className={Number(fan) === n ? 'selected' : ''} onClick={() => touch(setFan)(n)}>{n}</button>)}</div></div>}
        {(pick === 'boost' || pick === 'overpressure') && <div className="vent-range"><span>{pick === 'boost' ? t('vent.boostDuration') : t('vent.overpressureDuration')} <b>{minutes} min</b></span><div className="vent-levels minutes" role="group" aria-label={t('vent.durationAria')}>{[5, 10, 15, 20, 30, 45, 60].map(n => <button key={n} type="button" className={Number(minutes) === n ? 'selected' : ''} onClick={() => touch(setMinutes)(n)}>{n}</button>)}</div><label className="vent-number">{t('vent.orEnterMinutes')} <input type="number" min="3" max="60" step="1" value={minutes} onChange={e => touch(setMinutes)(e.target.value)}/></label></div>}
      </div>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="vent-apply"><button type="submit" className="button primary" disabled={busy || !changed}>{busy ? <LoaderCircle size={16} className="spin"/> : null}{t('vent.apply')}</button>{dirty && <button type="button" className="text-button" onClick={() => setDirty(false)}>{t('vent.cancelEdit')}</button>}</div>
    </form>
  </section>;
}

function Switch({ on, onChange, disabled, label }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`vent-switch ${on ? 'on' : ''}`} disabled={disabled} onClick={() => onChange(!on)}><i/></button>;
}

function NumberSetting({ value, min, max, step = 1, unit, onSave, disabled, label, after }) {
  const [draft, setDraft] = useState(String(value ?? ''));
  useEffect(() => { setDraft(String(value ?? '')); }, [value]);
  const changed = draft !== '' && Number(draft) !== Number(value);
  return <form className="vent-numset" onSubmit={e => { e.preventDefault(); if (changed) onSave(Number(draft)); }}>
    <input type="number" inputMode="decimal" min={min} max={max} step={step} value={draft} onChange={e => setDraft(e.target.value)} aria-label={label}/>
    {unit && <span>{unit}</span>}
    {after && draft !== '' && Number.isFinite(Number(draft)) && <span className="vent-after">{after(Number(draft))}</span>}
    {changed && <button type="submit" className="button" disabled={disabled}>{t('vent.save')}</button>}
  </form>;
}

function Row({ title, hint, children }) {
  return <div className="vent-row"><div><b>{title}</b>{hint && <small>{hint}</small>}</div><div className="vent-row-control">{children}</div></div>;
}

function Settings({ view, notify, onView }) {
  const d = view.data, sw = d.switches, s = d.settings;
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), [open, setOpen] = useState(false);
  async function save(body, text) {
    setBusy(true); setError(null);
    try { onView(await api('/airobot/settings', { method: 'POST', body: JSON.stringify(body) })); notify?.(text); } catch (e) { setError(e.message); notify?.(e.message, true); } finally { setBusy(false); }
  }
  const filter = filterInfo(s.filterElapsed, s.filterInterval);
  return <section className={`panel vent-settings ${open ? 'open' : ''}`}>
    <button type="button" className="vent-settings-toggle" aria-expanded={open} aria-controls="vent-settings-body" onClick={() => setOpen(!open)}>
      <span><b>{t('vent.settings')}</b><small>{open ? t('vent.settingsOpenHint') : t('vent.settingsClosedHint')}</small></span>
      <ChevronDown size={20}/>
    </button>
    {open && <div id="vent-settings-body" className="vent-settings-body">
    <Row title={t('vent.bypassTitle')} hint={t('vent.bypassHint')}><span className="vent-state">{sw.bypass ? t('enum.auto') : t('enum.off')}</span><Switch on={sw.bypass} disabled={busy} label={t('vent.bypassTitle')} onChange={on => save({ bypass: on }, t('vent.bypassSaved', { state: on ? t('vent.autoOn') : t('vent.off') }))}/></Row>
    <Row title={t('vent.powerTitle')} hint={t('vent.powerHint')}><span className="vent-state">{sw.power ? t('enum.on') : t('enum.off')}</span><Switch on={sw.power} disabled={busy} label={t('vent.powerTitle')} onChange={on => { if (!on && !window.confirm(t('vent.powerOffConfirm'))) return; save({ power: on }, t('vent.powerSaved', { state: on ? t('vent.on') : t('vent.off') })); }}/></Row>
    {sw.humidityControl != null && <Row title={t('vent.humidityTitle')} hint={t('vent.humidityHint')}><Switch on={sw.humidityControl} disabled={busy} label={t('vent.humidityAria')} onChange={on => save({ humidityControl: on }, t('vent.humiditySaved', { state: on ? t('vent.on') : t('vent.off') }))}/><NumberSetting label={t('vent.humiditySetpoint')} value={s.humiditySetpoint} min={5} max={95} step={1} unit="%" disabled={busy} onSave={n => save({ humiditySetpoint: n }, t('vent.humiditySetpointSaved', { value: n }))}/></Row>}
    {sw.vocControl != null && <Row title={t('vent.vocTitle')} hint={t('vent.vocHint')}><Switch on={sw.vocControl} disabled={busy} label={t('vent.vocAria')} onChange={on => save({ vocControl: on }, t('vent.vocSaved', { state: on ? t('vent.on') : t('vent.off') }))}/>{s.vocSetpoint != null && <NumberSetting label={t('vent.vocSetpoint')} value={s.vocSetpoint} min={0} max={500} unit={t('vent.index')} disabled={busy} onSave={n => save({ vocSetpoint: n }, t('vent.vocSetpointSaved', { value: n }))}/>}</Row>}
    {sw.pmControl != null && <Row title={t('vent.pmTitle')} hint={t('vent.pmHint')}><Switch on={sw.pmControl} disabled={busy} label={t('vent.pmAria')} onChange={on => save({ pmControl: on }, t('vent.pmSaved', { state: on ? t('vent.on') : t('vent.off') }))}/>{s.pmSetpoint != null && <NumberSetting label={t('vent.pmSetpoint')} value={s.pmSetpoint} min={0} max={999} unit="µg/m³" disabled={busy} onSave={n => save({ pmSetpoint: n }, t('vent.pmSetpointSaved', { value: n }))}/>}</Row>}
    <Row title={t('vent.overpressureSpeedTitle')} hint={t('vent.overpressureSpeedHint')}><div className="vent-levels compact" role="radiogroup" aria-label={t('vent.overpressureSpeedAria')}>{Array.from({ length: 10 }, (_, i) => i + 1).map(n => <button key={n} type="button" role="radio" aria-checked={s.overpressureFanLevel === n} className={s.overpressureFanLevel === n ? 'selected' : ''} disabled={busy} onClick={() => s.overpressureFanLevel !== n && save({ overpressureFanLevel: n }, t('vent.overpressureSpeedSaved', { value: n }))}>{n}</button>)}</div></Row>
    <Row title={t('vent.filterIntervalTitle')} hint={filter ? t('vent.filterUsed', { used: daysWithMonths(s.filterElapsed), percent: filter.percent, left: daysWithMonths(filter.leftHours) }) : undefined}><NumberSetting label={t('vent.filterIntervalAria')} value={Math.round(s.filterInterval / 24)} min={30} max={365} step={1} unit={t('common.days')} after={n => `(${daysWithMonths(n * 24).replace(/^.*\(/, '').replace(/\)$/, '')})`} disabled={busy} onSave={n => save({ filterInterval: n * 24 }, t('vent.filterIntervalSaved', { value: daysWithMonths(n * 24) }))}/><button type="button" className="button" disabled={busy} onClick={() => { if (window.confirm(t('vent.filterResetConfirm'))) save({ resetFilter: true }, t('vent.filterResetDone')); }}>{t('vent.filterChanged')}</button></Row>
    {error && <p className="inline-error" role="alert">{error}</p>}
    </div>}
  </section>;
}

export function VentilationPage({ tick, theme, HistoryChart, notify, airobot, outdoor, pumpDeviceId, outdoorPointId }) {
  const own = useAirobot(tick, !airobot), source = airobot || own;
  const { view, error, reload, setView } = source;
  const [tab, setTab] = useState('climate'), [hours, setHours] = useState(24), [changing, setChanging] = useState(false);
  if (!view) return <div className="panel vent-loading">{error ? <><AlertCircle size={18}/> {error}</> : <><LoaderCircle size={18} className="spin"/> {t('vent.loading')}</>}</div>;
  if (!view.configured || changing) return <Setup current={view.host} notify={notify} onDone={v => { setView(v); setChanging(false); }}/>;
  const d = view.data, byId = Object.fromEntries(view.points.map(p => [p.parameterId, p]));
  const hasClimate = Boolean(pumpDeviceId && outdoorPointId), tabs = [...(hasClimate ? [['climate', t('vent.tabClimate'), null]] : []), ['co2', t('vent.tabCo2'), ['co2']], ['temp', t('vent.tabTemps'), ['supply_temp', 'extract_temp']], ['hum', t('vent.tabHum'), ['supply_hum', 'extract_hum']], ['flow', t('vent.tabFlow'), ['supply_flow', 'extract_flow']], ['rpm', t('vent.tabFans'), ['supply_rpm', 'extract_rpm']]];
  const current = tabs.find(x => x[0] === tab) || tabs[0], pts = current[0] === 'climate' ? climatePoints() : current[2].map(id => byId[id]).filter(Boolean).map(p => ({ ...p, label: pointNameText(p.label) }));
  const air = d ? co2Quality(d.co2) : null, filter = d ? filterInfo(d.settings.filterElapsed, d.settings.filterInterval) : null;
  const bypass = d ? bypassOpen(d) : null;
  const clim = climate(outdoor, view), fmt = v => v == null ? '—' : number(v, 1);
  // Kaartide värv: kui palju on näit normist kõrgem (roheline → kollane → punane).
  const q = d ? {
    temp: readingQuality('temp', clim.indoor),
    hum: readingQuality('hum', d.humidity?.extract),
    co2: readingQuality('co2', d.co2),
    voc: readingQuality('voc', d.voc, d.settings.vocSetpoint),
    pm: readingQuality('pm25', d.pm25),
    filter: d.switches.filterAlert ? { key: 'bad', label: t('vent.replaceFilter') } : filter && filter.percent > 85 ? { key: 'high', label: t('vent.wornFilter') } : null
  } : {};
  return <div className="vent">
    {!d ? <section className="panel vent-error" role="alert"><AlertCircle size={20}/><div><b>{t('vent.offlineTitle')}</b><p>{view.error || t('vent.waiting')} {t('vent.offlineHint', { host: view.host })}</p></div><button className="button" type="button" onClick={reload}><RefreshCw size={15}/>{t('vent.retry')}</button></section> : <>
      <Control view={view} notify={notify} onView={setView}/>
      <section className="panel vent-summary">
        <span className={`vent-icon ${d.fans.supplyRpm > 0 ? 'on' : ''}`}><Wind size={28}/></span>
        <div><h3>{ventilationSentence(view)}</h3><p>{t('vent.lastReading', { time: time(view.time), host: view.host })}</p></div>
        <div className="vent-flags">
          <span className={`vent-chip ${air.key}`}>{t('vent.airChip', { air: air.label })}</span>
          {d.switches.bypass && <span className="vent-chip ok">{t('vent.bypassChip')}{bypass == null ? '' : bypass ? t('vent.bypassOpen') : t('vent.bypassClosed')}</span>}
          {d.switches.filterAlert && <span className="vent-chip bad">{t('vent.filterNeedsChange')}</span>}
          {view.errors.map(e => <span key={e} className="vent-chip bad">{t('vent.errorChip', { error: e })}</span>)}
        </div>
      </section>
      <div className="vent-grid">
        <Tile label={t('vent.tileIndoor')} info={t('vent.tileIndoorInfo')} value={fmt(clim.indoor)} unit="°C" note={t('vent.tileIndoorNote')} quality={q.temp}/>
        <Tile label={t('vent.tileOutdoor')} info={t('vent.tileOutdoorInfo')} value={fmt(clim.outdoor)} unit="°C" note={clim.outdoorSource === 'soojuspump' ? t('vent.sensorPump') : t('vent.sensorVent')}/>
        <Tile label={t('vent.tileCo2')} info={t('vent.tileCo2Info')} value={d.co2} unit="ppm" note={t('vent.threshold', { value: d.settings.co2Setpoint })} quality={q.co2}/>
        <Tile label={t('vent.tileSupplyTemp')} info={t('vent.tileSupplyTempInfo')} value={fmt(d.temperatures.supply)} unit="°C" note={t('vent.intoRoom')}/>
        <Tile label={t('vent.tileHum')} info={t('vent.tileHumInfo')} value={fmt(d.humidity.extract)} unit="%" note={t('vent.setpoint', { value: number(d.settings.humiditySetpoint, 0) })} quality={q.hum}/>
        <Tile label={t('vent.tileRecovery')} info={t('vent.tileRecoveryInfo')} value={number(d.heatRecovery, 0)} unit="%"/>
        <Tile label={t('vent.tileBypass')} info={t('vent.tileBypassInfo')} value={!d.switches.bypass ? t('vent.bypassOff') : bypass == null ? t('vent.bypassAuto') : bypass ? t('vent.bypassOpenState') : t('vent.bypassClosedState')} note={d.switches.bypass ? t('vent.bypassAutoMode') : undefined}/>
        <Tile label={t('vent.tileSupplyFlow')} info={t('vent.tileSupplyFlowInfo')} value={number(d.airflow.supply, 0)} unit="m³/h" note={t('vent.estimated', { rpm: number(d.fans.supplyRpm, 0) })}/>
        <Tile label={t('vent.tileExtractFlow')} info={t('vent.tileExtractFlowInfo')} value={number(d.airflow.extract, 0)} unit="m³/h" note={t('vent.estimated', { rpm: number(d.fans.extractRpm, 0) })}/>
        <Tile label={t('vent.tileVoc')} info={t('vent.tileVocInfo')} value={number(d.voc, 0)} note={d.settings.vocSetpoint != null ? t('vent.vocSetpointNote', { value: d.settings.vocSetpoint }) : undefined} quality={q.voc}/>
        <Tile label={t('vent.tilePm')} info={t('vent.tilePmInfo')} value={number(d.pm25, 0)} unit="µg/m³" note={t('vent.pmNorm')} quality={q.pm}/>
        {filter && <Tile label={t('vent.tileFilter')} info={t('vent.tileFilterInfo')} value={`${filter.percent}`} unit={t('vent.usedPercent')} note={t('vent.left', { value: daysWithMonths(filter.leftHours) })} quality={q.filter}/>}
        <Tile label={t('vent.tileUptime')} info={t('vent.tileUptimeInfo')} value={d.uptimeHours < 48 ? number(d.uptimeHours * 60, 0) : number(d.uptimeHours / 24, 1)} unit={d.uptimeHours < 48 ? 'min' : t('common.days')} note={t('vent.sinceRestart')}/>
      </div>
      <p className="vent-legend"><i className="good"/>{t('vent.legendGood')}<i className="high"/>{t('vent.legendHigh')}<i className="bad"/>{t('vent.legendBad')}</p>
      {filter && <div className="vent-filter" role="img" aria-label={t('vent.filterAria', { percent: filter.percent })}><i style={{ width: `${filter.percent}%` }}/></div>}
      <section className="panel vent-trend">
        <div className="vent-trend-head"><h3>{t('overview.trend')}</h3>
          <div className="vent-controls">
            <div className="segmented" role="group" aria-label={t('vent.indicator')}>{tabs.map(([id, label]) => <button key={id} type="button" className={current[0] === id ? 'selected' : ''} aria-pressed={current[0] === id} onClick={() => setTab(id)}>{label}</button>)}</div>
            <div className="segmented" role="group" aria-label={t('vent.period')}>{[[24, t('overview.periodDay')], [168, t('overview.periodWeek')], [720, t('overview.periodMonth')]].map(([v, l]) => <button key={v} type="button" className={hours === v ? 'selected' : ''} aria-pressed={hours === v} onClick={() => setHours(v)}>{l}</button>)}</div>
          </div>
        </div>
        {pts.length > 0 && <HistoryChart key={current[0]} name={`vent-${current[0]}`} deviceId={current[0] === 'climate' ? 'climate' : 'airobot'} extra={current[0] === 'climate' ? climateQuery(pumpDeviceId, outdoorPointId) : ''} points={pts} hours={hours} tick={tick} compact theme={theme}/>}
      </section>
      <Settings view={view} notify={notify} onView={setView}/>
    </>}
    <p className="vent-foot"><button type="button" className="text-button" onClick={() => setChanging(true)}>{t('vent.changeIp')}</button><button type="button" className="text-button" onClick={async () => { if (!window.confirm(t('vent.removeConfirm'))) return; try { setView(await api('/airobot', { method: 'DELETE', body: '{}' })); } catch (e) { notify?.(e.message, true); } }}><Trash2 size={13}/>{t('vent.remove')}</button></p>
  </div>;
}
