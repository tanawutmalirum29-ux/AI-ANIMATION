/* Two-tap teacher-driven learning from imported JSON.
 * Child scans all eligible narration locally; Teacher validates and saves on AWS.
 * Owner delegates AI teaching; lessons passing structure QA become eligible for
 * CPU training, with cross-project QA before model promotion. Edits are exported
 * separately; never silently rewrite the original JSON.
 */
(function(root,factory){
'use strict';
const api=factory(root);
if(typeof module==='object'&&module.exports)module.exports=api;
if(root)root.StoryAutoTeach=api;
})(typeof globalThis!=='undefined'?globalThis:null,function(root){
'use strict';
let bridge=null,host=null,provider='openrouter',scanned=null,running=false,
  progress='',error='',results=[],memory=[],loadedMemory=false,failReasons=[],repairModelChoice=null,
  completedLessons=new Map(),pendingSceneIds=[],trainingStatus=null,readyExport=false;
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
  results:[...results],completed:results.reduce((n,x)=>n+(x.saved||0)+(x.reused||0),0),
  running,progress,error,pendingSceneIds:[...pendingSceneIds],trainingStatus,
  readyExport,failReasons:[...failReasons],repairSuggestion:repairModelChoice?{...repairModelChoice}:null,autoMemoryCount:memory.length,modelUsed:scanned?.modelUsed||false};
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
 if(repairModelChoice){
  const choice=repairModelChoice;
  const label=choice.provider==='openrouter'?
   'เปลี่ยนเป็น OpenRouter โมเดลฟรีอัตโนมัติ':
   'เลือก Gemini 3.5 Flash-Lite (ตรวจสิทธิ์และค่าบริการก่อน)';
  rootPanel.append(el('p','โมเดลเดิม: '+choice.model+
   ' · รุ่นที่เสนอ: '+choice.suggested,'teacher-muted'));
  const fix=btn(label,()=>repair404Model().catch(()=>{}));
  rootPanel.append(fix);
 }
 if(failReasons.length){
  const details=el('details',null,'teacher-auto-teach-errors');
  details.open=true;
  details.append(el('summary','สาเหตุที่ AWS ยังไม่บันทึก ('+failReasons.length+' รายการ)'));
  for(const reason of failReasons.slice(0,4))details.append(el('p',reason,'teacher-warning'));
  rootPanel.append(details);
 }
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
 if(pendingSceneIds.length)rootPanel.append(el('p','รอสอนซ้ำ '+pendingSceneIds.length+
  ' ฉาก · ระบบจะลองแก้ซ้ำอัตโนมัติ / ถ้าถูกจำกัดโควตา ข้อมูลค้างยังเก็บบน AWS','teacher-muted'));
 if(trainingStatus)rootPanel.append(el('p',
  'ฝึก CPU: '+(trainingStatus.status||'ยังไม่มีผล')+
  ' · '+(trainingStatus.counts?.projects||0)+' เรื่อง · '+
  (trainingStatus.metrics?'ผลทดสอบ '+Math.round(100*Number(trainingStatus.metrics.accuracy||0))+'%':'ยังรอข้อมูลหลายเรื่อง'),
  'teacher-muted'));
 if(readyExport){
  const exportButton=btn('ดาวน์โหลด JSON เนื้อเรื่องที่ AI แม่แก้ครบแล้ว',downloadCompletedStory);
  rootPanel.append(exportButton);
 }
 rootPanel.append(el('p',
  'คุณมอบสิทธิ์ให้ AI แม่สอนเอง · บทเรียนผ่าน QA เข้าชุดฝึกได้ · โมเดล CPU เปิดใช้เมื่อทดสอบข้ามเรื่องผ่าน · ยังไม่ใช่การฝึกโมเดลเขียนบทภาษาอิสระ',
  'teacher-muted'));
 host.replaceChildren(rootPanel);
}
async function scan(){
 if(running)return getState();
 running=true;error='';failReasons=[];repairModelChoice=null;progress='AI ลูกกำลังตรวจบททั้งหมด...';render();
 try{
  const project=sourceProject(),stamp=signature(project);
  let model=null;
  try{const p=await root.StoryNarrativeFoundation?.load?.();model=p?.model||null}catch(_){}
  try{
   if(root.StoryStudioAccess?.isReady?.()){
    const remote=await root.StoryStudioAccess.request({action:'student.storyAutoModel'});
    const active=remote?.active;
    if(active?.source==='teacher-owner-delegated-qa'&&
       active?.task==='thai-narrative-edit-diagnosis'&&
       active?.metrics?.qaPassed===true&&active?.status==='active-advisory'&&
       root.StoryNarrativeFoundation?.classify){
      model=active;
    }
   }
  }catch(_){} // Keep the safe synthetic baseline if AWS/teacher model is unavailable.

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
async function verifyTeacherReady(){
 // Fail before touching the first paid/rate-limited inference when Lambda
 // still runs an older version or the chosen API provider is not connected.
 const status=await root.StoryStudioAccess.request({action:'teacher.status'});
 if(!status?.feedbackReady)throw Error('AWS ไม่มีตารางบันทึกบทเรียน AI แม่ กรุณาตรวจการติดตั้ง Lambda');
 const ready=(Array.isArray(status.providers)?status.providers:[]).filter(p=>p?.ready);
 if(!ready.length)throw Error('ยังไม่มี API Key ของ AI แม่ที่พร้อมใช้ · ไปที่ AI ครู / API → เชื่อม API');
 if(!ready.some(p=>p.id===provider)){
  if(ready.length===1){
   provider=ready[0].id;
   progress='สลับไปใช้ AI แม่ที่เชื่อมไว้: '+provider;
   render();
  }else throw Error('AI แม่ '+provider+' ยังไม่พร้อม · กรุณาเลือก provider ที่เชื่อม API ไว้');
 }
 // The earlier Lambda lacks autoLessons; fail fast instead of attempting
 // 47+ autoTeach requests and reporting 141 false failures.
 const probe=await root.StoryStudioAccess.request({action:'teacher.autoLessons',limit:1});
 if(!Array.isArray(probe?.lessons))throw Error('Lambda รุ่นนี้ยังไม่รองรับระบบสอนอัตโนมัติ กรุณา Deploy Lambda ล่าสุด');
 const entry=ready.find(p=>p.id===provider);
 try{
  // A real generation request catches a missing/restricted model. Metadata
  // can say 'ready' even when the selected model responds HTTP 404.
  const check=await root.StoryStudioAccess.request({action:'teacher.modelTest',provider});
  if(!check?.ready)throw Error('AI provider ไม่ยืนยันว่ารุ่นโมเดลใช้งานได้');
  repairModelChoice=null;
 }catch(e){
  const msg=String(e.message||e);
  if(/404|TEACHER_MODEL_UNAVAILABLE|ไม่พบหรือไม่อนุญาตให้ใช้โมเดล/i.test(msg)&&
     ['openrouter','gemini'].includes(provider)){
   repairModelChoice={
    provider,model:String(entry?.model||'ไม่ทราบรุ่น'),
    suggested:provider==='openrouter'?'openrouter/free':'gemini-3.5-flash-lite'
   };
  }
  throw e;
 }
 return true;
}
async function repair404Model(){
 const choice=repairModelChoice;
 if(!choice||running)return;
 const warning=choice.provider==='gemini'?
  'Gemini อาจมีค่าใช้จ่ายถ้าบัญชีเปิด Billing โปรดตรวจโควตา Free tier ใน Google AI Studio ก่อน เปลี่ยนโมเดลเป็น '+choice.suggested+' โดยใช้ API Key เดิมบน AWS หรือไม่?':
  'เลือกโมเดล openrouter/free ที่จำกัดเฉพาะโมเดลฟรี โดยใช้ API Key เดิมใน AWS ไม่ต้องกรอกคีย์อีกหรือไม่?';
 if(root?.confirm&&!root.confirm(warning))return;
 running=true;render();
 try{
  const result=await root.StoryStudioAccess.request({
   action:'teacher.configure',provider:choice.provider,model:choice.suggested,apiKey:''});
  if(!result?.ok)throw Error('AWS ไม่ยืนยันการเปลี่ยนโมเดล');
  const test=await root.StoryStudioAccess.request({
   action:'teacher.modelTest',provider:choice.provider});
  if(!test?.ready)throw Error('AI แม่ไม่ยืนยันว่าโมเดลใหม่ใช้งานได้');
  repairModelChoice=null;error='';failReasons=[];
  progress='ทดสอบโมเดล '+choice.suggested+' ผ่านแล้ว · กด AI แม่สอนและบันทึก AWS อีกครั้ง';
 }catch(e){
  error='เปลี่ยนโมเดลหรือทดสอบไม่สำเร็จ: '+String(e.message||e);
  failReasons=[error];
 }finally{running=false;render()}
}
function makeBatches(rows){
 // Fewer outputs per call prevent the structured Thai JSON being truncated
 // on free-tier models that have limited output tokens or reasoning budgets.
 const batches=[],batch=[];let length=0;
 function flush(){if(batch.length){batches.push(batch.splice(0));length=0}}
 for(const item of rows){
  if(item.text.length>500){flush();batches.push([item]);continue}
  if(batch.length>=2||length+item.text.length>800)flush();
  batch.push(item);length+=item.text.length;
 }
 flush();return batches;
}
function downloadableProject(){
 const project=JSON.parse(JSON.stringify(sourceProject()));
 for(const ep of project.episodes||[]){
  for(const sc of ep.scenes||[]){
   if(typeof sc.voiceover!=='string'||!sc.voiceover.trim())continue;
   const item=completedLessons.get(ep.id+'::'+sc.id);
   if(!item||item.original!==sc.voiceover)throw Error('บทเรียนที่ AWS สอนยังไม่ตรงกับ JSON ปัจจุบัน: '+sc.id);
   if(item.issue!=='keep'){
    sc.voiceover=item.revised;
    sc.subtitle=[];sc.subtitleCues=[];
    if(sc.audioClips)sc.audioClips=[];
    sc.audio=null;
   }
  }
 }
 return project;
}
function downloadCompletedStory(){
 if(!readyExport||!completedLessons.size)throw Error('ระบบยังสอนไม่ครบทุกฉาก');
 const json=downloadableProject();
 const story=root.StoryOnlyJSON;
 const output=json.project?.mode==='story-only'&&story?.exportTextOnly?
  story.exportTextOnly(json):json;
 const blob=new Blob([JSON.stringify(output,null,2)],{type:'application/json;charset=utf-8'});
 const url=URL.createObjectURL(blob);
 const a=root.document.createElement('a');
 a.href=url;a.download='ai-mother-reviewed-story-'+Date.now()+'.json';
 root.document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),12000);
}
async function autoTrainCPU(){
 try{
  trainingStatus=await root.StoryStudioAccess.request({action:'student.storyAutoTrain'});
  if(trainingStatus?.activated){
   progress+=' · โมเดล CPU ผ่าน QA และเปิดใช้แล้ว';
  }else{
   progress+=' · เก็บข้อมูลฝึกไว้แล้ว ('+
    (trainingStatus?.counts?.projects||0)+' เรื่อง; รอ QA ข้ามเรื่อง)';
  }
 }catch(e){
  trainingStatus={status:'training-deferred',error:String(e.message||e)};
  failReasons.push('ยังฝึก CPU ไม่ได้ แต่บทเรียน AWS ยังอยู่: '+trainingStatus.error);
 }
}
async function teach(){
 if(running)return getState();
 if(!root?.StoryStudioAccess?.isReady?.()){
  error='กรุณาเข้าสู่ระบบ AWS Studio ก่อนใช้ AI แม่';render();throw Error(error);
 }
 if(!scanned)await scan();
 if(signature(sourceProject())!==scanned.stamp){
  error='บท JSON เปลี่ยนหลัง AI ลูกตรวจ กรุณากดตรวจใหม่';
  render();throw Error(error);
 }
 running=true;error='';failReasons=[];results=[];completedLessons=new Map();
 pendingSceneIds=[];readyExport=false;trainingStatus=null;
 progress='กำลังตรวจ AWS และโมเดล AI แม่...';render();
 const byId=new Map(scanned.rows.map(x=>[x.id,x]));
 const allRows=scanned.rows,originalSignature=scanned.stamp;
 let saved=0,reused=0,critical=false;
 try{
  await verifyTeacherReady();
  const project=sourceProject();
  if(!project.project)project.project={};
  project.project.aiWorkspace=root.StoryAIWorkspaceCore?.ensure?.(
    project.project.aiWorkspace||{});
  bridge.persist?.();
  const projectId=project.project.aiWorkspace?.projectId;
  if(!projectId)throw Error('ไม่พบรหัสโปรเจกต์');
  let remaining=[...allRows];
  // Initial pass + up to two follow-up passes of ONLY failed scenes.
  // Never silently drop invalid lessons; retain their IDs for later retry.
  for(let pass=0;pass<3&&remaining.length;pass++){
   const batches=makeBatches(remaining),failedRows=[];
   for(let index=0;index<batches.length;index++){
    if(signature(sourceProject())!==originalSignature)
     throw Error('JSON ถูกแก้ระหว่างสอน ต้องตรวจใหม่เพื่อป้องกันบทเรียนผิดเรื่อง');
    const chunk=batches[index];
    progress=(pass?'AI แม่แก้บทเรียนที่ไม่ผ่านซ้ำ รอบ '+(pass+1):
     'AI แม่สอนบททั้งหมด')+' · ชุด '+(index+1)+'/'+batches.length+
     ' · AWS ยืนยัน '+completedLessons.size+'/'+allRows.length;
    render();
    const params={action:'teacher.autoTeach',projectId,provider,
      scenes:chunk.map(x=>({id:x.id,episodeId:x.episodeId,text:x.text,
        previous:x.previous,next:x.next,studentIssue:x.studentIssue}))};
    let payload=null,reason='',rateLimited=false;
    for(let attempt=0;attempt<2;attempt++){
     try{payload=await root.StoryStudioAccess.request(params);break}
     catch(e){
      reason=String(e.message||e);
      rateLimited=/429|เกิน 6 คำขอ|rate.?limit/i.test(reason);
      if(attempt===0&&rateLimited){
       progress='AI แม่ติดโควตา กำลังพักและลองต่อโดยอัตโนมัติ';
       render();await sleep(62000);
       continue;
      }
      // Hard model/provider failures cannot be repaired by repeating the
      // identical request and must not consume the remaining 141-scene quota.
      break;
     }
    }
    if(!payload){
     failedRows.push(...chunk);
     failReasons.push('ชุด '+(index+1)+': '+(reason||'AI provider ไม่ตอบ'));
     const lessonFormatError=/422|TEACHER_LESSONS_RETRY_QUEUED|ตรวจซ้ำ/i.test(reason);
     if(!rateLimited&&!lessonFormatError){critical=true;break}
    }else{
     const counts=[payload.saved,payload.reused,payload.failed];
     if(!counts.every(v=>Number.isInteger(v)&&v>=0)||
        !Array.isArray(payload.lessons)||
        counts.reduce((a,b)=>a+b,0)!==chunk.length){
      failedRows.push(...chunk);
      failReasons.push('ชุด '+(index+1)+': AWS ไม่ยืนยันจำนวนบทเรียน');
      critical=true;break;
     }
     saved+=payload.saved;reused+=payload.reused;
     const accepted=new Set();
     for(const lesson of payload.lessons){
      const x=byId.get(lesson?.sceneId);
      if(x&&x.text===lesson.original&&
         typeof lesson.revised==='string'&&lesson.revised.trim()){
       completedLessons.set(x.episodeId+'::'+x.id,lesson);
       accepted.add(x.id);
      }
     }
     const misses=chunk.filter(x=>!accepted.has(x.id));
     failedRows.push(...misses);
     results.push({saved:payload.saved,reused:payload.reused,failed:misses.length});
     if(misses.length)failReasons.push('ชุด '+(index+1)+': AI แม่ยังต้องแก้ซ้ำ '+misses.length+' ฉาก');
    }
    if(index<batches.length-1)await sleep(11000);
   }
   pendingSceneIds=[...new Set(failedRows.map(x=>x.id))];
   if(critical)break;
   remaining=failedRows;
   if(remaining.length&&pass<2){
    progress='มี '+remaining.length+' ฉากไม่ผ่าน QA · ระบบกำลังส่งให้ AI แม่สอนแก้ใหม่';
    render();
    await sleep(11000);
   }
  }
  readyExport=completedLessons.size===allRows.length&&scanned.skipped.length===0;
  if(readyExport){
   progress='สอนครบและ AWS ยืนยัน '+completedLessons.size+'/'+allRows.length+
    ' ฉาก · ดาวน์โหลดบทที่ AI แม่เรียบเรียงได้แล้ว';
  }else{
   const missed=allRows.length-completedLessons.size;
   progress='AI แม่ทำงานแล้ว AWS ยืนยัน '+completedLessons.size+'/'+allRows.length+
    ' ฉาก · ค้างสอนซ้ำ '+missed+
    ' ฉาก (ไม่สูญหาย สามารถกดสอนอีกครั้ง)';
   error=critical?'โมเดลหรือการเชื่อมต่อมีปัญหา ต้องตรวจสาเหตุด้านล่าง':
    'บางฉากยังไม่ผ่าน QA จึงยังไม่ส่งออกเป็นฉบับสมบูรณ์';
  }
  if(completedLessons.size){
   await loadMemory();
   await autoTrainCPU();
  }
  return getState();
 }catch(e){
  error='สอนยังไม่จบ: '+String(e.message||e);
  failReasons.push(error);
  progress='AWS ยืนยัน '+completedLessons.size+'/'+allRows.length+
   ' ฉาก · ระบบจะไม่อ้างว่าสอนครบจนกว่าจะครบจริง';
  throw e;
 }finally{running=false;render()}
}
function examples(bundle,limit=1){
 if(!root?.StoryContinuityCoach?.examples)return [];
 return root.StoryContinuityCoach.examples(bundle,memory,limit)
  .map(x=>({...x,source:'teacher-owner-delegated-qa',ownerDelegatedTraining:true,reviewedByOwner:false}));
}
function configure(source,selectedProvider){
 bridge=source;provider=selectedProvider||provider;
}
function mount(node,source,selectedProvider){
 host=node;bridge=source;provider=selectedProvider||provider;
 render();
}
return Object.freeze({mount,configure,scan,teach,repair404Model,getState,loadMemory,examples,childScan,downloadableProject});
});
