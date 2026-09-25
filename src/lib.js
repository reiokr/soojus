export async function api(url, options = {}) {
  const response = await fetch(`/api${url}`, { ...options, headers: { 'Content-Type': 'application/json', 'X-Soojus-Request': '1', ...options.headers }, signal: options.signal || AbortSignal.timeout(40000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Päring ebaõnnestus.');
  return data;
}
export const number = (n, decimals = 1) => n == null || n === '' || !Number.isFinite(Number(n)) ? '—' : new Intl.NumberFormat('et-EE', { maximumFractionDigits: decimals }).format(Number(n));
export function date(value, options = {}) {
  if (!value) return '—';
  const d = new Date(typeof value === 'number' ? value : String(value).replace(/\+0$/, '+00:00'));
  return Number.isNaN(d.valueOf()) ? String(value) : new Intl.DateTimeFormat('et-EE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', ...options }).format(d);
}
export const time = value => value ? new Intl.DateTimeFormat('et-EE', { hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—';
export const enumText = text => ({ off: 'Väljas', on: 'Sees', heat: 'Kütmine', cool: 'Jahutamine', auto: 'Automaatne', Party: 'Peorežiim', Normal: 'Tavarežiim', Default: 'Vaikimisi', Home: 'Kodus', Away: 'Eemal', Vacation: 'Puhkus' }[text] || text);
// This model exposes missing category translations and several ambiguous names.
// Only confirmed WZSV 92H3M ids get these presentation aliases. Every other model uses API metadata.
const aliases = { '0': 'Pealevool', '1': 'Tagasivool', '2': 'Tagasivoolu siht', '3': 'Akupaagi temperatuur', '6': 'Tarbevee temperatuur', '7': 'Tarbevee siht', '17': 'Seadme tööolek', '21': 'Hetkevõimsus', '31': 'Vooluhulk', '39': 'Välisõhu keskmine', '46': 'Tarbevee olek', '5001': 'Kütte temperatuuri nihe', '5003': 'Kütte töörežiim', '5004': 'Tarbevee töörežiim', '5105': 'Tarbevee sihttemperatuur', '5700': 'Kütte välisõhupiir', '6146': 'Kõrgendatud tarbevee siht', '6147': 'Ekstra sooja vee kestus', '40001': 'Kütteringi režiim', '40007': 'Tarbeveetsooni režiim', '40009': 'Kõrgendatud tarbevee režiim', '40010': 'Tarbeveetsooni temperatuur' };
export function enhance(points, model) {
  const wzsv = model === 'WZSV 92H3M';
  return points.map(p => {
    const scale = Number(p.scaleValue ?? 1);
    const scaled = x => x == null ? null : Number((Number(x) * scale).toFixed(8));
    const id = p.parameterId;
    let group = 'Muu';
    if (p.smartHomeCategories?.some(c => /hw/.test(c)) || /tarbe|boiler|soe vesi/i.test(p.parameterName) || wzsv && ['5105','6146','6147','40007','40009','40010'].includes(id)) group = 'Tarbevesi';
    else if (/välis|keskmine temp/i.test(p.parameterName) || p.smartHomeCategories?.includes('sh-outdoorTemp')) group = 'Väliskliima';
    else if (/töötun|impulsid|tööaeg/i.test(p.parameterName)) group = 'Töötunnid';
    else if (/rõhu|kaitse|^EVU|^Sul\//i.test(p.parameterName)) group = 'Sisendid';
    else if (p.enumValues?.length && !p.writable && !/olek|olukord|veateade/i.test(p.parameterName)) group = 'Väljundid';
    else if (/küt|pealev|tagasiv|akupaak/i.test(p.parameterName) || wzsv && ['5001','5003','40001'].includes(id)) group = 'Küte';
    else if (p.parameterUnit === '°C') group = 'Temperatuurid';
    else if (p.parameterUnit === 'kW' || p.parameterUnit === 'kWh') group = 'Energia';
    else if (/olek|olukord|veateade/i.test(p.parameterName)) group = 'Olek';
    return { ...p, label: wzsv && aliases[id] || p.parameterName, group, min: scaled(p.minValue), max: scaled(p.maxValue), step: scaled(p.stepValue), display: p.enumValues?.length ? enumText(p.enumValues.find(e => String(e.value) === String(p.value))?.text || p.strVal) : p.strVal ?? String(p.value ?? '—') };
  });
}
export function metric(points, model, id, category, pattern) {
  return (model === 'WZSV 92H3M' && points.find(p => p.parameterId === id)) || points.find(p => p.smartHomeCategories?.includes(category)) || points.find(p => pattern?.test(p.parameterName));
}
