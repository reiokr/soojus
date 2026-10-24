import React from 'react';
import { AlertCircle, CircleHelp, Droplets, Flame, Power, Settings2, SlidersHorizontal, Thermometer } from 'lucide-react';
import { enumText, number, time } from './lib.js';
import { t } from './i18n/index.js';
import { Badge, Button, Empty, PanelTitle, Reading } from './ui.jsx';

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


export default ControlPage;
