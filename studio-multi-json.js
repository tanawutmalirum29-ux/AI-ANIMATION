/* Multi-JSON AI Mother Cloud Intake.
 * Selected JSON is parsed and checked locally. Only scene narration/context is
 * uploaded to existing AWS teacher jobs. No model keys, full source media,
 * or raw JSON stored in localStorage. Running jobs are rediscovered from AWS.
 */
(function(root){
'use strict';
let host=null,items=[],jobs=[],providers=[],provider='',loading=false,
 uploading=false,checking=false,error='',notice='',timer=null;
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
    const hash=await digest(serialized);
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
  const [status,config]=await Promise.all([
   api('teacher.status'),api('teacher.job.config')]);
  if(!config.enabled)throw Error('AWS Background Jobs ยังไม่เปิดใช้งาน');
  providers=(status.providers||[]).filter(x=>x.ready&&
    ['gemini','openrouter','compatible'].includes(x.id));
  if(!providers.length)throw Error('ยังไม่มี AI Provider ที่เชื่อมคีย์สำเร็จ');
  if(!providers.some(p=>p.id===provider))provider=providers[0].id;
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
async function start(){
 if(uploading||checking)return;
 const valid=items.filter(x=>x.state==='ready'||x.state==='failed');
 if(!valid.length){error='กรุณาเลือกไฟล์ JSON ที่ผ่านการตรวจ';render();return}
 if(!provider){error='ยังไม่มี AI Provider พร้อมใช้งาน';render();return}
 uploading=true;error='';notice='กำลังส่งงานเข้า AWS ทีละไฟล์…';render();
 let accepted=0,failed=0;
 try{
  for(const item of valid){
   item.state='uploading';item.error='';render();
   try{
    const out=await root.StoryCloudTeach.startBatchProject({
     projectId:item.projectId,scenes:item.scenes,provider,
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
    job.saved+' · ใช้ความจำ '+job.reused+' · '+job.provider));
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
function render(){
 if(!host)return;
 host.replaceChildren();
 const panel=dom('section',null,'multi-json');
 panel.append(dom('h3','สอน AI ลูกจากหลาย JSON'),
  dom('p','เลือกได้สูงสุด 8 เรื่องต่อรอบ · ตรวจบทบนเครื่อง แล้วส่งให้ AWS สอนต่อแยกตามเรื่อง · ใช้ API Key เดิมร่วมกัน','multi-json-muted'));
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
 select.setAttribute('aria-label','เลือก AI Provider');
 for(const p of providers){
  const op=dom('option',p.id+' · '+(p.model||''));op.value=p.id;
  op.selected=p.id===provider;select.append(op);
 }
 select.addEventListener('change',()=>{provider=select.value});
 actions.append(select,
  button(uploading?'กำลังส่งงาน…':'ส่งและเริ่มสอนทุกเรื่อง',start,
    uploading||checking||!items.some(x=>x.state==='ready'||x.state==='failed')||!provider),
  button('รีเฟรช AWS',()=>refresh(),loading||uploading));
 panel.append(actions);
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
