'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const auto=require('../studio-auto-teach.js');
const source=fs.readFileSync(path.join(__dirname,'../studio-auto-teach.js'),'utf8');
function project(n=141){
 return {project:{title:'Long Thai story'},episodes:[{
  id:'ep1',scenes:Array.from({length:n},(_,i)=>({
   id:'s'+(i+1),voiceover:'ชาวบ้านกำลังตรวจระดับน้ำที่ตลาดก่อนรุ่งเช้า ฉากที่ '+(i+1)}))
 }]};
}
function prepare(n=141){
 const data=project(n);
 auto.configure({get:()=>data,persist:()=>{}},'gemini');
 global.StoryAIWorkspaceCore={ensure:()=>({projectId:'story123'})};
 return data;
}
async function setupScan(n=141){
 prepare(n);
 await auto.scan();
}
test('141 scenes: one failed backend call stops immediately and reports root cause',async()=>{
 await setupScan();
 const calls=[];
 global.StoryStudioAccess={
  isReady:()=>true,
  request:async params=>{
   calls.push(params.action);
   if(params.action==='teacher.status')return {providers:[{id:'gemini',ready:true}],feedbackReady:true};
   if(params.action==='teacher.autoLessons')return {lessons:[]};
   if(params.action==='teacher.modelTest')return {ready:true,model:'gemini-3.5-flash-lite'};
   if(params.action==='teacher.autoTeach')throw Error('AI provider HTTP 502');
   throw Error('Unexpected '+params.action);
  }
 };
 const result=await auto.teach();
 assert.deepEqual(calls,['teacher.status','teacher.autoLessons','teacher.modelTest','teacher.autoTeach']);
 assert.equal(result.scenes,141);
 assert.equal(result.completed,0);
 assert.equal(result.results.length,1);
 assert.equal(result.results[0].failed,2);
 assert.ok(result.progress.includes('ยังไม่ได้ประมวลผล 139'));
 assert.ok(result.failReasons[0].includes('HTTP 502'));
 assert.ok(!result.progress.includes('สอนครบทุกชุด'));
});
test('stale Lambda is detected before any inference requests',async()=>{
 await setupScan(10);
 const calls=[];
 global.StoryStudioAccess={
  isReady:()=>true,
  request:async params=>{
   calls.push(params.action);
   if(params.action==='teacher.status')return {providers:[{id:'gemini',ready:true}],feedbackReady:true};
   throw Error('Unknown action teacher.autoLessons');
  }
 };
 await assert.rejects(()=>auto.teach(),/Unknown action/);
 assert.deepEqual(calls,['teacher.status','teacher.autoLessons']);
 assert.equal(auto.getState().completed,0);
 assert.match(auto.getState().progress,/การสอนยังไม่สำเร็จ/);
});
test('missing API key fails before the first paid provider request',async()=>{
 await setupScan(10);
 const calls=[];
 global.StoryStudioAccess={
  isReady:()=>true,
  request:async params=>{
   calls.push(params.action);
   if(params.action==='teacher.status')return {providers:[
    {id:'gemini',ready:false},{id:'openrouter',ready:false}],feedbackReady:true};
   throw Error('should not reach '+params.action);
  }
 };
 await assert.rejects(()=>auto.teach(),/ยังไม่มี API Key/);
 assert.deepEqual(calls,['teacher.status']);
});
test('adaptive grouping caps each model request at two short or one long scene',()=>{
 assert.match(source,/batch\.length>=2/);
 assert.match(source,/item\.text\.length>500/);
 assert.match(source,/length\+item\.text\.length>800/);
 assert.match(source,/if\(!payload\)\{/);
 assert.match(source,/stopEarly=true;break/);
 assert.match(source,/teacher\.autoLessons/);
 assert.match(source,/teacher\.status/);
});
