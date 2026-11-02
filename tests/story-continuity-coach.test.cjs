'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const coach=require('../studio-story-coach.js');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const makeScene=(id,voiceover,location)=>({id,voiceover,location,notes:'',actors:[]});
const project={project:{title:'ประตูน้ำ'},episodes:[{id:'e1',title:'ตอนแรก',scenes:[
 makeScene('s1','ฝนตกหนักใกล้ตลาด','ตลาด'),
 makeScene('s2','จากนั้นคนเฝ้าประตูได้ยินเสียงผิดปกติ','ประตูน้ำ'),
 makeScene('s3','เขาเดินไปดูที่คลองทันที','คลอง')]}]};

test('coherence considers previous current next, no episode leakage and valid JSON',()=>{
 const bundle=coach.selected(project,'s2');
 assert.equal(bundle.previous.voiceover,project.episodes[0].scenes[0].voiceover);
 assert.equal(bundle.current.id,'s2');
 assert.equal(bundle.next.id,'s3');
 assert.equal(coach.selected(project,'s1').previous,null);
 assert.equal(coach.selected(project,'s3').next,null);
 const payload=JSON.parse(coach.prompt(bundle,[]));
 assert.equal(payload.context.sceneId,'s2');
 assert.match(payload.instructions,/Preserve canon/);
 assert.doesNotMatch(JSON.stringify(payload),/data:video/);
});
test('local clues are hedged and never invent a contradiction',()=>{
 const bundle=coach.selected(project,'s2');
 const cues=coach.signals(bundle);
 assert.ok(cues.some(x=>x.includes('สถานที่เปลี่ยน')));
 assert.ok(!cues.some(x=>x.includes('ขัดแย้งแน่นอน')));
});
test('reviewed examples keep editorial type and never replace canonical text',()=>{
 const bundle=coach.selected(project,'s2');
 const old=JSON.stringify(project);
 const examples=coach.examples(bundle,[
  {issue:'continuity',previous:'ฝนตกหนักใกล้ตลาด',
   original:'จากนั้นคนเฝ้าประตูได้ยินเสียงผิดปกติ',
   next:'เขาเดินไปดูที่คลองทันที',
   revised:'คนเฝ้าประตูได้ยินเสียงผิดปกติจากอาคารใกล้ตลาด จึงหันไปทางคลอง',
   ownerReason:'เพิ่มสะพานเชื่อมเหตุการณ์'},
  {issue:'keep',original:'ไม่ต้องแก้',revised:'ไม่ต้องแก้'}
 ],3);
 assert.equal(examples.length,1);
 assert.equal(examples[0].issue,'continuity');
 assert.equal(JSON.stringify(project),old);
 assert.equal(coach.validLesson({issue:'expand',original:'ข้อความเดิม',revised:'ข้อความที่แก้'}),true);
 assert.equal(coach.validLesson({issue:'unknown',original:'ข้อความเดิม',revised:'ข้อความที่แก้'}),false);
});
test('narrative coach is mounted and never directly sends a key or trains weights',()=>{
 const html=read('index.html'),teacher=read('studio-teacher.js'),ui=read('studio-story-coach-ui.js'),
  build=read('amplify.yml');
 assert.match(html,/studio-story-coach\.js/);
 assert.match(html,/studio-story-coach-ui\.js/);
 assert.match(teacher,/tab==='story'\?storyPanel\(\)/);
 assert.match(ui,/student\.storyLesson/);
 assert.match(ui,/student\.storyLessons/);
 assert.match(ui,/teacher\.chat/);
 assert.match(ui,/dryRun:true/);
 assert.match(ui,/saveRecovery\(\)/);
 assert.match(build,/studio-story-coach\.js studio-story-coach-ui\.js/);
 assert.doesNotMatch(ui,/localStorage\.setItem/);
});

test('teacher checklist requires uncertainty, suspense and expressive repetition; approved keep is retrievable',()=>{
 const bundle=coach.selected(project,'s2'),prompt=JSON.parse(coach.prompt(bundle));
 assert.ok(prompt.editorialChecklist.some(x=>x.includes('คำซ้ำ')));
 assert.ok(prompt.editorialChecklist.some(x=>x.includes('ความทรงจำ')));
 assert.ok(prompt.editorialChecklist.some(x=>x.includes('ปริศนา')));
 const current=bundle.current.voiceover;
 const related=coach.examples(bundle,[{
  issue:'keep',previous:bundle.previous.voiceover,original:current,
  revised:current,next:bundle.next.voiceover,ownerReason:'รักษาบทเดิม'
 }]);
 assert.equal(related.length,1);
 assert.equal(related[0].issue,'keep');
 const emotional={...bundle,current:{...bundle.current,voiceover:'ผม... ผมไม่แน่ใจว่าเห็นเขาหรือเปล่า'}};
 assert.ok(coach.signals(emotional).some(x=>x.includes('จังหวะหยุด')));
 assert.ok(coach.signals(emotional).some(x=>x.includes('ยังไม่แน่ใจ')));
});
