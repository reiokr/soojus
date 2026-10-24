import React, { useEffect, useState } from 'react';
import { api, time } from './lib.js';
import { t } from './i18n/index.js';

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const hourLabel = hour => `${String(hour).padStart(2, '0')}:00`;
const ruleKeys = ['pumpError', 'ventFilter', 'co2', 'legionella', 'stale'];

export default function NotificationSettings({ notify }) {
  const [form, setForm] = useState(null);
  const [log, setLog] = useState({ sent: [] });
  const [busy, setBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [error, setError] = useState(null);
  const [devices, setDevices] = useState([]);
  const [devicesError, setDevicesError] = useState(null);

  const load = async () => {
    try {
      const [settings, activity] = await Promise.all([api('/notifications/settings'), api('/notifications/log')]);
      setForm({ ...settings, twilioToken: '', messagebirdKey: '', webhookToken: '' });
      setLog(activity || { sent: [] });
      setError(null);
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); }, []);
  const loadDevices = async () => {
    try {
      const result = await api('/notifications/kdeconnect');
      setDevices(result.devices || []); setDevicesError(result.error || null);
    } catch (e) { setDevicesError(e.message); }
  };
  useEffect(() => { if (form?.provider === 'kdeconnect') loadDevices(); }, [form?.provider]);

  if (error) return <section className="panel"><div className="panel-title"><div><h3>{t('notify.title')}</h3></div></div><p className="inline-error" role="alert">{error}</p></section>;
  if (!form) return <section className="panel"><div className="panel-title"><div><h3>{t('notify.title')}</h3></div></div><p className="muted">{t('notify.loading')}</p></section>;

  const update = patch => setForm(previous => ({ ...previous, ...patch, rules: { ...previous.rules, ...(patch.rules || {}) } }));
  const setRule = (key, value) => update({ rules: { [key]: value } });

  async function save(e) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const saved = await api('/notifications/settings', { method: 'POST', body: JSON.stringify(form) });
      setForm({ ...saved, twilioToken: '', messagebirdKey: '', webhookToken: '' });
      notify?.(t('notify.saved'));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function test() {
    setTestBusy(true); setError(null);
    try {
      await api('/notifications/test', { method: 'POST', body: JSON.stringify(form) });
      notify?.(t('notify.testSent'));
      const activity = await api('/notifications/log');
      setLog(activity || { sent: [] });
    } catch (e) { setError(e.message); } finally { setTestBusy(false); }
  }

  return <section className="panel notify-panel">
    <div className="panel-title"><div><h3>{t('notify.title')}</h3><p>{t('notify.hint')}</p></div></div>
    <form onSubmit={save}>
      <div className="notify-grid">
        <label className="field"><span>{t('notify.phone')}</span><input type="tel" value={form.phone} onChange={e => update({ phone: e.target.value })} placeholder="+372 5555 1234" autoComplete="tel"/></label>
        <label className="field"><span>{t('notify.provider')}</span><select value={form.provider} onChange={e => update({ provider: e.target.value })}>
          <option value="kdeconnect">{t('notify.kdeconnect')}</option>
          <option value="twilio">Twilio</option>
          <option value="messagebird">MessageBird</option>
          <option value="webhook">{t('notify.webhook')}</option>
        </select></label>
      </div>
      <label className="check-filter notify-toggle"><input type="checkbox" checked={form.smsEnabled} onChange={e => update({ smsEnabled: e.target.checked })}/>{t('notify.smsEnabled')}</label>
      <p className="muted notify-hint">{t('notify.providerHint')}</p>

      {form.provider === 'kdeconnect' && <>
        <label className="field"><span>{t('notify.kdeconnectDevice')}</span><select value={form.kdeconnectDevice || ''} onChange={e => update({ kdeconnectDevice: e.target.value })}>
          <option value="">{t('notify.kdeconnectAuto')}</option>
          {devices.map(device => <option key={device.id} value={device.id}>{device.name}</option>)}
        </select></label>
        <button type="button" className="text-button" onClick={loadDevices}>{t('notify.refreshDevices')}</button>
        {devices.length === 0 && <p className="inline-error">{devicesError || t('notify.kdeconnectNone')}</p>}
        <p className="muted notify-hint">{t('notify.kdeconnectHint')}</p>
      </>}

      {form.provider === 'twilio' && <div className="notify-grid">
        <label className="field"><span>{t('notify.twilioSid')}</span><input value={form.twilioSid} onChange={e => update({ twilioSid: e.target.value })} placeholder="AC…"/></label>
        <label className="field"><span>{t('notify.twilioToken')}</span><input type="password" value={form.twilioToken} onChange={e => update({ twilioToken: e.target.value })} placeholder={form.secrets?.twilioToken ? t('notify.savedSecret') : ''} autoComplete="new-password"/></label>
        <label className="field"><span>{t('notify.twilioFrom')}</span><input value={form.twilioFrom} onChange={e => update({ twilioFrom: e.target.value })} placeholder="+1…"/></label>
      </div>}
      {form.provider === 'messagebird' && <div className="notify-grid">
        <label className="field"><span>{t('notify.messagebirdKey')}</span><input type="password" value={form.messagebirdKey} onChange={e => update({ messagebirdKey: e.target.value })} placeholder={form.secrets?.messagebirdKey ? t('notify.savedSecret') : ''} autoComplete="new-password"/></label>
        <label className="field"><span>{t('notify.messagebirdFrom')}</span><input value={form.messagebirdFrom} onChange={e => update({ messagebirdFrom: e.target.value })} placeholder="Soojus"/></label>
      </div>}
      {form.provider === 'webhook' && <div className="notify-grid">
        <label className="field"><span>{t('notify.webhookUrl')}</span><input value={form.webhookUrl} onChange={e => update({ webhookUrl: e.target.value })} placeholder="http://…"/></label>
        <label className="field"><span>{t('notify.webhookToken')}</span><input type="password" value={form.webhookToken} onChange={e => update({ webhookToken: e.target.value })} placeholder={form.secrets?.webhookToken ? t('notify.savedSecret') : ''} autoComplete="new-password"/></label>
      </div>}

      <h4 className="notify-subhead">{t('notify.rules')}</h4>
      <div className="notify-checks">
        {ruleKeys.map(key => <label className="check-filter" key={key}><input type="checkbox" checked={Boolean(form.rules?.[key])} onChange={e => setRule(key, e.target.checked)}/>{t(`notify.rule_${key}`)}</label>)}
      </div>

      <div className="notify-grid">
        <label className="field"><span>{t('notify.quietFrom')}</span><select value={form.quietFrom} onChange={e => update({ quietFrom: Number(e.target.value) })}>{HOURS.map(hour => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}</select></label>
        <label className="field"><span>{t('notify.quietTo')}</span><select value={form.quietTo} onChange={e => update({ quietTo: Number(e.target.value) })}>{HOURS.map(hour => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}</select></label>
        <label className="field"><span>{t('notify.cooldown')}</span><input type="number" min="0" max="1440" step="30" value={form.cooldownMinutes} onChange={e => update({ cooldownMinutes: Number(e.target.value) })}/></label>
        <label className="field"><span>{t('notify.dailyLimit')}</span><input type="number" min="1" max="100" step="1" value={form.dailyLimit} onChange={e => update({ dailyLimit: Number(e.target.value) })}/></label>
      </div>
      <p className="muted notify-hint">{t('notify.quietHint')} {t('notify.costHint')}</p>

      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="button-row">
        <button type="submit" className="button primary" disabled={busy}>{busy ? t('notify.saving') : t('notify.save')}</button>
        <button type="button" className="button" onClick={test} disabled={testBusy || !form.phone}>{testBusy ? t('notify.sending') : t('notify.test')}</button>
      </div>
      <p className="muted notify-hint">{t('notify.testHint')}</p>

      <h4 className="notify-subhead">{t('notify.log')}</h4>
      {log.sent?.length ? <ul className="notify-log">
        {log.sent.slice(0, 6).map((entry, index) => <li key={`${entry.time}-${index}`}><time dateTime={entry.time}>{time(entry.time)}</time><span className={entry.ok ? 'notify-ok' : 'notify-fail'}>{entry.text}</span>{entry.ok ? <b>{t('notify.sent')}</b> : <b>{t('notify.failed')}: {entry.error}</b>}</li>)}
      </ul> : <p className="muted">{t('notify.noLog')}</p>}
    </form>
  </section>;
}
