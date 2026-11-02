const test=require('node:test'),assert=require('node:assert/strict');
const ml=require('../studio-script-ml.js');
test('miraculous contrast is intentional, not a contradiction warning',()=>{
 const t='แม้ไฟจะดับ แต่ยังมีแสงสว่าง ไม่รู้จากที่ใด สาดส่องเข้ามา';
 assert.equal(ml.intentionalContrast(t),true);
 assert.deepEqual(ml.warnings(t),[]);
 const r=ml.review(t,{mode:'narration'});
 assert.equal(r.intentionalContrast,true);assert.equal(r.hasEdit,false);
 assert.ok(!r.warnings.some(x=>x.includes('ขัดแย้ง')));
});
test('scene metadata can mark magic/mystery so plain-looking lines are not flagged',()=>{
 const t='ไฟดับทั้งห้อง แต่ไฟยังสว่างที่กลางโต๊ะ';
 assert.ok(ml.warnings(t).length>0,'ordinary scene still warns');
 assert.deepEqual(ml.warnings(t,{situation:'magical event'}),[]);
 assert.deepEqual(ml.warnings(t,{notes:'เหตุการณ์มหัศจรรย์'}),[]);
});
test('ordinary contradictions are still flagged; nothing else changes',()=>{
 assert.ok(ml.warnings('ไฟดับทั้งตึก แล้วไฟยังสว่างทุกห้อง').some(x=>x.includes('ไฟดับ')));
 assert.ok(ml.warnings('ฝนหยุดตกแล้ว แต่ฝนยังตกหนัก').some(x=>x.includes('ฝน')));
 assert.equal(ml.intentionalContrast('เขาเดินไปตลาดตามปกติ'),false);
});
test('more magical phrasing is intentional; more ordinary contradictions still warn',()=>{
 for(const t of ['ไฟดับ แต่ยังสว่าง ราวกับพระเจ้าทรงส่องทาง','เมื่อไฟดับ วิญญาณเด็กน้อยก็จุดตะเกียงให้ ไฟยังสว่างไปทั้งห้อง','ห้องว่างเปล่า ทว่ามีเงาคนเต็มห้องเหมือนฝัน'])
  assert.deepEqual(ml.warnings(t),[],t);
 for(const t of ['ห้องมืดสนิท เขามองเห็นชัดทุกอย่างบนโต๊ะ','ผู้ป่วยตายแล้ว แต่ยังหายใจเป็นปกติ','ห้องเรียนเงียบสนิท เสียงดังลั่นจากนักเรียนทุกคน'])
  assert.ok(ml.warnings(t).some(x=>x.includes('ขัดแย้ง')),t);
});
test('repeated spells and chants are kept, never auto-removed',()=>{
 for(const t of ['จงตื่น จงตื่น ผู้พิทักษ์แห่งแสง','เปิดเถิด เปิดเถิด ประตูแห่งกาลเวลา','เขาท่องคาถา ว่า อาคม อาคม ซ้ำสามรอบ'])
  assert.notEqual(ml.classifyIntent(t,{mode:'narration',emotion:'neutral'}).decision,'remove',t);
 assert.equal(ml.propose('จงตื่น จงตื่น ผู้พิทักษ์แห่งแสง',{mode:'narration'}),'จงตื่น จงตื่น ผู้พิทักษ์แห่งแสง');
});
