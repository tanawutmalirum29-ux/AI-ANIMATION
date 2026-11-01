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
assert.ok(layout.ops[0].patch.actors[1].x-layout.ops[0].patch.actors[0].x>=12-.05,
 'landscape composer must create at least 12 units between actors');
assert.equal(JSON.stringify(src),original,'composition planner is read-only');
const walking={project:{aspect:'9:16'},episodes:[{scenes:[scene('s07','นิลและตาอินวิ่งฝ่าฝน',{actors:[
 {char:'nil',x:18,y:90,toX:57,pose:'run'},
 {char:'ta_in',x:12,y:90,toX:48,pose:'walk'}
]})]}]};
const fixedWalk=planner.plan(walking,'composition',assets);
assert.equal(fixedWalk.ops.length,1,'real source overlap can be safely corrected');
const movedWalk=fixedWalk.ops[0].patch.actors;
assert.ok(Math.abs(movedWalk[0].x-movedWalk[1].x)>=23.9,
 'portrait characters must start 24 units apart rather than old 12');
assert.equal(movedWalk[0].toX-movedWalk[0].x,39,
 'Nil retains her authored walk displacement');
assert.equal(movedWalk[1].toX-movedWalk[1].x,36,
 'Ta In retains his authored walk displacement');
assert.ok(movedWalk.every(a=>a.x>=11&&a.toX<=89),
 'portrait endpoints must stay within visible margins');
const appliedWalk=structuredClone(walking);
Object.assign(appliedWalk.episodes[0].scenes[0],fixedWalk.ops[0].patch);
assert.equal(planner.plan(appliedWalk,'composition').ops.length,0,
 'repeated production must not keep shifting actors');

const three={project:{aspect:'9:16'},episodes:[{scenes:[scene('three','ตัวละครสามคนขึ้นเขา',{actors:[
 {char:'ta_in',x:12,y:90,toX:48,pose:'walk'},
 {char:'nil',x:18,y:90,toX:57,pose:'run'},
 {char:'moss',x:37,y:90,pose:'point'}
]})]}]};
const triple=planner.plan(three,'composition');
assert.equal(triple.ops.length,1);

// Arrival gap: two walkers that START apart but CONVERGE must also be separated
// at the end, with authored travel distances unchanged and the result idempotent.
const converge={project:{aspect:'9:16'},episodes:[{scenes:[scene('converge','สองคนเดินเข้าหากัน',{actors:[
 {char:'nil',x:15,y:90,toX:50,pose:'walk'},
 {char:'ta_in',x:60,y:90,toX:55,pose:'walk'}
]})]}]};
const conv=planner.plan(converge,'composition');
assert.equal(conv.ops.length,1,'arrival overlap is corrected');
const ca=conv.ops[0].patch.actors;
assert.ok(Math.abs(ca[0].x-ca[1].x)>=23.9&&Math.abs(ca[0].toX-ca[1].toX)>=23.9,
 'start and arrival gaps are both portrait-safe');
assert.equal(ca[0].toX-ca[0].x,35,'authored travel distance is kept');
assert.equal(ca[1].toX-ca[1].x,-5,'authored travel distance is kept');
const convApplied=structuredClone(converge);
Object.assign(convApplied.episodes[0].scenes[0],conv.ops[0].patch);
assert.equal(planner.plan(convApplied,'composition').ops.length,0,'arrival fix is idempotent');
// Unfixable crossing path is reported for a human, never silently rewritten.
const cross={project:{aspect:'9:16'},episodes:[{scenes:[scene('cross','เดินสวนกัน',{actors:[
 {char:'nil',x:30,y:90,toX:70,pose:'walk',lockPosition:true},
 {char:'ta_in',x:70,y:90,toX:30,pose:'walk',lockPosition:true}
]})]}]};
const crossPlan=planner.plan(cross,'composition');
assert.equal(crossPlan.ops.length,0,'locked actors are untouched');
assert.ok(crossPlan.warnings.some(w=>/เส้นทางเดินตัดผ่านกัน/.test(w)),'crossing paths are flagged');

const sorted=triple.ops[0].patch.actors.map(a=>a.x).sort((a,b)=>a-b);
assert.ok(sorted.every((x,i)=>i===0||x-sorted[i-1]>=23.9),
 'all three characters are separated, not just the first colliding pair');
assert.ok(triple.ops[0].patch.actors.every(a=>a.x>=11&&a.x<=89));
const contact={project:{aspect:'9:16'},episodes:[{scenes:[
 scene('transfer','ตาอินช่วยนิลทรงตัวและส่งประแจให้นิล',{actors:[
  {char:'nil',x:54,y:90},{char:'ta_in',x:57,y:90}
 ]})]}]};
assert.equal(planner.plan(contact,'composition').ops.length,0,
 'intentional actor contact must remain authored');
const frozen={project:{aspect:'9:16'},episodes:[{scenes:[
 scene('fixed','ยืนข้างกัน',{actors:[
  {char:'a',x:40,y:90,lockPosition:true},
  {char:'b',x:44,y:90,route:[{x:44,y:90},{x:60,y:90}]}
 ]})]}]};
