import React, { useState } from 'react';
import { CloudSun, LoaderCircle, MapPin, Search } from 'lucide-react';
import { api, number } from './lib.js';
import { compassName, weatherLabel } from './weather-logic.js';
import { t } from './i18n/index.js';

export function LocationPanel({ weather, notify, compact = false }) {
  const place = weather?.place, current = weather?.view?.weather;
  const [query, setQuery] = useState(''), [results, setResults] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const [manual, setManual] = useState(false), [coords, setCoords] = useState({ name: '', latitude: '', longitude: '' });
  async function search(e) {
    e.preventDefault(); setBusy(true); setError(null); setResults(null);
    try { setResults((await api(`/location/search?q=${encodeURIComponent(query.trim())}`)).results); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function choose(p) {
    setBusy(true); setError(null);
    try { await weather.setLocation({ name: p.name, latitude: p.latitude, longitude: p.longitude }); setResults(null); setQuery(''); notify?.(t('loc.saved', { name: p.name })); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function saveManual(e) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await weather.setLocation({ name: coords.name, latitude: coords.latitude, longitude: coords.longitude }); notify?.(t('loc.saved', { name: coords.name })); setManual(false); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <section className={`panel location-panel ${compact ? 'compact' : ''}`}>
    <div className="location-head">
      <span className="location-icon"><MapPin size={22}/></span>
      <div>
        <h3>{t('loc.title')}</h3>
        <p>{place ? <>{t('loc.current', { name: place.name, lat: number(place.latitude, 2), lon: number(place.longitude, 2) })}{place.isDefault && t('loc.default')}</> : t('loc.loading')}</p>
        <small>{t('loc.hint')}</small>
      </div>
    </div>
    {current && <p className="location-now"><CloudSun size={16}/> {t('loc.now', { temp: number(current.temperature, 1), weather: weatherLabel(current.code) })}{current.wind != null && t('loc.wind', { wind: number(current.wind, 1), dir: compassName(current.windDirection) })}{weather.view.stale && t('loc.stale')}</p>}
    {weather?.view?.error && !current && <p className="inline-error" role="alert">{weather.view.error}</p>}
    <form className="location-search" onSubmit={search}>
      <label className="search-input"><Search size={17}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('loc.searchPlaceholder')} aria-label={t('loc.searchAria')} minLength={2} maxLength={60}/></label>
      <button type="submit" className="button primary" disabled={busy || query.trim().length < 2}>{busy ? <LoaderCircle size={16} className="spin"/> : <Search size={16}/>}{t('loc.search')}</button>
    </form>
    {results && (results.length ? <ul className="location-results" aria-label={t('loc.results')}>{results.map(r => <li key={`${r.latitude},${r.longitude}`}><button type="button" onClick={() => choose(r)} disabled={busy}><b>{r.name}</b><span>{r.region}</span><em>{number(r.latitude, 2)}°, {number(r.longitude, 2)}°</em></button></li>)}</ul> : <p className="muted">{t('loc.noResults')}</p>)}
    <div className="location-actions">
      <button type="button" className="text-button" onClick={() => setManual(!manual)} aria-expanded={manual}>{manual ? t('loc.hideCoords') : t('loc.showCoords')}</button>
      {place && !place.isDefault && <button type="button" className="text-button" disabled={busy} onClick={async () => { try { await weather.resetLocation(); notify?.(t('loc.resetDone')); } catch (err) { setError(err.message); } }}>{t('loc.reset')}</button>}
    </div>
    {manual && <form className="location-manual" onSubmit={saveManual}>
      <label className="field"><span>{t('loc.name')}</span><input value={coords.name} onChange={e => setCoords({ ...coords, name: e.target.value })} placeholder={t('loc.namePlaceholder')} required maxLength={80}/></label>
      <label className="field"><span>{t('loc.lat')}</span><input value={coords.latitude} onChange={e => setCoords({ ...coords, latitude: e.target.value })} placeholder="58.38" inputMode="decimal" required/></label>
      <label className="field"><span>{t('loc.lon')}</span><input value={coords.longitude} onChange={e => setCoords({ ...coords, longitude: e.target.value })} placeholder="26.72" inputMode="decimal" required/></label>
      <button type="submit" className="button primary" disabled={busy}>{t('loc.save')}</button>
    </form>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </section>;
}
