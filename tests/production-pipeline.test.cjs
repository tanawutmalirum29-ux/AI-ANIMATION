'use strict';
const assert=require('node:assert/strict');
const planner=require('../studio-production-planner.js');
const assets=require('../studio-production-assets.js');
const core=require('../studio-asset-core.js');
const qa=require('../studio-visual-qa.js');
const timing=require('../studio-timing-auditor.js');
const scene=(id,voiceover,other={})=>({id,duration:8,voiceover,subtitleCues:[],
 actors:[],props:[],customAssets:[],...other});
const src={project:{title:'สามแสงก่อนรุ่งสาง'},episodes:[{id:'ep1',scenes:[
 scene('s08','สะพานไม้ผุยุบตัว กล่องเครื่องมือหลุดมือลงน้ำ',{
  actors:[{char:'a',x:30,y:80},{char:'b',x:32,y:80}]}),
 scene('s11','แผ่นสะท้อนหมุนไปด้านข้าง แล้วไฟติดขึ้น'),
 scene('s12','สายพานขาด ทันใดนั้นแสงดับ'),
 scene('s15','หนึ่งวาบ สองวาบ สามวาบ ลำแสงพุ่งไกล'),
 scene('s17','น้ำทะลักเข้าตลาด'),
 scene('s18','คนสองคนเดินผ่านลาน',{actors:[{char:'x',x:20,y:80,pose:'walk'}]})
]}]};
const original=JSON.stringify(src);
assert.equal(planner.stages.length,6);
assert.deepEqual(planner.stages.map(s=>s.id),['composition','assets','motion','voice','timing','qa']);
const layout=planner.plan(src,'composition',assets);
assert.equal(layout.ops.length,1);
assert.equal(layout.ops[0].patch.actors[1].x,45);
assert.equal(JSON.stringify(src),original,'composition planner is read-only');
const applied=structuredClone(src);
for(const op of layout.ops)Object.assign(applied.episodes[0].scenes.find(s=>s.id===op.id),op.patch);
const drawable=planner.plan(applied,'assets',assets);
assert.ok(drawable.ops.length>=4,'required story events receive draft SVGs');
for(const op of drawable.ops){
 const target=applied.episodes[0].scenes.find(x=>x.id===op.id);
 target.customAssets=op.patch.customAssets;
 for(const item of target.customAssets){
  assert.doesNotThrow(()=>core.asset(item.asset),'all shapes must obey existing safe SVG schema');
  assert.ok(item.motionKeys?.length>=2,'generated visual event must have keyframes');
 }
}
assert.equal(planner.plan(applied,'assets',assets).ops.length,0,'reruns must be idempotent');
const key=applied.episodes[0].scenes.find(x=>x.id==='s15');
const beacon=key.customAssets.find(x=>x.eventKind==='beacon');
assert.ok(beacon,'explicit 3 flashes created');
const time=assets.beats('beacon',8);
assert.equal(time.filter(x=>x.opacity===1).length,6);
const off=core.sceneMarkup(key,'back',60,0);
const on=core.sceneMarkup(key,'back',60,time[2].t);
assert.match(off,/opacity="0.000"/);
assert.match(on,/opacity="1.000"/,'preview and export must reveal the light on a timed beat');
assert.notEqual(off,on,'SVG animation must respond to real scene time');
const timedScene=structuredClone(key);
timedScene.audioClips=[{kind:'voice',data:'data:audio/wav;base64,AAAA',duration:2,at:0,rate:1}];
const timedState={episodes:[{id:'timed',scenes:[timedScene]}]};
assert.equal(timing.hasTimedEvents(timedScene),true,'asset keyframes protect visual events');
assert.equal(timing.audit(timedState,{scope:'all'}).ops.length,0,
 'audio-aware timing must not cut three light flashes just because narration ended early');
const move=planner.plan(applied,'motion',assets);
assert.equal(move.ops.length,1);
assert.equal(move.ops[0].id,'s18');
assert.ok(move.ops[0].patch.actors[0].motionKeys.length===2);
const fx=qa.inspect(applied,{scope:'all'});
assert.ok(fx.inspected>=6);
const locked={episodes:[{scenes:[scene('locked','สะพานพัง กล่องเครื่องมือหล่น',{
  image:'data:image/png;base64,AAAA',customAssets:[]})]}]};
assert.equal(planner.plan(locked,'assets',assets).ops.length,0);
assert.ok(planner.plan(locked,'assets',assets).warnings.length);
const existing={episodes:[{scenes:[scene('manual','สะพานพัง',{customAssets:[{
  asset:assets.item({duration:8},'bridge').asset,eventKind:'bridge'
 }]})]}]};
assert.equal(planner.plan(existing,'assets',assets).ops.length,0,'do not duplicate curated props');
assert.equal(JSON.stringify(src),original,'source JSON and narration never changed by planning');
console.log('PASS: six stage plans; idempotent bounded SVG+motion, opacity flashes, original JSON preserved');
