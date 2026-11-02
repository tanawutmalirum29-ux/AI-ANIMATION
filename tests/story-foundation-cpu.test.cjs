'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),
 fs=require('node:fs'),path=require('node:path');
const model=require('../studio-story-foundation.js'),coach=require('../studio-story-coach.js');
const data=JSON.parse(fs.readFileSync(path.join(__dirname,
 '../training-lab/datasets/thai-narrative-editor-foundation-v1.json'),'utf8'));
test('75 original Thai editorial cases, five balanced labels, 15 distinct stories',()=>{
 const summary=model.validate(data);
 assert.equal(summary.rows,75);assert.equal(summary.groups,15);
 for(const label of model.LABELS)assert.equal(summary.counts[label],15);
 for(const row of data.rows){
  assert.ok(row.original.trim().length>=10&&row.revised.trim().length>=10);
  assert.ok(row.reason.trim().length>=10);
  assert.equal(row.source,'assistant-authored-synthetic');
  assert.equal(row.ownerApproved,false);
  if(row.issue==='keep')assert.equal(row.original,row.revised);
 }
});
test('training and evaluation are separated by story, never by individual scene',()=>{
 const split=model.splitByStory(data),
  train=new Set(split.train.map(x=>x.group)),testGroups=new Set(split.test.map(x=>x.group));
 assert.equal(split.test.length,15);
 for(const g of testGroups)assert.ok(!train.has(g));
 const qa=model.evaluate(data);
 assert.equal(qa.trainRows,60);assert.equal(qa.testRows,15);
 assert.equal(qa.syntheticOnly,true);
 assert.equal(qa.notOwnerApproved,true);
 assert.equal(qa.holdoutGroupDisjoint,true);
 assert.ok(Number.isFinite(qa.accuracy)&&qa.accuracy>=0&&qa.accuracy<=1);
});
test('reproducible CPU model produces bounded advice only',()=>{
 const prepared=model.prepare(data);
 const input={original:'เพราะฝนตกหนัก ชาวบ้านจึงหยุดข้ามสะพาน',
  previous:'สะพานไม้เริ่มสั่น',next:'เจ้าหน้าที่มาตรวจ'};
 const result=model.classify(prepared.model,input);
 assert.ok(model.LABELS.includes(result.label));
 assert.equal(result.advisory,true);
 assert.equal(result.calibrated,false);
 assert.equal(result.source,'assistant-authored-synthetic');
 assert.equal(Object.hasOwn(result,'ops'),false);
 assert.deepEqual(model.evaluate(data),model.evaluate(data));
});
test('contextual examples are advisory and never treated as approved owner memories',()=>{
 const foundation=model.nearest(data,{current:{voiceover:'สะพานไม้สั่นแล้วชาวบ้านเดินกลับ'},
  previous:{voiceover:'น้ำในแม่น้ำเริ่มสูง'},next:{voiceover:'เจ้าหน้าที่ตรวจโครงสร้าง'}},2);
 assert.ok(foundation.length<=2);
 for(const item of foundation){
  assert.ok(item.reason);
  assert.equal(item.source,'assistant-authored-synthetic');
  assert.ok(item.score>=0);
 }
 const teacher=JSON.parse(coach.prompt({
  current:{voiceover:'ประโยคทดสอบ'},previous:null,next:null},[],foundation));
 assert.equal(teacher.ownerApprovedExamples.length,0);
 assert.ok(teacher.syntheticFoundationExamples.length<=1);
});
test('reject malformed/unauthorized or deceptively approved synthetic data',()=>{
 const poisoned={...data,rows:data.rows.map(x=>({...x}))};
 poisoned.rows[0].ownerApproved=true;
 assert.throws(()=>model.validate(poisoned),/QA/);
});
test('runtime and build package all required files and do not auto-edit',()=>{
 const repo=path.join(__dirname,'..'),
 read=name=>fs.readFileSync(path.join(repo,name),'utf8');
 const index=read('index.html'),amplify=read('amplify.yml'),
 ui=read('studio-story-coach-ui.js'),foundation=read('studio-story-foundation.js');
 assert.match(index,/studio-story-foundation\.js/);
 assert.ok(index.indexOf('studio-story-foundation.js')<index.indexOf('studio-story-coach.js'));
 assert.match(amplify,/thai-narrative-editor-foundation-v1\.json/);
 assert.match(ui,/StoryNarrativeFoundation\?\.load/);
 assert.match(ui,/AI ลูก · โมเดลภาษาไทย CPU/);
 assert.match(ui,/StoryNarrativeFoundation\.nearest/);
 assert.match(foundation,/notProductionValidated:true/);
 assert.doesNotMatch(foundation,/localStorage|indexedDB|apiKey/);
});
