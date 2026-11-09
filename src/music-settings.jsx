import React, { useCallback, useEffect, useState } from 'react';
import { FolderOpen, Music, Trash2, Upload } from 'lucide-react';
import { api, number } from './lib.js';
import { t } from './i18n/index.js';
import { PanelTitle } from './ui.jsx';
import { titleFromFile } from './next/live/ambience.js';

const ACCEPT = 'audio/*,.mp3,.ogg,.oga,.opus,.m4a,.aac,.wav,.flac,.webm';
const AUDIO_NAME = /\.(mp3|ogg|oga|opus|m4a|aac|wav|flac|webm)$/i;
const MB = 1024 * 1024;

// Oma muusika: failid laetakse brauserist serverisse (data/audio) ja jäävad uuenduste järel alles.
export default function MusicLibrary({ notify }) {
  const [files, setFiles] = useState([]);
  const [limits, setLimits] = useState({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api('/audio');
      setFiles((data.files || []).filter(file => file.url.startsWith('/user-audio/')));
      setLimits(data.limits || {});
      setError(null);
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function upload(selected) {
    const list = [...(selected || [])].filter(file => AUDIO_NAME.test(file.name));
    if (!list.length) { setError(t('music.noAudio')); return; }
    setBusy(true); setError(null);
    const failed = [];
    for (const [index, file] of list.entries()) {
      setProgress({ done: index + 1, total: list.length, name: file.name });
      try {
        const response = await fetch(`/api/audio?name=${encodeURIComponent(file.name)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream', 'X-Soojus-Request': '1' },
          body: file
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || t('common.requestFailed'));
      } catch (e) { failed.push(`${file.name}: ${e.message}`); }
    }
    setBusy(false); setProgress(null);
    await load();
    if (failed.length) setError(failed.join(' · '));
    else notify?.(t('music.uploaded', { count: list.length }));
  }

  async function remove(file) {
    if (!window.confirm(t('music.deleteConfirm', { name: file.name }))) return;
    setBusy(true); setError(null);
    try {
      await api(`/audio/${encodeURIComponent(file.name)}`, { method: 'DELETE' });
      notify?.(t('music.deleted'));
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const pick = event => { upload(event.target.files); event.target.value = ''; };
  const used = files.reduce((sum, file) => sum + file.size, 0);

  return <section className="panel music-panel">
    <PanelTitle title={t('music.title')} subtitle={t('music.hint')}/>
    <div className="button-row">
      <label className={`button primary${busy ? ' is-disabled' : ''}`}>
        <Upload size={16}/>{t('music.uploadFiles')}
        <input type="file" accept={ACCEPT} multiple hidden disabled={busy} onChange={pick}/>
      </label>
      <label className={`button${busy ? ' is-disabled' : ''}`}>
        <FolderOpen size={16}/>{t('music.uploadFolder')}
        <input type="file" accept={ACCEPT} webkitdirectory="" directory="" multiple hidden disabled={busy} onChange={pick}/>
      </label>
    </div>
    <p className="muted">{t('music.folderHint')}</p>
    {progress && <p className="muted" role="status">{t('music.uploading', progress)}</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {files.length > 0 ? <ul className="music-list">{files.map(file => <li key={file.name}><span className="music-icon"><Music size={16}/></span><span><b>{titleFromFile(file.name)}</b><small>{file.name} · {number(file.size / MB, 1)} MB</small></span><button type="button" className="icon-button" disabled={busy} aria-label={t('music.deleteAria', { name: file.name })} onClick={() => remove(file)}><Trash2 size={16}/></button></li>)}</ul> : <p className="muted">{t('music.empty')}</p>}
    {limits.totalBytes ? <p className="muted">{t('music.limit', { used: number(used / MB, 1), total: number(limits.totalBytes / MB, 0) })}</p> : null}
    <p className="muted">{t('music.typeHint')}</p>
  </section>;
}
