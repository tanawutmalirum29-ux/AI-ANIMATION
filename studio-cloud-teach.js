/* Cloud AI Mother: jobs continue in AWS without a live browser. No API keys,
 * session tokens, project JSON, or training data are written to localStorage.
 * The server remains the authoritative source of job progress and permissions.
 */
(function(root){
'use strict';
let adapter=null,job=null,enabled=false,known=false,busy=false,error='';
let timer=null,restoreEpoch=0,loadingResults=false;
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
  if(out?.job)setJob(out.job);
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
  job=out?.job||null;
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
async function teach(fallback){
 if(busy)return adapter?.getState?.();
 if(!access()?.isReady?.())return fallback();
 busy=true;error='';repaint();
 try{
  const cfg=await request({action:'teacher.job.config'});
  known=true;enabled=!!cfg.enabled;
  if(!enabled)return fallback();
  // Rescan locally: the uploaded snapshot must correspond to current JSON.
  await adapter.scan();
  const scanned=adapter.getScan();
  if(!scanned||!scanned.rows?.length)throw Error('ยังไม่มีฉากให้สอน');
  const id=projectId();
  if(!id)throw Error('ไม่พบรหัสโปรเจกต์');
  const out=await request({action:'teacher.job.start',projectId:id,
   provider:adapter.provider,
   scenes:scanned.rows.map(x=>({
    id:x.id,episodeId:x.episodeId,text:x.text,previous:x.previous,
    next:x.next,studentIssue:x.studentIssue}))});
  if(!out?.job)throw Error('AWS ยังไม่ยืนยันการสร้างงาน');
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
  if(job.error){const warning=doc.createElement('p');
   warning.textContent=job.error;box.append(warning)}
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
 adapter=bridge;job=null;known=false;enabled=false;error='';
 if(timer)clearTimeout(timer);
 restore().catch(()=>{});
}
function afterScan(){
 if(job?.state==='completed')loadResults().catch(()=>{});
}
root.StoryCloudTeach=Object.freeze({mount,decorate,teach,afterScan,refresh});
if(typeof root.addEventListener==='function'){
 root.addEventListener('online',()=>{if(job)refresh().catch(()=>{})});
 root.addEventListener('visibilitychange',()=>{
  if(job&&root.document?.visibilityState==='visible')refresh().catch(()=>{})});
 root.addEventListener('story-studio-access-change',()=>{
  if(access()?.isReady?.())restore().catch(()=>{})});
}
})(window);
