/* Multi-JSON AI Mother Cloud Intake.
 * Selected JSON is parsed and checked locally. Only scene narration/context is
 * uploaded to existing AWS teacher jobs. No model keys, full source media,
 * or raw JSON stored in localStorage. Running jobs are rediscovered from AWS.
 */
(function(root){
'use strict';
let host=null,items=[],jobs=[],connections=[],selection='auto',loading=false,
 uploading=false,checking=false,adding=false,renaming=false,error='',notice='',timer=null;
let olderJobs=[],nextJobCursor=null,loadingOlder=false;
let poolAvailable=false,poolWanted=false,scalableVault=false,expandKeys=false;
let editingConnectionId='';
let keyDraft={provider:'gemini',model:'',baseUrl:''};
const MAX_FILES=100,MAX_FILE_BYTES=8*1024*1024,MAX_TOTAL_BYTES=64*1024*1024;
const UPLOAD_PARALLEL=3;
function dom(tag,text,cls){
 const e=root.document.createElement(tag);
 if(text!=null)e.textContent=String(text);
 if(cls)e.className=cls;
 return e;
}
function button(label,callback,disabled=false){
 const b=dom('button',label);b.type='button';b.disabled=disabled;
 b.addEventListener('click',()=>callback().catch(e=>{error=String(e.message||e);render()}));
 return b;
}
function api(action,other={}){
 if(!root.StoryStudioAccess?.isReady?.())
  throw Error('ต้องเข้าสู่ระบบด้วย GitHub แอดมินก่อน');
 return root.StoryStudioAccess.request({action,...other});
}
async function digest(text){
 if(!root.crypto?.subtle?.digest)throw Error('อุปกรณ์ไม่รองรับ SHA-256');
 const bytes=new root.TextEncoder().encode(text);
 const raw=new Uint8Array(await root.crypto.subtle.digest('SHA-256',bytes));
 return Array.from(raw,b=>b.toString(16).padStart(2,'0')).join('');
}
// The batch teacher accepts the same narration-only formats as Story Only.
// Convert in memory; never upload original JSON, media or provider credentials.
function normalizeForTraining(input){
 const story=root.StoryOnlyJSON;
 if(story?.appearsTextOnly?.(input)){
  if(typeof story.convert!=='function')throw Error('ตัวแปลง JSON เนื้อเรื่องล้วนยังไม่พร้อม');
  return story.convert(input);
 }
 if(input?.type==='story-only'||Array.isArray(input?.chapters))
  throw Error('ตัวแปลง JSON เนื้อเรื่องล้วนยังไม่พร้อม กรุณาโหลดหน้าเว็บใหม่');
 return input;
}
async function prepare(files){
 if(uploading||checking)return;
 if(!files.length)return;
 const selected=Array.from(files);
 // Accepted jobs live on AWS. Remove their transient browser rows when a
 // new selection arrives; preserve unsent/failed files for retry or next pick.
 const remaining=items.filter(x=>x.state!=='accepted');
 if(selected.length+remaining.length>MAX_FILES){
  error='เกินขีดจำกัดคิว '+MAX_FILES+' ไฟล์ กรุณาส่งงานหรือล้างรายการก่อนเลือกเพิ่ม';
  render();return;
 }
 const bytes=selected.reduce((n,f)=>n+f.size,0)+
  remaining.reduce((n,x)=>n+(x.state==='invalid'?0:x.bytes||0),0);
 if(bytes>MAX_TOTAL_BYTES){
  error='ไฟล์ที่ยังไม่ส่งรวมกันเกิน 64 MB กรุณาส่งบางส่วนก่อนเลือกเพิ่ม';render();return;
 }
 checking=true;error='';notice='กำลังตรวจ JSON บนอุปกรณ์…';
 items=remaining;render();
 const seen=new Set(items.filter(x=>x.projectId&&x.state!=='invalid').map(x=>x.projectId));
 try{
  for(const [index,file] of selected.entries()){
   const entry={name:file.name.slice(0,130),bytes:file.size,state:'checking',count:0,done:0,total:0,
                skipped:0,error:'',scenes:null,projectId:''};
   items.push(entry);render();
   try{
    if(!file.name.toLowerCase().endsWith('.json'))throw Error('รองรับเฉพาะไฟล์ .json');
    if(file.size>MAX_FILE_BYTES)throw Error('ขนาด JSON เกิน 8 MB');
    const input=JSON.parse((await file.text()).replace(/^\uFEFF/,''));
    const project=normalizeForTraining(input);
    if(!Array.isArray(project?.episodes)||!project.episodes.length)
     throw Error('ไม่พบ episodes ใน JSON');
    if(!root.StoryAutoTeach?.childScan)throw Error('โมดูล AI ลูกยังไม่พร้อม');
    const check=root.StoryAutoTeach.childScan(project,null,root.StoryContinuityCoach);
    if(!check.rows.length)throw Error('ไม่มีฉากที่มีบทพากย์ถูกต้อง');
    if(check.rows.length>350)throw Error('ไฟล์นี้เกิน 350 ฉากต่อหนึ่งงาน');
    if(check.skipped.length)throw Error('ตรวจพบ '+check.skipped.length+
       ' ฉากไม่ผ่านเกณฑ์ กรุณาแก้ JSON ก่อนสอน เพื่อไม่ข้ามข้อมูลโดยไม่ตั้งใจ');
    entry.scenes=check.rows.map(r=>({
     id:r.id,episodeId:r.episodeId,text:r.text,previous:r.previous,
     next:r.next,studentIssue:r.studentIssue}));
    const serialized=JSON.stringify(entry.scenes);
    if(new root.TextEncoder().encode(serialized).length>4_000_000)
     throw Error('ข้อมูลบทพากย์รวมเกิน 4 MB');
    const hash=await digest(JSON.stringify([
     project.project?.title||input.title||file.name,entry.scenes]));
    entry.projectId='multi-'+hash.slice(0,24);
    if(seen.has(entry.projectId))throw Error('ไฟล์นี้มีบทพากย์ซ้ำกับไฟล์ที่เลือกแล้ว');
    seen.add(entry.projectId);
    entry.storyName=String(project.project?.title||input.title||file.name.replace(/\.json$/i,'')).slice(0,100);
    entry.count=entry.scenes.length;entry.state='ready';
   }catch(e){entry.state='invalid';entry.error=String(e.message||e);entry.scenes=null}
   if(index%5===4||index===selected.length-1)render();
  }
  notice=items.filter(x=>x.state==='ready').length+' ไฟล์พร้อมส่ง · เพิ่ม JSON ได้อีกหรือกดส่งทั้งหมด';
 }finally{checking=false;render()}
}
async function loadSettings(){
 if(loading)return;
 loading=true;error='';render();
 try{
  const [keys,config]=await Promise.all([
   api('teacher.connection.list'),api('teacher.job.config')]);
  if(!config.enabled)throw Error('AWS Background Jobs ยังไม่เปิดใช้งาน');
  poolAvailable=config.poolEnabled===true;
  if(!poolAvailable)poolWanted=false;
  scalableVault=keys.maxExtra===null;
  connections=(keys.connections||[]).filter(x=>x.ready);
  if(!connections.some(x=>String(x.id).startsWith('key-')))poolWanted=false;
  connections.sort((a,b)=>(a.legacy===b.legacy?0:a.legacy?-1:1)||
   (a.createdAt||0)-(b.createdAt||0)||a.name.localeCompare(b.name));
  if(selection!=='auto'&&!connections.some(p=>p.id===selection))
   selection='auto';
  if(!connections.length)notice='ยังไม่มี API Key · เพิ่มคีย์ด้านล่างได้เลย';
  await refresh(true);
 }catch(e){error=String(e.message||e)}
 finally{loading=false;render()}
}
function schedule(){
 if(timer)clearTimeout(timer);
 timer=null;
 if(!host)return;
 timer=setTimeout(()=>refresh().catch(()=>{}),
   root.document?.visibilityState==='hidden'?60000:17000);
}
async function refresh(silent=false,resetOlder=false){
 if(!root.StoryStudioAccess?.isReady?.()){schedule();return}
 try{
  const response=await api('teacher.job.list');
  jobs=Array.isArray(response.jobs)?response.jobs:[];
  if(resetOlder){olderJobs=[];nextJobCursor=null}
  if(!olderJobs.length)nextJobCursor=response.nextCursor||null;
  if(!silent){error='';render()}
 }catch(e){if(!silent){error='อ่านสถานะ AWS ไม่สำเร็จ: '+String(e.message||e);render()}}
 finally{schedule()}
}
async function loadOlderJobs(){
 if(loadingOlder||!nextJobCursor||uploading)return;
 loadingOlder=true;render();
 try{
  const response=await api('teacher.job.list',{cursor:nextJobCursor});
  const seen=new Set([...jobs,...olderJobs].map(x=>x.jobId));
  for(const job of response.jobs||[]){
   if(!seen.has(job.jobId)){olderJobs.push(job);seen.add(job.jobId)}
  }
  nextJobCursor=response.nextCursor||null;
 }catch(e){error='โหลดรายการงานเก่าจาก AWS ไม่สำเร็จ: '+String(e.message||e)}
 finally{loadingOlder=false;render()}
}
// LPT scheduling: assign each entire story to the least loaded connection.
 // Context remains coherent within one story; existing AWS workers split its
 // scenes in small batches and reuse approved lessons before API calls.
function planAssignments(batch){
 const active=new Map(connections.map(k=>[k.id,0]));
 for(const job of jobs){
  if(['queued','running'].includes(job.state)&&active.has(job.connectionId))
   active.set(job.connectionId,active.get(job.connectionId)+Number(job.remaining||0));
 }
 const chosen=new Map();
 for(const item of [...batch].sort((a,b)=>b.count-a.count)){
  let conn;
  if(item.connectionId&&connections.some(k=>k.id===item.connectionId))
   conn=connections.find(k=>k.id===item.connectionId);
  else if(selection!=='auto')
   conn=connections.find(k=>k.id===selection);
  else conn=[...connections].sort((a,b)=>
    (active.get(a.id)||0)-(active.get(b.id)||0)||a.id.localeCompare(b.id))[0];
  if(!conn)throw Error('ไม่พบการเชื่อมต่อ API ที่พร้อมใช้งาน');
  chosen.set(item,conn);
  active.set(conn.id,(active.get(conn.id)||0)+item.count);
 }
 return chosen;
}
// At most three concurrent AWS intake jobs. A single upload still sends
// immutable 16-scene chunks sequentially and can resume after disconnection.
// This controls HTTP intake only: server-side AI inference respects key leases.
async function runLimited(entries,limit,worker){
 let next=0;
 await Promise.all(Array.from({length:Math.min(limit,entries.length)},async()=>{
  while(next<entries.length){
   const index=next++;
   await worker(entries[index],index);
  }
 }));
}
let progressQueued=false;
function progressRender(){
 if(progressQueued)return;
 progressQueued=true;
 root.setTimeout(()=>{progressQueued=false;render()},160);
}
async function start(){
 if(uploading||checking)return;
 const valid=items.filter(x=>x.state==='ready'||x.state==='failed');
 if(!valid.length){error='กรุณาเลือกไฟล์ JSON ที่ผ่านการตรวจ';render();return}
 if(!connections.length){error='กรุณาเพิ่ม API Key ก่อน';render();return}
 uploading=true;error='';notice='กำลังตรวจและส่งงาน AWS พร้อมกันสูงสุด '+UPLOAD_PARALLEL+' เรื่อง…';render();
 let accepted=0,failed=0;
 try{
  await refresh(true);
  const unverified=[];
  for(const item of valid){
   const prior=jobs.find(j=>j.projectId===item.projectId);
   if(prior){
    if(prior.state==='cancelled'){
     item.state='failed';
     item.error='งานเวอร์ชันนี้เคยยกเลิก กรุณาแก้ไข JSON เป็นเวอร์ชันใหม่';
     failed++;
    }else{
     item.state='accepted';item.jobId=prior.jobId;item.scenes=null;
     item.connectionId=prior.connectionId;
     item.connectionName=connections.find(k=>k.id===prior.connectionId)?.name||prior.provider;
     accepted++;
    }
    continue;
   }
   unverified.push(item);
  }
  // Existing partial upload lookup is parallel but limited to protect AWS.
  await runLimited(unverified,UPLOAD_PARALLEL,async item=>{
   item.state='finding';progressRender();
   try{
    const found=await api('teacher.job.upload.find',{projectId:item.projectId});
    if(found.upload){
     const existing=connections.find(c=>c.id===found.upload.connectionId);
     if(!existing)throw Error('API Key ของอัปโหลดเดิมถูกถอดออก กรุณาเชื่อมใหม่');
     item.connectionId=existing.id;item.connectionName=existing.name;
     item.poolMode=found.upload.poolMode===true;
    }
    item.state='ready';delete item.lookupFailed;
   }catch(e){
    item.state='failed';item.error=String(e.message||e);item.lookupFailed=true;failed++;
   }
   progressRender();
  });
  const pending=unverified.filter(item=>!item.lookupFailed);
  // Least-load assignment is pinned to each file before parallel upload.
  const assignments=planAssignments(pending);
  await runLimited(pending,UPLOAD_PARALLEL,async item=>{
   const conn=assignments.get(item);
   item.connectionId=conn.id;item.connectionName=conn.name;
   item.state='uploading';item.error='';progressRender();
   try{
    const out=await root.StoryCloudTeach.startBatchProject({
     projectId:item.projectId,scenes:item.scenes,storyName:item.storyName,
     provider:conn.provider,connectionId:conn.id,
     poolMode:item.poolMode===true||(item.poolMode==null&&poolWanted&&poolAvailable),
     onProgress:(done,total)=>{item.done=done;item.total=total;progressRender()}});
    if(!out?.job?.jobId)throw Error('AWS ยังไม่ยืนยันหมายเลขงาน');
    item.state='accepted';item.done=item.total;item.jobId=out.job.jobId;
    item.scenes=null;accepted++;
   }catch(e){
    failed++;item.state='failed';item.error=String(e.message||e);
   }
   notice='AWS รับแล้ว '+accepted+' เรื่อง · ค้างส่ง '+failed+
    ' เรื่อง · เริ่มสอนบนเซิร์ฟเวอร์ตามโควตาแต่ละ API Key';
   progressRender();
  });
  await refresh(true);
  notice='AWS รับแล้ว '+accepted+' เรื่อง · ค้างส่ง '+failed+
   ' เรื่อง · ปิดหน้าเว็บได้เมื่อรับครบ คิวสอนทำต่อบน AWS';
 }finally{uploading=false;progressQueued=false;render()}
}
async function addConnection(){
 if(adding||uploading)return;
 const panel=host;
 const selected=keyDraft.provider;
 const model=(panel.querySelector('#multiKeyModel')?.value||'').trim();
 const baseUrl=(panel.querySelector('#multiKeyBase')?.value||'').trim();
 const keyNode=panel.querySelector('#multiKeyValue');
 const apiKey=keyNode?.value.trim()||'';
 if(keyNode)keyNode.value='';
 if(!apiKey)throw Error('กรุณาใส่ API Key');
 adding=true;error='';render();
 try{
  const result=await api('teacher.connection.add',{
   provider:selected,model,baseUrl,apiKey});
  if(!result?.connection?.id)throw Error('AWS ยังไม่ยืนยันการเชื่อม API');
  notice='เพิ่ม API แม่แล้ว · แสดงชื่อ AI แม่ตามลำดับในรายการ';
  await loadSettings();
 }finally{adding=false;render()}
}
async function testConnection(conn){
 const result=await api('teacher.connection.test',{connectionId:conn.id});
 notice=result?.ready?'ทดสอบสำเร็จ: '+conn.name:'ยังไม่ยืนยันโมเดลของ '+conn.name;
 render();
}
async function renameConnection(conn){
 if(renaming)return;
 const input=host?.querySelector('#multiRenameValue');
 const name=input?.value.trim()||'';
 renaming=true;error='';
 try{
  const result=await api('teacher.connection.rename',{
   connectionId:conn.id,name});
  if(!result?.connection?.id)throw Error('AWS ยังไม่ยืนยันการเปลี่ยนชื่อ');
  editingConnectionId='';
  await loadSettings();
  notice='บันทึกชื่อ '+result.connection.name+' บน AWS แล้ว';
 }finally{renaming=false;render()}
}
async function removeConnection(conn){
 if(conn.legacy)throw Error('คีย์หลักจัดการได้จากแท็บ AI ครู / API');
 if(!root.confirm?.('ลบ '+conn.name+'? ถ้ามีงานกำลังใช้คีย์นี้ จะไม่อนุญาตให้ลบ'))return;
 await api('teacher.connection.remove',{
  connectionId:conn.id,confirmRemove:true});
 notice='ลบการเชื่อมต่อ '+conn.name+' แล้ว';
 await loadSettings();
}
async function control(job,action){
 if(action==='cancel'&&root.confirm&&!root.confirm(
   'ยกเลิกงานนี้? บทเรียนที่ AWS บันทึกแล้วจะยังอยู่'))return;
 await api('teacher.job.'+action,{jobId:job.jobId});
 await refresh(true);render();
}
function itemRow(item){
 const row=dom('div',null,'multi-json-item');
 const title=dom('strong',(item.storyName||item.name)+' · '+item.name);row.append(title);
 const label={checking:'กำลังตรวจ',ready:'ตรวจผ่าน',
  invalid:'ตรวจไม่ผ่าน',finding:'ตรวจอัปโหลดเดิม',uploading:'กำลังส่ง AWS',accepted:'AWS รับงานแล้ว',
  failed:'ส่งไม่สำเร็จ'}[item.state]||item.state;
 row.append(dom('small',label+' · '+item.count+' ฉาก'+
  (item.connectionName?' · '+item.connectionName:'')+
  (item.total?' · '+item.done+'/'+item.total+' ชุด':'')+
  (item.error?' · '+item.error:'')));
 if(item.total){
  const meter=dom('progress');meter.max=item.total;meter.value=item.done;row.append(meter);
 }
 return row;
}
function jobRow(job){
 const row=dom('div',null,'multi-json-item');
 row.append(dom('strong','เรื่อง '+(job.storyName||job.projectId||'').slice(0,100)),
  dom('small',(job.trainingPending?'รอคิวฝึก AI ลูก':job.state)+
    ' · '+job.completed+'/'+job.total+' ฉาก · บันทึก '+
    job.saved+' · ใช้ความจำ '+job.reused+' · '+
    (job.poolMode?'แบ่งงานเมื่อว่าง · ล่าสุด '+
       (connections.find(k=>k.id===job.lastConnectionId)?.name||job.lastConnectionId||'รอเริ่ม')+
       (job.unusableKeys?' · ข้ามคีย์มีปัญหา '+job.unusableKeys+' ตัว':''):
       (connections.find(k=>k.id===job.connectionId)?.name||job.provider))));
 const meter=dom('progress');meter.max=job.total||1;meter.value=job.completed||0;row.append(meter);
 if(job.nextRetryAt && Number.isFinite(Number(job.nextRetryAt)) &&
    Number(job.nextRetryAt)*1000>Date.now()){
  const when=new Date(Number(job.nextRetryAt)*1000).toLocaleString('th-TH',{
   timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',day:'numeric',month:'short'});
  row.append(dom('small','ระบบเก็บ Checkpoint แล้ว · จะลอง API อีกครั้งหลัง '+when+
    ' · ปิดเว็บได้','multi-json-muted'));
 }
 if(job.error)row.append(dom('small','AWS: '+job.error,'multi-json-error'));
 if(job.lastProviderReason && job.error){
  const cause={
   TEACHER_PROVIDER_TIMEOUT:'AI ตอบไม่ทันเวลารอ',
   TEACHER_PROVIDER_NETWORK:'เครือข่ายเชื่อม API ขัดข้อง',
   TEACHER_PROVIDER_UPSTREAM:'เซิร์ฟเวอร์ AI ตอบ HTTP 408/5xx',
   TEACHER_PROVIDER_BAD_RESPONSE:'AI ส่ง JSON ที่อ่านไม่ได้',
   AWS_NETWORK_TRANSIENT:'AWS หรือเครือข่ายตอบช้า'
  }[job.lastProviderReason]||'เกิดปัญหาชั่วคราวระหว่างเรียก AI';
  row.append(dom('small','สาเหตุ: '+cause+
   (Number(job.transientFailures)>0?' · ลองใหม่รอบ '+job.transientFailures:''),
   'multi-json-muted'));
 }
 const controls=dom('div',null,'multi-json-actions');
 if(['queued','running'].includes(job.state))
  controls.append(button('พัก',()=>control(job,'pause')));
 if(['paused','needs-attention'].includes(job.state))
  controls.append(button('ทำต่อ',()=>control(job,'resume')));
 if(!['completed','cancelled'].includes(job.state))
  controls.append(button('ยกเลิก',()=>control(job,'cancel')));
 row.append(controls);
 return row;
}
function connectionPanel(){
 const box=dom('section',null,'multi-json-connections');
 const github=root.StoryStudioAccess?.user?.();
 box.append(dom('h4','AI แม่ที่เชื่อมต่อ · เปลี่ยนชื่อได้'),
  dom('p','ผูกกับบัญชี GitHub: '+(github?.login||'แอดมินที่เข้าสู่ระบบ')+
   ' · เก็บใน AWS ข้ามเครื่องได้จนกว่าจะลบ · '+
   (scalableVault?'คลังคีย์รุ่นใหม่ไม่จำกัด 6 คีย์':'โหมดเดิมสูงสุด 6 คีย์เพิ่มเติม')+
   ' · ไม่บันทึกคีย์ในเบราว์เซอร์','multi-json-muted'));
 const shown=expandKeys?connections:connections.slice(0,20);
 box.append(dom('p','เชื่อมต่อพร้อมใช้งาน '+connections.length+
   ' คีย์ · แสดง '+shown.length+' คีย์','multi-json-muted'));
 for(const conn of shown){
  const line=dom('div',null,'multi-json-key');
  const info=dom('div',null,'multi-json-key-info');
  info.append(dom('strong',conn.name),
   dom('small',conn.provider.toUpperCase()+' · '+conn.model+
     (conn.legacy?' · คีย์หลัก':'')));
  const actions=dom('div',null,'multi-json-key-actions');
  actions.append(button('เปลี่ยนชื่อ',async()=>{
   editingConnectionId=editingConnectionId===conn.id?'':conn.id;
   render();
   host?.querySelector('#multiRenameValue')?.focus();
  },uploading||adding||renaming),
   button('ทดสอบ',()=>testConnection(conn),uploading||adding||renaming));
  if(!conn.legacy)actions.append(button('ลบ',()=>removeConnection(conn),
   uploading||adding||renaming));
  line.append(info,actions);
  if(editingConnectionId===conn.id){
   const editor=dom('div',null,'multi-json-rename');
   const value=dom('input');value.id='multiRenameValue';value.type='text';
   value.maxLength=40;value.value=conn.customName||'';
   value.placeholder='ชื่อใหม่ (เว้นว่าง = ใช้ AI แม่ตามลำดับ)';
   value.setAttribute('aria-label','ชื่อ AI แม่ใหม่');
   value.addEventListener('keydown',event=>{
    if(event.key==='Enter'){
     event.preventDefault();
     renameConnection(conn).catch(e=>{error=String(e.message||e);render()});
    }
    if(event.key==='Escape'){editingConnectionId='';render()}
   });
   editor.append(value,
    button(renaming?'กำลังบันทึก…':'บันทึกชื่อ',()=>renameConnection(conn),renaming),
    button('ยกเลิก',async()=>{editingConnectionId='';render()},renaming));
   line.append(editor);
  }
  box.append(line);
 }
 if(connections.length>20){
  box.append(button(expandKeys?'แสดง 20 คีย์แรก':'แสดงคีย์ทั้งหมด ('+connections.length+')',
   async()=>{expandKeys=!expandKeys;render()}));
 }
 const form=dom('div',null,'multi-json-key-form');
 const prov=dom('select');prov.setAttribute('aria-label','บริการ API เพิ่ม');
 for(const p of ['gemini','openrouter','compatible']){
  const op=dom('option',p==='gemini'?'Google Gemini':p==='openrouter'?'OpenRouter':'OpenAI-compatible');
  op.value=p;op.selected=p===keyDraft.provider;prov.append(op);
 }
 prov.addEventListener('change',()=>{
  keyDraft.provider=prov.value;keyDraft.model='';keyDraft.baseUrl='';
  render();
 });
 const model=dom('input');model.id='multiKeyModel';
 model.placeholder=keyDraft.provider==='gemini'?'gemini-3.5-flash-lite':
  keyDraft.provider==='openrouter'?'openrouter/free':'Model ID (จำเป็น)';
 model.value=keyDraft.model;model.setAttribute('aria-label','Model ID (เว้นว่างใช้ค่าเริ่มต้น)');
 model.addEventListener('input',()=>{keyDraft.model=model.value});
 const base=dom('input');base.id='multiKeyBase';
 base.placeholder='https://api.example.com/v1';
 base.value=keyDraft.baseUrl;base.setAttribute('aria-label','API Base URL ที่ AWS อนุญาต');
 base.hidden=keyDraft.provider!=='compatible';
 base.addEventListener('input',()=>{keyDraft.baseUrl=base.value});
 const key=dom('input');key.id='multiKeyValue';key.type='password';
 key.placeholder='วาง API Key ใหม่';key.autocomplete='off';
 key.setAttribute('aria-label','API Key ใหม่');
 form.append(prov,model,base,key,button(adding?'กำลังเชื่อม…':'เพิ่ม API Key',addConnection,adding||uploading));
 box.append(form);
 box.append(dom('p','หาก Provider ตอบ 429 ระบบ Pool จะพักงานไว้และลองใหม่อัตโนมัติโดยไม่ลบฉากที่สอนแล้ว','multi-json-muted'));
 return box;
}

function render(){
 if(!host)return;
 host.replaceChildren();
 const panel=dom('section',null,'multi-json');
 panel.append(dom('h3','สอน AI ลูกจากหลาย JSON'),
  dom('p','เลือกเพิ่มได้สูงสุด 100 เรื่องในคิว (รวมไม่เกิน 64 MB) · ส่ง AWS พร้อมกันสูงสุด 3 เรื่อง · เซิร์ฟเวอร์สอนหลายเรื่องพร้อมกันได้เมื่อใช้ API Key อิสระที่มีโควตา','multi-json-muted'));
 const picker=dom('input');picker.type='file';picker.accept='.json,application/json';
 picker.multiple=true;picker.disabled=uploading||checking;
 picker.setAttribute('aria-label','เลือก JSON หลายไฟล์');
 picker.addEventListener('change',()=>prepare(picker.files).catch(e=>{
  error=String(e.message||e);checking=false;render()}));
 panel.append(picker);
 panel.append(dom('p','เลือกไฟล์เพิ่มได้หลายรอบโดยไม่ล้างคิวที่ยังไม่ส่ง · ไฟล์ JSON แต่ละเรื่องยังจำกัด 8 MB / 350 ฉาก · ลบข้อมูลชั่วคราวจากเครื่องหลัง AWS รับงาน','multi-json-muted'));
 if(items.length){
  const block=dom('div',null,'multi-json-list');
  for(const item of items)block.append(itemRow(item));
  panel.append(block);
  panel.append(dom('p','รายการในคิว '+items.length+'/'+MAX_FILES+' · พร้อมส่ง '+items.filter(x=>x.state==='ready').length+
   ' · AWS รับแล้ว '+items.filter(x=>x.state==='accepted').length,'multi-json-muted'));
  panel.append(button('ล้างรายการที่ส่งแล้ว',async()=>{
   if(uploading||checking)return;
   items=items.filter(x=>x.state!=='accepted');
   render();
  },uploading||checking||!items.some(x=>x.state==='accepted')));
  panel.append(button('ล้างคิวทั้งหมดบนหน้านี้',async()=>{
   if(uploading||checking)return;
   if(root.confirm&&!root.confirm('ล้างรายการที่เลือกในเบราว์เซอร์? ไม่ลบงานหรือบทเรียนบน AWS'))return;
   items=[];notice='ล้างรายการในเบราว์เซอร์แล้ว งานบน AWS ไม่เปลี่ยน';render();
  },uploading||checking));
 }
 const actions=dom('div',null,'multi-json-actions');
 const select=dom('select');select.disabled=uploading||loading;
 select.setAttribute('aria-label','วิธีกระจายงาน AI');
 const auto=dom('option','อัตโนมัติ · แบ่งเรื่องตามคิวแต่ละ API');
 auto.value='auto';auto.selected=selection==='auto';select.append(auto);
 for(const p of connections){
  const op=dom('option',p.name+' · '+p.model);op.value=p.id;
  op.selected=p.id===selection;select.append(op);
 }
 select.addEventListener('change',()=>{selection=select.value});
 actions.append(select,
  button(uploading?'กำลังส่งพร้อมกัน '+UPLOAD_PARALLEL+' เรื่อง…':'ส่งทุกเรื่องพร้อมกันสูงสุด '+UPLOAD_PARALLEL+' เรื่อง',start,
    uploading||checking||!items.some(x=>x.state==='ready'||x.state==='failed')||!connections.length),
  button('รีเฟรช AWS',()=>refresh(false,true),loading||uploading));
 panel.append(actions);
 const poolLabel=dom('label',null,'multi-json-muted');
 const poolToggle=dom('input');poolToggle.type='checkbox';
 poolToggle.checked=poolWanted&&poolAvailable;
 poolToggle.disabled=!poolAvailable||uploading||checking||
  !connections.some(c=>String(c.id).startsWith('key-'));
 poolToggle.setAttribute('aria-label','แบ่งงานให้ AI แม่ที่ว่างช่วยสอนระหว่างเรื่อง');
 poolToggle.addEventListener('change',()=>{poolWanted=poolToggle.checked;render()});
 poolLabel.append(poolToggle,root.document.createTextNode(
  ' ให้ AI แม่ที่ว่างช่วยงานชุดถัดไปจากเรื่องอื่น (ทดลอง · ไม่ย้ายฉากที่กำลังสอน)'));
 panel.append(poolLabel);
 if(poolAvailable)panel.append(dom('p',
  'เมื่อเปิด Pool เนื้อเรื่องและข้อความประกอบฉากอาจถูกส่งไปยัง API Provider ใดก็ได้ที่แอดมินเชื่อมเพิ่มไว้ ไม่จำกัดเฉพาะ Provider ที่เลือกไว้ตอนส่งงาน',
  'multi-json-muted'));
 if(!poolAvailable)panel.append(dom('p','โหมดแบ่งงานยังไม่เปิดที่ AWS; งานปัจจุบันใช้ API ที่ผูกไว้ตามเดิม','multi-json-muted'));
 else if(!connections.some(c=>String(c.id).startsWith('key-')))
  panel.append(dom('p','ต้องเชื่อม API แม่เพิ่มเติมอย่างน้อย 1 คีย์ก่อนเปิดการช่วยงาน','multi-json-muted'));
 panel.append(connectionPanel());
 if(notice)panel.append(dom('p',notice,'multi-json-muted'));
 if(error)panel.append(dom('p',error,'multi-json-error'));
 panel.append(dom('p','ความเร็วการส่ง JSON กับความเร็ว AI สอนต่างกัน: AWS เปิดคิวแต่ละเรื่องได้พร้อมกัน แต่ API Key เดียวจะสอนเรียงเพื่อเคารพโควตา · หลายคีย์อิสระจึงช่วยให้สอนขนานกันได้ · เมื่อ AWS รับครบปิดเว็บได้ หากเน็ตหลุดเลือกไฟล์เดิมแล้วกดส่งเฉพาะส่วนที่ขาด','multi-json-muted'));
 const allJobs=[...jobs,...olderJobs.filter(j=>!jobs.some(x=>x.jobId===j.jobId))];
 panel.append(dom('h4','งานสอนจาก AWS ('+allJobs.length+' ที่โหลด)'));
 const recent=dom('div',null,'multi-json-list');
 if(!allJobs.length)recent.append(dom('p','ยังไม่พบงาน AWS'));
 for(const job of allJobs)recent.append(jobRow(job));
 panel.append(recent);
 if(nextJobCursor)panel.append(button(loadingOlder?'กำลังโหลด…':'โหลดงานก่อนหน้าอีก 40 เรื่อง',
  loadOlderJobs,loadingOlder||uploading));
 if(olderJobs.length)panel.append(dom('p','รายการที่โหลดเพิ่มเป็นสถานะ ณ ตอนดึงข้อมูล · กดรีเฟรช AWS เพื่ออ่านหน้าล่าสุดใหม่','multi-json-muted'));
 host.append(panel);
}
function mount(target){
 host=target;render();
 if(!loading&&!connections.length)loadSettings().catch(()=>{});
 else refresh(true).catch(()=>{});
}
root.StoryMultiJSON=Object.freeze({mount,normalizeForTraining});
})(window);
