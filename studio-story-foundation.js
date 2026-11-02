/* Thai Narrative Foundation — tiny CPU-trained character n-gram classifier.
 * Assistant-authored synthetic curriculum; experimental advisory only.
 * It CANNOT write stories, infer character motives, or attest to semantic correctness.
 * Model diagnostics never authorize code, edits or training on owner texts.
 */
(function(root,factory){
'use strict';
const api=factory(root);
if(typeof module==='object'&&module.exports)module.exports=api;
if(root)root.StoryNarrativeFoundation=api;
})(typeof globalThis!=='undefined'?globalThis:null,function(root){
'use strict';
const LABELS=['continuity','clarity','expand','pacing','keep'];
const TITLES={continuity:'เหตุการณ์อาจไม่ต่อเนื่อง',clarity:'ประโยคอาจไม่ชัด',
 expand:'อาจต้องเติมคำเชื่อม',pacing:'บทอาจยาวหรือวกวน',keep:'อาจคงบทเดิม'};
const SOURCE='assistant-authored-synthetic';
let loaded=null,inflight=null,error='';
function normal(s){
 return String(s||'').normalize('NFC').toLowerCase().replace(/\s+/g,' ').trim().slice(0,900);
}
function tokens(row){
 // Core narration carries the dominant weight; context is limited and tagged.
 const text=normal(row.original||row.current?.voiceover),previous=normal(row.previous?.voiceover||row.previous),
  next=normal(row.next?.voiceover||row.next);
 const counts={};
 function gram(value,prefix,mult=1){
  for(const n of [2,3]){
   for(let i=0;i<=value.length-n;i++){
    const chunk=value.slice(i,i+n);
    if(chunk.includes(' ')||chunk.includes('\n'))continue;
    const key=prefix+n+':'+chunk;
    counts[key]=(counts[key]||0)+mult;
   }
  }
 }
 gram(text,'t:',2);
 gram(previous.slice(-150),'p:');
 gram(next.slice(0,150),'n:');
 // Structural features that generalize better than particular character names.
 for(const [key,flag] of [
  ['long',text.length>95],['short',text.length<38],
  ['pronoun',/เขา|เธอ|มัน|สิ่งนั้น|ตรงนั้น|นี่|นั้น/u.test(text)],
  ['transition',/หลัง|เมื่อ|เพราะ|จึง|ก่อน|ระหว่าง|ทันที/u.test(text)],
  ['repeat',/(?:มาก){2}|(?:อย่าง){2}|(?:ที่){2}|ได้มีการ|เนื่องจากว่า/u.test(text)],
  ['quote',/[“”"‘’]/u.test(text)],
  ['context',previous.length>0&&next.length>0]
 ])if(flag)counts['f:'+key]=2;
 return counts;
}
function validate(data){
 if(data?.task!=='thai-narrative-edit-diagnosis'||data?.quality!=='synthetic-foundation-not-human-approved'||
  !Array.isArray(data.rows)||data.rows.length<50)throw Error('ชุดข้อมูลพื้นฐานไม่ถูกต้อง');
 const groups=new Set(),ids=new Set();
 const counts=Object.fromEntries(LABELS.map(l=>[l,0]));
 for(const row of data.rows){
  if(!LABELS.includes(row.issue)||row.source!==SOURCE||row.ownerApproved!==false||
   !row.group||!row.id||ids.has(row.id)||!row.original||!row.revised||
   typeof row.reason!=='string'||!row.reason.trim())throw Error('ข้อมูลฝึกไม่ผ่าน QA');
  ids.add(row.id);groups.add(row.group);counts[row.issue]++;
 }
 if(groups.size<10||LABELS.some(l=>counts[l]<10))throw Error('ชุดข้อมูลไม่สมดุล');
 return {groups:groups.size,counts,rows:data.rows.length};
}
function fit(rows){
 const classes={};const vocabulary=new Set();
 for(const label of LABELS)classes[label]={docs:0,total:0,tokens:{}};
 for(const row of rows){
  const bucket=classes[row.issue],t=tokens(row);
  bucket.docs++;
  for(const [k,n] of Object.entries(t)){
   bucket.tokens[k]=(bucket.tokens[k]||0)+n;
   bucket.total+=n;vocabulary.add(k);
  }
 }
 return {schema:1,task:'thai-narrative-edit-diagnosis',labels:LABELS,
  vocabSize:vocabulary.size,classes,source:SOURCE};
}
function classify(model,input){
 if(!model||model.task!=='thai-narrative-edit-diagnosis')return null;
 const features=tokens(input),scores={},count=LABELS.reduce((sum,l)=>sum+model.classes[l].docs,0),
  vocab=Math.max(1,model.vocabSize);
 if(!count)return null;
 for(const label of LABELS){
  const cls=model.classes[label],denominator=cls.total+vocab;
  let log=Math.log((cls.docs+1)/(count+LABELS.length));
  for(const [k,n] of Object.entries(features))log+=n*Math.log((1+(cls.tokens[k]||0))/denominator);
  scores[label]=log;
 }
 const ordered=[...LABELS].sort((a,b)=>scores[b]-scores[a]);
 const margin=Math.max(0,scores[ordered[0]]-scores[ordered[1]]);
 return {label:ordered[0],title:TITLES[ordered[0]],margin:+margin.toFixed(2),
  lowEvidence:margin<3,source:SOURCE,calibrated:false,advisory:true};
}
function splitByStory(data){
 const groups=[...new Set(data.rows.map(r=>r.group))].sort();
 // Deterministic group-disjoint split: every fifth group is held out.
 const testGroups=new Set(groups.filter((_,index)=>index%5===4));
 const train=data.rows.filter(r=>!testGroups.has(r.group));
 const test=data.rows.filter(r=>testGroups.has(r.group));
 if(!test.length||!train.length)throw Error('ไม่มีชุดทดสอบแยกเรื่อง');
 return {train,test,trainGroups:groups.length-testGroups.size,testGroups:testGroups.size};
}
function evaluate(data){
 validate(data);
 const {train,test,trainGroups,testGroups}=splitByStory(data);
 const trained=fit(train);
 const correct=test.filter(row=>classify(trained,row).label===row.issue).length;
 const frequency=Object.fromEntries(LABELS.map(l=>[l,test.filter(r=>r.issue===l).length]));
 const baseline=Math.max(...Object.values(frequency))/test.length;
 return {testRows:test.length,trainRows:train.length,trainGroups,testGroups,
  correct,accuracy:correct/test.length,majorityBaseline:baseline,
  labelCoverage:frequency,holdoutGroupDisjoint:true,
  syntheticOnly:true,notOwnerApproved:true,notProductionValidated:true};
}
function similarity(a,b){
 const A=new Set(Object.keys(tokens(a))),B=new Set(Object.keys(tokens(b)));
 if(!A.size||!B.size)return 0;
 let intersection=0;for(const k of A)if(B.has(k))intersection++;
 return 2*intersection/(A.size+B.size);
}
function nearest(data,bundle,limit=2){
 const query={original:bundle?.current?.voiceover||'',previous:bundle?.previous?.voiceover||'',
  next:bundle?.next?.voiceover||''};
 const ranked=(data?.rows||[]).map(r=>({row:r,score:similarity(query,r)}))
  .sort((a,b)=>b.score-a.score);
 return ranked.slice(0,Math.min(Math.max(limit,0),3)).filter(x=>x.score>=.08)
  .map(({row,score})=>({
   issue:row.issue,before:row.original.slice(0,230),after:row.revised.slice(0,230),
   reason:row.reason.slice(0,200),score:+score.toFixed(3),source:SOURCE,
   exampleId:row.id}));
}
function prepare(data){
 const report=evaluate(data);
 return {report,model:fit(data.rows),data};
}
async function load(force=false){
 if(loaded&&!force)return loaded;
 if(inflight&&!force)return inflight;
 if(!root?.fetch)throw Error('ต้องโหลด JSON จากเว็บไซต์');
 inflight=(async()=>{
  const response=await root.fetch('./training-lab/datasets/thai-narrative-editor-foundation-v1.json',
   {cache:'no-cache'});
  if(!response.ok)throw Error('โหลดชุดข้อมูลภาษาไทยไม่สำเร็จ HTTP '+response.status);
  const doc=await response.json();
  loaded=prepare(doc);error='';return loaded;
 })();
 try{return await inflight}
 catch(e){error=String(e.message||e);throw e}
 finally{inflight=null}
}
function summary(){
 return {loaded:!!loaded,error,rows:loaded?.data?.rows?.length||0,
  report:loaded?.report||null,source:SOURCE};
}
return Object.freeze({LABELS,TITLES,validate,tokens,fit,classify,splitByStory,evaluate,
 similarity,nearest,prepare,load,summary});
});
