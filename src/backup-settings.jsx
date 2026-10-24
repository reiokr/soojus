import React, { useEffect, useRef, useState } from 'react';
import { Download, LoaderCircle, RotateCcw, Trash2, Upload } from 'lucide-react';
import { api, date, number } from './lib.js';
import { t } from './i18n/index.js';

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const hourLabel = hour => `${String(hour).padStart(2, '0')}:00`;
const kindKey = kind => `backup.kind_${kind === 'pre-restore' ? 'pre' : kind}`;
const mb = bytes => number(Number(bytes) / 1048576, 1);

export default function BackupSettings({ notify }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [file, setFile] = useState(null);
  const fileRef = useRef(null);

  const load = async () => {
    try {
      const result = await api('/backups');
      setData(result);
      setForm(result.settings);
      setError(null);
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); }, []);

  if (!data || !form) return <section className="panel backup-panel"><div className="panel-title"><div><h3>{t('backup.title')}</h3></div></div><p className="muted">{error || t('backup.loading')}</p></section>;

  const update = patch => setForm(previous => ({ ...previous, ...patch }));

  async function createBackup() {
    setBusy('create'); setError(null); setMessage(null);
    try {
      const meta = await api('/backups', { method: 'POST', body: '{}', signal: AbortSignal.timeout(180000) });
      await load();
      const a = document.createElement('a');
      a.href = `/api/backups/${encodeURIComponent(meta.name)}`;
      a.download = meta.name;
      document.body.appendChild(a); a.click(); a.remove();
      notify?.(t('backup.created'));
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  }

  async function saveSettings(e) {
    e.preventDefault(); setBusy('settings'); setError(null); setMessage(null);
    try {
      await api('/backups/settings', { method: 'POST', body: JSON.stringify(form) });
      await load();
      setMessage(t('backup.saved'));
      notify?.(t('backup.saved'));
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  }

  async function upload() {
    if (!file) return;
    setBusy('upload'); setError(null); setMessage(null);
    try {
      const response = await fetch('/api/backups/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Soojus-Request': '1' },
        body: file
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || t('common.requestFailed'));
      setFile(null); if (fileRef.current) fileRef.current.value = '';
      await load();
      setMessage(t('backup.uploaded', { name: result.name }));
      notify?.(t('backup.uploaded', { name: result.name }));
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  }

  async function restore(name) {
    if (!window.confirm(t('backup.confirmRestore', { name }))) return;
    setBusy(`restore:${name}`); setError(null); setMessage(null);
    try {
      const result = await api('/backups/restore', { method: 'POST', body: JSON.stringify({ name }), signal: AbortSignal.timeout(180000) });
      setMessage(result.automatic ? t('backup.restarting') : t('backup.restartManual'));
      if (result.automatic) {
        const started = Date.now();
        const check = async () => {
          try {
            const response = await fetch('/api/status', { cache: 'no-store' });
            if (response.ok) { location.reload(); return; }
          } catch {}
          if (Date.now() - started < 30000) setTimeout(check, 1500);
          else setError(t('backup.restartTimeout'));
        };
        setTimeout(check, 2500);
      }
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  }

  async function remove(name) {
    if (!window.confirm(t('backup.confirmDelete', { name }))) return;
    setBusy(`delete:${name}`); setError(null); setMessage(null);
    try {
      await api(`/backups/${encodeURIComponent(name)}`, { method: 'DELETE' });
      await load();
      notify?.(t('backup.deleted'));
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  }

  const blocked = Boolean(busy);
  return <section className="panel backup-panel">
    <div className="panel-title"><div><h3>{t('backup.title')}</h3><p>{t('backup.hint')}</p></div></div>
    <div className="backup-head">
      <button type="button" className="button primary" onClick={createBackup} disabled={blocked}>{busy === 'create' ? <><LoaderCircle size={16} className="spin"/>{t('backup.creating')}</> : <><Download size={16}/>{t('backup.create')}</>}</button>
      <button type="button" className="button" onClick={() => fileRef.current?.click()} disabled={blocked}>{t('backup.chooseFile')}</button>
      <input ref={fileRef} type="file" accept=".sqlite,.db,application/octet-stream" onChange={e => setFile(e.target.files?.[0] || null)} hidden/>
      {file && <button type="button" className="button" onClick={upload} disabled={blocked}>{busy === 'upload' ? <><LoaderCircle size={16} className="spin"/>{t('backup.uploading')}</> : <><Upload size={16}/>{t('backup.upload')}</>}</button>}
      {file && <small className="backup-filename">{file.name}</small>}
    </div>
    <p className="muted notify-hint">{t('backup.uploadHint')}</p>

    <form className="backup-settings" onSubmit={saveSettings}>
      <label className="check-filter notify-toggle"><input type="checkbox" checked={form.enabled} onChange={e => update({ enabled: e.target.checked })}/>{t('backup.auto')}</label>
      <div className="backup-grid">
        <label className="field"><span>{t('backup.hour')}</span><select value={form.hour} onChange={e => update({ hour: Number(e.target.value) })}>{HOURS.map(hour => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}</select></label>
        <label className="field"><span>{t('backup.retention')}</span><input type="number" min="1" max="90" step="1" value={form.retentionDays} onChange={e => update({ retentionDays: Number(e.target.value) })}/></label>
      </div>
      <p className="muted notify-hint">{t('backup.autoHint', { hour: hourLabel(form.hour), days: form.retentionDays })}</p>
      <button type="submit" className="button" disabled={blocked}>{busy === 'settings' ? t('backup.saving') : t('backup.saveSettings')}</button>
    </form>

    {data.status && <p className={data.status.ok ? 'muted' : 'inline-error'}>{data.status.ok ? t('backup.statusOk', { time: date(data.status.time), size: mb(data.status.bytes) }) : t('backup.statusError', { error: data.status.error })}</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {message && <p className="muted" role="status">{message}</p>}

    <h4 className="notify-subhead">{t('backup.list')}</h4>
    {data.files?.length ? <ul className="backup-list">
      {data.files.map(item => <li key={item.name}>
        <div><b>{item.name}</b><small>{date(item.createdAt)} · {mb(item.bytes)} MB</small></div>
        <span className={`backup-kind ${item.kind}`}>{t(kindKey(item.kind))}</span>
        <div className="backup-actions">
          <a className="button" href={`/api/backups/${encodeURIComponent(item.name)}`} download><Download size={14}/>{t('backup.download')}</a>
          <button type="button" className="button" disabled={blocked} onClick={() => restore(item.name)}>{busy === `restore:${item.name}` ? <LoaderCircle size={14} className="spin"/> : <RotateCcw size={14}/>}{t('backup.restore')}</button>
          <button type="button" className="button" disabled={blocked} onClick={() => remove(item.name)}>{busy === `delete:${item.name}` ? <LoaderCircle size={14} className="spin"/> : <Trash2 size={14}/>}{t('backup.remove')}</button>
        </div>
      </li>)}
    </ul> : <p className="muted">{t('backup.empty')}</p>}
    <p className="muted notify-hint">{t('backup.note')}</p>
  </section>;
}
