import React from 'react';
import { Droplets, MapPin, Snowflake, Sun } from 'lucide-react';
import { number } from '../../lib.js';
import { outlook } from '../../weather-logic.js';
import { WeatherIcon } from './WeatherPanel.jsx';

// Tunniaeg "2026-10-03T14:00" -> "14:00".
const hhmm = t => typeof t === 'string' && t.length >= 16 ? t.slice(11, 16) : null;

// Täisekraani parem serv, infobulletite all: hetkeilm + tekstiline 24 h kokkuvõte (külmim, soojim, sadu).
// Kompaktne ja alati nähtav; pikk tunniloend jäi välja, sest selle info annab lühike lause.
export default function ForecastRail({ scene, forecast, place }) {
  if (!scene) return null;
  const hourly = forecast?.hourly ?? [], out = outlook(hourly), night = forecast?.isDay === false;
  const now = forecast?.temperature ?? scene.temperature;
  return <aside className="live-rail" aria-label="Hetkeilm ja 24 tunni kokkuvõte">
    <div className={`live-rail-hero ${scene.kind} ${night ? 'night' : 'day'}`}>
      <span className="live-rail-ico"><WeatherIcon kind={scene.kind} night={night} size={52}/></span>
      <div className="live-rail-hero-text">
        <small><MapPin size={12}/> {place?.name ?? ''}{scene.demo && ' · DEMO'}</small>
        <b>{now == null ? '—' : `${number(now, 1)}°`}</b>
        <span>{scene.label.replace(/^./, c => c.toUpperCase())}{scene.windMs != null && ` · ${number(scene.windMs, 0)} m/s`}</span>
      </div>
    </div>
    {out && <div className="live-rail-out">
      <h4>Prognoos 24 h</h4>
      <ul>
        <li><Sun size={13}/><span>Kõrgeim</span><b>{Math.round(out.max.temperature)}°</b><em>kell {hhmm(out.max.time) ?? '—'}</em></li>
        <li><Snowflake size={13}/><span>Madalaim</span><b>{Math.round(out.min.temperature)}°</b><em>kell {hhmm(out.min.time) ?? '—'}</em></li>
        <li className={out.rainStart ? '' : 'dry'}><Droplets size={13}/><span>Sademed</span>{out.rainStart ? <><b>{number(out.rainTotal, 1)} mm</b><em>alates {hhmm(out.rainStart)}</em></> : <em>lähitundidel ei ole</em>}</li>
      </ul>
    </div>}
  </aside>;
}
