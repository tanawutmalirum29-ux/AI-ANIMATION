'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('Teacher Studio and UI scripts parse',()=>{
 assert.doesNotThrow(()=>new Function(read('studio-teacher.js')));
 assert.doesNotThrow(()=>new Function(read('studio-ai-workspace.js')));
});
test('Teacher module is connected to the existing application and Amplify',()=>{
 const html=read('index.html'),workspace=read('studio-ai-workspace.js'),build=read('amplify.yml');
 assert.match(html,/studio-teacher\.js/);
 assert.match(html,/studio-teacher\.css/);
 assert.match(workspace,/StoryTeacherStudio\.mount\(area,bridge\)/);
 assert.match(build,/studio-teacher\.js studio-teacher\.css/);
});
test('Teacher API uses authenticated session, previewed ops and rollback',()=>{
 const front=read('studio-teacher.js'),backend=read('autodub/teacher.py');
 assert.match(front,/StoryStudioAccess\.request/);
 assert.match(front,/dryRun:true/);
 assert.match(front,/saveRecovery\(/);
 assert.match(front,/teacher\.feedback/);
 assert.doesNotMatch(front,/localStorage\.(?:setItem|getItem)\([^\n]*apiKey/);
 assert.match(backend,/TEACHER_SETTINGS_PARAMETER/);
 assert.match(backend,/TEACHER_FEEDBACK_TABLE/);
 assert.match(backend,/TEACHER_ALLOWED_API_HOSTS/);
 assert.match(read('autodub/handler.py'),/action\.startswith\("teacher\."\)/);
});

test('teacher context for long projects stays valid JSON without audio payloads',()=>{
 const source=read('studio-teacher.js');
 const start=source.indexOf('function sceneData(scene){');
 const end=source.indexOf('function summarizeDraft(ops)',start);
 assert.ok(start>0&&end>start);
 const scenes=Array.from({length:30},(_,i)=>({id:'s'+i,duration:10,
  voiceover:'เสียงพากย์ภาษาไทย'.repeat(30),subtitle:['ซับบททดสอบ'],notes:'ฉาก'.repeat(40),
  actors:[{char:'a',x:30,y:50}],audioClips:[{data:'NEVER_SEND_BINARY_AUDIO_CONTENT'}]}));
 const episodes=Array.from({length:20},(_,i)=>({id:'e'+i,title:'ตอนที่ '+i,scenes}));
 const bridge={get:()=>({project:{title:'เรื่องทดสอบ',aspect:'9:16'},episodes}),
  episodeIndex:()=>0,scene:()=>scenes[0]};
 const fn=new Function('bridge',source.slice(start,end)+';return context;')(bridge);
 const raw=fn(),data=JSON.parse(raw);
 assert.ok(raw.length<=14000, 'context should fit API bound');
 assert.equal(data.selectedSceneId,'s0');
 assert.ok(data.episodeOutline.length>0);
 assert.ok(!raw.includes('NEVER_SEND_BINARY_AUDIO_CONTENT'));
});
