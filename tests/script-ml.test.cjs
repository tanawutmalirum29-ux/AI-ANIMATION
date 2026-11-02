const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ml=require('../studio-script-ml.js');
test('real SGD reproduces pilot model on separate groups',()=>{
 const rows=JSON.parse(fs.readFileSync(path.join(__dirname,'../training-lab/datasets/script-review-assistant-demo.json'),'utf8')).rows;
 const m=ml.train(rows);
 assert.equal(m.trainRows,88);assert.equal(m.testRows,22);
 assert.equal(m.accuracy,1); // Only on assistant-curated synthetic pairs; not proof of general Thai quality.
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

test('real user feedback: first pass removes only doubled connector, second pass exact no-op',()=>{
 const input='ฝนเริ่มตกหนัก แล้วก็ แล้วก็ น้ำจากคลองค่อย ๆ สูงขึ้น';
 const once=ml.review(input);
 assert.equal(once.hasEdit,true);
 assert.equal(once.proposed,'ฝนเริ่มตกหนัก แล้วก็ น้ำจากคลองค่อย ๆ สูงขึ้น');
 const twice=ml.review(once.proposed);
 assert.equal(twice.hasEdit,false);
 assert.equal(twice.proposed,once.proposed);
 assert.equal(ml.propose(twice.proposed),once.proposed);
 assert.ok(once.risk>twice.risk,'learned score must fall after correction');
});
test('protect intentional spoken repetition and preserve clean text exactly',()=>{
 const spoken='พิมบอกว่า “เอ่อ เอ่อ ขอคิดก่อนนะ”';
 assert.equal(ml.propose(spoken),spoken);
 const dramatic='ไม่ ไม่ใช่ตอนนี้! เดี๋ยวก่อน!';
 assert.equal(ml.propose(dramatic),dramatic);
 const cleaned='ฝนเริ่มตกหนัก แล้วก็ น้ำจากคลองค่อย ๆ สูงขึ้น';
 assert.equal(ml.review(cleaned).hasEdit,false);
 assert.equal(ml.review(cleaned).needsReview,false);
});
test('expanded Thai connectors are simplified once, not rewritten freely',()=>{
 const src='จากนั้น จากนั้น เจ้าหน้าที่ก็เข้าไปตรวจ เพราะว่า เพราะว่า มีเสียงผิดปกติ';
 const text=ml.propose(src);
 assert.equal(text,'จากนั้น เจ้าหน้าที่ก็เข้าไปตรวจ เพราะว่า มีเสียงผิดปกติ');
 assert.equal(ml.propose(text),text);
});
test('semantic and subtitle QA are advisory-only, no story edits',()=>{
 const original='ฝนหยุดตก แต่ฝนยังตกหนักอยู่ในตลาด';
 const report=ml.review(original,{subtitle:['นี่เป็นข้อความซับภาษาไทยที่ยาวเกินกว่ายี่สิบแปดตัวอักษรอย่างเห็นได้ชัด','อีกบรรทัด','สามบรรทัด','สี่บรรทัด']});
 assert.equal(report.hasEdit,false);
 assert.equal(report.proposed,original);
 assert.ok(report.warnings.some(x=>x.includes('ขัดแย้ง')));
 assert.ok(report.warnings.some(x=>x.includes('มากกว่า 3')));
 assert.ok(report.warnings.some(x=>x.includes('28')));
});
