import React from 'react';
import { Cloud, Droplets, Eye, Gauge, MapPin, Navigation, Snowflake, Sun, Sunrise, Thermometer, Umbrella, Wind } from 'lucide-react';
import { number } from '../../lib.js';
import { compassName, daylight, dewPoint, outlook, pressureLabel, uvLabel, visibilityLabel, weatherKind, weatherLabel, windLabel } from '../../weather-logic.js';
import { t, getLocale } from '../../i18n/index.js';

const CLOUD = 'M20 48C12 48 8 42 10 36C11 31 15 28 20 28C21 20 28 15 35 17C41 18 45 22 46 27C52 27 56 32 55 38C54 44 50 48 44 48Z';
const hhmm = v => v ? v.slice(11, 16) : '—';
const clockOf = v => v ? `${v.slice(11, 13)}:00` : '';
const minutesText = m => m == null ? '—' : `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')} min`;

// Animeeritud ilmaikoon. kind: clear | partly | cloudy | fog | drizzle | rain | snow | storm. still: animatsioon käivitub alles hõljutamisel.
export function WeatherIcon({ kind = 'clear', night = false, size = 64, still = false }) {
  const sun = night ? <Moon/> : <SunShape/>;
  const drops = (n, light) => Array.from({ length: n }, (_, i) => <line key={i} className="wx-drop" x1={22 + i * 9} y1="50" x2={20 + i * 9} y2={light ? 54 : 57} style={{ animationDelay: `-${(0.35 + i * 0.23).toFixed(2)}s` }}/>);
  return <svg className={`wx-ico ${still ? 'still' : ''}`} viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" focusable="false">
    {kind === 'clear' && <g>{sun}{night && <Stars/>}</g>}
    {kind === 'partly' && <><g transform="translate(-9 -9) scale(.72)" style={{ transformOrigin: '32px 32px' }}>{sun}</g><g transform="translate(4 8) scale(.88)"><path className="wx-cloud wx-drift" d={CLOUD}/></g></>}
    {kind === 'cloudy' && <><g transform="translate(-6 -6) scale(.8)"><path className="wx-cloud dark wx-drift slow" d={CLOUD}/></g><g transform="translate(6 6) scale(.9)"><path className="wx-cloud wx-drift" d={CLOUD}/></g></>}
    {kind === 'fog' && <><g transform="translate(0 -6) scale(.95)"><path className="wx-cloud wx-drift" d={CLOUD}/></g>{[48, 54, 60].map((y, i) => <rect key={y} className="wx-fog" x={12 + i * 3} y={y - 3} width={36 - i * 4} height="3" rx="1.5" style={{ animationDelay: `${i * 0.7}s` }}/>)}</>}
    {kind === 'drizzle' && <><g transform="translate(0 -6) scale(.95)"><path className="wx-cloud wx-drift" d={CLOUD}/></g>{drops(3, true)}</>}
    {kind === 'rain' && <><g transform="translate(0 -6) scale(.95)"><path className="wx-cloud dark wx-drift" d={CLOUD}/></g>{drops(4, false)}</>}
    {kind === 'snow' && <><g transform="translate(0 -6) scale(.95)"><path className="wx-cloud wx-drift" d={CLOUD}/></g>{[0, 1, 2, 3].map(i => <circle key={i} className="wx-flake" cx={20 + i * 8} cy="50" r="2.2" style={{ animationDelay: `-${(0.9 + i * 0.45).toFixed(2)}s` }}/>)}</>}
    {kind === 'storm' && <><g transform="translate(0 -8) scale(.95)"><path className="wx-cloud dark wx-drift slow" d={CLOUD}/></g><polygon className="wx-bolt" points="34,38 26,52 33,52 29,62 42,45 35,45 39,38"/>{drops(2, true).map((d, i) => React.cloneElement(d, { key: i, x1: 16 + i * 30, x2: 14 + i * 30 }))}</>}
  </svg>;
}

