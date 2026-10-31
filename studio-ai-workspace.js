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
let scriptDraft='',targetMinutes=5,voiceRate=6.5,scriptPlacement='append';
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
 if(!['voice','structure'].includes(role))throw Error('มีเพียงผู้ช่วยจัดบทและผู้ช่วยพากย์เสียง');
 if(role==='voice'&&!['scene','episode','all'].includes(scope))throw Error('ขอบเขตพากย์ไม่ถูกต้อง');
 const source=role==='structure'?scriptDraft.trim():'';
 if(role==='structure'&&!source)throw Error('โปรดใส่บทพากย์ก่อนให้ AI จัดตอน');
 if(role==='structure'&&Array.from(source).length>60000)throw Error('บทเกิน 60,000 ตัวอักษร');
 const prompt=role==='voice'?'พากย์ตามบทเดิมของผู้ใช้':'จัดแบ่งบทเป็นตอน โดยตั้งเป้า '+targetMinutes+' นาที/ตอน';
 const job={id:core.id(),role,scope:role==='voice'?scope:'all',prompt,status:'queued',
   createdAt:now(),updatedAt:now(),source:role==='structure'?source:undefined,
   targetMinutes:role==='structure'?targetMinutes:undefined,
   charsPerSecond:role==='structure'?voiceRate:undefined,
   placement:role==='structure'?scriptPlacement:undefined,response:'',ops:[]};
 persist(s=>{s.role=role;s.tasks.push(job);if(s.tasks.length>MAX_TASKS)s.tasks.splice(0,s.tasks.length-MAX_TASKS);
  core.historyPush(s,{speaker:'user',role,text:prompt,taskId:job.id})});
 return job;
}
function queueWork(role){
 if(busy){status('กำลังทำงานอื่นอยู่',true);return}
 if(role==='structure'&&scriptPlacement==='replace'&&!root.confirm('แทนฉากในตอนที่เปิดอยู่ด้วยบทใหม่หรือไม่? ระบบจะสำรองเวอร์ชันก่อนแก้ และ Undo ได้'))return;
 try{const job=createTask(role,audioScope);runTask(job.id)}
 catch(err){status('เริ่มงานไม่ได้: '+err.message,true)}
}
async function backupBeforeEdit(){
 const state=bridge.get(),metadata=core.summaryOfSnapshot(state);
 const snapshot=JSON.stringify(state),database=await openDb();
 const record={id:metadata.projectId+'-script-before-'+Date.now()+'-'+core.id(),projectId:metadata.projectId,
   title:metadata.title+' (ก่อนจัดบท)',savedAt:now(),episodes:metadata.episodes,scenes:metadata.scenes,
   size:snapshot.length,snapshot};
 await new Promise((resolve,reject)=>{
   const tx=database.transaction(STORE,'readwrite');
   tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error||Error('สร้างสำรองก่อนแก้ไม่สำเร็จ'));
   tx.objectStore(STORE).put(record);
 });
 return record;
}
function planOps(plan,placement){
 if(placement==='replace'){
  const old=bridge.episode();if(!old)throw Error('ไม่มีตอนปัจจุบันให้แทนที่');
  if(plan.episodes.some(ep=>ep.scenes.some(sc=>(bridge.get().episodes||[]).some(e=>e.scenes.some(s=>s.id===sc.id)))))
    throw Error('รหัสฉากซ้ำกับโปรเจกต์เดิม');
  const [first,...rest]=plan.episodes;
  return {firstEpisode:old.id,ops:[
   {op:'replaceScenes',episode:old.id,scenes:first.scenes},
   {op:'updateEpisode',id:old.id,patch:{targetSeconds:first.targetSeconds}},
   ...rest.map((ep,i)=>({op:'addEpisode',index:bridge.episodeIndex()+i+1,episode:{
    id:ep.id,title:'ตอนที่ '+(bridge.episodeIndex()+i+2),targetSeconds:ep.targetSeconds,scenes:ep.scenes,clues:[]}}))
  ]};
 }
 return {firstEpisode:plan.episodes[0].id,ops:plan.episodes.map(ep=>({op:'addEpisode',episode:{
   id:ep.id,title:'ตอนที่ '+(bridge.get().episodes.length+plan.episodes.indexOf(ep)+1),
   targetSeconds:ep.targetSeconds,scenes:ep.scenes,clues:[]}}))};
}

