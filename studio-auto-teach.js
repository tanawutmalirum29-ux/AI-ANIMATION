/* Two-tap teacher-driven learning from imported JSON.
 * Child scans all eligible narration locally; Teacher validates and saves on AWS.
 * The saved examples are explicitly UNVERIFIED by owner, advisory-only, and
 * cannot silently rewrite a project or train/promote production model weights.
 */
(function(root,factory){
'use strict';
const module=factory(root);
if(typeof exports==='object'&&typeof module!=='undefined'&&module.exports)module.exports=module;
if(root)root.StoryAutoTeach=module;
})(typeof globalThis!=='undefined'?globalThis:null,function(root){
'use strict';
let bridge=null,host=null,provider='openrouter',scanned=null,running=false,
  progress='',error='',results=[],memory=[],loadedMemory=false;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const validIssues=['continuity','clarity','expand','pacing','keep'];
const clip=(s,n)=>String(s||'').slice(0,n);
function escapeText(el,text){el.textContent=String(text)}
function sourceProject(){
 if(!bridge?.get)throw Error('กรุณาเปิดโปรเจกต์ JSON ก่อน');
 const project=bridge.get();
 if(!Array.isArray(project?.episodes)||!project.episodes.length)throw Error('ไม่พบตอนในโปรเจกต์ JSON');
 return project;
}
function digestSource(project){
 // Exact in-memory snapshots prevent submitting old child decisions after edits.
 return JSON.stringify((project.episodes||[]).map(ep=>[
  ep.id,(ep.scenes||[]).map(s=>[s.id,s.voiceover||'',s.location||'',s.notes||''])]));
}
function contextFor(s,previous,next){
 return {id:s.id,episodeId:s.episodeId||'',text:s.text,
  previous:clip(previous?.voiceover,350),next:clip(next?.voiceover,350),
  studentIssue:s.studentIssue};
}
function childScan(project,model,coach){
 const rows=[],skipped=[];
 const ml=root?.StoryScriptML;
 const ids=new Set();
 for(const ep of project.episodes||[]){
  const scenes=Array.isArray(ep?.scenes)?ep.scenes:[];
  for(let i=0;i<scenes.length;i++){
   const scene=scenes[i]||{},text=String(scene.voiceover||'').trim(),id=String(scene.id||'');
   if(!text)continue;
   if(text.length<4||text.length>1200||!id||id.length>100||ids.has(id)){
    skipped.push({sceneId:id||'-',reason:'บทเกิน 1200 ตัวอักษร / ID ซ้ำหรือไม่ถูกต้อง'});continue;
   }
   ids.add(id);
   const previous=scenes[i-1]||null,next=scenes[i+1]||null,
    ctx={previous:clip(previous?.voiceover,350),next:clip(next?.voiceover,350),original:text};
   let advice=null;
   try{advice=model?root.StoryNarrativeFoundation.classify(model,ctx):null}catch(_){}
   const warnings=coach?.signals?.({
    previous:previous?{voiceover:previous.voiceover,location:previous.location}:null,
    current:{voiceover:text,location:scene.location},next:next?{voiceover:next.voiceover}:null
   })||[];
   let repeat=null;
   try{repeat=ml?.review?.(text,ml.sceneContextById?.(project,scene.id)||{})}catch(_){}
   rows.push({id,episodeId:String(ep.id||'').slice(0,90),text,
    previous:clip(previous?.voiceover,350),next:clip(next?.voiceover,350),
    studentIssue:validIssues.includes(advice?.label)?advice.label:'review',
    warnings:warnings.slice(0,3),repeatDecision:repeat?.intent?.decision||null});
  }
 }
 return {rows,skipped,scenes:rows.length,found:ids.size,modelUsed:!!model,
  syntheticModelAccuracy:null};
}
function signature(project){return digestSource(project)}
function getState(){
 return {ready:!!scanned,scenes:scanned?.rows.length||0,skipped:scanned?.skipped.length||0,
  results:[...results],completed:results.filter(x=>x.saved||x.reused).length,
  running,progress,error,autoMemoryCount:memory.length,modelUsed:scanned?.modelUsed||false};
}
function render(){
 if(!host||!root?.document)return;
 const d=root.document,el=(name,text,className)=>{
  const n=d.createElement(name);if(className)n.className=className;
  if(text!=null)n.textContent=String(text);return n;};
 const rootPanel=el('div',null,'teacher-auto-teach');
 rootPanel.append(el('strong','สอน AI ลูกจาก JSON อัตโนมัติ'));
 rootPanel.append(el('p','นำเข้า JSON → AI ลูกตรวจทุกฉาก → AI แม่วิเคราะห์และบันทึกบทเรียนใน AWS โดยไม่ต้องกดอนุมัติทีละฉาก','teacher-muted'));
 const buttons=el('div',null,'teacher-row');
 const btn=(text,handler)=>{
  const b=el('button',text);b.type='button';b.disabled=running;b.addEventListener('click',handler);return b;
 };
 buttons.append(btn('1. AI ลูกตรวจทั้ง JSON',()=>{scan().catch(()=>{})}),
  btn('2. AI แม่สอนและบันทึก AWS',()=>{teach().catch(()=>{})}));
 rootPanel.append(buttons);
 rootPanel.append(el('p',progress||'เริ่มจากกดให้ AI ลูกตรวจทั้ง JSON','teacher-auto-teach-progress'));
 if(error)rootPanel.append(el('p',error,'teacher-warning'));
 if(scanned)rootPanel.append(el('p',
  'AI ลูกพบ '+scanned.rows.length+' ฉากที่ตรวจได้ · ข้าม '+scanned.skipped.length+
  ' ฉาก · '+(scanned.modelUsed?'ใช้โมเดล CPU พื้นฐาน':'ใช้กฎตรวจบทพื้นฐาน'),
  'teacher-muted'));
 if(results.length){
  const stats={saved:0,reused:0,failed:0};
  for(const r of results)for(const key of Object.keys(stats))stats[key]+=r[key]||0;
  rootPanel.append(el('p','AWS บันทึกใหม่ '+stats.saved+' · ใช้ความจำเดิม '+stats.reused+
    ' · ยังไม่สำเร็จ '+stats.failed,'teacher-auto-teach-stats'));
 }
 rootPanel.append(el('p',
  'ผลสอนอัตโนมัติระบุว่า AI แม่ตรวจ (ยังไม่ใช่คำตอบที่คุณรับรอง) · เก็บแยกใน DynamoDB · ไม่นำไปฝึกน้ำหนักหรือแก้บทจริงอัตโนมัติ',
  'teacher-muted'));
 host.replaceChildren(rootPanel);
}
async function scan(){
 if(running)return getState();
 running=true;error='';progress='AI ลูกกำลังตรวจบททั้งหมด...';render();
 try{
  const project=sourceProject(),stamp=signature(project);
  let model=null;
  try{const p=await root.StoryNarrativeFoundation?.load?.();model=p?.model||null}catch(_){}
  const report=childScan(project,model,root.StoryContinuityCoach);
  if(!report.rows.length)throw Error('ไม่มีฉากที่มีบทพากย์ถูกต้องให้ตรวจ');
  if(signature(sourceProject())!==stamp)throw Error('JSON เปลี่ยนระหว่างตรวจ กรุณาเริ่มใหม่');
  scanned={...report,stamp};
  results=[];loadedMemory=false;
  progress='AI ลูกตรวจครบ '+report.rows.length+' ฉาก · กด AI แม่สอนเพื่อบันทึก AWS';
  return getState();
 }catch(e){scanned=null;error=String(e.message||e);progress='AI ลูกตรวจไม่สำเร็จ';throw e}
 finally{running=false;render()}
}
async function loadMemory(){
 if(!root?.StoryStudioAccess?.isReady?.())return [];
 try{
  const result=await root.StoryStudioAccess.request({action:'teacher.autoLessons',limit:45});
  if(Array.isArray(result?.lessons)){memory=result.lessons;loadedMemory=true}
 }catch(_){}
 return memory;
}
async function teach(){
 if(running)return getState();
 if(!root?.StoryStudioAccess?.isReady?.()){
  error='กรุณาเข้าสู่ระบบ AWS Studio ก่อนใช้ AI แม่';render();throw Error(error);
 }
 if(!scanned){
  await scan();
 }
 if(signature(sourceProject())!==scanned.stamp){
  error='บท JSON ถูกแก้หลัง AI ลูกตรวจ กรุณากดตรวจใหม่ก่อนสอน';
  render();throw Error(error);
 }
 const project=sourceProject();
 const workspace=root.StoryAIWorkspaceCore?.ensure?.(project.project?.aiWorkspace||{});
 const projectId=workspace?.projectId;
 if(!projectId)throw Error('ไม่พบรหัสโปรเจกต์');
 running=true;error='';results=[];render();
 const batches=[];
 for(let i=0;i<scanned.rows.length;i+=3)batches.push(scanned.rows.slice(i,i+3));
 let done=0,failures=0;
 try{
  for(let index=0;index<batches.length;index++){
   if(signature(sourceProject())!==scanned.stamp)throw Error('JSON เปลี่ยนระหว่างการสอน ต้องตรวจใหม่');
   const chunk=batches[index];
   progress='AI แม่กำลังสอนและบันทึก AWS ชุด '+(index+1)+'/'+batches.length+
    ' · เสร็จแล้ว '+done+'/'+scanned.rows.length+' ฉาก';
   render();
   let payload=null;
   const params={action:'teacher.autoTeach',projectId,provider,
    scenes:chunk.map(x=>({
     id:x.id,episodeId:x.episodeId,text:x.text,previous:x.previous,
     next:x.next,studentIssue:x.studentIssue}))};
   for(let attempts=0;attempts<2;attempts++){
    try{
     payload=await root.StoryStudioAccess.request(params);
     break;
    }catch(e){
     if(attempts===0&&/429|เกิน 6 คำขอ|rate.?limit/i.test(String(e.message||e))){
      progress='AI แม่ติดโควตารายคำขอ กำลังพักแล้วลองชุดเดิมใหม่';
      render();await sleep(62000);continue;
     }
     failures+=chunk.length;results.push({failed:chunk.length,error:String(e.message||e)});
     payload=null;break;
    }
   }
   if(payload){
    if(!Number.isInteger(payload.saved)||!Number.isInteger(payload.reused)||
     !Array.isArray(payload.lessons)) {
     failures+=chunk.length;results.push({failed:chunk.length,error:'AWS ส่งผลสอนผิดรูปแบบ'});
    }else{
     done+=payload.saved+payload.reused;
     failures+=payload.failed||0;
     results.push({saved:payload.saved,reused:payload.reused,failed:payload.failed||0});
    }
   }
   // Existing Teacher API is warm-container throttled to six calls/minute.
   // Pacing also reduces provider bursts on low-rate free API tiers.
   if(index<batches.length-1)await sleep(11000);
  }
  progress='สอนครบทุกชุด · AWS ยืนยัน '+done+' ฉาก'+
   (failures?' · ยังไม่สำเร็จ '+failures+' ฉาก':'')+
   ' · ความจำ AI แม่พร้อมนำไปใช้เทียบเคียงครั้งต่อไป';
  if(!done)error='ไม่มีบทเรียนที่ AWS ยืนยันว่าบันทึกสำเร็จ กรุณาตรวจ API และโควตา';
  await loadMemory();
  return getState();
 }catch(e){
  error=String(e.message||e);
  progress='งานสอนหยุดกลางทาง · ส่วนที่ AWS ยืนยันแล้วไม่สูญหาย สามารถกดสอนซ้ำได้';
  throw e;
 }finally{running=false;render()}
}
function examples(bundle,limit=1){
 if(!root?.StoryContinuityCoach?.examples)return [];
 return root.StoryContinuityCoach.examples(bundle,memory,limit)
  .map(x=>({...x,source:'teacher-auto-unverified',reviewedByOwner:false}));
}
function mount(node,source,selectedProvider){
 host=node;bridge=source;provider=selectedProvider||provider;
 render();
}
return Object.freeze({mount,scan,teach,getState,loadMemory,examples,childScan});
});
