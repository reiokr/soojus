import React, { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChartLine, Clock3, Eye, Globe, LayoutTemplate, Monitor, Moon, Music2, Palette, RefreshCw, Settings2, Sun, Thermometer, X } from 'lucide-react';
import { t, LOCALES, setLocale } from './i18n/index.js';
import { useLocale } from './i18n/react.js';
import { setFormat } from './formats.js';
import { useFormats } from './formats-react.js';

const THEMES = [
  ['auto', 'prefs.themeAuto', Monitor],
  ['light', 'prefs.themeLight', Sun],
  ['dark', 'prefs.themeDark', Moon]
];

// Üldseaded: teema, keel, liides ja muusikamängija ühes väikeses hüpikmenüüs.
// Sama komponent on mõlemas liideses (klassikaline ülariba ja Kodu-plaan), seega
// valikud on alati samad ja salvestuvad brauserisse.
export default function GeneralSettings({ themeChoice, setThemeChoice, ui, setUi, ovHours, pickOvHours, refreshSec, setRefreshSec, musicHidden, setMusicHidden, visuals, setVisuals }) {
  const locale = useLocale();
  const formats = useFormats();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector('.prefs-btn')?.focus(); } };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const pick = (fn, ...args) => { fn(...args); setOpen(false); };

  return <div className="prefs" ref={ref}>
    <button type="button" className={`prefs-btn${open ? ' is-open' : ''}`} aria-haspopup="dialog" aria-expanded={open}
      aria-label={t('prefs.button')} title={t('prefs.button')} onClick={() => setOpen(!open)}><Settings2 size={18}/></button>
    {open && <div className="prefs-menu" role="dialog" aria-label={t('prefs.title')}>
      <div className="prefs-head"><b>{t('prefs.title')}</b><button type="button" className="icon-button" aria-label={t('prefs.close')} onClick={() => setOpen(false)}><X size={16}/></button></div>

      <div className="prefs-group">
        <span className="prefs-label"><Palette size={15}/>{t('prefs.theme')}</span>
        <div className="segmented prefs-seg" role="group" aria-label={t('prefs.theme')}>
          {THEMES.map(([value, label, Icon]) => {
            const IconTag = Icon;
            return <button key={value} type="button" className={themeChoice === value ? 'selected' : ''} aria-pressed={themeChoice === value}
              onClick={() => setThemeChoice(value)}><IconTag size={14}/>{t(label)}</button>;
          })}
        </div>
      </div>

      <div className="prefs-group">
        <span className="prefs-label"><Globe size={15}/>{t('prefs.language')}</span>
        <div className="segmented prefs-seg" role="group" aria-label={t('prefs.language')}>
          {LOCALES.map(([code, label]) => <button key={code} type="button" className={locale === code ? 'selected' : ''} aria-pressed={locale === code}
            onClick={() => pick(setLocale, code)}>{label}</button>)}
        </div>
      </div>

      <div className="prefs-group">
        <span className="prefs-label"><LayoutTemplate size={15}/>{t('prefs.interface')}</span>
        <div className="segmented prefs-seg" role="group" aria-label={t('prefs.interface')}>
          {[['classic', 'settings.ui.classic'], ['next', 'settings.ui.next']].map(([value, label]) => <button key={value} type="button" className={ui === value ? 'selected' : ''} aria-pressed={ui === value}
            onClick={() => pick(setUi, value)}>{t(label)}</button>)}
        </div>
      </div>

      {setVisuals && <div className="prefs-group">
        <span className="prefs-label"><Eye size={15}/>{t('prefs.visuals')}</span>
        <div className="segmented prefs-seg" role="group" aria-label={t('prefs.visuals')}>
          {[['full', 'prefs.visualFull'], ['calm', 'prefs.visualCalm'], ['off', 'prefs.visualOff']].map(([value, label]) => <button key={value} type="button" className={visuals === value ? 'selected' : ''} aria-pressed={visuals === value}
            onClick={() => setVisuals(value)}>{t(label)}</button>)}
        </div>
        <small className="prefs-note">{t('prefs.visualsHint')}</small>
      </div>}

      <div className="prefs-group">
        <span className="prefs-label"><Clock3 size={15}/>{t('prefs.clock')}</span>
        <div className="segmented prefs-seg" role="group" aria-label={t('prefs.clock')}>
          {[['24', 'prefs.clock24'], ['12', 'prefs.clock12']].map(([value, label]) => <button key={value} type="button" className={formats.clock === value ? 'selected' : ''} aria-pressed={formats.clock === value}
            onClick={() => setFormat('clock', value)}>{t(label)}</button>)}
        </div>
      </div>

      <div className="prefs-group">
        <span className="prefs-label"><Thermometer size={15}/>{t('prefs.temp')}</span>
        <div className="segmented prefs-seg" role="group" aria-label={t('prefs.temp')}>
          {[['c', 'prefs.tempC'], ['f', 'prefs.tempF']].map(([value, label]) => <button key={value} type="button" className={formats.temp === value ? 'selected' : ''} aria-pressed={formats.temp === value}
            onClick={() => setFormat('temp', value)}>{t(label)}</button>)}
        </div>
      </div>

      <div className="prefs-group">
        <span className="prefs-label"><CalendarDays size={15}/>{t('prefs.date')}</span>
        <div className="segmented prefs-seg" role="group" aria-label={t('prefs.date')}>
          {[['locale', 'prefs.dateLocale'], ['iso', 'prefs.dateIso']].map(([value, label]) => <button key={value} type="button" className={formats.date === value ? 'selected' : ''} aria-pressed={formats.date === value}
            onClick={() => setFormat('date', value)}>{t(label)}</button>)}
        </div>
      </div>

      {ovHours != null && <div className="prefs-group">
        <span className="prefs-label"><ChartLine size={15}/>{t('prefs.chartPeriod')}</span>
        <div className="segmented prefs-seg" role="group" aria-label={t('prefs.chartPeriod')}>
          {[[24, 'prefs.periodDay'], [168, 'prefs.periodWeek'], [720, 'prefs.periodMonth']].map(([hours, label]) => <button key={hours} type="button" className={ovHours === hours ? 'selected' : ''} aria-pressed={ovHours === hours}
            onClick={() => pickOvHours(hours)}>{t(label)}</button>)}
        </div>
      </div>}

      {refreshSec != null && <div className="prefs-group">
        <span className="prefs-label"><RefreshCw size={15}/>{t('prefs.refresh')}</span>
        <div className="segmented prefs-seg" role="group" aria-label={t('prefs.refresh')}>
          {[[30, 'prefs.refresh30'], [60, 'prefs.refresh60'], [300, 'prefs.refresh300'], [0, 'prefs.refreshOff']].map(([seconds, label]) => <button key={seconds} type="button" className={refreshSec === seconds ? 'selected' : ''} aria-pressed={refreshSec === seconds}
            onClick={() => setRefreshSec(seconds)}>{t(label)}</button>)}
        </div>
        <small className="prefs-note">{t('prefs.refreshHint')}</small>
      </div>}

      <label className="prefs-switch">
        <Music2 size={15}/>
        <span><b>{t('prefs.music')}</b><small>{t('prefs.musicHint')}</small></span>
        <input type="checkbox" role="switch" checked={!musicHidden} aria-label={t('prefs.musicShow')} onChange={e => setMusicHidden(!e.target.checked)}/>
      </label>
    </div>}
  </div>;
}
