'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ml=require('../studio-script-ml.js');
const rows=JSON.parse(fs.readFileSync(path.join(__dirname,'../training-lab/datasets/script-emotion-context-demo-v3.json'),'utf8')).rows;
test('actual CPU SGD emotion model reproduces frozen 6-class weights on group-held-out synthetic scenes',()=>{
 const result=ml.trainEmotion(rows);
 assert.equal(result.trainRows,749);assert.equal(result.testRows,184);
 assert.ok(result.correct>=108); // Synthetic scenes only; not real-story accuracy.
 assert.deepEqual(result.weights,ml.EMOTION_MODEL.weights);
 assert.deepEqual(result.bias,ml.EMOTION_MODEL.bias);
 assert.equal(ml.EMOTION_MODEL.status,'assistant-synthetic-demo-only');
});
test('infers high-risk feelings from narration even without author emotion tags',()=>{
 const line='เขาหอบหายใจ แล้วก็ แล้วก็ ถอยหลัง';
 const result=ml.review(line,{mode:'narration'});
 assert.equal(result.intent.emotion.label,'fear');
 assert.equal(result.intent.decision,'review');
 assert.equal(result.hasEdit,false);
 assert.equal(result.proposed,line);
 const anger='เขากำหมัดแน่น แล้วก็ แล้วก็ ทุบโต๊ะ';
 assert.equal(ml.review(anger,{mode:'narration'}).intent.decision,'review');
});
test('context from previous, next or notes can warn on ambiguous repetition',()=>{
 const text='เขาก้าวเข้าไป แล้วก็ แล้วก็ หันกลับมา';
 for(const field of ['previous','next','notes']){
  const ctx={mode:'narration',[field]:'เขากลัวจนตัวสั่นและได้ยินเสียงกรีดร้อง'};
  const result=ml.review(text,ctx);
  assert.equal(result.intent.emotion.label,'fear',field);
  assert.equal(result.intent.decision,'review',field);
  assert.equal(result.hasEdit,false);
 }
});
test('neutral repetition is editable, repeated radio filler not assumed to be intentional anxiety',()=>{
 for(const original of ['น้ำเริ่มสูง แล้วก็ แล้วก็ ไหลเข้าถนนหน้าบ้าน',
 'เสียงวิทยุรายงานว่า เอ่อ เอ่อ ถนนฝั่งเหนือเปิดให้ผ่านแล้ว']){
  const result=ml.review(original,{mode:'narration'});
  assert.equal(result.intent.decision,'remove',original);
  assert.equal(result.hasEdit,true);
  assert.equal(ml.review(result.proposed,{mode:'narration'}).hasEdit,false);
 }
});
test('insufficient text evidence or negation does not masquerade as confidently inferred emotion',()=>{
 const none=ml.inferEmotion('เขาเดินกลับบ้าน แล้วก็ แล้วก็ หยุด');
 assert.equal(none.label,'unknown');
 const negation=ml.inferEmotion('เขาไม่กลัว แล้วก็ แล้วก็ เดินต่อ');
 assert.equal(negation.label,'unknown');
 const conflict=ml.inferEmotion('เขาตัวสั่นเพราะกลัว แล้วก็ แล้วก็ กำหมัดด้วยความโกรธ');
 assert.equal(conflict.label,'unknown');
 assert.equal(conflict.conflict,true);
});
test('project review reads neighbors and rejects approved edits after context changes',()=>{
 const project={episodes:[{id:'ep',scenes:[
 {id:'s0',voiceover:'ทุกคนกรีดร้องและตัวสั่นด้วยความกลัว'},
 {id:'s1',voiceover:'เขาถอยไป แล้วก็ แล้วก็ หยุด',scriptMode:'narration'},
 {id:'s2',voiceover:'เจ้าหน้าที่ทำงานตามปกติ แล้วก็ แล้วก็ จดรายงาน',scriptMode:'narration'}]}]};
 const review=ml.reviewProject(project);
 assert.equal(review.entries[1].result.intent.emotion.label,'fear');
 assert.equal(review.entries[1].result.hasEdit,false);
 assert.equal(review.entries[2].result.hasEdit,true);
 const selected=ml.verifyBatchSelection(project,review.entries,['0:2']);
 assert.equal(selected.length,1);
 project.episodes[0].scenes[1].voiceover='ข้อความเปลี่ยน';
 assert.throws(()=>ml.verifyBatchSelection(project,review.entries,['0:2']),/เปลี่ยนหลังวิเคราะห์/);
});
test('UI still requires human confirmation and never displays synthetic emotion confidence as accuracy',()=>{
 const ui=fs.readFileSync(path.join(__dirname,'../studio-ai-workspace.js'),'utf8');
 assert.match(ui,/sceneContextById/);
 assert.match(ui,/emotion\?\.label/);
 assert.match(ui,/ยืนยันแก้ฉากที่เลือกทั้งหมด/);
 assert.match(ui,/await backupBeforeEdit\(\)/);
 assert.match(ui,/StudioAPI\.apply\(ops,\{dryRun:true\}\)/);
});
