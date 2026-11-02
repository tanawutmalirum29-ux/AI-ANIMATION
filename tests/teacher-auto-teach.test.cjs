'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),
 fs=require('node:fs'),path=require('node:path');
const auto=require('../studio-auto-teach.js');
const repo=path.resolve(__dirname,'..');
function read(name){return fs.readFileSync(path.join(repo,name),'utf8')}
const project={project:{title:'บทฝนตก'},episodes:[{
 id:'ep1',scenes:[
 {id:'s1',voiceover:'ฝนตกหนัก คนขายของยกกล่องขึ้นที่สูง',location:'ตลาด'},
 {id:'s2',voiceover:'น้ำเริ่มไหลเข้าทางเดิน ทุกคนเก็บของ',location:'ตลาด'},
 {id:'s3',voiceover:'เมื่อฝนหยุด คนขายของเริ่มสำรวจร้าน',location:'ตลาด'}
 ]}]};
test('child preflight reads every narration scene, sets contextual neighbors',()=>{
 const result=auto.childScan(project,null,null);
 assert.equal(result.rows.length,3);
 assert.equal(result.skipped.length,0);
 assert.equal(result.rows[0].previous,'');
 assert.match(result.rows[1].previous,/ฝนตกหนัก/);
 assert.match(result.rows[1].next,/เมื่อฝนหยุด/);
 assert.equal(result.rows[2].episodeId,'ep1');
});
test('invalid/ambiguous scenes skipped, not silently truncated or invented',()=>{
 const bad={project:{},episodes:[{id:'ep1',scenes:[
  {id:'s1',voiceover:'x'.repeat(1300)},
  {id:'same',voiceover:'ประโยคที่หนึ่ง'},
  {id:'same',voiceover:'ประโยคที่สอง'}
 ]}]};
 const res=auto.childScan(bad,null,null);
 assert.equal(res.rows.length,1);
 assert.equal(res.skipped.length,2);
});
test('teacher shortcut calls automatic workflow, not an unsaved chat-only hint',()=>{
 const teacher=read('studio-teacher.js'),backend=read('autodub/teacher.py'),
  ui=read('studio-auto-teach.js'),build=read('amplify.yml'),html=read('index.html');
 assert.match(teacher,/m\.id==='student'\?root\.StoryAutoTeach\?\.teach/);
 assert.match(teacher,/StoryAutoTeach\.mount/);
 assert.match(ui,/action:'teacher\.autoTeach'/);
 assert.match(ui,/action:'teacher\.autoLessons'/);
 assert.match(ui,/62000/);
 assert.match(ui,/11000/);
 assert.match(backend,/ConditionExpression="attribute_not_exists\(pk\)/);
 assert.match(backend,/reviewedByOwner": False/);
 assert.match(backend,/usedForWeightTraining": False/);
 assert.match(build,/studio-auto-teach\.js/);
 assert.match(html,/studio-auto-teach\.js/);
 assert.doesNotMatch(ui,/autoApply|autoMerge|autoTrainWeights/);
});
