import { test } from 'node:test';
import assert from 'node:assert/strict';
import { date, enhance, estKey, clipSpans, targetLines, holdValues, plotKey, niceScale, timeTicks, mergeSeries, seriesStats, stateSpans, wzsvWorkState } from '../src/lib.js';

test('chart timestamps render as dates instead of raw Unix milliseconds',()=>{
  const ms = Date.parse('2026-09-24T10:00:00Z');
  assert.match(date(ms),/24\.09\.2026/);
  assert.equal(date('2026-09-24T10:00:00+0'),date('2026-09-24T10:00:00Z'));
});
test('WZSV water sensor is never presented as indoor air temperature',()=>{
  const [p] = enhance([{parameterId:'6',parameterName:'Tarbevesi- on',value:45,parameterUnit:'°C',scaleValue:'0.1',smartHomeCategories:['sh-hwTemp','sh-indoorTemp']}],'WZSV 92H3M');
  assert.equal(p.group,'Tarbevesi'); assert.equal(p.label,'Tarbevee temperatuur');
});

test('niceScale gives round ticks with padding and handles flat series',()=>{
  const s = niceScale(22.5,53.7); assert.ok(s.domain[0] <= 22.5 && s.domain[1] >= 53.7); assert.equal(s.decimals,0);
  const f = niceScale(45,45); assert.ok(f.domain[0] < 45 && f.domain[1] > 45);
  assert.equal(niceScale(0.1,0.7).decimals,1);
});
test('timeTicks aligns to round local times',()=>{
  const from = new Date(2026,8,29,10,17).getTime(), to = new Date(2026,8,30,10,17).getTime();
  const { ticks, step } = timeTicks(from,to,7);
  assert.equal(step,6*3600000); assert.ok(ticks.length >= 3 && ticks.length <= 8);
  assert.ok(ticks.every(t => new Date(t).getMinutes() === 0 && t >= from && t <= to));
});
test('mergeSeries breaks lines across long gaps instead of interpolating',()=>{
  const t = m => new Date(Date.UTC(2026,8,30,0,m)).toISOString();
  const rows = [{point:'a',time:t(0),value:1},{point:'a',time:t(5),value:2},{point:'a',time:t(180),value:3}];
  const data = mergeSeries(rows,['a'],60);
  const gap = data.find(r => r.gap); assert.ok(gap && gap.a == null && gap.time > Date.parse(t(5)) && gap.time < Date.parse(t(180)));
  assert.equal(data.filter(r => r.a != null).length,3);
  assert.deepEqual(seriesStats(data,'a'),{min:1,max:3,avg:2,last:3});
});
test('stateSpans holds the last state until the next change',()=>{
  const rows = [{time:'2026-09-30T00:00:00Z',value:5},{time:'2026-09-30T02:00:00Z',value:1},{time:'2026-09-30T03:00:00Z',value:5}];
  const from = Date.parse('2026-09-30T01:00:00Z'), to = Date.parse('2026-09-30T05:00:00Z');
  const spans = stateSpans(rows,from,to,wzsvWorkState);
  assert.deepEqual(spans.map(s => [s.kind,s.from,s.to]),[['idle',from,Date.parse('2026-09-30T02:00:00Z')],['hw',Date.parse('2026-09-30T02:00:00Z'),Date.parse('2026-09-30T03:00:00Z')],['idle',Date.parse('2026-09-30T03:00:00Z'),to]]);
});
test('interleaved series keep continuous lines while real values stay separate',()=>{
  const t = m => new Date(Date.UTC(2026,8,30,0,m)).toISOString();
  const rows = [{point:'a',time:t(0),value:10},{point:'b',time:t(5),value:1},{point:'a',time:t(10),value:20},{point:'b',time:t(15),value:3}];
  const data = mergeSeries(rows,['a','b'],60);
  const mid = data.find(r => r.time === Date.parse(t(5)));
  assert.equal(mid.a,undefined); assert.equal(mid[plotKey('a')],15);
  assert.equal(seriesStats(data,'a').avg,15);
});
test('target lines pair the water temperature with its setpoint and hold the last value',()=>{
  const pts = [{parameterId:'6',label:'Tarbevee temperatuur'},{parameterId:'5105',label:'Tarbevee sihttemperatuur',parameterUnit:'°C'}];
  assert.deepEqual(targetLines(pts,'WZSV 92H3M',['6']).map(x => x.id),['5105']);
  assert.deepEqual(targetLines(pts,'WZSV 92H3M',['6','5105']),[]);
  assert.deepEqual(targetLines(pts,'Muu',['6']),[]);
  const rows = [{time:'2026-09-30T00:00:00Z',value:40},{time:'2026-09-30T02:00:00Z',value:45}];
  assert.deepEqual(holdValues(rows,[Date.parse('2026-09-29T23:00:00Z'),Date.parse('2026-09-30T01:00:00Z'),Date.parse('2026-09-30T05:00:00Z')]),[null,40,45]);
});
test('long gaps get a separate estimate line and never touch the measured line',()=>{
  const t = m => new Date(Date.UTC(2026,8,30,0,m)).toISOString();
  const data = mergeSeries([{point:'a',time:t(0),value:10},{point:'a',time:t(120),value:30}],['a'],60);
  const first = data[0], last = data.at(-1), gap = data.find(r => r.gap);
  assert.equal(first[estKey('a')],10); assert.equal(last[estKey('a')],30);
  assert.equal(gap[estKey('a')],10); assert.equal(gap[plotKey('a')],undefined);
});
test('state spans are cut at data gaps',()=>{
  const out = clipSpans([{kind:'hw',from:0,to:100}],[{from:20,to:60}]);
  assert.deepEqual(out.map(s => [s.from,s.to]),[[0,20],[60,100]]);
  assert.deepEqual(clipSpans([{kind:'hw',from:0,to:10}],[{from:20,to:60}]).length,1);
});
test('niceScale does not go below zero for non-negative data such as power',()=>{
  assert.equal(niceScale(0,3.2).domain[0],0);
  assert.ok(niceScale(-2,3).domain[0] < 0);
});
test('fill times add empty rows so the cursor can land inside data gaps',()=>{
  const t = m => new Date(Date.UTC(2026,8,30,0,m)).toISOString();
  const rows = [{point:'a',time:t(0),value:10},{point:'a',time:t(300),value:20}];
  const data = mergeSeries(rows,['a'],60,[Date.parse(t(0)),Date.parse(t(100)),Date.parse(t(200)),Date.parse(t(300))]);
  const mid = data.find(r => r.time === Date.parse(t(100)));
  assert.ok(mid && mid.a === undefined && mid[plotKey('a')] === undefined && mid[estKey('a')] === 10);
});

