const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ml=require('../studio-script-ml.js');
const original='ฝนเริ่มตกหนัก แล้วก็ แล้วก็ น้ำจากคลองค่อย ๆ สูงขึ้น';
const cleaned='ฝนเริ่มตกหนัก แล้วก็ น้ำจากคลองค่อย ๆ สูงขึ้น';
function sample(){
 return {project:{title:'Script Batch Test'},episodes:[
  {id:'ep-one',title:'ทดสอบตอนหนึ่ง',scenes:[
   {id:'s1',voiceover:original,subtitle:[],audioClips:[]},
   {id:'s2',voiceover:cleaned,subtitle:[],audioClips:[]},
   {id:'s3',voiceover:'ฝนหยุดตก แต่ฝนยังตกหนักอยู่ในตลาด',subtitle:[],audioClips:[]}]},
  {id:'ep-two',title:'ทดสอบตอนสอง',scenes:[
   {id:'s4',voiceover:'จากนั้น จากนั้น ทุกคนเดินไปยังทางออก',subtitle:[],audioClips:[]},
   {id:'s5',voiceover:'',subtitle:[],audioClips:[]},
   {id:'s6',voiceover:'คนเฝ้าประตูยืนยันว่าไฟยังทำงาน',subtitle:[],audioClips:[]}]}]};
}
test('one request reviews every scene across all episodes without edits',()=>{
 const project=sample(),snapshot=JSON.stringify(project);
 const r=ml.reviewProject(project);
 assert.deepEqual(r.stats,{scenes:6,withNarration:5,changes:2,attention:1,passed:2,clean:2,kept:0,missing:1});
 assert.equal(r.entries.length,6);
 assert.equal(r.entries[0].result.proposed,cleaned);
 assert.equal(r.entries[1].result.hasEdit,false);
 assert.equal(r.entries[2].result.hasEdit,false);
 assert.ok(r.entries[2].result.warnings.length>0);
 assert.equal(r.entries[3].result.hasEdit,true);
 assert.equal(r.entries[4].result,null);
 assert.equal(r.entries[5].result.hasEdit,false);
 assert.equal(JSON.stringify(project),snapshot);
});
test('batch selection validates multiple episode scenes atomically and returns distinct references',()=>{
 const project=sample(),batch=ml.reviewProject(project);
 const rows=ml.verifyBatchSelection(project,batch.entries,['0:0','1:0']);
 assert.equal(rows.length,2);
 assert.deepEqual(rows.map(x=>x.entry.sceneId),['s1','s4']);
 assert.equal(rows[0].proposed,cleaned);
 assert.equal(rows[1].proposed,'จากนั้น ทุกคนเดินไปยังทางออก');
 assert.equal(project.episodes[0].scenes[0].voiceover,original,'review may not mutate source');
});
test('second pass becomes no-op; user is not prompted to reapprove unchanged text',()=>{
 const project=sample(),batch=ml.reviewProject(project);
 project.episodes[0].scenes[0].voiceover=batch.entries[0].result.proposed;
 const next=ml.reviewProject(project);
 assert.equal(next.entries[0].result.hasEdit,false);
 assert.equal(next.entries[0].result.proposed,cleaned);
 assert.equal(next.stats.changes,1);
 assert.throws(()=>ml.verifyBatchSelection(project,batch.entries,['0:0']),/เปลี่ยนหลังวิเคราะห์/);
});
test('invalid, stale and unknown review candidates are rejected before applying anything',()=>{
 const state=sample(),report=ml.reviewProject(state);
 assert.throws(()=>ml.verifyBatchSelection(state,report.entries,['9:9']),/ไม่ได้อยู่ในรายงาน/);
 state.episodes[1].scenes[0].subtitle=['มีการแก้ซับแล้ว'];
 assert.throws(()=>ml.verifyBatchSelection(state,report.entries,['1:0']),/เปลี่ยนหลังวิเคราะห์/);
 const duplicate=sample();duplicate.episodes[1].scenes[0].id='s1';
 assert.throws(()=>ml.verifyBatchSelection(duplicate,ml.reviewProject(duplicate).entries,['0:0']),/scene.id ซ้ำ/);
});
test('batch UI shows each proposal and requires one user confirmation before single multi-op apply',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../studio-ai-workspace.js'),'utf8');
 assert.match(source,/function analyzeAllScripts\(\)/);
 assert.match(source,/async function applyBatchScriptReview\(\)/);
 assert.match(source,/วิเคราะห์ทุกฉาก · ทุกตอน/);
 assert.match(source,/ดาวน์โหลดรายงาน JSON/);
 assert.match(source,/ยืนยันแก้ฉากที่เลือกทั้งหมด/);
 assert.match(source,/ml\.verifyBatchSelection\(bridge\.get\(\),scriptBatch\.entries/);
 const block=source.slice(source.indexOf('async function applyBatchScriptReview()'),source.indexOf('function renderChat(container)'));
 assert.match(block,/root\.confirm\(summary\)/);
 assert.match(block,/const ops=selected\.map/);
 assert.match(block,/StudioAPI\.apply\(ops,\{dryRun:true\}\)/);
 assert.match(block,/await backupBeforeEdit\(\)/);
 assert.match(block,/StudioAPI\.apply\(ops\)/);
 assert.match(block,/staleNarration:true/);
 assert.equal((block.match(/StudioAPI\.apply\(ops\)/g)||[]).length,1);
});
