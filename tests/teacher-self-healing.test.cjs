'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const auto=require('../studio-auto-teach.js');
const source=fs.readFileSync(path.join(__dirname,'../studio-auto-teach.js'),'utf8');
const project={project:{aiWorkspace:{projectId:'story123'},mode:'story-only'},
 episodes:[{id:'ep1',scenes:[{id:'s1',voiceover:'ตลาดมีฝนตกหนัก ชาวบ้านรีบยกของ'},
 {id:'s2',voiceover:'ชาวบ้านเดินกลับบ้านหลังฝนเริ่มซา'}]}]};
function init(){
 global.StoryAIWorkspaceCore={ensure:()=>({projectId:'story123'})};
 auto.configure({get:()=>project,persist:()=>{}},'gemini');
 global.StoryNarrativeFoundation={load:async()=>({model:null})};
 global.StoryStudioAccess={isReady:()=>true,request:async params=>{
  if(params.action==='teacher.status')return {feedbackReady:true,providers:[{id:'gemini',ready:true}]};
  if(params.action==='teacher.autoLessons')return {lessons:[]};
  if(params.action==='teacher.modelTest')return {ready:true};
  if(params.action==='student.storyAutoModel')return {active:null};
  if(params.action==='student.storyAutoTrain')return {trained:false,activated:false,status:'collecting-diverse-teacher-lessons',counts:{projects:1}};
  throw Error('Unmocked action '+params.action);
 }};
}
function acceptance(scene){
 return {sceneId:scene.id,episodeId:'ep1',issue:'keep',original:scene.voiceover,
  revised:scene.voiceover,source:'teacher-owner-delegated-qa',
  ownerDelegatedTraining:true,trainingEligible:true,
  qa:{structurePassed:true}};
}
test('partial teacher failure is retried automatically and final script can export',async()=>{
 init();
 await auto.scan();
 const calls=[];
 const originalRequest=global.StoryStudioAccess.request;
 global.StoryStudioAccess.request=async params=>{
  if(params.action==='teacher.autoTeach'){
   calls.push(params.scenes.map(s=>s.id));
   if(calls.length===1)return {saved:1,reused:0,failed:1,
    failedSceneIds:['s2'],lessons:[acceptance(project.episodes[0].scenes[0])]};
   return {saved:1,reused:0,failed:0,
    failedSceneIds:[],lessons:[acceptance(project.episodes[0].scenes[1])]};
  }
  return originalRequest(params);
 };
 const result=await auto.teach();
 assert.equal(calls.length,2);
 assert.deepEqual(calls,[['s1','s2'],['s2']]);
 assert.equal(result.completed,2);
 assert.equal(result.readyExport,true);
 assert.deepEqual(result.pendingSceneIds,[]);
 assert.equal(result.trainingStatus.status,'collecting-diverse-teacher-lessons');
 const ready=auto.downloadableProject();
 assert.equal(ready.episodes[0].scenes.length,2);
 assert.equal(ready.episodes[0].scenes[0].voiceover,project.episodes[0].scenes[0].voiceover);
});
test('auto-training endpoint and owner-delegated provenance are wired',()=>{
 const server=fs.readFileSync(path.join(__dirname,'../autodub/teacher.py'),'utf8'),
  train=fs.readFileSync(path.join(__dirname,'../autodub/story_auto_train.py'),'utf8'),
  routes=fs.readFileSync(path.join(__dirname,'../autodub/student_learning.py'),'utf8');
 assert.match(server,/teacher-qa-approved/);
 assert.match(server,/ownerDelegatedTraining": True/);
 assert.match(server,/teacher-retry-queued/);
 assert.match(server,/attempt < 2/);
 assert.match(train,/groupDisjoint/);
 assert.match(train,/qa = accuracy >= \.70 and accuracy > majority/);
 assert.match(routes,/student\.storyAutoTrain/);
 assert.match(routes,/student\.storyAutoModel/);
 assert.match(source,/downloadCompletedStory/);
});
