import { useCallback, useEffect, useState } from 'react';
import { api } from './lib.js';

// Ilm ja asukoht serverist (server hoiab vahemälu ja saadab ilmateenusele ainult ümardatud koordinaate).
export function useWeather(tick) {
  const [view, setView] = useState(null), [error, setError] = useState(null);
  const load = useCallback(async () => { try { setView(await api('/weather')); setError(null); } catch (e) { setError(e.message); } }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const timer = setInterval(load, 10 * 60000); return () => clearInterval(timer); }, [load]);
  useEffect(() => { if (tick) load(); }, [tick, load]);
  const setLocation = useCallback(async place => { await api('/location', { method: 'POST', body: JSON.stringify(place) }); await load(); }, [load]);
  const resetLocation = useCallback(async () => { await api('/location', { method: 'DELETE', body: '{}' }); await load(); }, [load]);
  return { view, error, reload: load, setLocation, resetLocation, place: view?.location ?? null };
}
