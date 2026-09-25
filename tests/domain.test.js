import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePoint, pointBounds, validateZone, pointResults, csvCell } from '../server/domain.js';

test('WZSV v2 bounds are raw, display values and writes are scaled', () => {
  const p = { writable:true, minValue:300, maxValue:650, stepValue:5, scaleValue:'0.1', value:45 };
  assert.deepEqual(pointBounds(p), { min:30, max:65, step:0.5 });
  assert.equal(validatePoint(p,45.5),'45.5');
  assert.throws(()=>validatePoint(p,455));
  assert.throws(()=>validatePoint(p,45.2));
  assert.throws(()=>validatePoint(p,''));
  assert.throws(()=>validatePoint(p,Infinity));
});
test('negative heat offsets and zero are valid at the advertised step',()=>{
  const p={writable:true,minValue:-50,maxValue:50,stepValue:5,scaleValue:'0.1'};
  assert.equal(validatePoint(p,-4.5),'-4.5');assert.equal(validatePoint(p,0),'0');assert.throws(()=>validatePoint(p,-6));
});
test('enum writes use actual values and reject labels, unknown values and read-only points',()=>{
  const p={writable:true,enumValues:[{value:'0',text:'Väljas'},{value:'1',text:'Sees'}]};
  assert.equal(validatePoint(p,1),'1');assert.throws(()=>validatePoint(p,'Sees'));assert.throws(()=>validatePoint(p,2));assert.throws(()=>validatePoint({...p,writable:false},1));assert.throws(()=>validatePoint(undefined,1));
});
test('partial API replies never claim full success',()=>{
  const r=pointResults({'1':'modified','2':'error'},['1','2','3']);
  assert.deepEqual(r.map(x=>x.success),[true,false,false]);assert.equal(r[2].status,'unknown');
});
test('zones validate supported modes and each advertised setpoint',()=>{
  const z={supportedModes:'off,on,heat',setpointHeat:45,setpointCool:null,setpointRangeMin:30,setpointRangeMax:65};
  assert.deepEqual(validateZone(z,{setpointHeat:45.5,mode:'heat'}),{setpointHeat:45.5,mode:'heat'});
  for(const p of [{setpointHeat:90},{setpointHeat:''},{setpointCool:22},{mode:'cool'},{}])assert.throws(()=>validateZone(z,p));
});
test('CSV exports quote data and neutralize spreadsheet formulas',()=>{
  assert.equal(csvCell('=CMD()'),'"\'=CMD()"');assert.equal(csvCell('a"b'),'"a""b"');assert.equal(csvCell(-5),'"-5"');
});
