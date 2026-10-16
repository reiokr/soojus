import React, { useEffect, useSyncExternalStore } from 'react';
import { ListMusic, Pause, Play, Repeat1, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react';
import { getAmbience } from './ambience.js';

// Muusika on kogu rakenduse peale üks ühine objekt (ambience.js), seega Kodu ja Elava kodu lehe nupud näitavad sama seisu ning lehte vahetades muusika ei katke.
export default function SoundControl() {
  const amb = getAmbience(), s = useSyncExternalStore(amb.subscribe, amb.getSnapshot);
  useEffect(() => amb.attach(), [amb]);

  const Icon = !s.on || s.paused || s.volume === 0 ? VolumeX : s.volume < 0.5 ? Volume1 : Volume2;
  const label = s.on ? 'Lülita taustamuusika välja (järgmine käivitus algab algusest)' : 'Lülita hubane taustamuusika sisse';
  const modeLabel = s.mode === 'one' ? 'Esitus: ühe loo kordamine (vajuta, et mängida kõiki järjest)' : 'Esitus: kõik järjest (vajuta, et korrata ühte)';
  const hint = s.blocked ? 'Brauser ootab esimest klõpsu või klahvivajutust, siis jätkub muusika' : s.error || label;

  return <div className={`live-sound ${s.on ? 'is-on' : ''}`} role="group" aria-label="Taustamuusika">
    <button type="button" className="live-sound-btn" onClick={() => amb.toggle()} disabled={s.busy} aria-pressed={s.on} aria-label={label} title={hint}><Icon size={16}/><span>{s.busy ? 'Laadin…' : s.paused ? 'Pausil' : s.blocked ? 'Klõpsa lehel' : s.on ? 'Muusika sees' : 'Muusika'}</span></button>
    {s.on && <button type="button" className="live-sound-step" onClick={() => amb.prev()} disabled={s.busy || s.tracks.length < 2} aria-label="Eelmine lugu" title="Eelmine lugu"><SkipBack size={16}/></button>}
    {s.on && <button type="button" className="live-sound-pause" onClick={() => amb.togglePause()} disabled={s.busy} aria-pressed={s.paused} aria-label={s.paused ? 'Jätka muusikat' : 'Peata muusika pausile'} title={s.paused ? 'Jätka samast kohast' : 'Paus (lugu jätkub samast kohast)'}>{s.paused ? <Play size={16}/> : <Pause size={16}/>}</button>}
    {s.on && <button type="button" className="live-sound-step" onClick={() => amb.next()} disabled={s.busy || s.tracks.length < 2} aria-label="Järgmine lugu" title="Järgmine lugu"><SkipForward size={16}/></button>}
    <select value={s.tracks.some(t => t.id === s.trackId) ? s.trackId : s.tracks[0].id} onChange={e => amb.setTrack(e.target.value)} onFocus={() => amb.refresh()} onMouseDown={() => amb.refresh()} aria-label="Lugu">{s.tracks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
    <button type="button" className="live-sound-mode" onClick={() => amb.setMode(s.mode === 'one' ? 'all' : 'one')} aria-label={modeLabel} title={modeLabel} data-mode={s.mode}>{s.mode === 'one' ? <Repeat1 size={16}/> : <ListMusic size={16}/>}</button>
    <input type="range" min="0" max="1" step="0.01" value={s.volume} onChange={e => amb.setVolume(Number(e.target.value))} aria-label="Helitugevus" aria-valuetext={`${Math.round(s.volume * 100)}%`}/>
    {s.error && <small role="alert">{s.error}</small>}
  </div>;
}