function setJob(id,patch){
 persist(s=>{const j=s.tasks.find(t=>t.id===id);if(j)Object.assign(j,patch,{updatedAt:now()})});
}
async function runTask(taskId){
 if(busy){status('มีงานอื่นกำลังทำอยู่',true);return}
 const task=w().tasks.find(t=>t.id===taskId);if(!task)return;
 if(!['voice','structure'].includes(task.role)){
   status('งาน AI เก่าที่เลิกใช้แล้วเป็นประวัติอย่างเดียว',true);return;
 }
 busy=true;setJob(taskId,{status:'running',error:''});render();
 status(task.role==='voice'?'กำลังพากย์เสียงจากบทเดิม':'กำลังแบ่งวรรค แบ่งฉาก และประเมินความยาวแต่ละตอน');
 try{
  let reply,exportPlan=null;
  if(task.role==='voice'){
   const result=await bridge.narrate(task.scope||'episode');
   if(!result?.ok)throw Error(result?.error||'บริการพากย์ยังไม่พร้อม โปรดตรวจการเชื่อม Edge TTS');
   reply='พากย์เสียงจากบทเดิมสำเร็จ '+result.made+' คลิป'+(result.failed?' · ล้มเหลว '+result.failed+' คลิป':'')+
    (result.cancelled?' · ยกเลิกระหว่างทาง':'')+' · ตรวจจังหวะจริงใน Sound Desk';
  }else{
   if(!root.StoryEpisodePlanner)throw Error('ไม่พบโมดูล AI แบ่งตอน');
   const plan=root.StoryEpisodePlanner.plan(task.source,{targetMinutes:task.targetMinutes,charsPerSecond:task.charsPerSecond});
   const {ops,firstEpisode}=planOps(plan,task.placement||'append');
   const api=root.StudioAPI;if(!api?.apply)throw Error('ระบบจัดการตอนยังไม่พร้อม');
   const check=api.apply(ops,{dryRun:true});
   if(!check.ok)throw Error('ตรวจโครงสร้างโปรเจกต์ไม่ผ่าน: '+((check.errors||[]).map(x=>x.msg).join(' / ')||
     (check.issues||[]).find(x=>x.level==='error')?.msg||'รูปแบบตอนผิดพลาด'));
   try{await backupBeforeEdit()}catch(err){throw Error('ยังไม่แก้บท เพราะสร้างสำรองก่อนแก้ไม่ได้: '+err.message)}
   const outcome=api.apply(ops);
   if(!outcome.applied)throw Error('นำตอนเข้าโปรเจกต์ไม่สำเร็จ');
   api.select?.({episode:firstEpisode});
   const minutes=(plan.totalSeconds/60).toFixed(1);
   reply='แบ่งบทสำเร็จ '+plan.episodes.length+' ตอน '+plan.totalScenes+' ฉาก · รวมเวลาพากย์ประมาณ '+minutes+
     ' นาที · เป้าหมาย '+task.targetMinutes+' นาที/ตอน · สร้างสำรองไว้ก่อนแล้ว · เวลาจริงปรับตามเสียงที่พากย์';
   exportPlan={targetSeconds:plan.targetSeconds,totalSeconds:plan.totalSeconds,episodes:plan.episodes.map(ep=>({
     id:ep.id,title:ep.title,estimatedSeconds:ep.estimatedSeconds,sceneCount:ep.scenes.length
   }))};
   // The project (not just the reply text) now owns the generated scenes and voiceover.
  }
  setJob(taskId,{status:'done',response:reply,ops:[],planSummary:exportPlan});
  persist(s=>core.historyPush(s,{speaker:'assistant',role:task.role,text:reply,taskId}));
  status(reply);
 }catch(err){
  const msg=String(err.message||err).slice(0,400);
  setJob(taskId,{status:'failed',error:msg});status('งานไม่สำเร็จ: '+msg,true);
 }finally{busy=false;render()}
}

