'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const ml=require('../studio-script-ml.js');
const feedback=JSON.parse(fs.readFileSync(path.join(__dirname,'../training-lab/evaluations/repetition-intent-user-feedback-16-scenes.json'),'utf8'));
test('all 16 pasted scenes: distinguish clean, fixable, kept, and needs manual review',()=>{
 assert.equal(feedback.cases.length,16);
 const counts={clean:0,remove:0,keep:0,review:0};
 for(const c of feedback.cases){
  const result=ml.review(c.original,c.context);
  assert.equal(result.intent.decision,c.expected,c.id+' incorrect: '+result.intent.reason);
  assert.equal(result.hasEdit,c.expected==='remove',c.id+' edit flag');
  if(c.expected!=='remove')assert.equal(result.proposed,c.original,c.id+' protected source');
  if(c.expected==='remove'){
   assert.notEqual(result.proposed,c.original,c.id);
   assert.equal(ml.review(result.proposed,c.context).hasEdit,false,c.id+' repeated pass must be no-op');
  }
  if(c.expected==='review')assert.equal(result.needsReview,true,c.id+' manual check');
  if(c.expected==='clean')assert.match(result.intent.reason,/ไม่พบรูปแบบคำซ้ำ/,c.id);
  counts[c.expected]++;
 }
 assert.deepEqual(counts,{clean:3,remove:5,keep:5,review:3});
});
test('repeating an entire analyzed project is safe and preserves scene text',()=>{
 const project={episodes:[{id:'ep1',title:'ทดสอบตอนหนึ่ง',scenes:feedback.cases.slice(0,8).map(c=>({
  id:c.id,voiceover:c.original,scriptMode:c.context.mode,emotion:c.context.emotion,situation:c.context.situation}))},
  {id:'ep2',title:'ทดสอบตอนสอง',scenes:feedback.cases.slice(8).map(c=>({
  id:c.id,voiceover:c.original,scriptMode:c.context.mode,emotion:c.context.emotion,situation:c.context.situation}))}]};
 const initial=JSON.stringify(project),results=ml.reviewProject(project);
 assert.equal(JSON.stringify(project),initial);
 assert.deepEqual(results.stats,{scenes:16,withNarration:16,changes:5,attention:3,passed:8,clean:3,kept:5,missing:0});
 const selected=results.entries.filter(e=>e.result?.hasEdit).map(e=>e.key);
 const verified=ml.verifyBatchSelection(project,results.entries,selected);
 assert.equal(verified.length,5);
 for(const {scene,proposed} of verified)scene.voiceover=proposed;
 const second=ml.reviewProject(project);
 assert.equal(second.stats.changes,0);
 assert.equal(second.stats.clean,8);
 assert.equal(second.stats.kept,5);
 assert.equal(second.stats.attention,3);
});
test('plain quoted and calm scripts without actual repetitions are clean, not keep',()=>{
 for(const text of ['ค่ำคืนหนึ่ง ฝนตกลงมา','“ฉันจะกลับบ้าน”','ชายคนหนึ่งเดินผ่านสะพาน']){
  const result=ml.review(text);
  assert.equal(result.intent.decision,'clean',text);
  assert.equal(result.hasEdit,false);
 }
});
test('emotional narrative repetition is review, quoted speech or idiom is keep',()=>{
 const text='เขาหอบหายใจ แล้วก็ แล้วก็ ถอยหลัง';
 assert.equal(ml.review(text,{mode:'narration',emotion:'fear'}).intent.decision,'review');
 assert.equal(ml.review(text,{mode:'narration',emotion:'fear'}).proposed,text);
 assert.equal(ml.review('“ไม่จริง! ไม่จริง!”',{mode:'dialogue',emotion:'surprise'}).intent.decision,'keep');
 assert.equal(ml.review('เขารอแล้วรอเล่า แต่ไม่มีใครกลับมา',{mode:'narration',emotion:'sadness'}).intent.decision,'keep');
});
