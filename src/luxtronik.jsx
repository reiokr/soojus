import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Link2, LoaderCircle, Thermometer, Trash2 } from 'lucide-react';
import { api, time, date } from './lib.js';
import { t } from './i18n/index.js';

export function useLuxtronik(tick) {
  const [view, setView] = useState(null), [error, setError] = useState(null);
  const load = useCallback(async () => { try { setView(await api('/luxtronik')); setError(null); } catch (e) { setError(e.message); } }, []);
  useEffect(() => { load(); }, [load, tick]);
  useEffect(() => { const timer = setInterval(load, 30000); return () => clearInterval(timer); }, [load]);
  return { view, error, reload: load, setView };
}

// Soojuspumba kohtvõrguliides: soojakandja temperatuurid, mida myUplinki API ei avalda. Ainult lugemine.
export function LuxtronikPanel({ lux, notify }) {
  const view = lux?.view;
  const [host, setHost] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  useEffect(() => { if (view?.host) setHost(view.host); }, [view?.host]);
  if (!view) return null;
  async function connect(e) {
    e.preventDefault(); setBusy(true); setError(null);
    try { lux.setView(await api('/luxtronik', { method: 'POST', body: JSON.stringify({ host }) })); notify?.(t('lux.connectedNotify')); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm(t('lux.disconnectConfirm'))) return;
    try { lux.setView(await api('/luxtronik', { method: 'DELETE', body: '{}' })); } catch (err) { setError(err.message); }
  }
  const temps = view.data?.temperatures;
  return <section className="panel luxtronik-panel">
    <div className="location-head">
      <span className="location-icon"><Thermometer size={22}/></span>
      <div>
        <h3>{t('lux.title')}</h3>
        <p>{view.configured ? <>{t('lux.connected', { host: view.host })}{view.time && t('lux.lastRead', { time: time(view.time) })}</> : t('lux.notConnected')}</p>
        <small>{view.primary ? t('lux.primary', { mapped: view.mapped, power: view.powerSource ? t('lux.powerDirect') : t('lux.powerFallback') }) : view.mismatch ? t('lux.mismatch') : view.configured ? t('lux.waiting') : ''} {t('lux.tail')}</small>
      </div>
    </div>
    {view.configured && !temps && view.error && <p className="inline-error" role="alert">{view.error}</p>}
    <form className="location-search" onSubmit={connect}>
      <label className="search-input"><Link2 size={17}/><input value={host} onChange={e => setHost(e.target.value)} placeholder={t('lux.placeholder')} aria-label={t('lux.aria')} inputMode="decimal" autoComplete="off"/></label>
      <button type="submit" className="button primary" disabled={busy || !host}>{busy ? <LoaderCircle size={16} className="spin"/> : <Link2 size={16}/>}{view.configured ? t('lux.change') : t('lux.connect')}</button>
    </form>
    {view.configured && view.errors?.length > 0 && <div className="pump-errors">
      <h4><AlertTriangle size={15}/> {t('lux.errors')} <span>{t('lux.errors7d', { count: view.errors7d })}</span></h4>
      <ul>{view.errors.slice(0, 10).map(e => <li key={`${e.time}-${e.code}`}><b>{e.code}</b><span>{e.name}</span><time dateTime={e.time}>{date(e.time)}</time></li>)}</ul>
      <p>{t('lux.errorsNote')}</p>
    </div>}
    {view.configured && <div className="location-actions"><button type="button" className="text-button" onClick={remove}><Trash2 size={13}/> {t('lux.disconnect')}</button></div>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </section>;
}