import { pumpState, stateSentence, formatDuration, daySummary, tempColor, scalePosition, secondsAsText, dhwQuality, bufferQuality } from '../src/next/logic.js';
test('domestic hot water and buffer tank turn yellow and red as they fall below their setpoint',()=>{
  assert.equal(dhwQuality(48,48).key,'good'); assert.equal(dhwQuality(47.3,48).key,'good');
  assert.equal(dhwQuality(46,48).key,'high'); assert.equal(dhwQuality(45,48).key,'high'); assert.equal(dhwQuality(45,48).label,'soojeneb');
  assert.equal(dhwQuality(41,48).key,'bad'); assert.equal(dhwQuality(41,48).label,'alla sihi');
  assert.equal(dhwQuality(null,48),null); assert.equal(dhwQuality(45,null),null); assert.equal(dhwQuality(45,0),null);
  assert.equal(bufferQuality(28.4,27.3).key,'good');
  assert.equal(bufferQuality(25,27).key,'high'); assert.equal(bufferQuality(25,27).label,'jahtunud'); assert.equal(bufferQuality(24,27.3).key,'high');
  assert.equal(bufferQuality(18,27.3).key,'bad'); assert.equal(bufferQuality(18,27.3).label,'külm');
  assert.equal(bufferQuality(20,null),null); assert.equal(bufferQuality(null,27.3),null);
});
test('pump state and plain-language sentence',()=>{
  const idle = pumpState({ workMode:{value:5}, heatingState:{value:1}, hwState:{value:1} });
  assert.equal(idle.running,false); assert.match(stateSentence(idle,true),/puhkab/);
  const hw = pumpState({ workMode:{value:1}, heatingState:{value:1}, hwState:{value:3} });
  assert.equal(hw.hwOn,true); assert.match(stateSentence(hw,true),/tarbevett/);
  assert.match(stateSentence(idle,false),/võrguühenduseta/);
});
test('durations and water-time text are human readable',()=>{
  assert.equal(formatDuration(0),'0 min'); assert.equal(formatDuration(3600000),'1 h'); assert.equal(formatDuration(5400000),'1 h 30 min');
  assert.equal(secondsAsText(1800),'30 min'); assert.equal(secondsAsText(7200),'2 h'); assert.equal(secondsAsText(5400),'1 h 30 min');
});
test('day summary counts run time and hot-water cycles and skips data gaps',()=>{
  const at = h => Date.parse('2026-09-30T00:00:00Z') + h*3600000;
  const rows = [{time:new Date(at(0)).toISOString(),value:5},{time:new Date(at(2)).toISOString(),value:1},{time:new Date(at(3)).toISOString(),value:5},{time:new Date(at(10)).toISOString(),value:1},{time:new Date(at(11)).toISOString(),value:5}];
  const s = daySummary(rows,[],at(0),at(24));
  assert.equal(s.hwCycles,2); assert.equal(s.hwMs,2*3600000); assert.equal(s.runMs,2*3600000); assert.equal(s.coverage,1);
  const gapped = daySummary(rows,[{from:at(10),to:at(12)}],at(0),at(24));
  assert.equal(gapped.hwMs,3600000); assert.ok(Math.abs(gapped.coverage - 22/24) < 1e-9);
});
test('temperature colours are ordered from cold to hot',()=>{
  assert.equal(tempColor(10),'rgb(79,159,200)'); assert.equal(tempColor(80),'rgb(200,70,40)');
  assert.ok(scalePosition(15) === 0 && scalePosition(65) === 1 && scalePosition(40) === .5);
});

