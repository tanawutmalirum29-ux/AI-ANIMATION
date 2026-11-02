(function(root,factory){
'use strict';
const api=factory();
if(typeof module==='object'&&module.exports)module.exports=api;
if(root)root.StoryScriptML=api;
})(typeof globalThis!=='undefined'?globalThis:null,function(){
'use strict';
// SGD pilot, assistant-authored examples only. NOT general Thai creative rewriting.
const NAMES=Object.freeze(['duplicateConnector','duplicatePause','repeatPunctuation','filler','nearConnector','length','veryLong','stutter']);
const MODEL=Object.freeze({schema:1,task:'thai-narration-review',status:'experimental-assistant-demo',data:'assistant-authored-only',features:[...NAMES],weights:[5.861116,2.46372,6.891667,2.46372,0.914772,0.29538,0,3.378493],bias:-3.786474,trainedGroups:24,holdoutAccuracy:1});
const clamp=(n,a=0,b=1)=>Math.min(b,Math.max(a,n));
function features(value){
 const t=String(value||'').slice(0,1200),count=re=>[...t.matchAll(re)].length;
 return [
  clamp(count(/(?:แล้วก็\s*){2,}|(?:จากนั้น\s*){2,}|(?:ในตอนนั้น\s*){2,}/gu)),
  clamp(count(/(?:เอ่อ\s*){2,}|(?:คือว่า\s*){2,}|(?:แบบว่า\s*){2,}/gu)),
  clamp(count(/([!?])\1+|[.]{4,}/gu)),
  clamp(count(/เอ่อ|คือว่า|แบบว่า/gu)/2),
  clamp(count(/แล้วก็.{0,22}แล้วก็|จากนั้น.{0,20}จากนั้น/gu)),
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
// Explicit proposal only: no auto-patching, no paraphrasing invented story events.
function propose(value){
 let after=String(value||'');
 const edits=[
  [/(?:แล้วก็\s*){2,}/gu,'แล้วก็ '],
  [/(?:จากนั้น\s*){2,}/gu,'จากนั้น '],
  [/(?:ในตอนนั้น\s*){2,}/gu,'ในตอนนั้น '],
  [/(?:เอ่อ\s*){2,}/gu,'เอ่อ '],
  [/(?:คือว่า\s*){2,}/gu,'คือว่า '],
  [/(?:แบบว่า\s*){2,}/gu,'แบบว่า '],
  [/([!?])\1+/gu,'$1']
 ];
 for(const [re,next]of edits)after=after.replace(re,next);
 return after.replace(/ {2,}/gu,' ').trim();
}
function review(value){
 const text=String(value||''),risk=probability(text),proposed=propose(text);
 const hasEdit=proposed!==text.trim()&&!!text.trim();
 return {risk,needsReview:hasEdit||risk>=0.6,hasEdit,proposed,
  explanation:hasEdit?'พบคำหรือเครื่องหมายซ้ำ — เสนอแก้เฉพาะจุด ไม่เปลี่ยนเนื้อเรื่อง':
  risk>=.6?'โมเดลทดลองพบความเสี่ยง แต่ยังไม่มีคำแก้ปลอดภัย กรุณาตรวจเอง':
  'ไม่พบรูปแบบผิดปกติที่โมเดลทดลองตรวจได้'};
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
return Object.freeze({NAMES,MODEL,features,probability,propose,review,train});
});