function SunShape() {
  return <g><g className="wx-spin">{Array.from({ length: 8 }, (_, i) => <line key={i} className="wx-ray" x1="32" y1="9" x2="32" y2="16" transform={`rotate(${i * 45} 32 32)`}/>)}</g><circle className="wx-sun" cx="32" cy="32" r="11"/></g>;
}
function Moon() {
  return <path className="wx-moon" d="M38 12a20 20 0 1 0 14 34A16 16 0 0 1 38 12Z"/>;
}
function Stars() {
  return <>{[[50, 14, 0], [54, 30, 0.8], [12, 18, 1.4]].map(([x, y, d], i) => <circle key={i} className="wx-star" cx={x} cy={y} r="1.5" style={{ animationDelay: `${d}s` }}/>)}</>;
}

// Taustaefekt hetkeilma kaardil (vihm, lumi, tähed, pilved, päikesevalgus). Dekoratiivne.
function Effects({ kind, night }) {
  const n = kind === 'rain' || kind === 'storm' ? 22 : kind === 'drizzle' ? 12 : kind === 'snow' ? 20 : 0;
  return <div className={`wx-fx ${kind} ${night ? 'night' : ''}`} aria-hidden="true">
    {Array.from({ length: n }, (_, i) => <span key={i} className="wx-fall" style={{ left: `${(i * 37) % 100}%`, animationDelay: `${((i * 53) % 17) / 10}s`, animationDuration: `${(kind === 'snow' ? 4 : kind === 'drizzle' ? 1.5 : 0.9) + ((i * 7) % 5) / 10}s` }}/>)}
    {(kind === 'cloudy' || kind === 'partly' || kind === 'rain' || kind === 'drizzle' || kind === 'storm' || kind === 'fog') && <><i className="wx-puff a"/><i className="wx-puff b"/></>}
    {kind === 'clear' && !night && <i className="wx-glow"/>}
    {night && (kind === 'clear' || kind === 'partly') && Array.from({ length: 14 }, (_, i) => <b key={i} className="wx-twinkle" style={{ left: `${(i * 29 + 7) % 96}%`, top: `${(i * 41 + 5) % 70}%`, animationDelay: `${(i % 6) * 0.5}s` }}/>)}
    {kind === 'storm' && <i className="wx-flash"/>}
  </div>;
}

function Tile({ icon: Icon, label, value, sub, bar, children }) {
  return <li className="wx-tile"><span className="wx-tile-label"><Icon size={14}/> {label}</span><b>{value}</b>{sub && <small>{sub}</small>}{bar != null && <span className="wx-bar"><i style={{ width: `${Math.max(0, Math.min(100, bar))}%` }}/></span>}{children}</li>;
}

function HourStrip({ hourly, now }) {
  if (!hourly.length) return null;
  const W = 62, H = 46, temps = hourly.map(h => h.temperature), lo = Math.min(...temps), hi = Math.max(...temps), span = Math.max(1, hi - lo);
  const pts = hourly.map((h, i) => [i * W + W / 2, H - 8 - ((h.temperature - lo) / span) * (H - 18)]);
  return <div className="wx-hourly-wrap"><h4>{t('wx.next24')}</h4><div className="wx-hourly" role="list" tabIndex={0} aria-label={t('wx.hourlyAria')}>
    <div className="wx-hourly-inner" style={{ width: hourly.length * W }}>
      <svg className="wx-spark" width={hourly.length * W} height={H} aria-hidden="true"><polyline points={pts.map(p => p.join(',')).join(' ')} fill="none"/>{pts.map(([x, y], i) => (temps[i] === lo || temps[i] === hi) && <circle key={i} cx={x} cy={y} r="3"/>)}</svg>
      <div className="wx-hours">{hourly.map((h, i) => <div key={h.time} role="listitem" className={`wx-hour ${h.isDay === false ? 'night' : ''}`}>
        <small>{i === 0 ? t('wx.now') : clockOf(h.time)}</small>
        <WeatherIcon kind={weatherKind(h.code)} night={h.isDay === false} size={34} still/>
        <b>{Math.round(h.temperature)}°</b>
        <em className={h.rainChance >= 10 || h.precipitation >= 0.1 ? '' : 'dry'}><Droplets size={11}/>{h.rainChance != null ? `${Math.round(h.rainChance)}%` : `${number(h.precipitation, 1)}`}</em>
        {h.wind != null && <span className="wx-hour-wind"><Wind size={10}/>{Math.round(h.wind)}</span>}
      </div>)}</div>
    </div>
  </div></div>;
}

