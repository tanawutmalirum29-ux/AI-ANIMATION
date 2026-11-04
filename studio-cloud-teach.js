/* Cloud AI Mother: jobs continue in AWS without a live browser. No API keys,
 * session tokens, project JSON, or training data are written to localStorage.
 * The server remains the authoritative source of job progress and permissions.
 */
(function(root){
'use strict';
let adapter=null,job=null,enabled=false,known=false,busy=false,error='';
let timer=null,restoreEpoch=0,loadingResults=false,uploadState=null;
const qaRecoveryAttempted=new Set();
const completedStates=new Set(['completed','cancelled','paused','needs-attention']);
function access(){return root.StoryStudioAccess}
function request(data){return access().request(data)}
function projectId(){
 const project=adapter?.sourceProject?.()?.project;
 if(!project)return '';
 if(!project.aiWorkspace?.projectId&&root.StoryAIWorkspaceCore?.ensure){
  project.aiWorkspace=root.StoryAIWorkspaceCore.ensure(project.aiWorkspace||{});
  adapter.bridge.persist?.();
 }
 return String(project.aiWorkspace?.projectId||'');
}
function progressText(){
 if(uploadState)return 'กำลังส่ง JSON ไป AWS '+uploadState.done+'/'+uploadState.total+
  ' ชุด · '+uploadState.scenes+' ฉาก · หากเน็ตหลุดกดเริ่มใหม่ได้ โดยส่งเฉพาะชุดที่ยังขาด';
 if(!job)return known?(enabled?
   'Cloud Background Jobs พร้อม · สั่งสอนครั้งเดียวและปิดเว็บได้':
   'โหมดเบราว์เซอร์: ต้องเปิดหน้าเว็บค้างไว้จนงานเสร็จ'):
   'กำลังตรวจว่าระบบ AWS Background Jobs เปิดใช้งานแล้วหรือยัง';
 const labels={queued:'AWS รอเริ่มชุดต่อไป',running:'AWS กำลังสอน',
  paused:'พักงานแล้ว',completed:'AWS สอนครบแล้ว',
  'needs-attention':'มีฉากต้องแก้ไขก่อนสอนต่อ',cancelled:'ยกเลิกงานแล้ว'};
 return (labels[job.state]||job.state)+' · '+
  job.completed+'/'+job.total+' ฉาก · ค้าง '+job.remaining+
  ' · บันทึกใหม่ '+job.saved+' · ใช้ความจำเดิม '+job.reused;
}
function repaint(){adapter?.render?.()}
function schedule(){
 if(timer)clearTimeout(timer);
 timer=null;
 if(!job||completedStates.has(job.state))return;
 timer=setTimeout(()=>{
  if(root.document?.visibilityState!=='hidden')refresh().catch(()=>{});
  else refresh().catch(()=>{});
 },root.document?.visibilityState==='hidden'?30000:10000);
}
async function recoverLegacyQA(value){
 if(!value?.qaAutoRecoveryAvailable||!value.jobId||qaRecoveryAttempted.has(value.jobId))
  return value;
 qaRecoveryAttempted.add(value.jobId);
 try{
  const response=await request({action:'teacher.job.auto-recover-qa',jobId:value.jobId});
  return response?.job||value;
 }catch(e){
  error='กู้คิว QA อัตโนมัติไม่สำเร็จ: '+String(e.message||e);
  return value;
 }
}
function setJob(value){
 job=value;
 error='';
 repaint();
 schedule();
 if(job?.state==='completed')loadResults().catch(e=>{
  error=String(e.message||e);repaint()});
}
async function refresh(){
 if(!job||!access()?.isReady?.())return;
 try{
  const out=await request({action:'teacher.job.status',jobId:job.jobId});
  if(out?.job)setJob(await recoverLegacyQA(out.job));
 }catch(e){error='เน็ตหรือ AWS ไม่พร้อมชั่วคราว: '+String(e.message||e);
  repaint();schedule()}
}
async function restore(){
 const epoch=++restoreEpoch;
 if(!adapter||!access()?.isReady?.())return;
 try{
  const cfg=await request({action:'teacher.job.config'});
  if(epoch!==restoreEpoch)return;
  known=true;enabled=!!cfg?.enabled;
  if(!enabled){repaint();return}
  const id=projectId();
  if(!id){repaint();return}
  const out=await request({action:'teacher.job.find',projectId:id});
  if(epoch!==restoreEpoch)return;
  job=out?.job?await recoverLegacyQA(out.job):null;
  repaint();schedule();
  if(job?.state==='completed')loadResults().catch(e=>{error=String(e.message||e);repaint()});
 }catch(e){
  if(epoch!==restoreEpoch)return;
  known=false;error='เชื่อมข้อมูลคิว AWS ไม่ได้: '+String(e.message||e);
  repaint();
 }
}
async function loadResults(){
 if(!adapter||!job||job.state!=='completed'||loadingResults)return;
 const scanned=adapter.getScan?.();
 if(!scanned)return;
 loadingResults=true;
 try{
  const result=new Map();let cursor=0,ended=false;
  for(let n=0;n<15;n++){
   const page=await request({action:'teacher.job.results',jobId:job.jobId,cursor});
   for(const row of page.items||[]){
    const source=scanned.rows?.[row.index],lesson=row.lesson;
    if(source&&lesson?.sceneId===source.id&&lesson.original===source.text)
     result.set(source.episodeId+'::'+source.id,lesson);
   }
   if(page.nextCursor==null){ended=true;break}
   if(page.nextCursor<=cursor)throw Error('AWS ส่งข้อมูลหน้าซ้ำ');
   cursor=page.nextCursor;
  }
  if(!ended)throw Error('ข้อมูลผลสอนหลายหน้าเกินขอบเขต');
  if(result.size===scanned.rows.length&&scanned.skipped.length===0){
   adapter.applyLessons(result);
  }else{
   error='ข้อมูลบทเรียนที่ AWS ส่งกลับยังไม่ตรงกับ JSON ปัจจุบัน · ตรวจชื่อโปรเจกต์และฉาก';
  }
 }finally{loadingResults=false;repaint()}
}
// For large projects use resumable 16-scene requests, not a single long
// multi-hundred-kilobyte upload. No API inference starts until commit.
async function startUploaded(projectId,scenes,selectedProvider=adapter?.provider,onProgress=null,connectionId=null,storyName='',poolMode=false){
 const encoder=new root.TextEncoder();
 const credential=connectionId||'default-'+selectedProvider;
 const fingerprint=[projectId,selectedProvider,scenes];
 if(credential!=='default-'+selectedProvider)fingerprint.push(credential);
 if(poolMode)fingerprint.push('idle-pool-v1');
 const raw=encoder.encode(JSON.stringify(fingerprint));
 if(!root.crypto?.subtle?.digest)throw Error('เบราว์เซอร์ไม่รองรับ SHA-256 สำหรับส่งงานอย่างปลอดภัย');
 const digest=new Uint8Array(await root.crypto.subtle.digest('SHA-256',raw));
 const uploadId=Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('').slice(0,32);
 const prepared=await request({action:'teacher.job.upload.prepare',
  uploadId,projectId,provider:selectedProvider,connectionId:credential,
  storyName,poolMode,totalScenes:scenes.length});
 const size=Number(prepared.chunkSize)||16,parts=Math.ceil(scenes.length/size);
 if(prepared.partCount!==parts||size!==16)
  throw Error('จำนวนชุดที่ AWS ตอบกลับไม่ตรงกัน');
 const done=new Set(prepared.uploadedParts||[]);
 if(onProgress)onProgress(done.size,parts);
 else {uploadState={done:done.size,total:parts,scenes:scenes.length};repaint();}
 // Chunks are immutable/idempotent and may arrive out of order. Limit to
 // two parallel requests per story to accelerate high-latency mobile upload
 // without flooding DynamoDB or starting inference before all chunks arrive.
 const missing=Array.from({length:parts},(_,i)=>i).filter(i=>!done.has(i));
 let nextPart=0,firstError=null;
 await Promise.all(Array.from({length:Math.min(2,missing.length)},async()=>{
  while(nextPart<missing.length&&!firstError){
   const partIndex=missing[nextPart++];
   try{
    await request({action:'teacher.job.upload.chunk',uploadId,partIndex,
     scenes:scenes.slice(partIndex*size,(partIndex+1)*size)});
    done.add(partIndex);
    if(onProgress)onProgress(done.size,parts);
    else {uploadState={done:done.size,total:parts,scenes:scenes.length};repaint();}
   }catch(e){if(!firstError)firstError=e}
  }
 }));
 if(firstError)throw firstError;
 const committed=await request({action:'teacher.job.upload.commit',uploadId});
 return committed;
}
async function startBatchProject({projectId:pid,scenes,provider:chosen,connectionId,storyName,onProgress,poolMode=false,skipConfigCheck=false}){
 if(!access()?.isReady?.())throw Error('กรุณาเข้าสู่ระบบ GitHub แอดมิน');
 if(!['gemini','openrouter','compatible'].includes(chosen))
  throw Error('กรุณาเลือก AI Provider ที่เชื่อมไว้');
 if(!Array.isArray(scenes)||scenes.length<1||scenes.length>350)
  throw Error('หนึ่ง JSON ต้องมี 1–350 ฉากที่ถูกต้อง');
 // Multi-JSON already fetched this config once for the entire submission.
 // The AWS prepare/commit endpoints still authenticate and check job readiness.
 if(!skipConfigCheck){
  const cfg=await request({action:'teacher.job.config'});
  if(!cfg?.enabled)throw Error('Cloud Background Jobs ยังไม่พร้อม');
 }
 const bytes=new root.TextEncoder().encode(JSON.stringify(scenes)).length;
 if(bytes>4_000_000)throw Error('บทพากย์รวมใหญ่เกิน 4 MB');
 return startUploaded(pid,scenes,chosen,onProgress||(()=>{}),connectionId,storyName,poolMode);
}
async function teach(fallback){
 if(busy)return adapter?.getState?.();
 if(!access()?.isReady?.())return fallback();
 busy=true;error='';repaint();
 try{
  const cfg=await request({action:'teacher.job.config'});
  known=true;enabled=!!cfg.enabled;
  if(!enabled)return fallback();
  if(job&&['queued','running'].includes(job.state)){
   error='มีงานบน AWS กำลังสอนอยู่แล้ว · ใช้ปุ่มตรวจสถานะ หรือพัก/ยกเลิกงานเดิมก่อนเริ่มงานใหม่';
   repaint();return adapter.getState();
  }
  // Rescan locally: the uploaded snapshot must correspond to current JSON.
  await adapter.scan();
  const scanned=adapter.getScan();
  if(!scanned||!scanned.rows?.length)throw Error('ยังไม่มีฉากให้สอน');
  const id=projectId();
  if(!id)throw Error('ไม่พบรหัสโปรเจกต์');
  const scenes=scanned.rows.map(x=>({
   id:x.id,episodeId:x.episodeId,text:x.text,previous:x.previous,
   next:x.next,studentIssue:x.studentIssue}));
  const bytes=new root.TextEncoder().encode(JSON.stringify(scenes)).length;
  // Small projects keep the existing one-call start API.
  const out=bytes>160000
   ? await startUploaded(id,scenes)
   : await request({action:'teacher.job.start',projectId:id,
      provider:adapter.provider,scenes});
  if(!out?.job)throw Error('AWS ยังไม่ยืนยันการสร้างงาน');
  uploadState=null;
  setJob(out.job);
  return adapter.getState();
 }catch(e){
  error='เริ่มงานไม่สำเร็จ: '+String(e.message||e);
  repaint();throw e;
 }finally{busy=false;repaint()}
}
async function control(action){
 if(!job||busy)return;
 if(action==='cancel'&&root.confirm&&!root.confirm(
  'ยกเลิกงาน AWS นี้? บทเรียนที่บันทึกแล้วจะยังอยู่'))return;
 busy=true;error='';repaint();
 try{
  const out=await request({action:'teacher.job.'+action,jobId:job.jobId});
  if(out?.job)setJob(out.job);
 }catch(e){error=String(e.message||e);repaint()}
 finally{busy=false;repaint()}
}
function decorate(host){
 const panel=host?.firstElementChild;
 if(!panel||!adapter)return;
 const doc=root.document;
 const box=doc.createElement('section');
 box.className='teacher-cloud-jobs';
 box.style.cssText='padding:12px;margin:10px 0;border:1px solid #5c7790;border-radius:12px;background:#15263a;color:#e6edf4';
 const heading=doc.createElement('strong');
 heading.textContent='AWS Background Jobs';
 const text=doc.createElement('p');
 text.textContent=progressText();
 text.style.cssText='margin:8px 0;font-size:13px;line-height:1.6';
 box.append(heading,text);
 if(uploadState){
  const meter=doc.createElement('progress');
  meter.max=uploadState.total;meter.value=uploadState.done;
  meter.style.cssText='width:100%;height:13px;accent-color:#4eae84';
  meter.setAttribute('aria-label','ความคืบหน้าอัปโหลด JSON ไป AWS');
  box.append(meter);
  box.append(doc.createTextNode('ระหว่างส่งไฟล์ต้องเปิดหน้านี้ไว้ก่อน · หลัง AWS รับงานแล้วปิดเว็บได้'));
 }
 if(job){
  const meter=doc.createElement('progress');
  meter.max=job.total||1;meter.value=job.completed||0;
  meter.style.cssText='width:100%;height:13px;accent-color:#4eae84';
  meter.setAttribute('aria-label','ความคืบหน้าฝึก AI บน AWS');
  box.append(meter);
  const buttons=doc.createElement('div');
  buttons.className='teacher-row';
  const add=(label,command)=>{
   const b=doc.createElement('button');
   b.type='button';b.disabled=busy;b.textContent=label;
   b.addEventListener('click',()=>{control(command).catch(()=>{})});
   buttons.append(b);
  };
  if(['queued','running'].includes(job.state))add('พักงาน','pause');
  if(['paused','needs-attention'].includes(job.state))add('ทำต่อจากฉากที่ค้าง','resume');
  if(!['completed','cancelled'].includes(job.state))add('ยกเลิกงาน','cancel');
  const refreshBtn=doc.createElement('button');
  refreshBtn.type='button';refreshBtn.textContent='รีเฟรชสถานะ AWS';
  refreshBtn.addEventListener('click',()=>refresh().catch(()=>{}));
  buttons.append(refreshBtn);
  box.append(buttons);
  if(job.qaAutoRecoveryAvailable){
   const notice=doc.createElement('p');
   notice.textContent='QA ไม่ผ่าน · ระบบกำลังกู้คิวหนึ่งครั้งและสอนฉากที่ค้างแยกทีละฉากโดยอัตโนมัติ';
   box.append(notice);
  }
  if(job.error){const warning=doc.createElement('p');
   warning.textContent=job.error;box.append(warning)}
  if(Array.isArray(job.qaFailures)&&job.qaFailures.length){
   const labels={
    missing_scene:'โมเดลไม่ได้ส่งบทเรียนของฉากนี้',
    invalid_issue:'ประเภทการแก้ไขไม่ถูกต้อง',
    invalid_revision_length:'บทที่ส่งมาสั้นหรือยาวเกินเกณฑ์',
    missing_reason:'โมเดลไม่ได้ให้เหตุผลที่เพียงพอ',
    keep_must_preserve_original:'โมเดลสั่งคงบท แต่แก้ข้อความ',
    changed_label_without_change:'โมเดลสั่งแก้บท แต่ไม่เปลี่ยนข้อความ',
    retry_provider_unavailable:'โมเดลไม่ตอบตอนแก้ซ้ำ',
    missing_valid_lesson:'บทเรียนยังไม่ผ่านการตรวจโครงสร้าง'
   };
   const details=doc.createElement('details');
   const summary=doc.createElement('summary');
   summary.textContent='ดูฉากที่ QA ไม่ผ่าน '+(job.qaFailureCount||job.qaFailures.length)+' ฉาก';
   details.append(summary);
   for(const failure of job.qaFailures){
    const p=doc.createElement('p');
    p.textContent=failure.sceneId+' · '+(labels[failure.reason]||failure.reason);
    details.append(p);
   }
   box.append(details);
  }
 }
 if(error){const warning=doc.createElement('p');
  warning.textContent=error;warning.style.color='#ffd3a1';box.append(warning)}
 panel.insertBefore(box,panel.children[3]||null);
 // Original button retains its own event handler; only update its label.
 const buttons=panel.querySelectorAll('button');
 for(const b of buttons)if(b.textContent.includes('2. AI แม่สอนและบันทึก AWS')){
  b.textContent=enabled?'2. เริ่มสอนบน AWS (ปิดเว็บได้)':b.textContent;break;
 }
}
function mount(bridge){
 adapter=bridge;job=null;known=false;enabled=false;error='';uploadState=null;
 if(timer)clearTimeout(timer);
 restore().catch(()=>{});
}
function afterScan(){
 if(job?.state==='completed')loadResults().catch(()=>{});
}
root.StoryCloudTeach=Object.freeze({mount,decorate,teach,afterScan,refresh,startBatchProject});
if(typeof root.addEventListener==='function'){
 root.addEventListener('online',()=>{if(job)refresh().catch(()=>{})});
 root.addEventListener('visibilitychange',()=>{
  if(job&&root.document?.visibilityState==='visible')refresh().catch(()=>{})});
 root.addEventListener('story-studio-access-change',()=>{
  if(access()?.isReady?.())restore().catch(()=>{})});
}
})(window);
