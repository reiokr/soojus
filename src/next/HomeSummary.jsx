import React from 'react';
import { CloudSun, Droplets, Fan, Flame, Home as HomeIcon, Thermometer } from 'lucide-react';
import { number, tempText } from '../lib.js';
import { t } from '../i18n/index.js';
import { pumpState, stateSentence } from './logic.js';
import { buildLiveState } from './live/state.js';
import SoundControl from './live/SoundControl.jsx';

const VENT_MODES = { Automaatne: 'vent.automatic', Manuaalne: 'vent.manual', Õhutus: 'vent.boost', Ülerõhk: 'vent.overpressure' };

// Illustratsioonide asemel näidatav info: samad põhiandmed ja lingid, ilma canvas'e ja animatsioonideta.
export default function HomeSummary({ ctx }) {
  const vent = ctx.airobot?.view?.configured ? ctx.airobot.view : null;
  const forecast = ctx.weather?.view?.weather ?? null, place = ctx.weather?.place ?? null;
  const state = pumpState(ctx.m);
  const live = buildLiveState({ m: ctx.m, climate: ctx.climate, vent, state, place, forecast });
  const ventMode = live.vent.modeText ? (VENT_MODES[live.vent.modeText] ? t(VENT_MODES[live.vent.modeText]) : live.vent.modeText) : t('live.ventLabel');
  const weather = live.weather;
  const tiles = [
    { id: 'indoor', icon: HomeIcon, label: t('live.indoor'), value: tempText(live.indoor, 1), page: 'ventilation' },
    { id: 'outdoor', icon: Thermometer, label: t('live.outdoor'), value: tempText(live.outdoor, 1), page: 'heating' },
    { id: 'water', icon: Droplets, label: t('live.water'), value: tempText(live.water, 1), note: live.waterTarget == null ? undefined : `${t('diag.waterTarget')} ${tempText(live.waterTarget, 0)}`, page: 'water' },
    { id: 'heat', icon: Flame, label: t('nav.heating'), value: tempText(live.supply, 1), note: live.returnT == null ? undefined : `${t('diag.return')} ${tempText(live.returnT, 1)}`, page: 'heating' },
    { id: 'vent', icon: Fan, label: t('live.ventLabel'), value: live.vent.present ? (live.vent.running ? `${live.vent.level}/10` : t('live.ventStopped')) : '—', note: live.vent.present ? `${ventMode} · CO₂ ${number(live.vent.co2, 0)} ppm` : undefined, page: 'ventilation' },
    { id: 'weather', icon: CloudSun, label: t('live.weather'), value: weather ? tempText(weather.temperature, 1) : '—', note: weather ? `${weather.label}${place?.name ? ` · ${place.name}` : ''}` : undefined, page: 'live' }
  ];
  return <section className="nx-panel nx-summary">
    <div className="nx-panel-head"><h2>{t('summary.title')}</h2><span className="nx-muted">{t('summary.hint')}</span></div>
    <div className="nx-summary-grid">
      {tiles.map(tile => {
        const Icon = tile.icon;
        return <button key={tile.id} type="button" className="nx-summary-tile" onClick={() => ctx.navigate(tile.page)} aria-label={t('summary.openAria', { page: tile.label })}>
          <small><Icon size={14}/>{tile.label}</small>
          <b>{tile.value}</b>
          {tile.note && <em>{tile.note}</em>}
        </button>;
      })}
    </div>
    <p className="nx-summary-status">{stateSentence(state, Boolean(ctx.online))}</p>
    {!ctx.musicHidden && <div className="nx-summary-music"><SoundControl/></div>}
  </section>;
}