function DayList({ days }) {
  if (!days.length) return null;
  const lo = Math.min(...days.map(d => d.min ?? d.max ?? 0)), hi = Math.max(...days.map(d => d.max ?? d.min ?? 0)), span = Math.max(1, hi - lo);
  return <div className="wx-days-wrap"><h4>{t('wx.daysForecast', { count: days.length })}</h4><ol className="wx-days">{days.map((d, i) => {
    const kind = weatherKind(d.code), left = ((d.min ?? d.max) - lo) / span * 100, width = Math.max(6, (((d.max ?? d.min) - (d.min ?? d.max)) / span) * 100);
    const name = i === 0 ? t('wx.today') : i === 1 ? t('wx.tomorrow') : new Intl.DateTimeFormat(getLocale(), { weekday: 'long' }).format(new Date(`${d.date}T12:00:00`)).replace(/^./, c => c.toUpperCase());
    return <li key={d.date} className="wx-day" title={d.sunrise && d.sunset ? t('wx.sunTitle', { rise: hhmm(d.sunrise), set: hhmm(d.sunset), uv: d.uv != null ? t('wx.uvPart', { value: number(d.uv, 0) }) : '' }) : undefined}>
      <b className="wx-day-name">{name}<small>{new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'numeric' }).format(new Date(`${d.date}T12:00:00`))}</small></b>
      <WeatherIcon kind={kind} size={34} still/>
      <span className="wx-day-label">{weatherLabel(d.code)}</span>
      <span className={`wx-day-rain ${(d.precipitation ?? 0) > 0.2 || (d.rainChance ?? 0) >= 30 ? '' : 'dry'}`}><Droplets size={12}/>{d.rainChance != null ? `${Math.round(d.rainChance)} %` : ''}{(d.precipitation ?? 0) > 0.2 && <i> {number(d.precipitation, 1)} mm</i>}</span>
      {d.wind != null && <span className="wx-day-wind"><Wind size={12}/>{Math.round(d.wind)} m/s</span>}
      <span className="wx-range"><em>{d.min == null ? '' : `${Math.round(d.min)}°`}</em><span className="wx-track"><i style={{ left: `${left}%`, width: `${width}%` }}/></span><b>{d.max == null ? '—' : `${Math.round(d.max)}°`}</b></span>
    </li>;
  })}</ol></div>;
}

