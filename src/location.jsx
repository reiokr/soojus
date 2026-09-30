import React, { useState } from 'react';
import { CloudSun, LoaderCircle, MapPin, Search } from 'lucide-react';
import { api, number } from './lib.js';
import { compassName, weatherLabel } from './weather-logic.js';

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
    try { await weather.setLocation({ name: p.name, latitude: p.latitude, longitude: p.longitude }); setResults(null); setQuery(''); notify?.(`Asukoht: ${p.name}.`); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function saveManual(e) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await weather.setLocation({ name: coords.name, latitude: coords.latitude, longitude: coords.longitude }); notify?.(`Asukoht: ${coords.name}.`); setManual(false); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <section className={`panel location-panel ${compact ? 'compact' : ''}`}>
    <div className="location-head">
      <span className="location-icon"><MapPin size={22}/></span>
      <div>
        <h3>Asukoht ja ilm</h3>
        <p>{place ? <>Praegu: <b>{place.name}</b> ({number(place.latitude, 2)}°, {number(place.longitude, 2)}°){place.isDefault && ' · vaikeasukoht'}</> : 'Laadin…'}</p>
        <small>Asukoht määrab päikese ja kuu asendi ning ilma. Ilmateenusele (Open-Meteo) saadetakse ainult umbes 1 km täpsusega koordinaadid.</small>
      </div>
    </div>
    {current && <p className="location-now"><CloudSun size={16}/> Praegu {number(current.temperature, 1)} °C, {weatherLabel(current.code)}{current.wind != null && `, tuul ${number(current.wind, 1)} m/s ${compassName(current.windDirection)}`}{weather.view.stale && ' · vana andmestik'}</p>}
    {weather?.view?.error && !current && <p className="inline-error" role="alert">{weather.view.error}</p>}
    <form className="location-search" onSubmit={search}>
      <label className="search-input"><Search size={17}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Otsi asulat või linna, nt Ülenurme, Elva, Tartu…" aria-label="Otsi asukohta" minLength={2} maxLength={60}/></label>
      <button type="submit" className="button primary" disabled={busy || query.trim().length < 2}>{busy ? <LoaderCircle size={16} className="spin"/> : <Search size={16}/>}Otsi</button>
    </form>
    {results && (results.length ? <ul className="location-results" aria-label="Otsingutulemused">{results.map(r => <li key={`${r.latitude},${r.longitude}`}><button type="button" onClick={() => choose(r)} disabled={busy}><b>{r.name}</b><span>{r.region}</span><em>{number(r.latitude, 2)}°, {number(r.longitude, 2)}°</em></button></li>)}</ul> : <p className="muted">Sobivaid kohti ei leitud. Proovi lähimat suuremat asulat või sisesta koordinaadid käsitsi.</p>)}
    <div className="location-actions">
      <button type="button" className="text-button" onClick={() => setManual(!manual)} aria-expanded={manual}>{manual ? 'Peida koordinaadid' : 'Sisesta koordinaadid käsitsi'}</button>
      {place && !place.isDefault && <button type="button" className="text-button" disabled={busy} onClick={async () => { try { await weather.resetLocation(); notify?.('Asukoht lähtestati vaikeväärtusele.'); } catch (err) { setError(err.message); } }}>Lähtesta vaikeasukohale</button>}
    </div>
    {manual && <form className="location-manual" onSubmit={saveManual}>
      <label className="field"><span>Nimi</span><input value={coords.name} onChange={e => setCoords({ ...coords, name: e.target.value })} placeholder="Minu kodu" required maxLength={80}/></label>
      <label className="field"><span>Laiuskraad</span><input value={coords.latitude} onChange={e => setCoords({ ...coords, latitude: e.target.value })} placeholder="58.38" inputMode="decimal" required/></label>
      <label className="field"><span>Pikkuskraad</span><input value={coords.longitude} onChange={e => setCoords({ ...coords, longitude: e.target.value })} placeholder="26.72" inputMode="decimal" required/></label>
      <button type="submit" className="button primary" disabled={busy}>Salvesta asukoht</button>
    </form>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </section>;
}
