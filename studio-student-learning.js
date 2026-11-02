/* Student Learning Memory — reproducible advisory retrieval and CPU-model inference.
 * Lesson data is fetched from authenticated AWS on demand; never localStorage.
 * A model's prediction cannot automatically delete, rewrite or publish any script.
 */
(function(root,factory){
'use strict';
const api=factory(root);
if(typeof module==='object'&&module.exports)module.exports=api;
if(root)root.StoryStudentLearning=api;
})(typeof globalThis!=='undefined'?globalThis:null,function(root){
'use strict';
let approved=[],active=null,lastLoaded=0,inFlight=null,lastError='';
const LABELS=['keep','remove','review'];
const normalize=text=>String(text||'').normalize('NFC').toLowerCase().replace(/\s+/g,' ').trim();
function tokens(text,context={}){
 const source=normalize(text).slice(0,500),out=[];
 for(let i=0;i<source.length-1;i++){
  const gram=source.slice(i,i+2);
  if(!gram.includes(' '))out.push('g:'+gram);
 }
 for(const key of ['mode','emotion','situation']){
  const tag=String(context?.[key]||'').trim().toLowerCase().slice(0,30);
  if(tag)out.push('c:'+key+':'+tag);
 }
 return out;
}
function similarity(a,b){
 const A=new Set(tokens(a.text,a.context)),B=new Set(tokens(b.text,b.context));
 if(!A.size||!B.size)return 0;
 let common=0;for(const v of A)if(B.has(v))common++;
 return 2*common/(A.size+B.size);
}
function predict(model,text,context){
 if(!model||model.schema!==1||model.task!=='thai-repetition-intent'||
    !Array.isArray(model.labels)||!LABELS.every(x=>model.labels.includes(x)))return null;
 const counts={},t=tokens(text,context);
 for(const gram of t)counts[gram]=(counts[gram]||0)+1;
 const classes=model.classes||{},n=LABELS.reduce((s,l)=>s+Number(classes[l]?.examples||0),0);
 if(n<=0)return null;
 const scores={};
 for(const label of LABELS){
  const cls=classes[label];
  if(!cls||typeof cls.tokens!=='object'||!Number.isFinite(Number(cls.total)))return null;
  const den=Number(cls.total)+Math.max(1,Number(model.vocab)||1);
  let score=Math.log((Number(cls.examples)+1)/(n+LABELS.length));
  for(const [term,count] of Object.entries(counts))
   score+=count*Math.log((Number(cls.tokens[term]||0)+1)/den);
  scores[label]=score;
 }
 const labels=[...LABELS].sort((a,b)=>scores[b]-scores[a]);
 const diff=scores[labels[0]]-scores[labels[1]];
 return {label:labels[0],margin:+diff.toFixed(3),version:model.version,
  source:'active-cpu-model',confidenceCalibrated:false};
}
function advise(text,context={}){
 if(!String(text||'').trim())return null;
 const target={text,context};
 let best=null;
 for(const item of approved){
  if(!item||!LABELS.includes(item.label))continue;
  const score=similarity(target,item);
  if(score>0.85&&(!best||score>best.similarity)){
   best={label:item.label,similarity:+score.toFixed(3),
    reason:String(item.ownerReason||item.teacherReason||'ตัวอย่างที่ผู้ใช้อนุมัติ').slice(0,220),
    source:'approved-example',id:item.id};
  }
 }
 const candidate=predict(active,text,context);
 if(best)return {...best,modelAdvice:candidate};
 return candidate;
}
async function load(force=false){
 if(!root?.StoryStudioAccess?.isReady?.())throw Error('กรุณาเข้าสู่ระบบ AWS Studio ก่อนโหลดความจำ');
 if(!force&&lastLoaded&&Date.now()-lastLoaded<60000)return summary();
 if(inFlight)return inFlight;
 inFlight=(async()=>{
  // A complete refresh: do not keep old records if the cloud request fails.
  const [lessons,model]=await Promise.all([
   root.StoryStudioAccess.request({action:'student.lessons',limit:150}),
   root.StoryStudioAccess.request({action:'student.model'})]);
  if(!Array.isArray(lessons?.lessons))throw Error('AWS ไม่ส่งข้อมูลบทเรียนในรูปแบบที่ถูกต้อง');
  approved=lessons.lessons.filter(x=>LABELS.includes(x.label)&&typeof x.text==='string');
  active=model?.active?.status==='active-advisory'?model.active:null;
  lastLoaded=Date.now();lastError='';
  return summary();
 })();
 try{return await inFlight}
 catch(e){approved=[];active=null;lastLoaded=0;lastError=String(e.message||e);throw e}
 finally{inFlight=null}
}
function summary(){return {lessonCount:approved.length,activeVersion:active?.version||null,
 trainingStatus:active?'active-advisory':'not-activated',lastError,lastLoaded}}
return Object.freeze({normalize,tokens,similarity,predict,advise,load,summary});
});