function exportText(name,data,mime='application/json'){
 const url=URL.createObjectURL(new Blob([data],{type:mime+';charset=utf-8'}));
 const a=e('a',{href:url,download:name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}

function renderChat(container){
 const pane=e('section',{className:'ai-chat-panel'});
 pane.append(e('h3',{},'ผู้ช่วย AI เพียง 2 ตัว · จัดบทก่อน แล้วพากย์เสียง'),
  e('p',{className:'ai-help'},'AI-1 จะแบ่งวรรค แบ่งฉากและตอนจากต้นฉบับที่คุณให้ พร้อมประมาณความยาว · AI-2 พากย์จากบทเดิม ไม่แต่งบทใหม่'));
 const cards=e('div',{className:'ai-audio-agents'});
 const script=e('textarea',{'aria-label':'วางบทสำหรับแบ่งตอน',rows:7,maxlength:60000,
  placeholder:'วางบทบรรยาย/เนื้อเรื่องที่ต้องการให้แบ่งฉากและตอน... ไม่ต้องกำหนดเวลาทีละฉาก',
  oninput:evt=>{scriptDraft=evt.target.value}});
 script.value=scriptDraft;
 const rate=e('select',{'aria-label':'ความเร็วพากย์โดยประมาณ',onchange:evt=>voiceRate=Number(evt.target.value)},
  ...[[5,'พากย์ช้า'],[6.5,'พากย์ปกติ'],[8,'พากย์เร็ว']].map(([x,label])=>e('option',{value:x,selected:voiceRate===x},label)));
 const duration=e('input',{type:'number','aria-label':'นาทีต่อตอน',min:1,max:30,step:1,value:targetMinutes,
  onchange:evt=>{targetMinutes=Number(evt.target.value)}});
 const placement=e('select',{'aria-label':'วิธีนำตอนเข้าโปรเจกต์',onchange:evt=>scriptPlacement=evt.target.value},
  e('option',{value:'append',selected:scriptPlacement==='append'},'เพิ่มตอนใหม่ (ไม่ลบของเดิม)'),
  e('option',{value:'replace',selected:scriptPlacement==='replace'},'แทนฉากของตอนปัจจุบัน (มีสำรองและยืนยัน)'));
 const structure=e('article',{className:'ai-audio-agent'},
  e('h4',{},'AI-1 · แบ่งบท / จัดตอนและความยาว'),
  e('p',{},'นำบทที่คุณให้มาแบ่งเป็นข้อความบรรยายสั้น ๆ พร้อมจังหวะซับและจำนวนตอนตามความยาวเป้าหมาย ตรวจไม่ให้คำในบทหาย ไม่เพิ่มเนื้อเรื่องเอง'),
  script,
  e('div',{className:'ai-script-settings'},e('label',{},'เป้าหมาย (นาที/ตอน)',duration),
    e('label',{},'ความเร็วอ่าน',rate),e('label',{},'การบันทึก',placement)),
  e('div',{className:'ai-actions'},
   button('ดึงบทจากตอนปัจจุบัน',()=>{scriptDraft=(bridge.episode()?.scenes||[]).map(s=>s.voiceover||'').filter(Boolean).join('\n\n');renderChatReset();},{disabled:busy}),
   button('ดึงบทจากทุกตอน',()=>{scriptDraft=(bridge.get().episodes||[]).flatMap(ep=>ep.scenes.map(s=>s.voiceover||'')).filter(Boolean).join('\n\n');renderChatReset();},{disabled:busy}),
   button(busy?'กำลังทำงาน…':'จัดบทเป็นตอนอัตโนมัติ',()=>queueWork('structure'),{disabled:busy,className:'ai-primary'})),
  e('small',{},'ไม่ใช้ API เสียเงิน · ความยาวเป็นค่าประมาณ ต้องปรับตามเสียงพากย์จริง · สร้างสำรองก่อนแก้ทุกครั้ง'));
 const scope=e('select',{'aria-label':'เลือกขอบเขตงานพากย์',onchange:evt=>audioScope=evt.target.value},
  ...[['scene','ฉากปัจจุบัน'],['episode','ตอนปัจจุบัน'],['all','ทุกตอน']].map(([id,label])=>
   e('option',{value:id,selected:id===audioScope},label)));
 const voice=e('article',{className:'ai-audio-agent'},
  e('h4',{},'AI-2 · พากย์เสียง'),
  e('p',{},'อ่านข้อความ voiceover หรือซับจากฉากที่ AI-1 จัดไว้ สร้างคลิปเสียงผ่านระบบพากย์เดิม และวางตามเวลาของฉากโดยไม่เปลี่ยนคำต้นฉบับ'),
  e('label',{className:'ai-field'},'ขอบเขตพากย์',scope),
  button(busy?'กำลังทำงาน…':'เริ่มพากย์เสียง',()=>queueWork('voice'),{disabled:busy,className:'ai-primary'}),
  e('small',{},'ใช้ระบบ Edge TTS ที่เชื่อมไว้เดิม · ถ้ายังไม่เชื่อมหรือบริการไม่พร้อม ระบบจะแจ้งข้อผิดพลาดอย่างชัดเจน'));
 cards.append(structure,voice);
 pane.append(cards,e('p',{className:'ai-help'},'เครื่องมือภาพ เสียงบรรยากาศ และ GitHub Asset Vault ยังอยู่ในสตูดิโอ แต่ไม่ใช่ทีม AI เพิ่มเติม'));
 container.append(pane);
}
function renderChatReset(){render()}

function renderTasks(container){
 const tasks=w().tasks.slice().reverse(),pane=e('section',{className:'ai-task-panel'});
 pane.append(e('div',{className:'ai-section-head'},e('h3',{},'ประวัติงานเสียง'),e('span',{},'บันทึกงานเก่าไว้เป็นประวัติ แต่รันได้เฉพาะผู้ช่วยจัดตอนและพากย์')));
 if(!tasks.length)pane.append(e('p',{className:'ai-help'},'ยังไม่มีงาน เริ่มจากแบ่งบทเป็นตอนหรือพากย์เสียง'));
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
  if(['voice','structure'].includes(task.role)&&['queued','failed','interrupted'].includes(task.status))
   actions.append(button('ลองทำงานอีกครั้ง',()=>runTask(task.id),{disabled:busy,className:'ai-primary'}));
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
  e('div',{className:'ai-header'},e('div',{},e('h2',{},'AI Production · 2 ผู้ช่วย'),
   e('p',{},'จัดวรรคและแบ่งตอนตามเวลา · พากย์เสียง · บันทึกโปรเจกต์'))),
  e('p',{id:'aiWorkspaceStatus',className:'ai-status','data-error':String(!!lastError),role:'status','aria-live':'polite'},
    progress||'จัดบทเป็นตอนก่อน แล้วสั่งพากย์ได้ · ไม่มี AI API เสียเงิน'),
  e('nav',{className:'ai-tabs','aria-label':'พื้นที่ทำงาน AI'},
   ...[['chat','2 ผู้ช่วย AI'],['tasks','ประวัติ'],['bible','ข้อมูลเรื่อง'],['projects','โปรเจกต์'],['assets','คลังรูป / GitHub']].map(([id,label])=>
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
