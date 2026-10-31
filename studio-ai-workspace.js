/* Story Studio AI Workbench — free on-device model with guarded automatic project editing.
 * The browser loads an open-source local WebLLM model on first prompt; no cloud AI API key,
 * paid inference endpoint, GitHub Models API, or new server billing required.
 * Untrusted ops are dry-run validated and backed up before automatic application.
 */
(function(root){
'use strict';
const core=root.StoryAIWorkspaceCore;
if(!core)return;
const DB='storyStudio.projectLibrary.v1',STORE='snapshots';
let bridge,rootElement,view='chat',audioScope='episode',busy=false,progress='',lastError='',db=null,dbPromise=null;
const MAX_TASKS=130;
const e=(tag,props={},...children)=>{
 const element=document.createElement(tag);
 for(const [k,v]of Object.entries(props)){
   if(k==='className')element.className=v;
   else if(k==='value')element.value=v;
   else if(k==='checked')element.checked=v;
   else if(k==='disabled')element.disabled=!!v;
   else if(k==='style')element.style.cssText=v;
   else if(k.startsWith('on')&&typeof v==='function')element.addEventListener(k.slice(2),v);
   else if(v!==null&&v!==undefined)element.setAttribute(k,String(v));
 }
 for(const ch of children.flat()){if(ch===null||ch===undefined||ch===false)continue;element.append(ch instanceof Node?ch:document.createTextNode(String(ch)))}
 return element;
};
const button=(label,handler,extra={})=>e('button',{type:'button',onclick:handler,...extra},label);
const now=()=>new Date().toISOString();
const humanDate=s=>{try{return new Date(s).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'})}catch(_){return s||''}};
function w(){return core.ensure(bridge?.get()?.project?.aiWorkspace||{})}
function persist(mutator){
 const s=bridge.get();
 if(!s.project.aiWorkspace)s.project.aiWorkspace=core.ensure({});
 const state=core.ensure(s.project.aiWorkspace);
 mutator(state);
 bridge.persist();
}
function status(message,fail=false){progress=message;lastError=fail?message:'';const node=rootElement?.querySelector('#aiWorkspaceStatus');if(node){node.textContent=message;node.dataset.error=String(!!fail)}}
function setView(id){view=id;render()}
function createTask(role,scope){
 if(!['voice','sound'].includes(role))throw Error('รองรับเฉพาะผู้ช่วยพากย์และผู้ช่วยจัดเสียง');
 if(!['scene','episode','all'].includes(scope))throw Error('ขอบเขตงานไม่ถูกต้อง');
 const prompt=role==='voice'?'พากย์จากบทเดิมที่ผู้ใช้เตรียมไว้':'ตรวจเหตุการณ์และจัดเสียงจากคลังที่มีอยู่';
 const job={id:core.id(),role,scope,prompt,status:'queued',createdAt:now(),updatedAt:now(),response:'',ops:[],bibleSuggestion:''};
 persist(s=>{s.role=role;s.tasks.push(job);if(s.tasks.length>MAX_TASKS)s.tasks.splice(0,s.tasks.length-MAX_TASKS);
  core.historyPush(s,{speaker:'user',role,text:prompt+' · '+scope,taskId:job.id})});
 return job;
}
function queueAudio(role){
 if(busy){status('มีงานเสียงกำลังทำอยู่',true);return}
 try{const job=createTask(role,audioScope);runTask(job.id)}
 catch(err){status('เริ่มงานไม่ได้: '+err.message,true)}
}
function setJob(id,patch){
 persist(s=>{const j=s.tasks.find(t=>t.id===id);if(j)Object.assign(j,patch,{updatedAt:now()})});
}
async function runTask(taskId){
 if(busy){status('กำลังจัดการเสียงงานอื่นอยู่',true);return}
 const task=w().tasks.find(t=>t.id===taskId);
 if(!task)return;
 if(!['voice','sound'].includes(task.role)){
  status('งานเก่าจากทีม AI ที่เลิกใช้แล้วเป็นประวัติเท่านั้น ไม่สามารถสั่งเขียนบท/แก้ฉากได้',true);return;
 }
 busy=true;setJob(taskId,{status:'running',error:''});render();
 status((task.role==='voice'?'กำลังพากย์จากบทเดิม':'กำลังจับคู่เสียงกับเหตุการณ์')+' · ไม่แก้ไขบทต้นฉบับ');
 try{
  let reply;
  if(task.role==='voice'){
   const result=await bridge.narrate(task.scope||'episode');
   if(!result?.ok)throw Error(result?.error||'ระบบสร้างเสียงยังไม่พร้อม เช็กการเชื่อม Edge TTS ในหน้าพากย์เสียง');
   reply='พากย์เสียงจากบทเดิมสำเร็จ '+result.made+' คลิป'+(result.failed?' · ไม่สำเร็จ '+result.failed+' คลิป':'')+
    (result.cancelled?' · ผู้ใช้หยุดงาน':'')+' · ตรวจหรือปรับใน Sound Desk ได้';
  }else{
   const result=bridge.applyAudioPlan(task.scope||'episode');
   reply='จัดเสียงตามเหตุการณ์ '+result.applied+' คลิปใน '+result.scenes+' ฉาก · รักษาเสียงที่ใส่เองทั้งหมด · มี Undo';
  }
  setJob(taskId,{status:'done',response:reply,ops:[],bibleSuggestion:'',assetSuggestion:null});
  persist(s=>core.historyPush(s,{speaker:'assistant',role:task.role,text:reply,taskId}));
  status(reply);
 }catch(err){
  const msg=String(err.message||err).slice(0,350);
  setJob(taskId,{status:'failed',error:msg});status('งานเสียงไม่สำเร็จ: '+msg,true);
 }finally{busy=false;render()}
}
function exportText(name,data,mime='application/json'){
 const url=URL.createObjectURL(new Blob([data],{type:mime+';charset=utf-8'}));
 const a=e('a',{href:url,download:name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}

function renderChat(container){
 const pane=e('section',{className:'ai-chat-panel'});
 pane.append(e('h3',{},'ผู้ช่วยเสียง 2 ตัว · บทและฉากคุณจัดการเอง'),
  e('p',{className:'ai-help'},'AI ทั้งสองใช้เนื้อเรื่องที่คุณสร้างแล้วเท่านั้น ไม่สร้างบทใหม่ ไม่แก้ซับ ตัวละคร ฉาก หรือภาพ'));
 const scope=e('select',{'aria-label':'เลือกขอบเขตงานเสียง',onchange:evt=>{audioScope=evt.target.value}},
  ...[['scene','เฉพาะฉากปัจจุบัน'],['episode','ทั้งตอนปัจจุบัน'],['all','ทุกตอนในโปรเจกต์']].map(([id,label])=>
   e('option',{value:id,selected:id===audioScope},label)));
 pane.append(e('label',{className:'ai-field'},'ขอบเขตที่ให้ทำ',scope));
 const cards=e('div',{className:'ai-audio-agents'});
 cards.append(
  e('article',{className:'ai-audio-agent'},
   e('h4',{},'AI-1 · ผู้ช่วยพากย์เสียง'),
   e('p',{},'อ่านข้อความ voiceover หรือซับที่คุณเขียนไว้ สร้างคลิปเสียงพากย์จริงผ่านระบบ Edge TTS เดิม จัดจังหวะและเว้นเสียงโดยอัตโนมัติ ไม่เขียนบทแทนคุณ'),
   button(busy?'กำลังทำงาน…':'พากย์จากบทเดิม',()=>queueAudio('voice'),{disabled:busy,className:'ai-primary'}),
   e('small',{},'ต้องมีการเชื่อมบริการพากย์ Edge TTS เดิม · หากมีคลิปเสียงพากย์อยู่แล้ว จะพยายามไม่สร้างซ้ำ')),
  e('article',{className:'ai-audio-agent'},
   e('h4',{},'AI-2 · ผู้ช่วยจัดเสียงเหตุการณ์'),
   e('p',{},'อ่านหมายเหตุฉาก บทพากย์ และช่วงซับ เพื่อเลือกเสียงฝน ลม ประตู ฝีเท้า การต่อสู้ เสียงบรรยากาศ หรือเพลงที่ตรงอารมณ์จากคลังเดิม พร้อมจัดเวลาลดเสียงกลบคำพากย์'),
   button(busy?'กำลังทำงาน…':'จัดเสียงตามเหตุการณ์',()=>queueAudio('sound'),{disabled:busy,className:'ai-primary'}),
   e('small',{},'ทำงานบนอุปกรณ์ ไม่ต้องโหลดโมเดล AI/ใช้ API เสียเงิน · ถ้าฉากไม่มีเหตุการณ์ที่ชัดเจน ระบบจะไม่ใส่เสียงมั่ว'))
 );
 pane.append(cards,e('p',{className:'ai-help'},'ต้องการแก้บท คำบรรยาย มุมกล้อง หรือวาดภาพ ให้ใช้เครื่องมือสตูดิโอตามปกติ ผู้ช่วยเสียงจะไม่แก้แทน'));
 container.append(pane);
}
function renderTasks(container){
 const tasks=w().tasks.slice().reverse(),pane=e('section',{className:'ai-task-panel'});
 pane.append(e('div',{className:'ai-section-head'},e('h3',{},'ประวัติงานเสียง'),e('span',{},'งานเดิมจากผู้ช่วยเขียนบทถูกเก็บให้อ่านอย่างเดียว')));
 if(!tasks.length)pane.append(e('p',{className:'ai-help'},'ยังไม่มีงานเสียง เลือกพากย์เสียงหรือจัดเสียงเหตุการณ์จากแท็บแรก'));
 for(const task of tasks){
  const role=core.roles.find(r=>r.id===task.role);
  const box=e('article',{className:'ai-task','data-task-id':task.id});
  box.append(e('div',{className:'ai-task-head'},e('strong',{},role?.name||'งาน AI เก่า (อ่านอย่างเดียว)'),
   e('span',{className:'ai-task-state','data-state':task.status},
    ({queued:'รอทำ',running:'กำลังทำ',done:'เสร็จ',failed:'ผิดพลาด',applied:'งานเก่า',interrupted:'หยุดไป'}[task.status]||task.status))));
  box.append(e('p',{},task.prompt||''));
  if(task.response)box.append(e('div',{className:'ai-response'},e('p',{},task.response)));
  if(task.error)box.append(e('p',{className:'ai-error'},task.error));
  const actions=e('div',{className:'ai-actions'});
  if(['voice','sound'].includes(task.role)&&['queued','failed','interrupted'].includes(task.status))
   actions.append(button('ลองทำงานเสียงอีกครั้ง',()=>runTask(task.id),{disabled:busy,className:'ai-primary'}));
  if(task.response)actions.append(button('คัดลอกผล',()=>navigator.clipboard?.writeText(task.response).then(()=>status('คัดลอกแล้ว')).catch(()=>status('คัดลอกไม่สำเร็จ',true))));
  box.append(actions);pane.append(box);
 }
 container.append(pane);
}
function renderBible(container){
 const s=w(),pane=e('section',{className:'ai-bible-panel'});
 pane.append(e('h3',{},'สมุดความต่อเนื่อง (Story Bible)'),e('p',{className:'ai-help'},'บันทึกข้อมูลที่ต้องจำข้ามฉากและข้ามตอน ข้อมูลนี้จะถูกส่งเป็นบริบทให้ AI ในเครื่องโดยอัตโนมัติ — ไม่ใช่ความจำถาวรของโมเดล'));
 const fields=[['premise','แนวเรื่อง / แกนหลัก','ธีม แนวทางและตอนจบที่วางไว้'],['world','โลก / กฎ / สถานที่','สิ่งที่เปลี่ยนไม่ได้และบรรยากาศ'],['characters','ตัวละคร / ความสัมพันธ์','นิสัย ความสัมพันธ์ เสียงและข้อมูลคงที่'],['timeline','เหตุการณ์ / ลำดับเวลา','เหตุการณ์สำคัญ ใครรู้เรื่องอะไรแล้ว'],['threads','ปมค้าง / สิ่งที่ต้องตามต่อ','เบาะแส ปริศนา สัญญาที่ต้องกลับมาเฉลย']];
 for(const [key,label,placeholder]of fields){
   const input=e('textarea',{rows:3,placeholder,onchange:evt=>{persist(w=>w.bible[key]=evt.target.value.slice(0,10000));status('บันทึกสมุดความต่อเนื่องแล้ว')}});
   input.value=s.bible[key]||'';pane.append(e('label',{className:'ai-field'},label,input));
 }
 const ep=bridge.episode(),id=ep?.id;
 if(id){const note=e('textarea',{rows:5,placeholder:'ตอนนี้เกิดอะไรขึ้น? ตัวละครรู้ข้อมูลอะไร ปมไหนยังไม่เฉลย? เขียนสรุปก่อนเริ่มตอนถัดไป',onchange:evt=>{persist(w=>w.summaries[id]=evt.target.value.slice(0,10000));status('บันทึกสรุปตอนแล้ว')}});note.value=s.summaries[id]||'';pane.append(e('label',{className:'ai-field'},'สรุปตอนปัจจุบัน · '+ep.title,note))}
 pane.append(e('div',{className:'ai-actions'},button('สร้างตอนถัดไปแบบต่อเนื่อง',()=>{if(root.confirm('สร้างตอนถัดไปโดยคงฉาก ตัวละคร และบรรยากาศท้ายตอนเดิม? กรุณาบันทึกสรุปตอนปัจจุบันก่อน')){bridge.continueEpisode();status('สร้างตอนถัดไปต่อเนื่องแล้ว · อัปเดตสรุปตอนใหม่ก่อนส่ง AI');render()}},{className:'ai-primary'}),button('ดาวน์โหลดสมุดเรื่อง',()=>exportText('story-bible.json',JSON.stringify({bible:s.bible,summaries:s.summaries},null,2))),button('คัดลอกบริบทให้ AI ภายนอก',()=>{navigator.clipboard?.writeText(JSON.stringify(core.context(bridge.get(),bridge.episodeIndex()),null,2)).then(()=>status('คัดลอกบริบทแล้ว')).catch(()=>status('ไม่รองรับการคัดลอก กรุณาดาวน์โหลด JSON',true))})));
 container.append(pane);
}
function openDb(){
 if(db)return Promise.resolve(db);
 if(dbPromise)return dbPromise;
 dbPromise=new Promise((resolve,reject)=>{
   if(!('indexedDB' in root)){reject(Error('เบราว์เซอร์นี้ไม่รองรับ IndexedDB'));return}
   const req=indexedDB.open(DB,1);
   req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE,{keyPath:'id'})};
   req.onsuccess=()=>{db=req.result;resolve(db)};
   req.onerror=()=>reject(req.error||Error('เปิดฐานข้อมูลไม่ได้'));
 }).catch(err=>{dbPromise=null;throw err});
 return dbPromise;
}
async function records(){
 const database=await openDb();
 return new Promise((resolve,reject)=>{const q=database.transaction(STORE,'readonly').objectStore(STORE).getAll();q.onsuccess=()=>resolve(q.result.sort((a,b)=>String(b.savedAt).localeCompare(String(a.savedAt))));q.onerror=()=>reject(q.error||Error('อ่านโปรเจกต์ไม่ได้'))});
}
async function saveRevision(){
 const state=bridge.get(),s=core.ensure(state.project.aiWorkspace||{});state.project.aiWorkspace=s;
 bridge.persist();const snapshot=JSON.stringify(state);const meta=core.summaryOfSnapshot(state);
 const record={id:s.projectId+'-'+Date.now()+'-'+core.id(),projectId:s.projectId,title:meta.title,savedAt:now(),episodes:meta.episodes,scenes:meta.scenes,size:snapshot.length,snapshot};
 try{
  const database=await openDb();
  await new Promise((resolve,reject)=>{
    const tx=database.transaction(STORE,'readwrite');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||Error('พื้นที่ไม่พอ'));tx.objectStore(STORE).put(record);
  });
  status('บันทึกโปรเจกต์เวอร์ชัน '+humanDate(record.savedAt)+' ลงเครื่องแล้ว · แนะนำให้ดาวน์โหลด JSON สำรองด้วย');renderLibrary();
 }catch(err){status('บันทึกลงเครื่องไม่ได้: '+err.message+' — กรุณาดาวน์โหลด JSON เพื่อสำรอง',true)}
}
async function openRevision(id){
 try{
  const database=await openDb(),record=await new Promise((resolve,reject)=>{const q=database.transaction(STORE,'readonly').objectStore(STORE).get(id);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});
  if(!record)throw Error('ไม่พบเวอร์ชัน');
  const project=core.validateSnapshot(JSON.parse(record.snapshot));
  if(!root.confirm('เปิดเวอร์ชัน “'+record.title+'” ? โปรเจกต์ปัจจุบันจะถูกแทนที่ กรุณาบันทึกเวอร์ชันหรือดาวน์โหลด JSON ก่อน'))return;
  bridge.load(project);status('เปิดเวอร์ชัน '+humanDate(record.savedAt)+' สำเร็จ');
  view='projects';render();
 }catch(err){status('เปิดเวอร์ชันไม่สำเร็จ: '+err.message,true)}
}
async function deleteRevision(id){
 if(!root.confirm('ลบเวอร์ชันนี้ออกจากเครื่องถาวร? หากไม่มี JSON สำรองจะกู้ไม่ได้'))return;
 try{
  const database=await openDb();
  await new Promise((resolve,reject)=>{const tx=database.transaction(STORE,'readwrite');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.objectStore(STORE).delete(id)});
  status('ลบเวอร์ชันแล้ว');renderLibrary();
 }catch(err){status('ลบไม่ได้: '+err.message,true)}
}
async function renderLibrary(){
 const target=rootElement?.querySelector('#aiProjectLibrary');if(!target)return;
 target.replaceChildren(e('p',{className:'ai-help'},'กำลังโหลดรายการโปรเจกต์...'));
 try{
  const list=await records();
  if(!target.isConnected)return;
  target.replaceChildren();
  if(!list.length)target.append(e('p',{className:'ai-help'},'ยังไม่มีเวอร์ชันที่บันทึกในเครื่อง กด “บันทึกเวอร์ชัน” เพื่อเริ่ม'));
  for(const record of list.slice(0,100)){
    target.append(e('article',{className:'ai-snapshot'},
      e('div',{},e('strong',{},record.title),e('small',{},humanDate(record.savedAt)+' · '+record.episodes+' ตอน · '+record.scenes+' ฉาก · '+(record.size/1048576).toFixed(2)+' MB')),
      e('div',{className:'ai-actions'},
        button('เปิดเวอร์ชัน',()=>openRevision(record.id),{className:'ai-primary'}),
        button('ดาวน์โหลด JSON',()=>exportText('story-studio-'+record.savedAt.slice(0,10)+'.json',record.snapshot)),
        button('ลบ',()=>deleteRevision(record.id))
      )
    ));
  }
  if(list.length>100)target.append(e('p',{className:'ai-help'},'แสดง 100 เวอร์ชันล่าสุด'));
 }catch(err){target.replaceChildren(e('p',{className:'ai-error'},'ไม่สามารถอ่านคลังโปรเจกต์: '+err.message+' (ยังดาวน์โหลด JSON ได้)'))}
}
function renderProjects(container){
 const pane=e('section',{className:'ai-project-panel'},
  e('h3',{},'บันทึกโปรเจกต์และเวอร์ชัน'),
  e('p',{className:'ai-help'},'เก็บโปรเจกต์ในอุปกรณ์นี้ผ่าน IndexedDB และส่งออก JSON สำหรับย้ายเครื่อง ข้อมูลเสียงและภาพในโปรเจกต์จะถูกรวมในไฟล์ด้วย'),
  e('div',{className:'ai-actions'},
    button('บันทึกเวอร์ชันในเครื่อง',saveRevision,{className:'ai-primary'}),
    button('ดาวน์โหลดโปรเจกต์ JSON',()=>bridge.exportJSON()),
    button('เปิดโปรเจกต์จาก JSON',()=>bridge.importJSON())
  ),
  e('p',{className:'ai-help'},'สำคัญ: ข้อมูลในเบราว์เซอร์อาจถูกลบเมื่อเคลียร์ข้อมูลเว็บหรือเปลี่ยนเครื่อง — ไม่ใช่ Cloud Save และยังไม่มีการซิงก์ข้ามอุปกรณ์'),
  e('div',{id:'aiProjectLibrary',className:'ai-project-list'})
 );
 container.append(pane);renderLibrary();
}
function render(){
 if(!rootElement||!bridge)return;
 rootElement.replaceChildren(
  e('div',{className:'ai-header'},e('div',{},e('h2',{},'Audio AI Workspace'),
   e('p',{},'พากย์เสียง · จัดเสียงตามเหตุการณ์ · ประวัติงาน · บันทึกโปรเจกต์'))),
  e('p',{id:'aiWorkspaceStatus',className:'ai-status','data-error':String(!!lastError),role:'status','aria-live':'polite'},
    progress||'เลือกผู้ช่วยเสียงได้ทันที · ไม่ต้องโหลดโมเดลหรือซื้อ AI API'),
  e('nav',{className:'ai-tabs','aria-label':'พื้นที่ทำงาน AI'},
   ...[['chat','ผู้ช่วยเสียง'],['tasks','ประวัติ'],['bible','ข้อมูลเรื่อง'],['projects','โปรเจกต์'],['assets','คลังรูป / GitHub']].map(([id,label])=>
    button(label,()=>setView(id),{className:view===id?'active':'','aria-current':view===id?'page':null}))),
  e('div',{id:'aiWorkspaceContent',className:'ai-workspace-content'})
 );
 const area=rootElement.querySelector('#aiWorkspaceContent');
 if(view==='chat')renderChat(area);
 else if(view==='tasks')renderTasks(area);
 else if(view==='bible')renderBible(area);
 else if(view==='assets'){if(root.StoryArtVault)root.StoryArtVault.mount(area,bridge);else area.append(e('p',{className:'ai-error'},'ไม่พบโมดูลคลังรูป'))}
 else renderProjects(area);
}
function mount(){
 bridge=root.StoryStudioBridge;
 rootElement=document.querySelector('#aiWorkspacePanel');
 if(!rootElement||!bridge)return;
 const state=w();
 if(state.tasks.some(t=>t.status==='running'))persist(s=>{for(const t of s.tasks)if(t.status==='running')t.status='interrupted'});
 render();
}
root.StoryAIWorkspace=Object.freeze({mount,render,open:()=>bridge?.openWorkspace(),status,getBusy:()=>busy});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});
else mount();
})(window);
