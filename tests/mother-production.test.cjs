'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

function harness(){
 const scenes=Array.from({length:7},(_,i)=>({
  id:'s'+i,voiceover:'บทเดิม',duration:12,notes:'คำสั่งเดิม',
  actors:[],audioClips:i===0?[{kind:'voice',data:'data:audio/wav;base64,AA=='}]:[]
 }));
 const state={episodes:[{id:'e1',scenes}],project:{title:'ทดสอบ'}};
 const calls=[],applied=[];
 const mothers=[{id:'key-1',provider:'gemini',name:'แม่หนึ่ง',ready:true},
                {id:'key-2',provider:'openrouter',name:'แม่สอง',ready:true}];
 const window={
  StoryStudioAccess:{isAdmin:()=>true,isReady:()=>true,request:async q=>{
   calls.push(q);
   if(q.action==='teacher.connection.list')return {connections:mothers};
   if(q.action==='teacher.production.review')return {
    ok:true,model:'connected-model',reply:'ปรับแผน',
    ops:q.scenes.map(s=>({op:'updateScene',id:s.id,patch:{
     notes:'เพิ่มระยะกล้อง',duration:15,voiceover:'บทปลอม',actors:[]}}))
     .concat([{op:'updateScene',id:'foreign-id',patch:{notes:'unsafe'}}])
   };
   throw Error('unexpected request '+q.action);
  }},
  StudioAPI:{apply:(ops,{dryRun}={})=>{
   if(!dryRun){applied.push(...ops);
    for(const op of ops)Object.assign(scenes.find(x=>x.id===op.id),op.patch);}
   return {ok:true,applied:true};
  }}
 };
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../studio-mother-production.js'),'utf8'),{window});
 return {api:window.StoryMotherProduction,state,scenes,calls,applied};
}
test('pool dispatches work by actual number of ready mothers; only safe patches are applied',async()=>{
 const {api,state,scenes,calls}=harness();
 let backups=0;
 const out=await api.runRole('timeline-editor',{get:()=>state,episodeIndex:()=>0},
  {scope:'all',ensureBackup:async()=>{backups++}});
 assert.equal(out.batches,3);
 assert.equal(out.mothers,2);
 assert.equal(out.applied,7);
 assert.equal(out.failures,0);
 assert.ok(backups>=1);
 const jobs=calls.filter(x=>x.action==='teacher.production.review');
 assert.equal(jobs.length,3);
 assert.deepEqual([...new Set(jobs.map(j=>j.connectionId))].sort(),['key-1','key-2']);
 assert.ok(jobs.every(j=>j.scenes.length<=3));
 assert.ok(scenes.every(s=>s.voiceover==='บทเดิม'));
 assert.ok(scenes.every(s=>!s.actors.length));
 assert.equal(scenes[0].duration,12,'do not retime scenes with existing real clips');
 assert.equal(scenes[1].duration,15,'bounded duration proposals are reviewed');
 assert.ok(scenes.every(s=>s.notes.includes('[AI แม่ timeline-editor]')));
 const redo=await api.runRole('timeline-editor',{get:()=>state,episodeIndex:()=>0},
  {scope:'all'});
 assert.equal(redo.applied,7);
 assert.ok(scenes.every(s=>s.notes.split('[AI แม่ timeline-editor]').length===2),'reruns do not accumulate duplicate notes');
});
test('voice selection only exposes Gemini-capable connected mothers',async()=>{
 const {api}=harness();await api.refresh();
 assert.equal(api.voiceConnections().length,1);
 assert.equal(api.voiceChoice('key-1').provider,'gemini');
 assert.equal(api.voiceChoice('key-2'),null);
});
test('role list excludes voice; no connected AI mother means explicit refusal',async()=>{
 const {api,state}=harness();
 await assert.rejects(api.runRole('audio-director',{get:()=>state}),/ไม่มีงาน AI แม่/);
 const registry=require('../studio-production-roles.js');
 assert.equal(registry.roles.length,11);
 assert.ok(registry.voiceRole.engines.includes('system'));
 assert.ok(registry.voiceRole.engines.includes('mother'));
});
