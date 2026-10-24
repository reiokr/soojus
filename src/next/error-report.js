// Vigade analüüsi raport: struktuurne mudel + kolm väljundit:
//  - buildReportText  – tavaline tekst (e-kirja keha jaoks, ilma torutabeliteta)
//  - buildReportHtml  – kena HTML (eelvaade, kopeerimine, printimine, .html fail)
//  - buildErrorReport – vana tekstilise raporti ühilduvus
import { number } from '../lib.js';
import { t, getLocale } from '../i18n/index.js';

const pad = n => String(n).padStart(2, '0');
const stamp = (iso, withTime = true) => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}${withTime ? ` ${pad(d.getHours())}:${pad(d.getMinutes())}` : ''}`;
};
const esc = value => String(value ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const REPORT_RECOMMENDATIONS = { 765: 'rep.rec765', 762: 'rep.rec762', 763: 'rep.rec763', 715: 'rep.rec715', 721: 'rep.rec721' };

// Automaatsed tähelepanekud: ainult selgelt eristuvad erinevused, et raport ei oleks müra.
export function reportObservations(cmp) {
  if (!cmp) return [];
  const g = id => cmp.params?.[id] || null;
  const out = [];
  const p = g('21'), b = g('brine_in'), s = g('brine_spread'), l = g('pressure_low'), h = g('pressure_high'), hg = g('hot_gas');
  if (p && p.base != null && p.error < p.base * 0.75) out.push(t('rep.obsLowLoad', { error: number(p.error, 1), base: number(p.base, 1) }));
  if (b && b.base != null && b.error > b.base + 1) out.push(t('rep.obsBrineWarmer', { error: number(b.error, 1), base: number(b.base, 1) }));
  if (s && s.base != null && s.error < s.base - 0.5) out.push(t('rep.obsSpreadSmaller', { error: number(s.error, 1), base: number(s.base, 1) }));
  if (l && l.base != null && l.error > l.base + 0.5) out.push(t('rep.obsLowPressure', { error: number(l.error, 2), base: number(l.base, 2) }));
  if (h && h.base != null && h.error < h.base - 2) out.push(t('rep.obsHighPressure', { error: number(h.error, 2), base: number(h.base, 2) }));
  if (hg && hg.base != null && hg.error < hg.base - 5) out.push(t('rep.obsHotGas', { error: number(hg.error, 1), base: number(hg.base, 1) }));
  return out;
}

export function buildReportModel({ data, code, device = {}, now = new Date(), notes = '' }) {
  if (!data) return null;
  const total = data.codes.reduce((n, c) => n + c.n, 0);
  const cmp = data.compare.find(c => c.code === code) || data.compare[0];
  const last = data.codes[0]?.last || null;
  return {
    device: [device.model, device.serial && `SN ${device.serial}`, device.firmware && t('rep.firmware', { version: device.firmware })].filter(Boolean).join(' · '),
    period: t('rep.period', { period: `${stamp(data.from, false)} – ${stamp(now, false)}`, days: data.days }),
    days: data.days,
    created: stamp(now),
    total,
    codes: data.codes,
    last,
    daysSince: last ? Math.max(0, Math.floor((now - Date.parse(last)) / 86400000)) : null,
    cmp: cmp ? {
      code: cmp.code,
      rows: data.params.map(p => {
        const v = cmp.params[p.id];
        if (!v) return null;
        return { label: p.label, unit: p.unit, error: v.error, base: v.base, delta: v.base == null ? null : v.error - v.base };
      }).filter(Boolean),
      observations: reportObservations(cmp),
      recommendation: REPORT_RECOMMENDATIONS[cmp.code] ? t(REPORT_RECOMMENDATIONS[cmp.code]) : ''
    } : null,
    errors: data.errors,
    notes: String(notes || '').trim()
  };
}

const ctxLine = e => {
  const n = (id, d = 1) => e.ctx[id] == null ? null : `${number(e.ctx[id], d)}`;
  const parts = [];
  if (n('brine_in') != null) parts.push(t('rep.ctxBrine', { value: n('brine_in') }));
  if (n('brine_spread') != null) parts.push(t('rep.ctxSpread', { value: n('brine_spread') }));
  if (n('suction_comp') != null) parts.push(t('rep.ctxSuction', { value: n('suction_comp') }));
  if (n('pressure_low', 2) != null && n('pressure_high', 2) != null) parts.push(`${n('pressure_low', 2)}/${n('pressure_high', 2)} bar`);
  if (n('21', 2) != null) parts.push(`${n('21', 2)} kW`);
  if (n('5') != null) parts.push(t('rep.ctxOutdoor', { value: n('5') }));
  return parts.join(' · ');
};

export function buildReportText(model) {
  if (!model) return '';
  const lines = [];
  lines.push(t('rep.titleUpper'));
  lines.push('');
  if (model.device) lines.push(t('rep.device', { device: model.device }));
  lines.push(model.period);
  lines.push(t('rep.created', { created: model.created }));
  lines.push('');
  lines.push(t('rep.summary'));
  if (!model.total) lines.push(t('rep.none'));
  else {
    lines.push(t('rep.total', { total: model.total, codes: model.codes.map(c => `${c.code} × ${c.n}`).join(', ') }));
    if (model.last) lines.push(t('rep.last', { time: stamp(model.last), ago: model.daysSince == null ? '' : t('rep.daysAgo', { days: model.daysSince }) }));
  }
  lines.push('');
  if (model.cmp && model.total) {
    lines.push(t('rep.context', { code: model.cmp.code }));
    for (const r of model.cmp.rows) {
      const d = r.delta == null ? '' : t('rep.rowDelta', { delta: `${r.delta > 0 ? '+' : ''}${number(r.delta, 1)} ${r.unit}` });
      lines.push(t('rep.row', { label: r.label, error: number(r.error, 1), unit: r.unit, base: r.base == null ? '—' : `${number(r.base, 1)} ${r.unit}`, delta: d }));
    }
    lines.push('');
    if (model.cmp.observations.length) {
      lines.push(t('rep.observations'));
      for (const o of model.cmp.observations) lines.push(`- ${o}`);
      lines.push('');
    }
    if (model.cmp.recommendation) { lines.push(t('rep.recommendation', { text: model.cmp.recommendation })); lines.push(''); }
  }
  if (model.total) {
    lines.push(t('rep.errors'));
    for (const e of model.errors) {
      const ctx = ctxLine(e);
      lines.push(`${stamp(e.time)} · ${e.code} · ${e.mode || '—'}${ctx ? ` · ${ctx}` : ''}`);
    }
    lines.push('');
  }
  if (model.notes) { lines.push(t('rep.notes')); lines.push(model.notes); lines.push(''); }
  lines.push(t('rep.method'));
  lines.push(t('rep.methodBody'));
  return lines.join('\n');
}

const S = {
  h1: 'font:600 20px/1.3 -apple-system,Segoe UI,Roboto,sans-serif;margin:0 0 4px;color:#1f3347',
  h2: 'font:700 11px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#6f6a5e;margin:22px 0 6px',
  p: 'margin:0 0 4px;color:#1f3347',
  meta: 'margin:0 0 2px;color:#6f6a5e;font-size:12.5px',
  table: 'width:100%;border-collapse:collapse;font-size:12.5px;margin:6px 0',
  th: 'text-align:left;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#6f6a5e;padding:6px 8px;border-bottom:1.5px solid #cfc3a9',
  td: 'padding:6px 8px;border-bottom:1px solid #e2d8c4;color:#1f3347;vertical-align:top',
  num: 'text-align:right;white-space:nowrap',
  ul: 'margin:4px 0 0;padding-left:18px;color:#1f3347',
  li: 'margin:2px 0',
  rec: 'margin-top:8px;padding:10px 12px;background:#f4efe4;border-left:3px solid #1f3347;color:#1f3347',
  note: 'margin-top:10px;color:#6f6a5e;font-size:12px'
};

const cell = (text, align = false) => `<td style="${S.td}${align ? `;${S.num}` : ''}">${esc(text)}</td>`;
const table = (head, rows) => `<table style="${S.table}"><thead><tr>${head.map(h => `<th style="${S.th}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => cell(c, i > 0)).join('')}</tr>`).join('')}</tbody></table>`;

export function buildReportHtml(model) {
  if (!model) return '';
  const h = [];
  h.push(`<h1 style="${S.h1}">${t('rep.title')}</h1>`);
  if (model.device) h.push(`<p style="${S.meta}">${t('rep.device', { device: esc(model.device) })}</p>`);
  h.push(`<p style="${S.meta}">${esc(model.period)} · ${t('rep.created', { created: esc(model.created) })}</p>`);
  h.push(`<h2 style="${S.h2}">${t('rep.summaryTitle')}</h2>`);
  if (!model.total) h.push(`<p style="${S.p}">${t('rep.none')}</p>`);
  else {
    h.push(`<p style="${S.p}">${t('rep.totalHtml', { total: model.total, codes: esc(model.codes.map(c => `${c.code} × ${c.n}`).join(', ')) })}</p>`);
    if (model.last) h.push(`<p style="${S.p}">${t('rep.last', { time: esc(stamp(model.last)), ago: model.daysSince == null ? '' : t('rep.daysAgo', { days: model.daysSince }) })}</p>`);
  }
  if (model.cmp && model.total) {
    h.push(`<h2 style="${S.h2}">${t('rep.contextTitle', { code: model.cmp.code })}</h2>`);
    h.push(`<p style="${S.meta}">${t('rep.contextMeta')}</p>`);
    h.push(table([t('rep.colParam'), t('rep.colError'), t('rep.colBase'), t('rep.colDelta')], model.cmp.rows.map(r => [
      r.label,
      `${number(r.error, 1)} ${r.unit}`,
      r.base == null ? '—' : `${number(r.base, 1)} ${r.unit}`,
      r.delta == null ? '—' : `${r.delta > 0 ? '+' : ''}${number(r.delta, 1)} ${r.unit}`
    ])));
    if (model.cmp.observations.length) {
      h.push(`<h2 style="${S.h2}">${t('rep.observationsTitle')}</h2>`);
      h.push(`<ul style="${S.ul}">${model.cmp.observations.map(o => `<li style="${S.li}">${esc(o)}</li>`).join('')}</ul>`);
    }
    if (model.cmp.recommendation) h.push(`<div style="${S.rec}"><b>${t('rep.recommendationTitle')}</b> ${esc(model.cmp.recommendation)}</div>`);
  }
  if (model.total) {
    h.push(`<h2 style="${S.h2}">${t('rep.errorsTitle')}</h2>`);
    h.push(table([t('rep.colTime'), t('rep.colCode'), t('rep.colMode'), t('rep.colBrine'), t('rep.colSpread'), t('rep.colSuction'), t('rep.colLow'), t('rep.colHigh'), t('rep.colPower'), t('rep.colOutdoor')], model.errors.map(e => [
      stamp(e.time), String(e.code), e.mode || '—',
      e.ctx.brine_in == null ? '—' : number(e.ctx.brine_in, 1),
      e.ctx.brine_spread == null ? '—' : number(e.ctx.brine_spread, 1),
      e.ctx.suction_comp == null ? '—' : number(e.ctx.suction_comp, 1),
      e.ctx.pressure_low == null ? '—' : number(e.ctx.pressure_low, 2),
      e.ctx.pressure_high == null ? '—' : number(e.ctx.pressure_high, 2),
      e.ctx['21'] == null ? '—' : number(e.ctx['21'], 2),
      e.ctx['5'] == null ? '—' : number(e.ctx['5'], 1)
    ])));
  }
  if (model.notes) { h.push(`<h2 style="${S.h2}">${t('rep.notesTitle')}</h2>`); h.push(`<p style="${S.p}">${esc(model.notes).replace(/\n/g, '<br>')}</p>`); }
  h.push(`<p style="${S.note}">${t('rep.methodNote', { text: t('rep.methodBody') })}</p>`);
  return h.join('\n');
}

// Täisdokument printimiseks, allalaadimiseks ja rikka tekstina kopeerimiseks.
export function buildReportDocument(model) {
  return `<!doctype html><html lang="${getLocale()}"><head><meta charset="utf-8"><title>${t('rep.title')}</title></head><body style="margin:0;background:#fff"><div style="max-width:860px;margin:28px auto;padding:0 22px;font:13px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:#1f3347">${buildReportHtml(model)}</div></body></html>`;
}

// Vana tekstilise raporti liides (kasutatakse mujal/vanades testides).
export function buildErrorReport({ data, code, device = {}, now = new Date() }) {
  return buildReportText(buildReportModel({ data, code, device, now }));
}
