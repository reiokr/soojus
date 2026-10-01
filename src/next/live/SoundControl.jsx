import React, { useEffect, useRef, useState } from 'react';
import { ListMusic, Repeat1, Volume1, Volume2, VolumeX } from 'lucide-react';
import { Ambience, TRACKS, loadMode, loadTrack, loadVolume } from './ambience.js';

export default function SoundControl() {
  const ref = useRef(null);
  const [on, setOn] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [volume, setVolume] = useState(loadVolume), [track, setTrack] = useState(loadTrack), [mode, setMode] = useState(loadMode), [tracks, setTracks] = useState(TRACKS);
  useEffect(() => { const a = new Ambience(); a.onTrack = setTrack; a.onTracks = setTracks; a.refresh(); a.onError = e => setError(e.message || 'Järgmist lugu ei õnnestunud laadida.'); ref.current = a; return () => a.destroy(); }, []);

  const run = async job => { setBusy(true); setError(''); try { await job(); } catch (e) { setError(e.message || 'Heli ei käivitunud.'); } finally { setBusy(false); } };
  const toggle = () => {
    const a = ref.current;
    if (on) { a.stop(); setOn(false); return; }
    run(async () => { await a.start(); setOn(true); });
  };
  const pick = e => { const id = e.target.value; setTrack(id); run(() => ref.current.setTrack(id)); };
  const flipMode = () => { const m = mode === 'one' ? 'all' : 'one'; setMode(m); ref.current?.setMode(m); };
  const change = e => { const v = Number(e.target.value); setVolume(v); ref.current?.setVolume(v); };
  const Icon = !on || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const modeLabel = mode === 'one' ? 'Esitus: ühe loo kordamine (vajuta, et mängida kõiki järjest)' : 'Esitus: kõik järjest (vajuta, et kordada ühte)';
  const label = on ? 'Lülita taustamuusika välja' : 'Lülita hubane taustamuusika sisse';

  return <div className={`live-sound ${on ? 'is-on' : ''}`} role="group" aria-label="Taustamuusika">
    <button type="button" className="live-sound-btn" onClick={toggle} disabled={busy} aria-pressed={on} aria-label={label} title={error || label}><Icon size={16}/><span>{busy ? 'Laadin…' : on ? 'Muusika sees' : 'Muusika'}</span></button>
    <select value={tracks.some(t => t.id === track) ? track : tracks[0].id} onChange={pick} onFocus={() => ref.current?.refresh()} onMouseDown={() => ref.current?.refresh()} aria-label="Lugu">{tracks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
    <button type="button" className="live-sound-mode" onClick={flipMode} aria-label={modeLabel} title={modeLabel} data-mode={mode}>{mode === 'one' ? <Repeat1 size={16}/> : <ListMusic size={16}/>}</button>
    <input type="range" min="0" max="1" step="0.01" value={volume} onChange={change} aria-label="Helitugevus" aria-valuetext={`${Math.round(volume * 100)}%`}/>
    {error && <small role="alert">{error}</small>}
  </div>;
}
