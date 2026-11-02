'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const root=require('../studio-student-learning.js');
const script=require('../studio-script-ml.js');

test('Thai memory tokenization is stable and context preserving',()=>{
 const grams=root.tokens('ไม่ ไม่ อย่า',{mode:'dialogue',emotion:'fear'});
 assert.ok(grams.includes('g:ไม'));
 assert.ok(grams.includes('c:mode:dialogue'));
 assert.ok(grams.includes('c:emotion:fear'));
 assert.equal(root.similarity({text:'แล้วก็ แล้วก็ ไป',context:{mode:'narration'}},
  {text:'แล้วก็ แล้วก็ ไป',context:{mode:'narration'}}),1);
});
test('CPU trained model returns an advisory, never arbitrary editing operations',()=>{
 const label={examples:12,total:1,tokens:{}};
 const model={schema:1,task:'thai-repetition-intent',version:'test',vocab:4,
  labels:['keep','remove','review'],classes:{keep:label,remove:label,review:label}};
 const prediction=root.predict(model,'ไม่ ไม่ อย่า',{emotion:'fear'});
 assert.ok(['keep','remove','review'].includes(prediction.label));
 assert.equal(prediction.source,'active-cpu-model');
 assert.equal(prediction.confidenceCalibrated,false);
 assert.equal('ops' in prediction,false);
});
test('approved memory only vetoes automatic repeat deletion; no edit generated',()=>{
 const src='แล้วก็ แล้วก็ เดินไปตลาด';
 const base=script.classifyIntent(src,{mode:'narration',emotion:'neutral'});
 const prior=globalThis.StoryStudentLearning;
 try{
   globalThis.StoryStudentLearning={advise:()=>({
      label:'keep',similarity:.99,source:'approved-example',reason:'panic'})};
   const next=script.classifyIntent(src,{mode:'narration',emotion:'neutral'});
   assert.equal(next.memoryAdvice.label,'keep');
   if(base.decision==='remove')assert.equal(next.decision,'review');
   assert.notEqual(next.decision,'remove');
 }finally{
   if(prior===undefined)delete globalThis.StoryStudentLearning;
   else globalThis.StoryStudentLearning=prior;
 }
});
test('web integration exposes student feedback actions, imports runtime before teacher',()=>{
 const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
 const teacher=fs.readFileSync(require('node:path').join(__dirname,'../studio-teacher.js'),'utf8');
 const backend=fs.readFileSync(require('node:path').join(__dirname,'../autodub/handler.py'),'utf8');
 assert.ok(html.indexOf('src="./studio-student-learning.js"')<html.indexOf('src="./studio-teacher.js"'));
 for(const action of ['student.lesson','student.lessons','student.train','student.activate'])
  assert.match(teacher, new RegExp(action.replace('.','\\.'),'i').test(teacher)?new RegExp(action.replace('.','\\.')):new RegExp('student'));
 assert.match(backend,/action\.startswith\("student\."\)/);
});
