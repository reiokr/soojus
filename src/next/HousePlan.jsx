import React from 'react';
import { number } from '../lib.js';
import { tempColor, scalePosition } from './logic.js';

const VIEWS = { full: [0, 40, 1000, 470], heat: [180, 168, 540, 312], water: [655, 205, 265, 230] };

function Pill({ view, x, y, title, value, unit, note, tone, below, onClick, label }) {
  const [vx, vy, vw, vh] = VIEWS[view];
  const left = (x - vx) / vw * 100, top = (y - vy) / vh * 100;
  if (left < -2 || left > 102 || top < -2 || top > 102) return null;
  const Tag = onClick ? 'button' : 'div';
  return <Tag type={onClick ? 'button' : undefined} className={`nx-pill ${tone || ''} ${below ? 'below' : ''}`} style={{ left: `${left}%`, top: `${top}%` }} onClick={onClick} aria-label={onClick ? label : undefined}>
    <small>{title}</small><b>{value}{unit && <i>{unit}</i>}</b>{note && <em>{note}</em>}
  </Tag>;
}

const fmt = p => p?.value == null ? '—' : number(p.value, 1);

// Maja lõige: tehnoruum, elutuba ja vannituba. Andmed on pillidena, seisund animatsioonina.
export default function HousePlan({ view = 'full', supply, returnT, returnTarget, buffer, water, waterTarget, power, outdoor, state, vent, climate, onOpen }) {
  const { heatOn, hwOn, heatDemand, hwDemand } = state;
  const powerKw = Number(power?.value) || 0;
  const wt = Number(water?.value), bt = Number(buffer?.value), target = Number(waterTarget);
  const pipeClass = (on, wait) => on ? 'nx-flow fast' : wait ? 'nx-flow slow' : 'nx-flow off';
  const [vx, vy, vw, vh] = VIEWS[view];
  const thermoY = t => 392 - scalePosition(t) * 130;
  const vd = view === 'full' && vent ? vent.data : null, ventOn = Boolean(vd && vd.fans.supplyRpm > 0);
  const open = id => onOpen ? () => onOpen(id) : undefined;
  return <div className={`nx-plan nx-plan-${view}`}>
    <svg viewBox={`${vx} ${vy} ${vw} ${vh}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      <defs>
        <pattern id={`nx-grid-${view}`} width="24" height="24" patternUnits="userSpaceOnUse"><path d="M12 9v6M9 12h6" stroke="var(--nx-line)" strokeWidth=".8" opacity=".7"/></pattern>
        <pattern id={`nx-slab-${view}`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="var(--nx-ink)" strokeWidth="1" opacity=".3"/></pattern>
        <pattern id={`nx-soil-${view}`} width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="3" cy="4" r="1" fill="var(--nx-ink)" opacity=".22"/><circle cx="10" cy="10" r="1.2" fill="var(--nx-ink)" opacity=".18"/></pattern>
        <linearGradient id={`nx-boiler-${view}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={tempColor(wt + 2)}/><stop offset=".55" stopColor={tempColor(wt)}/><stop offset="1" stopColor={tempColor(wt - 12)}/></linearGradient>
        <linearGradient id={`nx-buffer-${view}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={tempColor(bt + 1)}/><stop offset="1" stopColor={tempColor(bt - 4)}/></linearGradient>
      </defs>
      <rect x="0" y="0" width="1000" height="520" fill={`url(#nx-grid-${view})`}/>

      <g className="nx-outside">
        <g stroke="var(--nx-ink)" strokeWidth="2" fill="none" strokeLinecap="round">
          <circle cx="95" cy="82" r="20"/>
          {Array.from({ length: 8 }, (_, i) => { const a = i * Math.PI / 4; return <line key={i} x1={95 + Math.cos(a) * 28} y1={82 + Math.sin(a) * 28} x2={95 + Math.cos(a) * 38} y2={82 + Math.sin(a) * 38}/>; })}
          <path d="M120 400V352"/><circle cx="120" cy="322" r="32"/><path d="M120 352l-14-14M120 344l12-12"/>
        </g>
      </g>

      <rect x="0" y="420" width="1000" height="100" fill={`url(#nx-soil-${view})`}/>
      <rect x="180" y="400" width="720" height="20" fill="var(--surface)" stroke="var(--nx-ink)" strokeWidth="2"/>
      <rect x="180" y="400" width="720" height="20" fill={`url(#nx-slab-${view})`}/>
      <path d="M0 400H180M900 400H1000" stroke="var(--nx-ink)" strokeWidth="2"/>

      <g fill="none" stroke="var(--nx-ink)" strokeLinejoin="round" strokeLinecap="round">
        <path d="M165 212L540 88L915 212" strokeWidth="3.5" fill="var(--surface)" fillOpacity=".55"/>
        <path d="M190 205V400M890 205V400M190 205H890" strokeWidth="3"/>
        <path d="M440 205V400M690 205V400" strokeWidth="1.5" opacity=".6"/>
      </g>
      <g className="nx-room-labels" fill="var(--nx-ink)" opacity=".7" fontSize="10" letterSpacing="2.2" fontWeight="700">
        <text x="312" y="446" textAnchor="middle">TEHNORUUM</text><text x="565" y="446" textAnchor="middle">ELUTUBA</text><text x="790" y="446" textAnchor="middle">VANNITUBA</text>
      </g>

      <g className="nx-pipes" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4">
        <path d="M310 292H345M409 292H480V315H535" className="nx-pipe heat"/>
        <path d="M535 368H505V390H310" className="nx-pipe cold"/>
        <path d="M310 352H326V409H815V400" className="nx-pipe heat"/>
        <path d="M845 400V415H318V372H310" className="nx-pipe cold"/>
        <path d="M825 262V244H735V250" className="nx-pipe heat"/>
        <path d="M310 292H345M409 292H480V315H535" className={`${pipeClass(heatOn, heatDemand)} heat`}/>
        <path d="M535 368H505V390H310" className={`${pipeClass(heatOn, heatDemand)} cold`}/>
        <path d="M310 352H326V409H815V400" className={`${pipeClass(hwOn, hwDemand)} heat`}/>
        <path d="M845 400V415H318V372H310" className={`${pipeClass(hwOn, hwDemand)} cold`}/>
      </g>

      {view === 'full' && vent && <g className={`nx-vent-unit ${vd ? '' : 'off'}`} stroke="var(--nx-ink)" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M236 189H485" className="nx-pipe cold" strokeWidth="4"/><path d="M575 150V102" className="nx-pipe heat" strokeWidth="4"/>
        <path d="M580 196V214M510 196V214" className="nx-pipe cold" strokeWidth="4"/>
        {ventOn && <g fill="none" strokeWidth="2.6">
          <path d="M236 189H485" className="nx-flow air cold"/><path d="M575 150V102" className="nx-flow air heat"/>
          <path d="M580 196V214" className="nx-flow air cold"/><path d="M510 214V196" className="nx-flow air heat"/>
        </g>}
        <rect x="485" y="150" width="112" height="46" rx="6" fill="var(--surface)"/>
        <g className={ventOn ? 'nx-vfan spin' : 'nx-vfan'}><circle cx="514" cy="173" r="13"/><path d="M514 160v26M501 173h26M505 164l18 18M523 164l-18 18" strokeWidth="1.4"/></g>
        <g className={ventOn ? 'nx-vfan spin' : 'nx-vfan'}><circle cx="568" cy="173" r="13"/><path d="M568 160v26M555 173h26M559 164l18 18M577 164l-18 18" strokeWidth="1.4"/></g>
        <path d="M502 214h16l-3 6h-10zM572 214h16l-3 6h-10z" fill="var(--surface)" strokeWidth="1.8"/>
        <path d="M228 189l8 -6v12z" fill="var(--nx-ink)" strokeWidth="1"/>
      </g>}

      <g className="nx-brine" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4">
        <path d="M285 400V446H610Q628 446 628 458Q628 470 610 470H250V400" className="nx-pipe cold"/>
        <path d="M285 400V446H610Q628 446 628 458Q628 470 610 470H250V400" className={pipeClass(heatOn || hwOn || powerKw > 0, false) + ' cold'}/>
      </g>

      <g className="nx-pump" stroke="var(--nx-ink)" strokeWidth="2.4">
        <rect x="215" y="245" width="95" height="155" rx="7" fill="var(--surface)"/>
        <rect x="227" y="257" width="71" height="30" rx="3" fill="var(--nx-ink)" stroke="none"/>
        <text x="262" y="277" textAnchor="middle" fontSize="14" fontWeight="700" fill="var(--surface)" stroke="none">{number(powerKw, 1)} kW</text>
        <circle cx="262" cy="338" r="32" fill="var(--nx-ink)" fillOpacity=".08"/>
        <g className={powerKw > 0 || state.heatOn || state.hwOn ? 'nx-fan spin' : 'nx-fan'} fill="none" strokeLinecap="round">
          <path d="M262 338a2 2 0 0 1 4 0a5 5 0 0 1-10 0a9 9 0 0 1 18 0a13 13 0 0 1-26 0a17 17 0 0 1 34 0" strokeWidth="2.2"/>
        </g>
        <path d="M225 400v-6M300 400v-6" strokeWidth="3"/>
      </g>

      <g className="nx-buffer" stroke="var(--nx-ink)" strokeWidth="2.4">
        <rect x="345" y="258" width="64" height="122" rx="14" fill={`url(#nx-buffer-${view})`}/>
        <path d="M357 272v90" stroke="var(--surface)" strokeWidth="4" opacity=".35" strokeLinecap="round"/>
        <path d="M358 380v20M396 380v20" strokeWidth="3"/>
      </g>

      <g className="nx-living" stroke="var(--nx-ink)" strokeWidth="2.2" fill="none" strokeLinejoin="round">
        <rect x="555" y="232" width="72" height="54" rx="2" fill="var(--nx-water)" fillOpacity=".12"/>
        <path d="M591 232v54M555 259h72" strokeWidth="1.5"/>
        <rect x="535" y="300" width="110" height="80" rx="5" fill={heatOn ? 'var(--nx-heat)' : 'var(--surface)'} fillOpacity={heatOn ? .22 : 1} className={heatOn ? 'nx-radiator on' : 'nx-radiator'}/>
        {Array.from({ length: 7 }, (_, i) => <path key={i} d={`M${549 + i * 14.5} 308v64`} strokeWidth="2.6"/>)}
        <path d="M545 380v20M635 380v20" strokeWidth="3"/>
        {heatOn && <g className="nx-waves" stroke="var(--nx-heat)" strokeWidth="2.2" opacity=".8">
          {[560, 590, 620].map((x, i) => <path key={x} d={`M${x} 292c-5-6 5-10 0-16s5-10 0-16`} style={{ animationDelay: `${i * .35}s` }}/>)}
        </g>}
        <path d="M665 400l-4-22h22l-4 22zM672 378c-10-10-18-24-12-38 8 8 12 22 12 38zM674 378c8-10 20-16 30-12-8 10-20 14-30 12z" strokeWidth="1.8"/>
      </g>

      <g className="nx-bath" stroke="var(--nx-ink)" strokeWidth="2.2" fill="none" strokeLinejoin="round" strokeLinecap="round">
        <rect x="790" y="262" width="70" height="138" rx="18" fill={`url(#nx-boiler-${view})`}/>
        <path d="M802 282v96" stroke="var(--surface)" strokeWidth="4" opacity=".4"/>
        <circle cx="803" cy="400" r="1.6" fill="var(--nx-ink)" stroke="none"/><circle cx="847" cy="400" r="1.6" fill="var(--nx-ink)" stroke="none"/>
        <path d="M720 250h30l-6 13h-18z" fill="var(--surface)"/>
        {hwOn && <g className="nx-drops" fill="var(--nx-water)" stroke="none">
          {[726, 735, 744].map((x, i) => <circle key={x} cx={x} cy="270" r="2.3" style={{ animationDelay: `${i * .28}s` }}/>)}
        </g>}
        <g className="nx-thermo" strokeWidth="1.6">
          <path d={`M874 ${thermoY(65)}V${thermoY(15)}`}/>
          {[20, 30, 40, 50, 60].map(t => <path key={t} d={`M870 ${thermoY(t)}h8`}/>)}
          {Number.isFinite(wt) && <circle cx="874" cy={thermoY(wt)} r="5" fill={tempColor(wt)}/>}
          {Number.isFinite(target) && <path d={`M866 ${thermoY(target) - 5}l8 5l-8 5z`} fill="var(--nx-ink)"/>}
        </g>
        {hwOn && <g className="nx-bubbles" fill="none" stroke="var(--surface)" strokeWidth="1.4">{[810, 825, 840].map((x, i) => <circle key={x} cx={x} cy="380" r="3" style={{ animationDelay: `${i * .5}s` }}/>)}</g>}
      </g>

      <text x="905" y="500" textAnchor="end" fontSize="10" letterSpacing="2" fill="var(--nx-ink)" opacity=".55" fontWeight="700">KODU-PLAAN · 1:50</text>
    </svg>

    {view === 'full' && vent && <Pill view={view} x={541} y={143} title="Ventilatsioon" value={vd ? vent.modeText : '—'} tone={vd && vd.co2 >= 1000 ? 'heat' : 'cold'} note={vd ? `kiirus ${vd.fans.supplyLevel}/10 · CO₂ ${vd.co2}` : 'ühendus puudub'} onClick={open('ventilation')} label="Ava ventilatsiooni leht"/>}
    {view === 'full' && climate?.indoor != null && <Pill view={view} x={712} y={153} below title="Toas" value={number(climate.indoor, 1)} unit="°C"/>}
    <Pill view={view} x={95} y={118} below title="Väljas" value={climate?.outdoor != null ? number(climate.outdoor, 1) : fmt(outdoor)} unit="°C"/>
    <Pill view={view} x={262} y={236} title="Hetkevõimsus" value={number(powerKw, 1)} unit="kW" tone={powerKw > 0 ? 'active' : ''} onClick={open('device')} label="Ava seadme leht"/>
    <Pill view={view} x={377} y={250} title="Akupaak" value={fmt(buffer)} unit="°C" onClick={open('heating')} label="Ava kütte leht"/>
    <Pill view={view} x={480} y={270} title="Pealevool" value={fmt(supply)} unit="°C" tone="heat" onClick={open('heating')} label="Ava kütte leht"/>
    <Pill view={view} x={430} y={428} below title="Tagasivool" value={fmt(returnT)} unit="°C" tone="cold" note={returnTarget?.value != null ? `siht ${number(returnTarget.value, 1)} °C` : undefined} onClick={open('heating')} label="Ava kütte leht"/>
    <Pill view={view} x={825} y={236} title="Tarbevesi" value={fmt(water)} unit="°C" tone="cold" note={Number.isFinite(target) ? `siht ${number(target, 0)} °C` : undefined} onClick={open('water')} label="Ava tarbevee leht"/>
  </div>;
}
