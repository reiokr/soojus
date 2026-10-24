// Vigade analüüs: iga pumba vea kohta vaatame töötingimusi vahetult enne viga ja võrdleme
// tavalise tööga. Nii saab hinnata, kas viga seostub koormuse, soojakandja temperatuuri,
// rõhkude või režiimiga – ilma et peaks käsitsi ajalugu läbi kammima.

// Numbrilised parameetrid, mida vea kontekstis keskmistatakse.
export const ANALYSIS_PARAMS = [
  ['brine_in', 'Soojakandja maast', '°C'],
  ['brine_out', 'Soojakandja maasse', '°C'],
  ['brine_spread', 'Soojakandja ΔT', 'K'],
  ['brine_spread_set', 'ΔT siht', 'K'],
  ['suction_comp', 'Imemistemperatuur', '°C'],
  ['pressure_low', 'Madalrõhk', 'bar'],
  ['pressure_high', 'Kõrgrõhk', 'bar'],
  ['hot_gas', 'Kuumgaas', '°C'],
  ['21', 'Soojusvõimsus', 'kW'],
  ['5', 'Välisõhk', '°C'],
  ['6', 'Tarbevesi', '°C']
];

export const MODE_NAMES = {
  0: 'Kütterežiim', 1: 'Soe tarbevesi', 2: 'Basseiniküte', 3: 'EVU', 4: 'Sulatus', 5: 'Puudub vajadus', 6: 'Lisaküte', 7: 'Jahutus'
};

// Vea-eelne aken: vaikimisi 35 min kuni 5 min enne viga. Viimased 5 min jätame välja, sest
// seade võib olla juba seiskunud ja rõhud on jõudnud ühtlustuda.
export function errorWindow(time, minutes = 35, skip = 5) {
  const t = Date.parse(time);
  if (!Number.isFinite(t)) return null;
  return { from: new Date(t - minutes * 60000).toISOString(), to: new Date(t - skip * 60000).toISOString() };
}

export const mean = values => {
  const v = values.filter(x => x != null && x !== '').map(Number).filter(Number.isFinite);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