import { co2Quality, filterInfo, ventilationSentence, climate, daysWithMonths, bypassOpen, readingQuality } from '../src/ventilation-logic.js';
test('air quality bands, filter usage and the ventilation sentence',()=>{
  assert.equal(co2Quality(520).key,'good'); assert.equal(co2Quality(900).key,'ok'); assert.equal(co2Quality(1200).key,'high'); assert.equal(co2Quality(1800).key,'bad'); assert.equal(co2Quality(NaN).key,'unknown');
  const f = filterInfo(6462,8760); assert.equal(f.percent,74); assert.equal(f.leftDays,96); assert.equal(filterInfo(9000,8760).percent,100); assert.equal(filterInfo(1,0),null);
  assert.match(ventilationSentence({ modeText:'Automaatne', data:{ co2:520, fans:{ supplyLevel:1 }, switches:{ power:true } } }),/Automaatne, kiirus 1\/10, õhu kvaliteet hea \(CO₂ 520 ppm\)/);
  assert.match(ventilationSentence({ data:{ co2:520, switches:{ power:false } } }),/välja lülitatud/);
  assert.equal(ventilationSentence(null),'');
});
test('reading quality turns green, yellow and red as a value moves past its norm',()=>{
  // CO₂: samad piirid nagu kokkuvõttevärvil
  assert.equal(readingQuality('co2',720).key,'good'); assert.equal(readingQuality('co2',720).label,'normis');
  assert.equal(readingQuality('co2',900).key,'good'); assert.equal(readingQuality('co2',900).label,'rahuldav');
  assert.equal(readingQuality('co2',1150).key,'high'); assert.equal(readingQuality('co2',1600).key,'bad');
  // Niiskus: mugavusvahemik 30–60 %
  assert.equal(readingQuality('hum',46.3).key,'good');
  assert.equal(readingQuality('hum',65).key,'high'); assert.equal(readingQuality('hum',65).label,'niiske');
  assert.equal(readingQuality('hum',75).key,'bad'); assert.equal(readingQuality('hum',22).key,'bad'); assert.equal(readingQuality('hum',28).key,'high');
  // VOC: norm on seadme enda sihttase (vaikimisi 250)
  assert.equal(readingQuality('voc',150,200).key,'good');
  assert.equal(readingQuality('voc',240,200).key,'high');
  assert.equal(readingQuality('voc',497,200).key,'bad');
  assert.equal(readingQuality('voc',200,200).key,'good');
  assert.equal(readingQuality('voc',300).key,'high'); assert.equal(readingQuality('voc',400).key,'bad');
  // PM2,5: WHO soovitus 15 µg/m³, kollane kuni 35
  assert.equal(readingQuality('pm25',6).key,'good'); assert.equal(readingQuality('pm25',25).key,'high'); assert.equal(readingQuality('pm25',50).key,'bad');
  // Toatemperatuur: mugav 19–25 °C
  assert.equal(readingQuality('temp',22.9).key,'good');
  assert.equal(readingQuality('temp',26).key,'high'); assert.equal(readingQuality('temp',18).key,'high');
  assert.equal(readingQuality('temp',28).key,'bad'); assert.equal(readingQuality('temp',16).key,'bad');
  // Puuduv väärtus ei anna värvi
  assert.equal(readingQuality('hum',null),null); assert.equal(readingQuality('voc',undefined),null);
});
test('outdoor temperature comes from the heat pump and indoor temperature from the ventilation extract air',()=>{
  const vent = { data:{ temperatures:{ outside:15.7, extract:22.8 } } };
  assert.deepEqual(climate('17.2',vent),{ outdoor:17.2, outdoorSource:'soojuspump', indoor:22.8 });
  assert.deepEqual(climate(null,vent),{ outdoor:15.7, outdoorSource:'ventilatsioon', indoor:22.8 });
  assert.deepEqual(climate(undefined,null),{ outdoor:null, outdoorSource:null, indoor:null });
  assert.equal(climate('',{ data:{ temperatures:{ outside:null, extract:null } } }).indoor,null);
});
test('the bypass damper position is derived from the documented opening rule and heat recovery',()=>{
  const v = o => ({ switches:{ bypass:true }, temperatures:{ outside:16, extract:24 }, fans:{ supplyRpm:1200 }, heatRecovery:5, ...o });
  assert.equal(bypassOpen(v({})), true);                                  // >13 °C, jahedam kui tuba, soojustagastus puudub → avatud
  assert.equal(bypassOpen(v({ heatRecovery:80 })), false);                // soojustagastus toimib → suletud
  assert.equal(bypassOpen(v({ switches:{ bypass:false } })), false);      // automaatika väljas → alati suletud
  assert.equal(bypassOpen(v({ temperatures:{ outside:10, extract:24 } })), false); // liiga külm väljas → suletud
  assert.equal(bypassOpen(v({ temperatures:{ outside:26, extract:24 } })), false); // väljas soojem kui toas → suletud
  assert.equal(bypassOpen(v({ fans:{ supplyRpm:0 } })), null);            // seade seisab → asend teadmata
  assert.equal(bypassOpen(v({ temperatures:{ outside:null, extract:24 } })), null);
});

