(function(root,factory){
'use strict';
const api=factory();
if(typeof module==='object'&&module.exports)module.exports=api;
if(root)root.StoryScriptML=api;
})(typeof globalThis!=='undefined'?globalThis:null,function(){
'use strict';
// SGD v2: assistant-authored data only; user examples held out for regression, not added as labels.
const NAMES=Object.freeze(['duplicateConnector','duplicatePause','repeatPunctuation','filler','nearConnector','length','veryLong','stutter']);
const MODEL=Object.freeze({schema:1,task:'thai-narration-review',status:'experimental-assistant-demo',data:'assistant-authored-only',features:[...NAMES],weights:[5.611543,2.484846,7.577056,2.484846,0.891972,0.592996,0,3.376818],bias:-4.031453,trainedGroups:44,holdoutGroups:11,holdoutAccuracy:1});
const clamp=(n,a=0,b=1)=>Math.min(b,Math.max(a,n));
function features(value){
 const t=String(value||'').slice(0,1200),count=re=>[...t.matchAll(re)].length;
 return [
  clamp(count(/(?:แล้วก็\s*){2,}|(?:จากนั้น\s*){2,}|(?:ในตอนนั้น\s*){2,}|(?:เพราะว่า\s*){2,}/gu)),
  clamp(count(/(?:เอ่อ\s*){2,}|(?:คือว่า\s*){2,}|(?:แบบว่า\s*){2,}/gu)),
  clamp(count(/([!?])\1+|[.]{4,}/gu)),
  clamp(count(/เอ่อ|คือว่า|แบบว่า/gu)/2),
  clamp(count(/แล้วก็.{0,22}แล้วก็|จากนั้น.{0,20}จากนั้น|เพราะว่า.{0,20}เพราะว่า/gu)),
  clamp([...t].length/150),
  clamp(Math.max(0,[...t].length-125)/130),
  clamp(count(/(.{2,8})\s+\1/gu))
 ];
}
function probability(value,model=MODEL){
 if(!model||model.task!=='thai-narration-review'||model.features.join('|')!==NAMES.join('|')||model.weights.length!==NAMES.length)return null;
 const v=features(value),z=model.weights.reduce((sum,w,i)=>sum+w*v[i],model.bias);
 return 1/(1+Math.exp(-Math.max(-30,Math.min(30,z))));
}
// Every proposed edit is a conservative rule. The SGD MODEL predicts risk only.
// Do not claim that model weights generate new words or understand story meaning.
function propose(value){
 const original=String(value||'');
 if(!original.trim()||/[“”"']/.test(original))return original; // Quoted speech may intentionally stutter.
 let after=original;
 const edits=[
  [/(?:แล้วก็\s*){2,}/gu,'แล้วก็ '],
  [/(?:จากนั้น\s*){2,}/gu,'จากนั้น '],
  [/(?:ในตอนนั้น\s*){2,}/gu,'ในตอนนั้น '],
  [/(?:เพราะว่า\s*){2,}/gu,'เพราะว่า '],
  [/(?:เอ่อ\s*){2,}/gu,'เอ่อ '],
  [/(?:คือว่า\s*){2,}/gu,'คือว่า '],
  [/(?:แบบว่า\s*){2,}/gu,'แบบว่า '],
  [/([!?])\1+/gu,'$1']
 ];
 for(const [re,next]of edits)after=after.replace(re,next);
 if(after===original)return original; // Perfect no-op on repeated review.
 return after.replace(/ {2,}/gu,' ').trim();
}
function warnings(value){
 const text=String(value||'');
 const issues=[];
 // These are simple conservative HEURISTICS, not learned semantic understanding.
 if(/ฝนหยุดตก[\s\S]{0,100}ฝนยังตก|ฝนยังตก[\s\S]{0,100}ฝนหยุดตก/u.test(text))
  issues.push('อาจขัดแย้ง: ฝนหยุดตกและยังตกในช่วงเดียวกัน — ตรวจลำดับเหตุการณ์');
 if/ไฟดับ[\s\S]{0,100}ไฟยังสว่าง|ไฟยังสว่าง[\s\S]{0,100}ไฟดับ/u.test(text))
  issues.push('อาจขัดแย้ง: ไฟดับแต่ยังสว่าง — ตรวจบริบท');
 if([...text].length>190)
  issues.push('ข้อความพากย์ยาวมาก ตรวจการแบ่งจังหวะและความยาวเสียงจริง');
 if(/[“”"']/.test(text)&&/(?:เอ่อ\s*){2,}|(?:แล้วก็\s*){2,}/u.test(text))
  issues.push('มีคำซ้ำในคำพูดตัวละคร อาจตั้งใจแสดงอาการลังเล จึงไม่แก้ให้อัตโนมัติ');
 return issues;
}
function subtitleAudit(lines){
 const src=Array.isArray(lines)?lines:[],messages=[];
 if(src.length>3)messages.push('ซับมีมากกว่า 3 บรรทัดในหนึ่งหน้า');
 for(let i=0;i<src.length;i++){
  const raw=String(src[i]||'');
  const length=typeof Intl!=='undefined'&&Intl.Segmenter?
   [...new Intl.Segmenter('th',{granularity:'grapheme'}).segment(raw)].length:[...raw].length;
  if(length>28)messages.push('ซับบรรทัด '+(i+1)+' ยาว '+length+' ตัวอักษรที่มองเห็น (แนะนำไม่เกิน 28)');
 }
 return messages;
}
function review(value,context={}){
 const text=String(value||''),risk=probability(text),proposed=propose(text);
 const hasEdit=proposed!==text;
 const issues=[...warnings(text),...subtitleAudit(context.subtitle)];
 return {risk,needsReview:hasEdit||risk>=0.6||issues.length>0,hasEdit,proposed,warnings:issues,
  explanation:hasEdit?'เสนอแก้คำหรือเครื่องหมายซ้ำเฉพาะจุด โดยให้คุณอนุมัติก่อน':
  issues.length?'ไม่แก้บทอัตโนมัติ แต่พบจุดต้องตรวจคุณภาพ':
  risk>=.6?'โมเดลทดลองพบความเสี่ยง แต่ยังไม่มีคำแก้ปลอดภัย':
  'ข้อความผ่านการตรวจเบื้องต้น — ไม่มีข้อเสนอแก้ซ้ำ (idempotent)'};
}
// Reproducible CPU stochastic gradient descent; source pair held out together.
function train(rows,epochs=300){
 const w=Array(NAMES.length).fill(0),b={value:0};
 const trainRows=rows.filter(x=>Number(x.group)%5!==0),testRows=rows.filter(x=>Number(x.group)%5===0);
 const samples=trainRows.map(x=>({v:features(x.text),label:x.label}));
 for(let e=0;e<epochs;e++){
  const lr=.11/(1+e/135);
  for(const sample of samples){
   let z=b.value;for(let j=0;j<w.length;j++)z+=w[j]*sample.v[j];
   const p=1/(1+Math.exp(-Math.max(-25,Math.min(25,z)))),err=p-sample.label;
   for(let j=0;j<w.length;j++)w[j]-=lr*(err*sample.v[j]+.0006*w[j]);
   b.value-=lr*err;
  }
 }
 const scores=testRows.map(x=>({expected:x.label,predicted:probability(x.text,{task:MODEL.task,features:NAMES,weights:w,bias:b.value})>=.5?1:0}));
 return {weights:w.map(x=>+x.toFixed(6)),bias:+b.value.toFixed(6),
  accuracy:scores.length?scores.filter(x=>x.expected===x.predicted).length/scores.length:0,
  trainRows:trainRows.length,testRows:testRows.length,groups:new Set(trainRows.map(x=>x.group)).size};
}
return Object.freeze({NAMES,MODEL,features,probability,propose,review,warnings,subtitleAudit,train});
});