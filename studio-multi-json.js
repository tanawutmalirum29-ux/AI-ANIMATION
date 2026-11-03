/* Multi-JSON AI Mother Cloud Intake.
 * Selected JSON is parsed and checked locally. Only scene narration/context is
 * uploaded to existing AWS teacher jobs. No model keys, full source media,
 * or raw JSON stored in localStorage. Running jobs are rediscovered from AWS.
 */
(function(root){
'use strict';
let host=null,items=[],jobs=[],connections=[],selection='auto',loading=false,
 uploading=false,checking=false,adding=false,error='',notice='',timer=null;
let keyDraft={provider:'gemini',model:'',baseUrl:''};
const MAX_FILES=8,MAX_FILE_BYTES=8*1024*1024;
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
async function prepare(files){
 if(uploading||checking)return;
 if(!files.length)return;
 checking=true;error='';notice='กำลังตรวจ JSON บนอุปกรณ์…';items=[];render();
 const selected=Array.from(files);
 if(selected.length>MAX_FILES){
  checking=false;error='เลือกได้ครั้งละไม่เกิน '+MAX_FILES+' ไฟล์';render();return;
 }
 const seen=new Set();
 try{
  for(const file of selected){
   const entry={name:file.name.slice(0,130),state:'checking',count:0,done:0,total:0,
                skipped:0,error:'',scenes:null,projectId:''};
   items.push(entry);render();
   try{
    if(!file.name.toLowerCase().endsWith('.json'))throw Error('รองรับเฉพาะไฟล์ .json');
    if(file.size>MAX_FILE_BYTES)throw Error('ขนาด JSON เกิน 8 MB');
    const input=JSON.parse(await file.text());
    if(!Array.isArray(input?.episodes)||!input.episodes.length)
     throw Error('ไม่พบ episodes ใน JSON');
    if(!root.StoryAutoTeach?.childScan)throw Error('โมดูล AI ลูกยังไม่พร้อม');
    const check=root.StoryAutoTeach.childScan(input,null,root.StoryContinuityCoach);
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
     input.project?.title||file.name,entry.scenes]));
    entry.projectId='multi-'+hash.slice(0,24);
    if(seen.has(entry.projectId))throw Error('ไฟล์นี้มีบทพากย์ซ้ำกับไฟล์ที่เลือกแล้ว');
    seen.add(entry.projectId);
    entry.count=entry.scenes.length;entry.state='ready';
   }catch(e){entry.state='invalid';entry.error=String(e.message||e);entry.scenes=null}
   render();
  }
  notice=items.filter(x=>x.state==='ready').length+' ไฟล์พร้อมส่ง · เลือก AI แม่แล้วกดส่งงานทั้งหมด';
 }finally{checking=false;render()}
}
async function loadSettings(){
 if(loading)return;
 loading=true;error='';render();
 try{
  const [keys,config]=await Promise.all([
   api('teacher.connection.list'),api('teacher.job.config')]);
  if(!config.enabled)throw Error('AWS Background Jobs ยังไม่เปิดใช้งาน');
  connections=(keys.connections||[]).filter(x=>x.ready);
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
async function refresh(silent=false){
 if(!root.StoryStudioAccess?.isReady?.()){schedule();return}
 try{
  const response=await api('teacher.job.list');
  jobs=Array.isArray(response.jobs)?response.jobs:[];
  if(!silent){error='';render()}
 }catch(e){if(!silent){error='อ่านสถานะ AWS ไม่สำเร็จ: '+String(e.message||e);render()}}
 finally{schedule()}
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
async function start(){
 if(uploading||checking)return;
 const valid=items.filter(x=>x.state==='ready'||x.state==='failed');
 if(!valid.length){error='กรุณาเลือกไฟล์ JSON ที่ผ่านการตรวจ';render();return}
 if(!connections.length){error='กรุณาเพิ่ม API Key ก่อน';render();return}
 const assignments=planAssignments(valid);
 uploading=true;error='';notice='กำลังส่งงานเข้า AWS ทีละไฟล์…';render();
 let accepted=0,failed=0;
 try{
  for(const item of valid){
   const conn=assignments.get(item);
   // Lock assignment on first attempt; a reconnect must use the same API key.
   item.connectionId=conn.id;
   item.connectionName=conn.name;
   item.state='uploading';item.error='';render();
   try{
    const out=await root.StoryCloudTeach.startBatchProject({
     projectId:item.projectId,scenes:item.scenes,provider:conn.provider,
     connectionId:conn.id,
     onProgress:(done,total)=>{item.done=done;item.total=total;render()}});
    if(!out?.job?.jobId)throw Error('AWS ยังไม่ยืนยันหมายเลขงาน');
    item.state='accepted';item.done=item.total;
    item.jobId=out.job.jobId;item.scenes=null;accepted++;
    notice='AWS รับงานแล้ว '+accepted+' เรื่อง · งานจะทำต่อแม้ปิดเว็บ';
   }catch(e){
    failed++;item.state='failed';item.error=String(e.message||e);
    notice='บางไฟล์ยังส่งไม่ครบ · กดส่งงานอีกครั้งเพื่อส่งเฉพาะส่วนที่ขาด';
   }
   render();
  }
  await refresh(true);
  notice='AWS รับแล้ว '+accepted+' เรื่อง · ค้างส่ง '+failed+
   ' เรื่อง · ไม่ต้องเปิดเว็บค้างหลัง AWS รับงานครบ';
 }finally{uploading=false;render()}
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
  notice='เพิ่ม '+result.connection.name+' แล้ว · ระบบตั้งชื่อให้อัตโนมัติ';
  await loadSettings();
 }finally{adding=false;render()}
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
 const title=dom('strong',item.name);row.append(title);
 const label={checking:'กำลังตรวจ',ready:'ตรวจผ่าน',
  invalid:'ตรวจไม่ผ่าน',uploading:'กำลังส่ง AWS',accepted:'AWS รับงานแล้ว',
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
 row.append(dom('strong','งาน '+(job.projectId||'').slice(0,35)),
  dom('small',job.state+' · '+job.completed+'/'+job.total+' ฉาก · บันทึก '+
    job.saved+' · ใช้ความจำ '+job.reused+' · '+
    (connections.find(k=>k.id===job.connectionId)?.name||job.provider)));
 const meter=dom('progress');meter.max=job.total||1;meter.value=job.completed||0;row.append(meter);
 if(job.error)row.append(dom('small','AWS: '+job.error,'multi-json-error'));
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
 box.append(dom('h4','เชื่อม API เพิ่ม · ตั้งชื่อให้อัตโนมัติ'),
  dom('p','ใส่คีย์หลายอันได้ (เพิ่มได้สูงสุด 6 คีย์นอกเหนือจากคีย์หลัก) · เก็บเข้ารหัสบน AWS · ไม่บันทึกคีย์ในเบราว์เซอร์','multi-json-muted'));
 for(const conn of connections){
  const line=dom('div',null,'multi-json-key');
  line.append(dom('span',conn.name+' · '+conn.provider));
  if(!conn.legacy)line.append(button('ลบ',()=>removeConnection(conn),uploading||adding));
  box.append(line);
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
 box.append(dom('p','หมายเหตุ: หลายคีย์จากบัญชีผู้ให้บริการเดียวกันอาจใช้โควตาร่วมกัน ไม่ได้เพิ่มโควตาจริง','multi-json-muted'));
 return box;
}
function render(){
 if(!host)return;
 host.replaceChildren();
 const panel=dom('section',null,'multi-json');
 panel.append(dom('h3','สอน AI ลูกจากหลาย JSON'),
  dom('p','เลือกได้ 8 เรื่องต่อรอบ · กระจายแต่ละเรื่องตามภาระงานของ API แต่ละคีย์ · เก็บบทเรียนร่วมบน AWS','multi-json-muted'));
 const picker=dom('input');picker.type='file';picker.accept='.json,application/json';
 picker.multiple=true;picker.disabled=uploading||checking;
 picker.setAttribute('aria-label','เลือก JSON หลายไฟล์');
 picker.addEventListener('change',()=>prepare(picker.files).catch(e=>{
  error=String(e.message||e);checking=false;render()}));
 panel.append(picker);
 if(items.length){
  const block=dom('div',null,'multi-json-list');
  for(const item of items)block.append(itemRow(item));
  panel.append(block);
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
  button(uploading?'กำลังส่งงาน…':'ส่งและเริ่มสอนทุกเรื่อง',start,
    uploading||checking||!items.some(x=>x.state==='ready'||x.state==='failed')||!connections.length),
  button('รีเฟรช AWS',()=>refresh(),loading||uploading));
 panel.append(actions);
 panel.append(connectionPanel());
 if(notice)panel.append(dom('p',notice,'multi-json-muted'));
 if(error)panel.append(dom('p',error,'multi-json-error'));
 panel.append(dom('p','หลัง AWS รับงานครบ สามารถปิดเว็บได้ · หากเน็ตหลุดตอนอัปโหลดให้เลือกไฟล์เดิมอีกครั้งเพื่อส่งเฉพาะชุดที่ขาด · สถานะงานบันทึกอยู่บน AWS','multi-json-muted'));
 panel.append(dom('h4','งานสอนล่าสุดจาก AWS ('+jobs.length+')'));
 const recent=dom('div',null,'multi-json-list');
 if(!jobs.length)recent.append(dom('p','ยังไม่พบงาน AWS'));
 for(const job of jobs)recent.append(jobRow(job));
 panel.append(recent);
 host.append(panel);
}
function mount(target){
 host=target;render();
 if(!loading&&!providers.length)loadSettings().catch(()=>{});
 else refresh(true).catch(()=>{});
}
root.StoryMultiJSON=Object.freeze({mount});
})(window);
