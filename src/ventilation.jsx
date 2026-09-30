import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ChevronDown, Fan, Flame, Gauge, Link2, LoaderCircle, RefreshCw, Trash2, Wind } from 'lucide-react';
import { api, number, time } from './lib.js';
import { climate, climatePoints, climateQuery, co2Quality, daysWithMonths, filterInfo, MODE_INFO, ventilationSentence } from './ventilation-logic.js';

export function useAirobot(tick, enabled = true) {
  const [view, setView] = useState(null), [error, setError] = useState(null);
  const load = useCallback(async () => { if (!enabled) return; try { setView(await api('/airobot')); setError(null); } catch (e) { setError(e.message); } }, [enabled]);
  useEffect(() => { load(); }, [load, tick]);
  useEffect(() => { if (!enabled) return; const timer = setInterval(load, 30000); return () => clearInterval(timer); }, [load, enabled]);
  return { view, error, reload: load, setView };
}

function Tile({ label, value, unit, note, tone }) {
  return <div className={`vent-tile ${tone || ''}`}><small>{label}</small><b>{value}{unit && <i>{unit}</i>}</b>{note && <em>{note}</em>}</div>;
}

function Setup({ onDone, notify, current }) {
  const [host, setHost] = useState(current || ''), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  async function save(e) {
    e.preventDefault(); setBusy(true); setError(null);
    try { const view = await api('/airobot', { method: 'POST', body: JSON.stringify({ host }) }); notify?.('Ventilatsiooniseade on ühendatud.'); onDone(view); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <section className="panel vent-setup">
    <div className="vent-setup-head"><span className="vent-icon"><Fan size={26}/></span><div><h3>Ühenda Airobot ventilatsiooniseade</h3><p>Seade suhtleb sinu kohtvõrgus Modbus TCP kaudu. Pilvekontot ega API-võtit pole vaja.</p></div></div>
    <ol className="vent-steps">
      <li>Ava seadme ekraanil <b>Menu → Settings → Other → Modbus TCP</b> ja lülita see <b>ON</b>. Seade taaskäivitub.</li>
      <li>Sisesta seadme IP-aadress kohtvõrgus (leiad ruuteri seadmete nimekirjast, nimi <code>Airobot-Ventilation</code>).</li>
      <li>Modbus TCP-l pole parooli, seega hoia seade ainult kodusesse võrku.</li>
    </ol>
    <form onSubmit={save} className="vent-form">
      <label className="field"><span>Seadme IP-aadress</span><input value={host} onChange={e => setHost(e.target.value)} placeholder="192.168.100.2" inputMode="decimal" autoComplete="off" required/></label>
      <button type="submit" className="button primary" disabled={busy || !host}>{busy ? <LoaderCircle size={16} className="spin"/> : <Link2 size={16}/>}Ühenda ja testi</button>
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
    try { const next = await api('/airobot/control', { method: 'POST', body: JSON.stringify(body) }); onView(next); setDirty(false); notify?.(`Ventilatsiooni režiim: ${MODE_INFO[pick].label}.`); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  const changed = pick !== view.mode || (pick === 'auto' && Number(co2) !== s.co2Setpoint) || (pick === 'manual' && Number(fan) !== clampFan(s.manualFanLevel)) || pick === 'boost' || pick === 'overpressure';
  return <section className="panel vent-control" aria-labelledby="vent-control-title">
    <div className="vent-now">
      <div><small>PRAEGU</small><h3 id="vent-control-title">{view.modeText}</h3></div>
      <div className="vent-speed" aria-label={`Kiirus ${d.fans.supplyLevel} 10-st`}><b>{d.fans.supplyLevel}</b><span>/ 10</span><small>kiirus</small></div>
    </div>
    <form onSubmit={apply}>
      <div className="vent-modes" role="radiogroup" aria-label="Ventilatsiooni režiim">
        {Object.entries(MODE_INFO).map(([key, info]) => { const Icon = MODE_ICONS[key]; return <button key={key} type="button" role="radio" aria-checked={pick === key} className={`${pick === key ? 'selected' : ''} ${view.mode === key ? 'current' : ''}`} onClick={() => touch(setPick)(key)}><Icon size={22}/><b>{info.label}</b><small>{info.hint}</small>{view.mode === key && <em>praegu</em>}</button>; })}
      </div>
      <div className="vent-param">
        {pick === 'auto' && <label className="vent-range"><span>CO₂ piirmäär, millal ventilatsioon kiirendab <b>{co2} ppm</b></span><input type="range" min="450" max="2000" step="50" value={co2} onChange={e => touch(setCo2)(e.target.value)} aria-label="CO₂ piirmäär ppm"/><small>Praegu õhus {d.co2} ppm · lubatud 450–2000</small></label>}
        {pick === 'manual' && <div className="vent-range"><span>Kiirus <b>{fan}</b> / 10</span><div className="vent-levels" role="radiogroup" aria-label="Ventilaatori kiirus">{Array.from({ length: 10 }, (_, i) => i + 1).map(n => <button key={n} type="button" role="radio" aria-checked={Number(fan) === n} className={Number(fan) === n ? 'selected' : ''} onClick={() => touch(setFan)(n)}>{n}</button>)}</div></div>}
        {(pick === 'boost' || pick === 'overpressure') && <div className="vent-range"><span>{pick === 'boost' ? 'Õhutuse' : 'Ülerõhu'} kestus <b>{minutes} min</b></span><div className="vent-levels minutes" role="group" aria-label="Kestus minutites">{[5, 10, 15, 20, 30, 45, 60].map(n => <button key={n} type="button" className={Number(minutes) === n ? 'selected' : ''} onClick={() => touch(setMinutes)(n)}>{n}</button>)}</div><label className="vent-number">või sisesta minutites (3–60) <input type="number" min="3" max="60" step="1" value={minutes} onChange={e => touch(setMinutes)(e.target.value)}/></label></div>}
      </div>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="vent-apply"><button type="submit" className="button primary" disabled={busy || !changed}>{busy ? <LoaderCircle size={16} className="spin"/> : null}Rakenda</button>{dirty && <button type="button" className="text-button" onClick={() => setDirty(false)}>Tühista muudatus</button>}</div>
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
    {changed && <button type="submit" className="button" disabled={disabled}>Salvesta</button>}
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
      <span><b>Seaded</b><small>{open ? 'Muudatus kehtib kohe ja salvestub seadmesse.' : 'Suletud, et neid ei muudetaks kogemata. Vajuta, et avada.'}</small></span>
      <ChevronDown size={20}/>
    </button>
    {open && <div id="vent-settings-body" className="vent-settings-body">
    <Row title="Suvine möödaviik (bypass)" hint="Kui sisse lülitatud, otsustab seade ise, millal soojusvaheti mööda minna."><span className="vent-state">{sw.bypass ? 'Sees' : 'Väljas'}</span><Switch on={sw.bypass} disabled={busy} label="Suvine möödaviik" onChange={on => save({ bypass: on }, `Suvine möödaviik: ${on ? 'sees' : 'väljas'}.`)}/></Row>
    <Row title="Ventilatsioon" hint="Lülitab seadme täielikult sisse või välja."><span className="vent-state">{sw.power ? 'Sees' : 'Väljas'}</span><Switch on={sw.power} disabled={busy} label="Ventilatsioon" onChange={on => { if (!on && !window.confirm('Lülitada ventilatsioon välja? Tuba ei tuulutata enne, kui lülitad selle tagasi.')) return; save({ power: on }, `Ventilatsioon: ${on ? 'sees' : 'väljas'}.`); }}/></Row>
    {sw.humidityControl != null && <Row title="Niiskuse automaatjuhtimine" hint="Kiirendab ventilatsiooni, kui toa niiskus ületab sihttaseme."><Switch on={sw.humidityControl} disabled={busy} label="Niiskuse juhtimine" onChange={on => save({ humidityControl: on }, `Niiskuse juhtimine: ${on ? 'sees' : 'väljas'}.`)}/><NumberSetting label="Niiskuse sihttase" value={s.humiditySetpoint} min={5} max={95} step={1} unit="%" disabled={busy} onSave={n => save({ humiditySetpoint: n }, `Niiskuse sihttase: ${n} %.`)}/></Row>}
    {sw.vocControl != null && <Row title="VOC automaatjuhtimine" hint="Reageerib lenduvatele orgaanilistele ühenditele (indeks 0–500)."><Switch on={sw.vocControl} disabled={busy} label="VOC juhtimine" onChange={on => save({ vocControl: on }, `VOC juhtimine: ${on ? 'sees' : 'väljas'}.`)}/>{s.vocSetpoint != null && <NumberSetting label="VOC sihttase" value={s.vocSetpoint} min={0} max={500} unit="indeks" disabled={busy} onSave={n => save({ vocSetpoint: n }, `VOC sihttase: ${n}.`)}/>}</Row>}
    {sw.pmControl != null && <Row title="PM2,5 automaatjuhtimine" hint="Reageerib peenetolmule (µg/m³)."><Switch on={sw.pmControl} disabled={busy} label="PM2,5 juhtimine" onChange={on => save({ pmControl: on }, `PM2,5 juhtimine: ${on ? 'sees' : 'väljas'}.`)}/>{s.pmSetpoint != null && <NumberSetting label="PM2,5 sihttase" value={s.pmSetpoint} min={0} max={999} unit="µg/m³" disabled={busy} onSave={n => save({ pmSetpoint: n }, `PM2,5 sihttase: ${n} µg/m³.`)}/>}</Row>}
    <Row title="Ülerõhu (kamina) kiirus" hint="Ventilaatori kiirus 1–10, kui ülerõhu režiim on sees."><div className="vent-levels compact" role="radiogroup" aria-label="Ülerõhu kiirus">{Array.from({ length: 10 }, (_, i) => i + 1).map(n => <button key={n} type="button" role="radio" aria-checked={s.overpressureFanLevel === n} className={s.overpressureFanLevel === n ? 'selected' : ''} disabled={busy} onClick={() => s.overpressureFanLevel !== n && save({ overpressureFanLevel: n }, `Ülerõhu kiirus: ${n}.`)}>{n}</button>)}</div></Row>
    <Row title="Filtri kasutusintervall" hint={filter ? `Kasutatud ${daysWithMonths(s.filterElapsed)}, ${filter.percent}%. Jäänud ${daysWithMonths(filter.leftHours)}.` : undefined}><NumberSetting label="Filtri kasutusintervall päevades" value={Math.round(s.filterInterval / 24)} min={30} max={365} step={1} unit="päeva" after={n => `(${daysWithMonths(n * 24).replace(/^.*\(/, '').replace(/\)$/, '')})`} disabled={busy} onSave={n => save({ filterInterval: n * 24 }, `Filtri kasutusintervall: ${daysWithMonths(n * 24)}.`)}/><button type="button" className="button" disabled={busy} onClick={() => { if (window.confirm('Lähtesta filtri taimer? Tee seda alles pärast filtri vahetamist.')) save({ resetFilter: true }, 'Filtri taimer lähtestati.'); }}>Filter vahetatud</button></Row>
    {error && <p className="inline-error" role="alert">{error}</p>}
    </div>}
  </section>;
}

export function VentilationPage({ tick, theme, HistoryChart, notify, airobot, outdoor, pumpDeviceId, outdoorPointId }) {
  const own = useAirobot(tick, !airobot), source = airobot || own;
  const { view, error, reload, setView } = source;
  const [tab, setTab] = useState('climate'), [hours, setHours] = useState(24), [changing, setChanging] = useState(false);
  if (!view) return <div className="panel vent-loading">{error ? <><AlertCircle size={18}/> {error}</> : <><LoaderCircle size={18} className="spin"/> Laadin ventilatsiooni andmeid…</>}</div>;
  if (!view.configured || changing) return <Setup current={view.host} notify={notify} onDone={v => { setView(v); setChanging(false); }}/>;
  const d = view.data, byId = Object.fromEntries(view.points.map(p => [p.parameterId, p]));
  const hasClimate = Boolean(pumpDeviceId && outdoorPointId), tabs = [...(hasClimate ? [['climate', 'Toas vs väljas', null]] : []), ['co2', 'CO₂', ['co2']], ['temp', 'Temperatuurid', ['supply_temp', 'extract_temp']], ['hum', 'Niiskus', ['supply_hum', 'extract_hum']], ['flow', 'Õhuvool', ['supply_flow', 'extract_flow']], ['rpm', 'Ventilaatorid', ['supply_rpm', 'extract_rpm']]];
  const current = tabs.find(t => t[0] === tab) || tabs[0], pts = current[0] === 'climate' ? climatePoints : current[2].map(id => byId[id]).filter(Boolean);
  const air = d ? co2Quality(d.co2) : null, filter = d ? filterInfo(d.settings.filterElapsed, d.settings.filterInterval) : null;
  const clim = climate(outdoor, view), t = v => v == null ? '—' : number(v, 1);
  return <div className="vent">
    {!d ? <section className="panel vent-error" role="alert"><AlertCircle size={20}/><div><b>Seadmega ei saanud ühendust</b><p>{view.error || 'Ootan esimest lugemist…'} Kontrolli, et seadmes on Modbus TCP sisse lülitatud ja IP on {view.host}.</p></div><button className="button" type="button" onClick={reload}><RefreshCw size={15}/>Proovi uuesti</button></section> : <>
      <Control view={view} notify={notify} onView={setView}/>
      <section className="panel vent-summary">
        <span className={`vent-icon ${d.fans.supplyRpm > 0 ? 'on' : ''}`}><Wind size={28}/></span>
        <div><h3>{ventilationSentence(view)}</h3><p>Viimane lugemine {time(view.time)} · {view.host}</p></div>
        <div className="vent-flags">
          <span className={`vent-chip ${air.key}`}>Õhk: {air.label}</span>
          {d.switches.bypass && <span className="vent-chip ok">Möödaviik sees</span>}
          {d.switches.filterAlert && <span className="vent-chip bad">Filter vajab vahetust</span>}
          {view.errors.map(e => <span key={e} className="vent-chip bad">Viga: {e}</span>)}
        </div>
      </section>
      <div className="vent-grid">
        <Tile label="Sisetemperatuur" value={t(clim.indoor)} unit="°C" note="väljatõmbeõhk toast"/>
        <Tile label="Välisõhk" value={t(clim.outdoor)} unit="°C" note={clim.outdoorSource === 'soojuspump' ? 'soojuspumba andur' : 'ventilatsiooni andur'}/>
        <Tile label="CO₂" value={d.co2} unit="ppm" tone={air.key} note={`piirmäär ${d.settings.co2Setpoint} ppm`}/>
        <Tile label="Sissepuhke temperatuur" value={t(d.temperatures.supply)} unit="°C" note="tuppa"/>
        <Tile label="Niiskus toas" value={t(d.humidity.extract)} unit="%" note={`sihttase ${number(d.settings.humiditySetpoint, 0)} %`}/>
        <Tile label="Soojustagastus" value={number(d.heatRecovery, 0)} unit="%"/>
        <Tile label="Sissepuhke õhuvool" value={number(d.airflow.supply, 0)} unit="m³/h" note={`${number(d.fans.supplyRpm, 0)} p/min`}/>
        <Tile label="Väljatõmbe õhuvool" value={number(d.airflow.extract, 0)} unit="m³/h" note={`${number(d.fans.extractRpm, 0)} p/min`}/>
        <Tile label="VOC indeks" value={number(d.voc, 0)}/>
        <Tile label="PM2,5" value={number(d.pm25, 0)} unit="µg/m³"/>
        {filter && <Tile label="Filter" value={`${filter.percent}`} unit="% kasutatud" tone={d.switches.filterAlert ? 'bad' : filter.percent > 85 ? 'high' : ''} note={`jäänud ${daysWithMonths(filter.leftHours)}`}/>}
        <Tile label="Töötab" value={d.uptimeHours < 48 ? number(d.uptimeHours * 60, 0) : number(d.uptimeHours / 24, 1)} unit={d.uptimeHours < 48 ? 'min' : 'päeva'} note="pärast taaskäivitust"/>
      </div>
      {filter && <div className="vent-filter" role="img" aria-label={`Filter ${filter.percent}% kasutatud`}><i style={{ width: `${filter.percent}%` }}/></div>}
      <section className="panel vent-trend">
        <div className="vent-trend-head"><h3>Trend</h3>
          <div className="vent-controls">
            <div className="segmented" role="group" aria-label="Näit">{tabs.map(([id, label]) => <button key={id} type="button" className={current[0] === id ? 'selected' : ''} aria-pressed={current[0] === id} onClick={() => setTab(id)}>{label}</button>)}</div>
            <div className="segmented" role="group" aria-label="Ajavahemik">{[[24, '24 tundi'], [168, 'Nädal'], [720, 'Kuu']].map(([v, l]) => <button key={v} type="button" className={hours === v ? 'selected' : ''} aria-pressed={hours === v} onClick={() => setHours(v)}>{l}</button>)}</div>
          </div>
        </div>
        {pts.length > 0 && <HistoryChart key={current[0]} name={`vent-${current[0]}`} deviceId={current[0] === 'climate' ? 'climate' : 'airobot'} extra={current[0] === 'climate' ? climateQuery(pumpDeviceId, outdoorPointId) : ''} points={pts} hours={hours} tick={tick} compact theme={theme}/>}
      </section>
      <Settings view={view} notify={notify} onView={setView}/>
    </>}
    <p className="vent-foot"><button type="button" className="text-button" onClick={() => setChanging(true)}>Muuda IP-aadressi</button><button type="button" className="text-button" onClick={async () => { if (!window.confirm('Eemalda ventilatsiooniseade? Salvestatud ajalugu jääb alles.')) return; try { setView(await api('/airobot', { method: 'DELETE', body: '{}' })); } catch (e) { notify?.(e.message, true); } }}><Trash2 size={13}/>Eemalda seade</button></p>
  </div>;
}
