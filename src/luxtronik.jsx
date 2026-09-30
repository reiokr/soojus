import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Link2, LoaderCircle, Thermometer, Trash2 } from 'lucide-react';
import { api, number, time, date } from './lib.js';

export function useLuxtronik(tick) {
  const [view, setView] = useState(null), [error, setError] = useState(null);
  const load = useCallback(async () => { try { setView(await api('/luxtronik')); setError(null); } catch (e) { setError(e.message); } }, []);
  useEffect(() => { load(); }, [load, tick]);
  useEffect(() => { const timer = setInterval(load, 30000); return () => clearInterval(timer); }, [load]);
  return { view, error, reload: load, setView };
}

// Soojuspumba kohtvõrguliides: alkoholi temperatuurid, mida myUplinki API ei avalda. Ainult lugemine.
export function LuxtronikPanel({ lux, notify }) {
  const view = lux?.view;
  const [host, setHost] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  useEffect(() => { if (view?.host) setHost(view.host); }, [view?.host]);
  if (!view) return null;
  async function connect(e) {
    e.preventDefault(); setBusy(true); setError(null);
    try { lux.setView(await api('/luxtronik', { method: 'POST', body: JSON.stringify({ host }) })); notify?.('Soojuspumbaga loodi kohtvõrgu ühendus.'); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm('Katkesta soojuspumba kohtvõrgu ühendus? Salvestatud ajalugu jääb alles.')) return;
    try { lux.setView(await api('/luxtronik', { method: 'DELETE', body: '{}' })); } catch (err) { setError(err.message); }
  }
  const t = view.data?.temperatures;
  return <section className="panel luxtronik-panel">
    <div className="location-head">
      <span className="location-icon"><Thermometer size={22}/></span>
      <div>
        <h3>Soojuspumba kohtvõrguliides</h3>
        <p>{view.configured ? <>Ühendatud: <b>{view.host}</b>{view.time && <> · viimane lugemine {time(view.time)}</>}</> : 'Pole ühendatud'}</p>
        <small>{view.primary ? `Põhiallikas: pump otse (${view.mapped} näitu, värskendus iga 10 s). Võimsus (kW): ${view.powerSource ? 'loetakse otse pumbalt' : 'tuleb praegu myUplinkist, otseväärtuse kinnitan pumba järgmisel töötsüklil'}. myUplink on varuks ja annab ülejäänud näidud, seaded ja häired.` : view.mismatch ? 'Otseandmete väljad ei klapi myUplinki omadega, seepärast kasutatakse myUplinki. Alkoholi temperatuure näidatakse siiski.' : view.configured ? 'Otseandmed ootavad esimest lugemist või on vananenud; praegu kasutatakse myUplinki.' : ''} myUplinki API ei anna alkoholi temperatuure. Pump (Alpha Innotec / Luxtronik) pakub neid kohtvõrgus pordil 8889. Ühendus on ainult lugemiseks ja töötab ainult sama võrgu aadressidega.</small>
      </div>
    </div>
    {view.configured && t && <p className="location-now"><Thermometer size={16}/> Alkohol maast {number(t.brineIn, 1)} °C, maasse {number(t.brineOut, 1)} °C · kuumgaas {number(t.hotGas, 1)} °C</p>}
    {view.configured && !t && view.error && <p className="inline-error" role="alert">{view.error}</p>}
    <form className="location-search" onSubmit={connect}>
      <label className="search-input"><Link2 size={17}/><input value={host} onChange={e => setHost(e.target.value)} placeholder="Soojuspumba IP-aadress, nt 192.168.100.171" aria-label="Soojuspumba IP-aadress" inputMode="decimal" autoComplete="off"/></label>
      <button type="submit" className="button primary" disabled={busy || !host}>{busy ? <LoaderCircle size={16} className="spin"/> : <Link2 size={16}/>}{view.configured ? 'Muuda ja testi' : 'Ühenda ja testi'}</button>
    </form>
    {view.configured && view.errors?.length > 0 && <div className="pump-errors">
      <h4><AlertTriangle size={15}/> Pumba veateated <span>{view.errors7d} viimase 7 päeva jooksul</span></h4>
      <ul>{view.errors.slice(0, 10).map(e => <li key={`${e.time}-${e.code}`}><b>{e.code}</b><span>{e.name}</span><time dateTime={e.time}>{date(e.time)}</time></li>)}</ul>
      <p>Pumba enda mälu hoiab ainult 5 viimast viga; rakendus salvestab need siia, et muster ei kaoks. Kood 765 tähendab, et külmaaine ülekuumenemine oli üle 5 minuti alla 2 K. Tootja juhendi järgi tuleb korduval esinemisel kutsuda hooldus.</p>
    </div>}
    {view.configured && <div className="location-actions"><button type="button" className="text-button" onClick={remove}><Trash2 size={13}/> Katkesta ühendus</button></div>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </section>;
}
