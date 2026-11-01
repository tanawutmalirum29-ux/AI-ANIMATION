'use strict';
const assert=require('node:assert/strict');
const planner=require('../studio-production-pipeline.js');
const orchestrator=require('../studio-production-orchestrator.js');
const assetCore=require('../studio-asset-core.js');
const visualQA=require('../studio-visual-qa.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const base={project:{title:'factory qa'},episodes:[{id:'ep1',scenes:[
 {id:'s08',duration:8,voiceover:'สะพานไม้ผุยุบตัวต่อหน้า นิลกระโดดข้าม แต่กล่องเครื่องมือหลุดมือและตกลงน้ำ',
  actors:[{char:'nil',x:18,y:90,toX:55,pose:'jump'}, {char:'ta_in',x:12,y:90,pose:'stand'}],
  imagePrompt:'',props:[],audioClips:[],customAssets:[]},
 {id:'s15',duration:9,voiceover:'หนึ่งวาบ สองวาบ สามวาบ นิลเปิดบานบังแสง',
  actors:[{char:'nil',x:72,y:90,pose:'point'}],imagePrompt:'',props:[],audioClips:[],customAssets:[]},
 {id:'s18',duration:7,voiceover:'นิลปิดสมุดของพ่อ',actors:[],props:[],audioClips:[],customAssets:[]},
 {id:'locked',duration:4,voiceover:'ฉากนี้ล็อกไว้',autoDirectorLocked:true,customAssets:[],audioClips:[]}
 ]}]};
const result=planner.plan(base,assetCore);
assert.ok(result.layout.ops.length>=1,'composition resolves overlapping actors');
assert.ok(result.svg.ops.length>=2,'SVG creates bridge/toolbox and three flashes');
assert.ok(result.motion.ops.length>=1,'jump actor gets true motion frames');
const first=result.final.episodes[0].scenes[0];
assert.deepEqual(first.audioClips,[]);
assert.equal(first.voiceover,base.episodes[0].scenes[0].voiceover,"never change external author text");
assert.ok(first.actors[0].motionKeys?.length>=4);
assert.ok(Math.abs(first.actors[0].x-first.actors[1].x)>=11);
assert.equal(base.episodes[0].scenes[0].customAssets.length,0,'plan is immutable');
assert.ok(first.customAssets.some(a=>a.autoDirectorTag.includes('bridge')));
assert.ok(first.customAssets.some(a=>a.autoDirectorTag.includes('toolbox')));
const beacon=result.final.episodes[0].scenes[1].customAssets.find(a=>a.autoDirectorTag.includes('beacon'));
assert.ok(beacon,'three-flash beacon is an actual SVG vector');
assert.ok(beacon.motionKeys.length>=10,'three flashes have actual timed on/off keyframes');
for(const ep of result.final.episodes)for(const scene of ep.scenes)
 for(const a of scene.customAssets||[])assetCore.asset(a.asset);
const svgEarly=assetCore.sceneMarkup(result.final.episodes[0].scenes[1],'front',90,0);
const svgLit=assetCore.sceneMarkup(result.final.episodes[0].scenes[1],'front',90,1.8);
assert.match(svgEarly,/opacity="0.000"/);
assert.match(svgLit,/<g opacity="(?!0\.000)/,'SVG fades visibly at timed frame');
const again=planner.plan(result.final,assetCore);
assert.equal(again.svg.ops.length,0,'rerunning is idempotent');
assert.equal(again.motion.ops.length,0,'do not regenerate keyframes');
assert.equal(again.layout.ops.length,0,'stable layout after first pass');
assert.equal(result.final.episodes[0].scenes[3].customAssets.length,0,'respect user lock');
(async()=>{
 const live=clone(base),calls=[],steps=[],applyOps=ops=>{
  for(const op of ops){
   const sc=live.episodes.flatMap(x=>x.scenes).find(s=>s.id===op.id);
   Object.assign(sc,clone(op.patch));
  }
 };
 const bridge={
  get:()=>live,
  narrate:async scope=>{
   calls.push(scope);
   for(const ep of live.episodes)for(const sc of ep.scenes)
    sc.audioClips=[{kind:'voice',data:'data:audio/wav;base64,AAAA',duration:3,at:0,rate:1}];
   return {ok:true,made:4,failed:0};
  }
 };
 let backs=0,timing=0;
 const ctx={planner,assetCore,visualQA,bridge,
  editor:{apply:(ops,o)=>o?.dryRun?{ok:true}:(applyOps(ops),{applied:true})},
  backup:async()=>{backs++},
  applyTiming:async()=>{timing++;return {changes:2,split:{created:0}}},
  onStep:(id,state)=>steps.push(id+':'+state)};
 const done=await orchestrator.run(ctx);
 assert.equal(calls.length,1,'voice invoked once while visual planning happens');
 assert.equal(backs,1,'backup once before visual edits');
 assert.equal(timing,1);
 assert.ok(done.report.svg>=2);
 assert.ok(done.ok,'all supported tasks finish when audio is provided: '+JSON.stringify(done));
 assert.ok(steps.includes('qa:done'));
 const again=await orchestrator.run(ctx);
 assert.ok(again.ok);
 assert.equal(calls.length,1,'already narrated scenes are skipped');
 assert.equal(backs,1,'no backup when there are no edits');
 const missing=clone(base);const moreSteps=[];
 const blocked=await orchestrator.run({...ctx,
  bridge:{get:()=>missing,narrate:async()=>({ok:false,error:'AWS TTS offline',made:0,failed:0})},
  onStep:(id,state)=>moreSteps.push(id+':'+state)});
 assert.equal(blocked.ok,false);
 assert.equal(blocked.report.missingAudio.length,4);
 assert.ok(moreSteps.includes('timing:needs_attention'));
 assert.ok(blocked.summary.includes('เสียง'));
 console.log('PASS six specialist planner, visible 3 flashes, 1-click handoffs, safe partial/offline and idempotence');
})().catch(e=>{console.error(e);process.exit(1)});
