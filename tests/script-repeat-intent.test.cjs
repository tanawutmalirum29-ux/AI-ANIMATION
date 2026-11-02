const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ml=require('../studio-script-ml.js');
const data=JSON.parse(fs.readFileSync(path.join(__dirname,'../training-lab/datasets/script-repeat-intent-demo-v3.json'),'utf8')).rows;
test('CPU SGD actually learns three-way intent with holdout by story, not same rows',()=>{
 const model=ml.trainIntent(data);
 assert.equal(data.length,659);
 assert.equal(model.trainRows,529);assert.equal(model.testRows,130);
 assert.equal(model.correct,130); // synthetic ONLY; never report as real-world accuracy
 assert.deepEqual(model.weights,ml.INTENT_MODEL.weights);assert.deepEqual(model.bias,ml.INTENT_MODEL.bias);
 assert.equal(ml.INTENT_MODEL.status,'synthetic-demo-not-approved');
});
test('remove accidental connective doubling in plain narration, second pass is exact no-op',()=>{
 const first='ฝนเริ่มตกหนัก แล้วก็ แล้วก็ น้ำจากคลองค่อย ๆ สูงขึ้น';
 const second='ฝนเริ่มตกหนัก แล้วก็ น้ำจากคลองค่อย ๆ สูงขึ้น';
 assert.equal(ml.review(first,{mode:'narration',emotion:'neutral'}).intent.decision,'remove');
 assert.equal(ml.propose(first),second);
 assert.equal(ml.review(second).hasEdit,false);
 assert.equal(ml.propose(second),second);
});
test('protect intentional repeated words in fear, anger, sadness and surprise even without quotation marks',()=>{
 const text='แล้วก็ แล้วก็ ฉันไม่กล้าเข้าไป';
 for(const emotion of ['fear','anger','sadness','surprise','hesitation','กลัว','โกรธ','ตกใจ']){
  const result=ml.review(text,{mode:'dialogue',emotion,situation:'danger approaching'});
  assert.equal(result.intent.decision,'keep',emotion);
  assert.equal(result.hasEdit,false);
  assert.equal(result.proposed,text);
 }
 const fearNarrator=ml.review('เขากลัว แล้วก็ แล้วก็ ถอยหลัง',{mode:'narration',emotion:'fear'});
 assert.equal(fearNarrator.hasEdit,false,'explicit emotional narration must never be auto-edited');
});
test('intent distinguishes speaker context even when the text has same repeated tokens',()=>{
 const text='แล้วก็ แล้วก็ ฉันไปต่อไม่ไหว';
 assert.equal(ml.review(text,{mode:'narration'}).hasEdit,true);
 assert.equal(ml.review(text,{mode:'dialogue',emotion:'fear'}).hasEdit,false);
 const unknown=ml.review(text,{mode:'unknown',emotion:'uncertain'});
 assert.equal(unknown.hasEdit,false);
 assert.equal(unknown.intent.decision,'review');
 assert.ok(unknown.warnings.length);
});
test('intentional dramatic and quoted repetition stays intact, no blanket deduplication',()=>{
 for(const sentence of ['มะ...มันมาแล้ว! มันมาแล้ว!','ออกไป! ฉันบอกให้ออกไป!','เขารอแล้วรอเล่า แต่ไม่มีใครกลับมา','“แล้วก็ แล้วก็ ฉันไม่กล้า”']){
  assert.equal(ml.propose(sentence),sentence);
 }
});
test('batch review applies scene metadata and detects stale emotion or role',()=>{
 const p={episodes:[{id:'e',scenes:[
  {id:'a',voiceover:'แล้วก็ แล้วก็ ฉันกลัว',scriptMode:'dialogue',emotion:'fear'}]},
  {id:'e2',scenes:[
  {id:'b',voiceover:'เจ้าหน้าที่เดินไป แล้วก็ แล้วก็ กลับมา',scriptMode:'narration',emotion:'neutral'}]}]};
 const batch=ml.reviewProject(p);
 assert.equal(batch.stats.changes,1);
 assert.equal(batch.entries[0].result.intent.decision,'keep');
 assert.equal(batch.entries[0].result.hasEdit,false);
 assert.equal(batch.entries[1].result.hasEdit,true);
 const approved=ml.verifyBatchSelection(p,batch.entries,['1:0']);
 assert.equal(approved.length,1);
 p.episodes[1].scenes[0].emotion='fear';
 assert.throws(()=>ml.verifyBatchSelection(p,batch.entries,['1:0']),/เปลี่ยนหลังวิเคราะห์/);
});
test('workflow/UI contain contextual intent details but human approval is still mandatory',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../studio-ai-workspace.js'),'utf8');
 assert.match(src,/ml\.sceneContext\(scene\)/);
 assert.match(src,/result\.intent\?\.decision/);
 assert.match(src,/ยืนยันแก้ฉากที่เลือกทั้งหมด/);
 assert.match(src,/await backupBeforeEdit\(\)/);
 assert.match(src,/StudioAPI\.apply\(ops,\{dryRun:true\}\)/);
});

test('clean narration is not called a repetition edit candidate',()=>{
 const normal=ml.review('ฝนเริ่มตกหนัก แล้วก็ น้ำจากคลองค่อย ๆ สูงขึ้น');
 assert.equal(normal.hasEdit,false);
 assert.equal(normal.intent.decision,'clean');
 assert.equal(normal.intent.reason,'ไม่พบรูปแบบคำซ้ำที่ต้องเสนอแก้');
});