test('filter intervals are shown as days with months in brackets',()=>{
  assert.equal(daysWithMonths(8760),'365 päeva (12 kuud)');
  assert.equal(daysWithMonths(720),'30 päeva (1 kuu)');
  assert.equal(daysWithMonths(24),'1 päev (0 kuud)');
  assert.equal(daysWithMonths(6462),'269 päeva (8,8 kuud)');
  assert.equal(daysWithMonths(NaN),'—');
});

test('a heating mode with a stopped compressor is shown as waiting, not as heating', () => {
  const m = (mode, hs, hw, comp) => ({ workMode: { value: mode }, heatingState: { value: hs }, hwState: { value: hw }, compressor: comp == null ? undefined : { value: comp } });
  const waiting = pumpState(m(0, 3, 1, 0));
  assert.equal(waiting.heatOn, false); assert.equal(waiting.heatDemand, true); assert.equal(waiting.running, false); assert.equal(waiting.stalled, true);
  assert.match(stateSentence(waiting, true), /Küte on nõutud, aga kompressor seisab/);
  const hwWaiting = pumpState(m(1, 1, 3, 0)); assert.equal(hwWaiting.hwOn, false); assert.match(stateSentence(hwWaiting, true), /Tarbevee soojendus on nõutud/);
  const running = pumpState(m(0, 3, 1, 1)); assert.equal(running.heatOn, true); assert.equal(running.stalled, false); assert.match(stateSentence(running, true), /kütab praegu maja/);
  const unknown = pumpState(m(0, 3, 1, null)); assert.equal(unknown.heatOn, true, 'kompressori olek teadmata: vana käitumine');
  const idle = pumpState(m(5, 1, 1, 0)); assert.equal(idle.stalled, false); assert.equal(stateSentence(idle, true), 'Pump puhkab.');
});