// scene: weatherScene() tulemus (võib olla demo); forecast: normaliseeritud ilmaandmed; sensor: soojuspumba välisandur (°C).
export default function WeatherPanel({ scene: w, forecast, place, sensor }) {
  if (!w) return null;
  const f = forecast ?? {}, today = f.days?.[0], hourly = f.hourly ?? [], night = f.isDay === false, kind = w.kind;
  const dew = dewPoint(f.temperature, f.humidity), out = outlook(hourly), light = daylight(today?.sunrise, today?.sunset);
  const fmt = v => v == null ? '—' : `${number(v, 1)} °C`;
  const mismatch = !w.demo && sensor != null && f.temperature != null && Math.abs(sensor - f.temperature) >= 3;
  return <div className="live-forecast wx" aria-label={t('wx.detailsAria')}>
    <section className={`wx-hero ${kind} ${night ? 'night' : 'day'}`}>
      <Effects kind={kind} night={night}/>
      <div className="wx-hero-icon"><WeatherIcon kind={kind} night={night} size={104}/></div>
      <div className="wx-hero-text">
        <small className="wx-place"><MapPin size={13}/> {place?.name ?? ''}{w.demo && ' · DEMO'}</small>
        <b className="wx-temp">{fmt(w.temperature)}</b>
        <span className="wx-desc">{w.label.replace(/^./, c => c.toUpperCase())}{w.feelsLike != null && t('wx.feels', { value: fmt(w.feelsLike) })}</span>
        {today && <small className="wx-range-today"><Thermometer size={13}/> {t('wx.todayRange', { min: today.min == null ? '—' : Math.round(today.min), max: today.max == null ? '—' : Math.round(today.max) })}</small>}
        {mismatch && <small className="wx-mismatch">{t('wx.mismatch', { sensor: fmt(sensor), temp: fmt(f.temperature) })}</small>}
      </div>
    </section>
    <ul className="wx-tiles" aria-label={t('wx.detailsAria')}>
      <Tile icon={Wind} label={t('wx.wind')} value={`${number(w.windMs, 1)} m/s`} sub={`${windLabel(w.windMs)}${f.gust != null ? t('wx.gust', { value: number(f.gust, 0) }) : ''}${f.windDirection != null ? ` · ${compassName(f.windDirection)}` : ''}`}>
        {f.windDirection != null && <Navigation className="wx-compass" size={18} style={{ transform: `rotate(${Math.round(f.windDirection + 180 - 45)}deg)`, '--wind': `${Math.min(2.4, 0.4 + (w.windMs ?? 0) / 6)}s` }} aria-label={t('wx.windDirAria', { deg: Math.round((f.windDirection + 180) % 360) })}/>}
      </Tile>
      <Tile icon={Droplets} label={t('wx.humidity')} value={f.humidity == null ? '—' : `${Math.round(f.humidity)} %`} sub={dew == null ? undefined : t('wx.dewPoint', { value: number(dew, 1) })} bar={f.humidity}/>
      <Tile icon={Gauge} label={t('wx.pressure')} value={f.pressure == null ? '—' : `${Math.round(f.pressure)} hPa`} sub={pressureLabel(f.pressure)}/>
      <Tile icon={Cloud} label={t('wx.cloud')} value={w.cloud == null ? '—' : `${Math.round(w.cloud * 100)} %`} sub={f.visibility == null ? undefined : t('wx.visibility', { km: number(f.visibility / 1000, 0), label: visibilityLabel(f.visibility) })} bar={w.cloud == null ? null : w.cloud * 100}/>
      <Tile icon={Umbrella} label={t('wx.precip')} value={`${number(f.precipitation ?? 0, 1)} mm`} sub={today ? t('wx.todayPrecip', { mm: number(today.precipitation ?? 0, 1), p: Math.round(today.rainChance ?? 0) }) : t('wx.nowLower')}/>
      <Tile icon={Sunrise} label={t('wx.sun')} value={`${hhmm(today?.sunrise)} – ${hhmm(today?.sunset)}`} sub={light ? t('wx.daylight', { duration: minutesText(light) }) : undefined}/>
      {today?.uv != null && <Tile icon={Sun} label={t('wx.uv')} value={number(today.uv, 1)} sub={uvLabel(today.uv)} bar={(today.uv / 11) * 100}/>}
      {f.snowDepth > 0.005 && <Tile icon={Snowflake} label={t('wx.snow')} value={`${number(f.snowDepth * 100, 0)} cm`}/>}
    </ul>
    {out && <p className="wx-outlook"><Eye size={14}/> {t('wx.outlookMin')} <b>{Math.round(out.min.temperature)} °C</b> {t('wx.outlookAt', { time: hhmm(out.min.time) })}, <b>{Math.round(out.max.temperature)} °C</b> {t('wx.outlookEnd', { time: hhmm(out.max.time) })} {out.rainStart ? t('wx.rainExpected', { time: hhmm(out.rainStart), total: number(out.rainTotal, 1) }) : t('wx.rainNone')}</p>}
    <HourStrip hourly={hourly}/>
    <DayList days={f.days ?? []}/>
  </div>;
}
