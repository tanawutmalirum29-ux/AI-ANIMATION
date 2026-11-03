'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const auto=require('../studio-auto-teach.js'),base=path.resolve(__dirname,'..');
const project={project:{aiWorkspace:{projectId:'story123'}},episodes:[{
  id:'ep1',scenes:[{id:'s1',voiceover:'ฝนตกหนัก ชาวบ้านจึงรีบเก็บสินค้าขึ้นที่สูง'},
                   {id:'s2',voiceover:'เจ้าหน้าที่มาถึงตลาดและช่วยตรวจระดับน้ำ'}]}]};
async function prep(provider='gemini'){
  global.StoryAIWorkspaceCore={ensure:()=>({projectId:'story123'})};
  auto.configure({get:()=>project,persist:()=>{}},provider);
  await auto.scan();
}
test('404 Gemini preflight aborts before any teaching and recommends model',async()=>{
 await prep();
 const calls=[];
 global.StoryStudioAccess={isReady:()=>true,
  request:async arg=>{
    calls.push(arg.action);
    if(arg.action==='teacher.status')return {providers:[{id:'gemini',ready:true,model:'gemini-2.5-flash'}],feedbackReady:true};
    if(arg.action==='teacher.autoLessons')return {lessons:[]};
    if(arg.action==='teacher.modelTest')throw Error('AI provider HTTP 404: gemini-2.5-flash');
    throw Error('Must not begin batch');
  }};
 await assert.rejects(()=>auto.teach(),/HTTP 404/);
 assert.deepEqual(calls,['teacher.status','teacher.autoLessons','teacher.modelTest']);
 const st=auto.getState();
 assert.equal(st.completed,0);
 assert.equal(st.repairSuggestion.provider,'gemini');
 assert.equal(st.repairSuggestion.suggested,'gemini-3.5-flash-lite');
});
test('one-tap model repair saves only model ID, reuses existing key in backend',async()=>{
 global.confirm=()=>true;
 const sent=[];
 global.StoryStudioAccess.request=async params=>{
  sent.push(params);
  if(params.action==='teacher.configure')return {ok:true};
  if(params.action==='teacher.modelTest')return {ready:true};
  throw Error('Unexpected action');
 };
 await auto.repair404Model();
 assert.deepEqual(sent.map(x=>x.action),['teacher.configure','teacher.modelTest']);
 assert.equal(sent[0].apiKey,'');
 assert.equal(sent[0].model,'gemini-3.5-flash-lite');
 assert.equal(auto.getState().repairSuggestion,null);
 assert.match(auto.getState().progress,/ทดสอบโมเดล/);
});
test('OpenRouter default remains free but owner-selected models are not restricted by price tier',()=>{
 const server=fs.readFileSync(path.join(base,'autodub/teacher.py'),'utf8'),
  client=fs.readFileSync(path.join(base,'studio-teacher.js'),'utf8');
 assert.match(server,/"openrouter": "openrouter\/free"/);
 assert.doesNotMatch(server,/TEACHER_ALLOW_PAID_MODELS/);
 assert.match(client,/openrouter\/free/);
 assert.doesNotMatch(client,/google\/gemma-3-27b-it:free/);
});
