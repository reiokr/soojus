import React, { useEffect, useState } from 'react';
import { AlertCircle, Clock3 } from 'lucide-react';
import { api, date, number } from '../lib.js';
import { formatDuration } from './logic.js';
import { t } from '../i18n/index.js';

const PERIODS = [[1, 'dhw.d1'], [7, 'dhw.d7'], [30, 'dhw.d30']];

const statusOf = cycle => cycle.ongoing ? 'ongoing' : cycle.reachedTarget ? 'reached' : 'stopped';

export default function DhwCycles({ ctx }) {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!ctx.selection) return undefined;
    let live = true;
    const controller = new AbortController();
    setData(null); setError(null);
    api(`/dhw/cycles?device=${encodeURIComponent(ctx.selection)}&days=${days}`, { signal: controller.signal })
      .then(result => { if (live) setData(result); })
      .catch(e => { if (live && !controller.signal.aborted) setError(e.message); });
    return () => { live = false; controller.abort(); };
  }, [ctx.selection, days, ctx.tick]);

  const period = <div className="segmented" role="group" aria-label={t('dhw.title')}>
    {PERIODS.map(([value, key]) => <button key={value} type="button" className={days === value ? 'selected' : ''} aria-pressed={days === value} onClick={() => setDays(value)}>{t(key)}</button>)}
  </div>;

  if (error) return <section className="nx-panel dhw-cycles"><div className="nx-panel-head"><h2>{t('dhw.title')}</h2>{period}</div><p className="nx-warn"><AlertCircle size={15}/>{t('dhw.error', { error })}</p></section>;
  if (!data) return <section className="nx-panel dhw-cycles"><div className="nx-panel-head"><h2>{t('dhw.title')}</h2>{period}</div><div className="nx-skeleton" aria-label={t('dhw.loading')}><i/></div></section>;

  const summary = data.summary || { count: 0, reached: 0, ongoing: 0 };
  const cycles = [...(data.cycles || [])].reverse();
  return <section className="nx-panel dhw-cycles">
    <div className="nx-panel-head"><h2>{t('dhw.title')}</h2>{period}</div>
    <p className="en-note">{t('dhw.hint')}</p>
    {cycles.length ? <>
      <div className="dhw-summary">
        <span>{t('dhw.summary', { count: summary.count, reached: summary.reached, ongoing: summary.ongoing })}</span>
        {summary.avgDurationMinutes != null && <span><Clock3 size={13}/>{t('dhw.avg', { duration: formatDuration(summary.avgDurationMinutes * 60000) })}</span>}
        {summary.avgPauseMinutes != null && <span>{t('dhw.avgPause', { duration: formatDuration(summary.avgPauseMinutes * 60000) })}</span>}
      </div>
      <ul className="dhw-cycle-list">
        {cycles.map(cycle => {
          const status = statusOf(cycle);
          const target = cycle.maxTarget ?? cycle.target;
          return <li className="dhw-cycle-row" key={cycle.start}>
            <div className="dhw-cycle-head">
              <time dateTime={cycle.start}>{date(cycle.start)}</time>
              <span className={`dhw-badge ${status}`}>{t(`dhw.${status}`)}</span>
            </div>
            <div className="dhw-cycle-temps">
              <span>{t('dhw.start')} <b>{number(cycle.startTemp)}°</b></span>
              <span>{t('dhw.min')} <b>{number(cycle.minTemp)}°</b></span>
              <span>{t('dhw.max')} <b>{number(cycle.maxTemp)}°</b></span>
              <span>{t('dhw.target')} <b>{target == null ? '—' : `${number(target)}°`}</b></span>
              <span>{t('dhw.duration')} <b>{formatDuration(cycle.durationMinutes * 60000)}</b></span>
            </div>
            <div className="dhw-cycle-bar" role="img" aria-label={t('dhw.barAria', { heat: formatDuration(cycle.heatingMinutes * 60000), pause: formatDuration(cycle.pauseMinutes * 60000) })}>
              {(cycle.segments || []).map((segment, index) => <i key={`${segment.from}-${index}`} className={segment.type} style={{ flexGrow: Math.max(1, segment.minutes) }} title={`${t(segment.type === 'heat' ? 'dhw.heating' : 'dhw.pause')} ${formatDuration(segment.minutes * 60000)}`}/>)}
            </div>
            <div className="dhw-cycle-meta">
              {t('dhw.heating')} {formatDuration(cycle.heatingMinutes * 60000)}
              {' · '}{t('dhw.pause')} {formatDuration(cycle.pauseMinutes * 60000)}
              {cycle.pauseCount > 0 ? ` · ${t('dhw.pauses', { count: cycle.pauseCount })}` : ''}
            </div>
          </li>;
        })}
      </ul>
      <p className="en-note">{t('dhw.note')}</p>
    </> : <p className="nx-muted">{t('dhw.empty')}</p>}
  </section>;
}