const lockedPlan=planner.plan(frozen,'composition');
assert.equal(lockedPlan.ops.length,0);
assert.ok(lockedPlan.warnings.some(x=>x.includes('fixed')),
 'locked author choreography must produce a review warning, never an edit');
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
assert.equal(timing.hasTimedEvents(timedScene),false,'factory relative keyframes must not count as an authored hold');
const autoReflow=timing.audit(timedState,{scope:'all'});
assert.equal(autoReflow.ops.length,1,
 'factory-owned relative animation should follow narration rather than adding a 5s mute tail');
const reflowPatch=autoReflow.ops[0].patch;
assert.ok(reflowPatch.duration>=2.3&&reflowPatch.duration<=3.1);
assert.equal(reflowPatch.customAssets.find(x=>x.eventKind==='beacon').motionKeys.at(-1).t,
 reflowPatch.duration,'three flashes remain within the new shortened scene');
assert.equal(reflowPatch.customAssets.find(x=>x.eventKind==='beacon').motionKeys.filter(x=>x.opacity===1).length,
 6,'all three visual pulses retain their on-keyframes after re-timing');
const compact=structuredClone(timedScene);
Object.assign(compact,reflowPatch);
assert.equal(timing.audit({episodes:[{id:'compact',scenes:[compact]}]},{scope:'all'}).ops.length,0,
 'repeat one-button production must not shorten the same clip again');
const manualBeats=structuredClone(timedScene);
delete manualBeats.customAssets[0].producer;
assert.equal(timing.audit({episodes:[{id:'manual',scenes:[manualBeats]}]},{scope:'all'}).ops.length,0,
 'manually authored vector keyframes must protect their original timing');
const explicitlyLocked=structuredClone(timedScene);
explicitlyLocked.customAssets[0].productionManualLock=true;
assert.equal(timing.audit({episodes:[{id:'lock',scenes:[explicitlyLocked]}]},{scope:'all'}).ops.length,0,
 'user-locked automatic vector beats cannot be retimed');
const withHold=structuredClone(timedScene);
withHold.notes='[HOLD] ปล่อยจังหวะหลังเสียงจบ';
assert.equal(timing.audit({episodes:[{id:'hold',scenes:[withHold]}]},{scope:'all'}).ops.length,0,
 'authored cinematic holds must remain intact');
const generatedActor={...timedScene,customAssets:[],actors:[{char:'actor',x:20,y:80,
 motionProducer:'studio-production-v1',pose:'walk',motionKeys:[{t:0,x:20},{t:8,x:32}]}]};
const actorOps=timing.audit({episodes:[{id:'actor',scenes:[generatedActor]}]},{scope:'all'}).ops;
assert.equal(actorOps.length,1,'factory-created walking keyframes may follow audio');
assert.equal(actorOps[0].patch.actors[0].motionKeys.at(-1).t,actorOps[0].patch.duration);
const manualActor=structuredClone(generatedActor);
delete manualActor.actors[0].motionProducer;
assert.equal(timing.audit({episodes:[{id:'actor',scenes:[manualActor]}]},{scope:'all'}).ops.length,0,
 'hand-created actor animation must not be truncated');
// Auto SVG drafts fit portrait export without resizing artist-managed library assets.
const generatedBridge=assets.item({duration:8},'bridge');
const autoSvg=core.sceneMarkup({customAssets:[generatedBridge]},'back',50.6,0);
const manualSvg=core.sceneMarkup({customAssets:[{...generatedBridge,producer:'manual'}]},'back',50.6,0);
const extractScale=svg=>Number(svg.match(/scale\(([0-9.]+) [0-9.]+\)/)?.[1]);
assert.ok(extractScale(autoSvg)<extractScale(manualSvg)*.61,
 'AI-owned shapes must shrink to portrait frame; manual art stays same');
assert.equal(extractScale(core.sceneMarkup({customAssets:[generatedBridge]},'back',160,0)),
 extractScale(core.sceneMarkup({customAssets:[{...generatedBridge,producer:'manual'}]},'back',160,0)),
 'wide frame shape sizes are unchanged');
// Measured 2026-11-01 portrait MP4 frames: toolbox covered a face and
// reflector crowded the characters. Only production-owned drafts change.
const factoryToolbox=assets.item({duration:8},'toolbox');
const factoryReflector=assets.item({duration:8},'reflector');
assert.ok(factoryToolbox.scale<=.7,'factory toolbox should not dominate a character head');
assert.equal(factoryToolbox.front,false,'factory toolbox must not draw in front of a character face');
assert.ok(factoryReflector.scale<=.85,'factory reflector should be a supporting prop');
assert.equal(factoryReflector.front,false);
assert.ok(factoryToolbox.motionKeys.length>=3,'smaller prop retains full drop animation');
assert.ok(factoryReflector.motionKeys.length>=2,'smaller reflector retains rotation');

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
