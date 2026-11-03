/* Thai Script Editor child v0.1 · owner-only experimental CPU editorial assistant.
   Nothing here modifies the project's voiceover/subtitle or AI member release v1.
   Owner confirmation saves a new lesson on AWS for future quality-gated retraining. */
(function(root){
'use strict';
let host=null,bridge=null,model=null,results=[],running=false,progress='',error='',
  saved=new Set(),busyId='',runStamp='';
const LABELS={typo:'คำผิด',awkward:'คำแปลกตามบริบท',fluency:'ประโยคไม่ลื่นไหล',
 intentional:'คำที่ตั้งใจใช้',keep:'เก็บบทเดิม'};
const issueOrder=['typo','awkward','fluency','intentional','keep'];
function el(tag,klass,text){
 const x=root.document.createElement(tag);
 if(klass)x.className=klass;
 if(text!==undefined)x.textContent=String(text);
 return x;
}
function button(text,fn,disabled=false){
 const b=el('button','thai-editor-button',text);b.type='button';b.disabled=disabled;
 b.addEventListener('click',()=>Promise.resolve().then(fn).catch(e=>{
  error=String(e.message||e);render();
 }));
 return b;
}
function api(action,rest={}){
 if(!root.StoryStudioAccess?.isReady?.())throw Error('กรุณาเข้าสู่ระบบ GitHub แอดมินก่อน');
 return root.StoryStudioAccess.request({action,...rest});
}
function project(){return bridge?.get?.()}
function sourceStamp(p){
 return JSON.stringify((p?.episodes||[]).map(ep=>[ep.id,
  (ep.scenes||[]).map(s=>[s.id,s.voiceover||''])]));
}
function chosenScenes(p){
 const out=[];
 const seen=new Set();
 for(const ep of p?.episodes||[]){
  const scenes=Array.isArray(ep?.scenes)?ep.scenes:[];
  for(let i=0;i<scenes.length;i++){
   const s=scenes[i],text=String(s?.voiceover||'').trim();
   if(!text)continue;
   if(text.length<4||text.length>1200||!s?.id||seen.has(s.id))continue;
   seen.add(s.id);
   out.push({id:String(s.id).slice(0,100),episodeId:String(ep.id||'').slice(0,90),
    text,previous:String(scenes[i-1]?.voiceover||'').slice(0,350),
    next:String(scenes[i+1]?.voiceover||'').slice(0,350)});
  }
 }
 return out;
}
function stableProjectId(p){
 const explicit=p?.project?.aiWorkspace?.projectId;
 if(typeof explicit==='string'&&/^[A-Za-z0-9_-]{5,90}$/.test(explicit))return explicit;
 const basis=String(p?.project?.title||'')+':' +
   (p?.episodes||[]).map(ep=>ep.id+':'+(ep.scenes||[]).map(sc=>sc.id).join(',')).join('|');
 let h1=2166136261,h2=362436069;
 for(let i=0;i<basis.length;i++){
  h1=Math.imul(h1^basis.charCodeAt(i),16777619);
  h2=Math.imul(h2^basis.charCodeAt(i),2246822519);
 }
 return 'editor-'+(h1>>>0).toString(16).padStart(8,'0')+
  (h2>>>0).toString(16).padStart(8,'0');
}
async function loadStatus(){
 try{model=await api('editor.status');error=''}catch(e){error=String(e.message||e)}
 render();
}
async function run(){
 if(running)return;
 const p=project();
 const scenes=chosenScenes(p);
 if(!scenes.length){error='เปิด JSON ที่มีบทพากย์ก่อน';render();return}
 if(scenes.length>350){error='ครั้งนี้ตรวจได้สูงสุด 350 ฉากต่อโปรเจกต์';render();return}
 running=true;error='';results=[];saved=new Set();runStamp=sourceStamp(p);
 progress='กำลังตรวจตัวอย่าง 0/'+scenes.length+' ฉาก';render();
 try{
  for(let i=0;i<scenes.length;i+=18){
   // This is a local CPU classifier running in AWS Lambda; no Gemini/OpenRouter
   // tokens are consumed by these review requests.
   const out=await api('editor.review',{scenes:scenes.slice(i,i+18)});
   if(!Array.isArray(out.suggestions))throw Error('AWS ไม่ส่งรายการข้อเสนอแก้บท');
   results.push(...out.suggestions);
   progress='ตรวจแล้ว '+Math.min(i+18,scenes.length)+'/'+scenes.length+' ฉาก';
   render();
  }
  progress='ตรวจบทครบ '+results.length+' ฉาก · ต้องยืนยันก่อนบันทึกบทเรียน · ยังไม่ได้แก้ JSON';
 }catch(e){error='ตรวจบทไม่สำเร็จ: '+String(e.message||e)}
 finally{running=false;render()}
}
async function approve(item){
 if(busyId)return;
 if(runStamp!==sourceStamp(project()))throw Error('JSON เปลี่ยนระหว่างตรวจ กรุณากดตรวจใหม่ก่อน');
 if(!item.draftIssue||!issueOrder.includes(item.draftIssue))
  throw Error('กรุณาเลือกประเภทปัญหาที่ถูกต้อง');
 const revised=String(item.draftRevised??'').trim();
 if(revised.length<4||revised.length>1200)throw Error('บทที่ยืนยันต้องมี 4–1200 ตัวอักษร');
 const same=revised===item.original;
 if((item.draftIssue==='keep'||item.draftIssue==='intentional')!==same)
  throw Error('ประเภทเก็บบทเดิมต้องไม่มีการแก้ข้อความ ส่วนประเภทคำผิดต้องมีข้อความต่างจากเดิม');
 const scene=chosenScenes(project()).find(s=>s.id===item.sceneId);
 if(!scene||scene.text!==item.original)throw Error('ข้อความต้นฉบับเปลี่ยนไป กรุณาตรวจใหม่');
 busyId=item.sceneId;error='';render();
 try{
  const out=await api('editor.feedback',{
   projectId:stableProjectId(project()),
   lesson:{sceneId:item.sceneId,issue:item.draftIssue,
    original:item.original,revised,previous:scene.previous,next:scene.next,
    reviewedByOwner:true}});
  if(!out.saved)throw Error('AWS ยังไม่ยืนยันการบันทึกบทเรียน');
  saved.add(item.sceneId);
  progress='บันทึกบทเรียนที่ยืนยันแล้ว '+saved.size+' รายการใน AWS · ยังไม่ฝึกน้ำหนักซ้ำ';
 }finally{busyId='';render()}
}
function exportReport(){
 if(!results.length)return;
 const report={type:'thai-editor-review-proposals',version:model?.version||null,
  source:'experimental CPU and explicit lexical rules',originalProjectUnchanged:true,
  results:results.map(x=>({sceneId:x.sceneId,original:x.original,issue:x.issue,
    suggested:x.suggested,reason:x.reason,requiresHumanReview:true}))};
 const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob),a=el('a');
 a.href=url;a.download='thai-editor-review.json';
 root.document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function resultCard(item,i){
 const card=el('article','thai-editor-item');
 card.append(el('strong',null,'ฉาก '+item.sceneId+' · '+(LABELS[item.issue]||'ตรวจบริบท')));
 card.append(el('p','thai-editor-original','ต้นฉบับ: '+item.original));
 const why=el('p','thai-editor-muted','เหตุผล: '+item.reason+' · '+item.source);
 card.append(why);
 const label=el('label','thai-editor-label','ประเภทที่ยืนยัน');
 const select=el('select');
 if(!item.draftIssue)item.draftIssue=issueOrder.includes(item.issue)?item.issue:'';
 const blank=el('option',null,'เลือกประเภทด้วยตนเอง');blank.value='';select.append(blank);
 for(const key of issueOrder){
  const option=el('option',null,LABELS[key]);option.value=key;
  option.selected=item.draftIssue===key;select.append(option);
 }
 select.addEventListener('change',()=>{item.draftIssue=select.value});
 label.append(select);card.append(label);
 const revisedLabel=el('label','thai-editor-label','บทที่ต้องการยืนยัน (แก้ไขได้)');
 const text=el('textarea');text.rows=2;text.maxLength=1200;
 if(item.draftRevised===undefined)item.draftRevised=item.suggested||item.original;
 text.value=item.draftRevised;
 text.addEventListener('input',()=>{item.draftRevised=text.value});
 revisedLabel.append(text);card.append(revisedLabel);
 if(saved.has(item.sceneId))
  card.append(el('p','thai-editor-confirmed','ยืนยันและบันทึกบทเรียนใน AWS แล้ว'));
 else card.append(button('ยืนยันตัวอย่างและบันทึกเป็นบทเรียน',()=>approve(item),
   !!busyId||running));
 return card;
}
function render(){
 if(!host)return;
 host.replaceChildren();
 const box=el('section','thai-editor');
 box.append(el('h3',null,'AI ลูกบรรณาธิการภาษาไทย · รุ่นทดลอง 0.1'),
  el('p','thai-editor-muted',
   'ตรวจคำผิด คำแปลก ประโยคไม่เป็นธรรมชาติ และคำซ้ำที่สื่ออารมณ์ · ไม่แก้ JSON อัตโนมัติ · ไม่ใช้ Gemini/OpenRouter เพื่อตรวจเบื้องต้น'));
 if(model){
  const m=model.metrics||{};
  box.append(el('p','thai-editor-stats',
   'CPU starter: ฝึก '+m.trainRows+' ตัวอย่าง · ทดสอบต่างเรื่อง '+m.holdoutRows+
   ' ตัวอย่าง · คะแนนชุดสังเคราะห์ '+Math.round(100*(m.holdoutAccuracy||0))+
   '% · baseline '+Math.round(100*(m.majorityBaseline||0))+
   '% · ไม่ใช่ความแม่นยำในงานจริง'));
 }
 const bar=el('div','thai-editor-actions');
 bar.append(button(running?'กำลังตรวจ…':'ตรวจบททุกฉากใน JSON',run,running||!!busyId),
  button('ดาวน์โหลดข้อเสนอ JSON',exportReport,!results.length||running),
  button('ตรวจสถานะโมเดล',loadStatus,running));
 box.append(bar);
 if(progress)box.append(el('p','thai-editor-muted',progress));
 if(error)box.append(el('p','thai-editor-error',error));
 box.append(el('p','thai-editor-muted',
  'แนวทางฝึก: โมเดล CPU เรียนรู้จาก 120 ตัวอย่างสมมุติ โดยแยก 30 ตัวอย่างไว้ทดสอบ; บทเรียนที่แอดมินยืนยันจะบันทึกไว้สำหรับการฝึกรอบถัดไป ไม่ปรับน้ำหนักทันที'));
 const list=el('div','thai-editor-list');
 for(let i=0;i<results.length;i++)list.append(resultCard(results[i],i));
 box.append(list);host.append(box);
}
function mount(container,source){
 host=container;bridge=source;render();
 if(!model)loadStatus().catch(()=>{});
}
root.StoryThaiEditor=Object.freeze({mount});
})(window);
