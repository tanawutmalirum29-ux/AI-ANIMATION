'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ml=require('../studio-script-ml.js');
// User reported these 8 results in chat. Emotion tags reconstructed from
// the supplied 16-scene test JSON; not new training rows and not blind evaluation.
const examples=[
 ['ep1-s01','ค่ำคืนหนึ่ง ฝนเทลงหนักเหนือหมู่บ้านริมคลอง ระดับน้ำกำลังสูงขึ้น','narration','neutral','clean'],
 ['ep1-s02','น้ำเริ่มสูง แล้วก็ แล้วก็ ไหลเข้าถนนหน้าบ้าน','narration','neutral','remove'],
 ['ep1-s03','“มันมาแล้ว! มันมาแล้ว! น้ำเข้าบ้านแล้ว!”','dialogue','fear','keep'],
 ['ep1-s04','จากนั้น จากนั้น ชาวบ้านจึงยกกล่องขึ้นที่สูง','narration','neutral','remove'],
 ['ep1-s05','แล้วก็...แล้วก็เราจะไปทางไหน','unknown','uncertain','review'],
 ['ep1-s06','“ออกไป! ฉันบอกให้ออกไป! อย่าขวางทาง!”','dialogue','anger','keep'],
 ['ep1-s07','เขาหอบหายใจ แล้วก็ แล้วก็ ถอยหลัง','narration','fear','review'],
 ['ep1-s08','เสียงไซเรนดังขึ้น!!!! ทุกคนรีบวิ่งไปยังสะพาน','narration','neutral','remove']
];
test('regression: all 8 observed user scenes keep correct actions but show author emotions',()=>{
 const project={episodes:[{id:'ep1',scenes:examples.map(([id,voiceover,scriptMode,emotion])=>({
  id,voiceover,scriptMode,emotion,voiceDirection:{emotion:'neutral'},notes:'All dialogue voiced by narrator.'
 }))}]};
 const report=ml.reviewProject(project);
 assert.equal(report.stats.scenes,8);
 for(const [i,c] of examples.entries()){
  const e=report.entries[i].result;
  assert.equal(e.intent.decision,c[4],c[0]+' action');
  assert.equal(e.intent.emotion.label,c[3]==='uncertain'?'unknown':c[3],c[0]+' author emotion');
  if(c[3]!=='uncertain')assert.equal(e.intent.emotion.source,'author-tag',c[0]);
  assert.equal(e.hasEdit,c[4]==='remove',c[0]);
 }
});
test('author anger outweighs next scene fear, without altering written dialogue',()=>{
 const project={episodes:[{id:'ep1',scenes:[
  {id:'angry',voiceover:'“ถอยไป! ฉันสั่งให้ถอยไป!”',emotion:'anger',scriptMode:'dialogue'},
  {id:'afraid',voiceover:'คนที่อยู่ตรงนั้นผวาจนตัวสั่น',emotion:'fear',scriptMode:'narration'}
 ]}]};
 const report=ml.reviewProject(project);
 const first=report.entries[0].result;
 assert.equal(first.intent.emotion.label,'anger');
 assert.equal(first.intent.emotion.source,'author-tag');
 assert.equal(first.intent.decision,'keep');
 assert.equal(first.hasEdit,false);
});
test('when author tags are absent, a current-scene anger clue outranks a fearful next scene',()=>{
 const inferred=ml.inferEmotion('เขาตะโกนว่าหลบไป อย่ามาขวางทาง',
  {next:'คนในบ้านผวาและวิ่งหนีด้วยความกลัว'});
 assert.equal(inferred.label,'anger');
 assert.equal(inferred.source,'text');
 const normal=ml.inferEmotion('เจ้าหน้าที่ทำงานตามปกติ',
  {next:'ทุกคนกลัวจนตัวสั่น'});
 assert.equal(normal.label,'neutral');
 assert.equal(normal.source,'text');
});
test('generated voiceDirection neutral does not silence current-text anger clues',()=>{
 const scene={id:'a',voiceover:'เขากำหมัดแน่นและโกรธ',
  voiceDirection:{emotion:'neutral'}};
 const context=ml.sceneContext(scene);
 assert.equal(context.emotionSource,'default');
 const inference=ml.inferEmotion(scene.voiceover,context);
 assert.equal(inference.label,'anger');
 assert.equal(inference.source,'text');
});
test('duplicate connector with fear or anger remains review, no auto destructive edit',()=>{
 const text='เขาหอบหายใจ แล้วก็ แล้วก็ ถอยหลัง';
 const result=ml.review(text,{mode:'narration',previous:'คนเดินไปตามทางปกติ'});
 assert.equal(result.intent.emotion.label,'fear');
 assert.equal(result.intent.decision,'review');
 assert.equal(result.proposed,text);
});
test('UI explains author tags vs model guesses instead of displaying both as inferred emotion',()=>{
 const s=fs.readFileSync(path.join(__dirname,'../studio-ai-workspace.js'),'utf8');
 assert.match(s,/author-tag/);
 assert.match(s,/ผู้เขียนกำหนด/);
 assert.match(s,/คำบ่งชี้ในบท/);
 assert.doesNotMatch(s,/ความมั่นใจโมเดลสาธิต \+Math\.round/);
});
