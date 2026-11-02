const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ml=require('../studio-script-ml.js');
test('real SGD reproduces pilot model on separate groups',()=>{
 const rows=JSON.parse(fs.readFileSync(path.join(__dirname,'../training-lab/datasets/script-review-assistant-demo.json'),'utf8')).rows;
 const m=ml.train(rows);
 assert.equal(m.trainRows,48);assert.equal(m.testRows,12);
 assert.equal(m.accuracy,1); // Only on assistant-written pilot; not real-world quality.
 assert.deepEqual(m.weights,ml.MODEL.weights);assert.equal(m.bias,ml.MODEL.bias);
 assert.equal(ml.MODEL.status,'experimental-assistant-demo');
});
test('suggests tiny edits without mutating original',()=>{
 const text='เขาวิ่งไปที่ท่าเรือ แล้วก็ แล้วก็ ตะโกนเรียกเพื่อน!!!',rev=ml.review(text);
 assert.ok(rev.risk>.9);assert.equal(rev.hasEdit,true);
 assert.equal(rev.proposed,'เขาวิ่งไปที่ท่าเรือ แล้วก็ ตะโกนเรียกเพื่อน!');
 assert.equal(text,'เขาวิ่งไปที่ท่าเรือ แล้วก็ แล้วก็ ตะโกนเรียกเพื่อน!!!');
});
test('good narration has no automatic edit',()=>{
 const text='ประตูน้ำเริ่มสั่น เมื่อแรงดันน้ำเพิ่มขึ้น';
 assert.equal(ml.review(text).hasEdit,false);
 assert.equal(ml.propose(text),text);
});
test('user must approve proposed script changes; no auto script stage',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../studio-ai-workspace.js'),'utf8');
 assert.match(src,/function reviewCurrentScript/);
 assert.match(src,/async function applyScriptReview/);
 assert.match(src,/backupBeforeEdit/);
 assert.match(src,/staleNarration:true/);
 assert.doesNotMatch(src,/await step\('script'/);
});
