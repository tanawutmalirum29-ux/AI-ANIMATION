'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../studio-mother-production.js'),'utf8');
function load({responses}={}){
 const scene={id:'s1',duration:8,voiceover:'ต้นฉบับ ห้ามแก้',notes:'หมายเหตุเดิม',
  camera:{from:1,to:1,world:1,panX:0},lighting:{exposure:1,glow:0,focusX:50,focusY:40},
  actors:[{char:'one',x:27,y:60,pose:'stand'},{char:'two',x:70,y:60,pose:'stand'}],
  audioClips:[{kind:'voice',data:'data:audio/wav;base64,AA=='}]};
 const state={project:{title:'visual test'},episodes:[{id:'e',scenes:[scene]}]};
 const requests=[],moms=[
  {id:'gemini',provider:'gemini',ready:true,name:'vision-one'},
  {id:'openrouter',provider:'openrouter',ready:true,name:'vision-two'}
 ];
 const root={StoryStudioAccess:{isAdmin:()=>true,isReady:()=>true,request:async q=>{
  requests.push(q);
  if(q.action==='teacher.connection.list')return {connections:moms};
  if(q.action==='teacher.production.visualReview')return responses?.[q.connectionId]||{
   ok:true,sceneId:'s1',observedFrame:true,summary:'ภาพกว้างเกินไป',
   issues:['ตัวละครเล็กเกินไป'],patch:{
    camera:{from:1.1,to:1.08},lighting:{exposure:1.1,glow:.1},
    actorMoves:[{index:0,dx:3,dy:0}],notes:'ปรับ framing เพื่อให้เห็นหน้า'}
  };
  throw Error('Unexpected '+q.action);
 }},StudioAPI:{apply(ops,opts={}){if(opts.dryRun)return {ok:true};
   for(const op of ops)Object.assign(scene,op.patch);return {applied:true}}}};
 vm.runInNewContext(source,{window:root});
 const bridge={scene:()=>scene,get:()=>state,episodeIndex:()=>0,
  capturePreviewFrame:async()=> 'data:image/jpeg;base64,'+Buffer.from('a'.repeat(250)).toString('base64')};
 return {scene,state,root,requests,bridge,api:root.StoryMotherProduction};
}
test('visual director uses actual JPEG frame with both mother connections and applies bounded patches',async()=>{
 const {scene,api,bridge,requests}=load();let saves=0;
 const out=await api.visualReview(bridge,{ensureBackup:async()=>{saves++}});
 assert.equal(out.observedFrame,true);assert.equal(out.attempted,2);assert.equal(out.mothers,2);
 assert.ok(out.applied>=1);assert.ok(saves>=1);
 const sent=requests.filter(x=>x.action==='teacher.production.visualReview');
 assert.equal(sent.length,2);
 assert.ok(sent.every(x=>x.frame.startsWith('data:image/jpeg;base64,')));
 assert.equal(scene.voiceover,'ต้นฉบับ ห้ามแก้');assert.equal(scene.audioClips.length,1);
 assert.equal(scene.actors[0].x,30);assert.equal(scene.actors[1].x,70);
 assert.equal(scene.camera.from,1.1);
 assert.equal(scene.lighting.exposure,1.1);
 assert.ok(scene.notes.includes('[AI แม่ visual]'));
});
test('autonomous visual director refuses unsafe camera jumps and locked actor alterations',async()=>{
 const {scene,api,bridge}=load({responses:{
  gemini:{ok:true,sceneId:'s1',observedFrame:true,summary:'bad',patch:{
   camera:{from:1.75,world:3.3},lighting:{exposure:1.5},
   actorMoves:[{index:0,dx:8,dy:0}]}},
  openrouter:{ok:true,sceneId:'s1',observedFrame:true,summary:'noop',patch:{}}
 }});
 scene.actors[0].lockPosition=true;
 const before=JSON.stringify(scene),out=await api.visualReview(bridge);
 assert.equal(out.applied,0);
 assert.equal(JSON.stringify(scene),before);
});
test('a failed provider never pretends to inspect a screenshot',async()=>{
 const {api,bridge}=load({responses:{
  gemini:{ok:false,error:'model cannot view JPEG'},
  openrouter:{ok:false,error:'quota'}
 }});
 const out=await api.visualReview(bridge);
 assert.equal(out.mothers,0);assert.equal(out.applied,0);assert.equal(out.warnings.length,2);
});
