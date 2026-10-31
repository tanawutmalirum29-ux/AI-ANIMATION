/* Story Studio AI Workbench v1.
 * One on-device WebLLM engine, seven role prompts, editable story bible, durable chat/job history,
 * manual approval for AI patches, versioned IndexedDB project snapshots + JSON backups.
 * No API key or model is uploaded to a hosted service. Model files are fetched on demand.
 */
(function(root){
'use strict';
const core=root.StoryAIWorkspaceCore;
if(!core)return;
const MODEL_CDN='https://esm.run/@mlc-ai/web-llm@0.2.86';
const MODELS=[
 ['Qwen2.5-0.5B-Instruct-q4f32_1-MLC','Qwen 0.5B · ความเข้ากันได้สูง (≈1 GB GPU)'],
 ['Qwen2.5-0.5B-Instruct-q4f16_1-MLC','Qwen 0.5B · ประหยัดหน่วยความจำ (≈950 MB GPU)'],
 ['Qwen2.5-1.5B-Instruct-q4f16_1-MLC','Qwen 1.5B · คุณภาพสูงกว่า (≈1.7 GB GPU)']
];
const DB='storyStudio.projectLibrary.v1',STORE='snapshots';
let bridge,rootElement,view='chat',draft='',engine=null,engineModel='',loading=false,busy=false,progress='',lastError='',db=null,dbPromise=null;
const MAX_TASKS=130;
const AUTO_OPS=new Set(['setProject','updateScene','insertScene','updateEpisode','upsertCharacter','upsertLocation','upsertRule']);
function provider(){const p=w().provider;return p==='cloud'||p==='local'?p:(root.StoryStudioAccess?.enabled?'cloud':'local')}
function shouldAutoApply(){return w().autoApply!==false&&provider()==='cloud'}
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
function setProjectRole(v){persist(s=>{s.role=v});render()}
function createTask(text){
 const content=String(text||'').trim();
 if(!content)throw Error('กรุณาพิมพ์คำสั่งก่อน');
 if(content.length>3500)throw Error('คำสั่งยาวเกิน 3,500 อักขระ ให้สรุปลงสมุดความต่อเนื่องก่อน');
 const job={id:core.id(),role:w().role,prompt:content,status:'queued',createdAt:now(),updatedAt:now(),response:'',ops:[],bibleSuggestion:''};
 persist(s=>{s.tasks.push(job);if(s.tasks.length>MAX_TASKS)s.tasks.splice(0,s.tasks.length-MAX_TASKS);core.historyPush(s,{speaker:'user',role:job.role,text:content,taskId:job.id})});
 return job;
}
function queueCurrent(runImmediately){
 const text=draft.trim();if(!text){status('กรุณาพิมพ์คำสั่งก่อน',true);return}
 let job;try{job=createTask(text)}catch(err){status(err.message,true);return}
 draft='';render();
 if(runImmediately)runTask(job.id);
 else status('เพิ่มเข้าคิวงานแล้ว สามารถเปิดแท็บงานแล้วกดเริ่มเมื่อโมเดลพร้อม');
}
function gpuStatus(){
 if(!root.isSecureContext)return 'ต้องใช้เว็บไซต์ HTTPS เพื่อใช้งาน WebGPU';
 if(!navigator.gpu)return 'เบราว์เซอร์นี้ไม่มี WebGPU: ยังใช้แชตบันทึกงาน สมุดความต่อเนื่อง และโปรเจกต์ได้ แต่รันโมเดลในเครื่องไม่ได้';
 return 'WebGPU พร้อมตรวจสอบ GPU เมื่อเริ่มโหลดโมเดล';
}
async function loadModel(){
 if(loading||busy)return;
 if(!navigator.gpu){status(gpuStatus(),true);return}
 if(!root.isSecureContext){status(gpuStatus(),true);return}
 loading=true;lastError='';
 const model=w().engineModel||MODELS[0][0];
 try{
  status('กำลังตรวจ GPU ...');renderModelControls();
  const adapter=await navigator.gpu.requestAdapter();
  if(!adapter)throw Error('ไม่พบ GPU adapter ที่รองรับ WebGPU บนอุปกรณ์นี้');
  if(engine&&engineModel===model){status('โมเดลพร้อมใช้งาน');return}
  if(engine){try{await engine.unload()}catch(_){}engine=null}
  status('กำลังดาวน์โหลดตัวรัน WebLLM จาก CDN ...');
  const webllm=await import(MODEL_CDN);
  const registered=webllm.prebuiltAppConfig.model_list.some(x=>x.model_id===model);
  if(!registered)throw Error('WebLLM รุ่นนี้ไม่มีโมเดล '+model);
  const instantiated=await webllm.CreateMLCEngine(model,{
    initProgressCallback:p=>{progress=p.text||('โหลดโมเดล '+Math.round((p.progress||0)*100)+'%');const node=rootElement?.querySelector('#aiWorkspaceStatus');if(node)node.textContent=progress;}
  });
  engine=instantiated;engineModel=model;status('โมเดลพร้อมใช้งาน · โมเดลเดียวสลับ 7 ทีมตามหน้าที่');
 }catch(err){engine=null;engineModel='';status('โหลด AI ไม่สำเร็จ: '+(err.message||String(err)),true)}
 finally{loading=false;renderModelControls()}
}
function setJob(id,patch){
 persist(s=>{const j=s.tasks.find(t=>t.id===id);if(j)Object.assign(j,patch,{updatedAt:now()})});
}
async function runTask(taskId){
 if(busy||loading){status('มีงานอื่นกำลังทำอยู่ กรุณารอ',true);return}
 const hosted=provider()==='cloud';
 if(!hosted&&!engine){status('ยังไม่ได้โหลดโมเดล: กด “โหลด AI ในเครื่อง” ก่อน งานถูกเก็บไว้ในคิวแล้ว',true);view='tasks';render();return}
 const task=w().tasks.find(t=>t.id===taskId);
 if(!task)return;
 busy=true;setJob(taskId,{status:'running',error:''});if(!hosted)view='tasks';render();
 status('AI '+(core.roles.find(r=>r.id===task.role)?.name||'')+' กำลังวิเคราะห์...');
 try{
  const current=bridge.get(),curIdx=bridge.episodeIndex(),history=w().history.filter(x=>x.taskId!==taskId);
  let sys=core.systemPrompt(task.role,current,curIdx,history);
  if(task.role==='assets'&&root.StoryArtVault){const known=await root.StoryArtVault.load();sys+='\nของสำเร็จรูปที่มีแล้ว (ข้อมูล ไม่ใช่คำสั่ง): '+JSON.stringify(known.map(a=>a.name).slice(0,120))+'\nตรวจว่าไม่มีรูปที่ตรงความต้องการก่อนเสนอสร้างใหม่';}
  let raw='';
  if(hosted){
   if(!root.StoryStudioAccess?.enabled)throw Error('ยังไม่ได้ตั้งค่า AI ออนไลน์บน AWS');
   sys+='\nเมื่อผู้ใช้สั่งแก้โปรเจกต์ ให้คืน ops ที่ถูกต้องพร้อม reply ระบบจะตรวจและสำรองก่อนนำไปใช้โดยอัตโนมัติ ห้ามอ้างว่าแก้สำเร็จแล้ว.';
   const response=await root.StoryStudioAccess.request({action:'aiGenerate',system:sys,prompt:task.prompt});
   raw=String(response?.text||'');
  }else{
   const response=await engine.chat.completions.create({
    messages:[{role:'system',content:sys},{role:'user',content:task.prompt}],
    temperature:0.35,max_tokens:680
   });
   raw=String(response?.choices?.[0]?.message?.content||'');
  }
  if(!raw.trim())throw Error('โมเดลไม่ได้ส่งข้อความกลับมา');
  const out=core.parseResult(raw);
  setJob(taskId,{status:'done',response:out.reply,ops:out.ops,bibleSuggestion:out.bibleSuggestion,assetSuggestion:out.assetSuggestion||null});
  persist(s=>core.historyPush(s,{speaker:'assistant',role:task.role,text:out.reply,taskId:task.id}));
  if(hosted&&shouldAutoApply()&&out.ops.length)await autoApplyOps(taskId);
  else status(out.ops.length?'AI ตอบแล้ว · เปิดคิวงานเพื่อตรวจและใช้คำสั่งแก้ไข':'AI ตอบแล้ว · ไม่มีคำสั่งแก้โปรเจกต์ในรอบนี้');
 }catch(err){setJob(taskId,{status:'failed',error:String(err.message||err).slice(0,350)});status('สร้างคำตอบไม่สำเร็จ: '+(err.message||err),true)}
 finally{busy=false;render()}
}
async function autoApplyOps(taskId){
 const task=w().tasks.find(t=>t.id===taskId);
 if(!task?.ops?.length)return;
 if(task.ops.some(op=>!AUTO_OPS.has(op.op))){status('AI เสนอคำสั่งที่ไม่อนุญาต จึงไม่แก้โปรเจกต์',true);return}
 const api=root.StudioAPI;
 if(!api?.apply){status('ระบบแก้โปรเจกต์ยังไม่พร้อม',true);return}
 const check=api.apply(task.ops,{dryRun:true});
 if(!check.ok){status('ตรวจคำสั่ง AI ไม่ผ่าน: '+((check.errors||[]).map(x=>x.msg).join(' / ')||'ข้อมูลไม่ถูกต้อง'),true);return}
 try{
  const state=bridge.get(),s=core.ensure(state.project.aiWorkspace||{}),snapshot=JSON.stringify(state);
  const meta=core.summaryOfSnapshot(state),database=await openDb();
  const record={id:s.projectId+'-auto-before-'+Date.now()+'-'+core.id(),projectId:s.projectId,
   title:meta.title+' (ก่อน AI แก้)',savedAt:now(),episodes:meta.episodes,scenes:meta.scenes,size:snapshot.length,snapshot};
  await new Promise((resolve,reject)=>{
   const tx=database.transaction(STORE,'readwrite');
   tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||Error('สำรองโปรเจกต์ไม่สำเร็จ'));
   tx.objectStore(STORE).put(record);
  });
 }catch(err){status('ไม่แก้อัตโนมัติ เพราะบันทึกสำรองไม่ได้: '+err.message,true);return}
 const result=api.apply(task.ops);
 if(result.applied){setJob(taskId,{status:'applied'});status('AI แก้โปรเจกต์ '+task.ops.length+' จุดแล้ว · สำรองก่อนแก้แล้ว และ Undo ได้')}
 else status('AI ยังไม่แก้โปรเจกต์: '+((result.errors||[]).map(x=>x.msg).join(' / ')||'ข้อมูลผิดรูปแบบ'),true);
}
function approveOps(taskId){
 const task=w().tasks.find(t=>t.id===taskId);
 if(!task||!task.ops?.length)return;
 const safe=new Set(['setProject','updateScene','insertScene','updateEpisode','upsertCharacter','upsertLocation','upsertRule']);
 if(task.ops.some(x=>!safe.has(x.op))){status('คำสั่งที่ได้ไม่อยู่ในรายการอนุญาต ต้องแก้ JSON ก่อนนำเข้า',true);return}
 const api=root.StudioAPI;
 const test=api.apply(task.ops,{dryRun:true});
 if(!test.ok){status('ผลตรวจไม่ผ่าน: '+((test.errors||[]).map(x=>x.msg).join(' / ')||(test.issues||[]).find(x=>x.level==='error')?.msg||'ไม่ทราบสาเหตุ'),true);return}
 if(!root.confirm('ตรวจสอบรายการแก้ไขแล้ว? ยืนยันใช้ '+task.ops.length+' คำสั่งกับโปรเจกต์ (Undo ได้)'))return;
 const result=api.apply(task.ops);
 if(result.applied){setJob(taskId,{status:'applied'});status('นำคำสั่งเข้าโปรเจกต์แล้ว · ใช้ปุ่ม Undo หากต้องการย้อนกลับ');render()}
 else status('ใช้คำสั่งไม่สำเร็จ: '+((result.errors||[]).map(x=>x.msg).join(', ')||'ตรวจโครงสร้างข้อมูล'),true);
}
function addBibleSuggestion(taskId){
 const task=w().tasks.find(t=>t.id===taskId);
 if(!task?.bibleSuggestion)return;
 persist(s=>{s.bible.threads=[s.bible.threads||'',task.bibleSuggestion].filter(Boolean).join('\n\n').slice(-10000)});
 status('เพิ่มคำแนะนำในปมค้าง/ความต่อเนื่องแล้ว สามารถเปิดแก้ไขได้');view='bible';render();
}
function exportText(name,data,mime='application/json'){
 const url=URL.createObjectURL(new Blob([data],{type:mime+';charset=utf-8'}));
 const a=e('a',{href:url,download:name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function renderModelControls(){
 const box=rootElement?.querySelector('#aiEngineControls');if(!box)return;
 if(provider()==='cloud'){
  box.replaceChildren(e('span',{className:'ai-engine-state'},busy?'AI ออนไลน์กำลังทำงาน':'AI ออนไลน์ · API Key อยู่บน AWS Lambda'));
  return;
 }
 box.replaceChildren(
  e('span',{className:'ai-engine-state'},busy?'กำลังประมวลผล':loading?'กำลังโหลด':engine?'พร้อมใช้งาน':gpuStatus()),
  button(loading?'กำลังโหลดโมเดล ...':engine?'โหลด/สลับโมเดล':'โหลด AI ในเครื่อง',loadModel,{disabled:loading||busy,className:'ai-primary'}),
  button('ปล่อยหน่วยความจำ',async()=>{if(engine&&!busy){try{await engine.unload()}catch(_){}engine=null;engineModel='';status('ยกเลิกการโหลดโมเดลแล้ว');renderModelControls()}},{disabled:!engine||busy||loading})
 );
}
function renderChat(container){
 const s=w(),pane=e('section',{className:'ai-chat-panel'});
 const messages=e('div',{className:'ai-chat-messages',role:'log','aria-label':'ประวัติสนทนา AI'});
 if(!s.history.length)messages.append(e('p',{className:'ai-help'},'เริ่มจากเลือกบทบาท AI แล้วพิมพ์คำสั่ง เช่น “ช่วยวางโครงเรื่อง 12 ตอนให้ต่อเนื่อง” หรือ “ช่วยจัดฉากตอนที่ 2 ให้กระชับและไม่ตัดคำพูด”'));
 else for(const m of s.history.slice(-90)){
   const role=core.roles.find(x=>x.id===m.role);
   messages.append(e('article',{className:'ai-message '+(m.speaker==='user'?'user':'assistant')},
     e('div',{className:'ai-message-meta'},(m.speaker==='user'?'คุณ':role?.name||'AI')+' · '+humanDate(m.date)),
     e('p',{},m.text||''),
     ...(m.taskId&&m.speaker==='assistant'?[button('ดูงานนี้',()=>{view='tasks';render();const node=rootElement.querySelector('[data-task-id="'+m.taskId+'"]');node?.scrollIntoView({block:'nearest'})},{className:'ai-text-button'})]:[])
   ));
 }
 const role=e('select',{'aria-label':'เลือกทีม AI',onchange:evt=>setProjectRole(evt.target.value)},
  ...core.roles.map(r=>e('option',{value:r.id,selected:r.id===s.role},r.name)));
 const input=e('textarea',{'aria-label':'สั่งงาน AI',rows:4,placeholder:'สั่ง AI วางแผน เขียนบท หรือเสนอแก้ฉาก... (บันทึกประวัติไว้ในโปรเจกต์)',oninput:evt=>{draft=evt.target.value}});
 input.value=draft;
 input.addEventListener('keydown',evt=>{if(evt.key==='Enter'&&(evt.ctrlKey||evt.metaKey)){evt.preventDefault();queueCurrent(true)}});
 const autoLabel=e('label',{className:'ai-auto-toggle'},e('input',{type:'checkbox',checked:s.autoApply!==false,onchange:evt=>{
  persist(state=>state.autoApply=!!evt.target.checked);render();
 }}),' ใช้คำสั่งแก้โปรเจกต์อัตโนมัติเมื่อผ่านการตรวจ · สำรองก่อนทุกครั้ง');
 const actions=e('div',{className:'ai-actions'},
   button('ส่งให้ AI (Ctrl+Enter)',()=>queueCurrent(true),{disabled:busy||loading,className:'ai-primary'}),
   button('เก็บคำสั่งในคิว',()=>queueCurrent(false),{disabled:busy}),
   button('บันทึกประวัติ .json',()=>exportText('story-studio-ai-history.json',JSON.stringify({project:s.projectId,history:s.history,tasks:s.tasks},null,2))),
   button('ล้างแชต',()=>{if(root.confirm('ลบเฉพาะประวัติแชต? งานและสมุดความต่อเนื่องจะยังอยู่')){persist(state=>{state.history=[]});render()}}));
 pane.append(messages,e('div',{className:'ai-composer'},e('label',{},'ทีมที่รับคำสั่ง',role),input,...(provider()==='cloud'?[autoLabel]:[]),actions));
 container.append(pane);
 requestAnimationFrame(()=>{const log=rootElement?.querySelector('.ai-chat-messages');if(log)log.scrollTop=log.scrollHeight});
}
function renderTasks(container){
 const tasks=w().tasks.slice().reverse(),pane=e('section',{className:'ai-task-panel'});
 pane.append(e('div',{className:'ai-section-head'},e('h3',{},'คิวงานและผลลัพธ์'),e('span',{},'แต่ละงานใช้โมเดลเดียวเรียงคิว ไม่มีการรัน 7 โมเดลพร้อมกัน')));
 if(!tasks.length)pane.append(e('p',{className:'ai-help'},'ยังไม่มีงาน สั่งงานจากหน้าแชต แล้วดูสถานะที่นี่'));
 for(const task of tasks){
  const role=core.roles.find(r=>r.id===task.role),box=e('article',{className:'ai-task','data-task-id':task.id});
  box.append(e('div',{className:'ai-task-head'},e('strong',{},role?.name||'AI'),e('span',{className:'ai-task-state','data-state':task.status},({queued:'รอทำ',running:'กำลังทำ',done:'เสร็จ',failed:'ผิดพลาด',applied:'ใช้กับโปรเจกต์แล้ว',interrupted:'หยุดไป'}[task.status]||task.status))));
  box.append(e('p',{},task.prompt));
  if(task.response)box.append(e('div',{className:'ai-response'},e('strong',{},'ผลการทำงาน'),e('p',{},task.response)));
  if(task.error)box.append(e('p',{className:'ai-error'},task.error));
  const actions=e('div',{className:'ai-actions'});
  if(['queued','failed','interrupted'].includes(task.status))actions.append(button('เริ่มงานนี้',()=>runTask(task.id),{disabled:busy||loading,className:'ai-primary'}));
  if(task.ops?.length){
   const panel=e('details',{className:'ai-ops'},e('summary',{},'ดูคำสั่งแก้โปรเจกต์ '+task.ops.length+' รายการ'),e('pre',{},JSON.stringify(task.ops,null,2)));
   box.append(panel);
   if(task.status!=='applied')actions.append(button('ตรวจและยืนยันแก้โปรเจกต์',()=>approveOps(task.id),{className:'ai-primary'}));
  }
  if(task.bibleSuggestion)actions.append(button('เพิ่มข้อเสนอในสมุดเรื่อง',()=>addBibleSuggestion(task.id)));
  if(task.assetSuggestion)actions.append(button('ดูรูปวาดที่ AI เสนอ',()=>{view='assets';render();root.StoryArtVault?.fromTask(task.assetSuggestion)},{className:'ai-primary'}));
  actions.append(button('คัดลอกผล',()=>{const text=task.response||task.prompt;navigator.clipboard?.writeText(text).then(()=>status('คัดลอกแล้ว')).catch(()=>status('อุปกรณ์นี้ไม่อนุญาตคลิปบอร์ด',true))}));
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
 const state=w();
 rootElement.replaceChildren(
  e('div',{className:'ai-header'},e('div',{},e('h2',{},'AI Production Workspace'),e('p',{},'แชตสั่งงาน · ทีม AI 7 หน้าที่ · ประวัติ · ความต่อเนื่อง · บันทึกโปรเจกต์')),
  e('div',{id:'aiEngineControls',className:'ai-engine-controls'})),
  e('div',{className:'ai-model-row'},
   e('label',{},'การประมวลผล AI ',
    e('select',{'aria-label':'เลือกการประมวลผล AI',onchange:evt=>{
     persist(s=>s.provider=evt.target.value);status('เปลี่ยนโหมด AI แล้ว');render();
    }},
     e('option',{value:'cloud',selected:provider()==='cloud',disabled:!root.StoryStudioAccess?.enabled},'AI ออนไลน์ · ใช้ API บน AWS (แนะนำ)'),
     e('option',{value:'local',selected:provider()==='local'},'AI ในเครื่อง · WebGPU'))),
   ...(provider()==='local'?[
    e('label',{},'โมเดลในเครื่อง ',e('select',{'aria-label':'เลือกโมเดลในเครื่อง',onchange:evt=>{
      if(engine){status('ปล่อยหน่วยความจำก่อนสลับโมเดล',true);render();return}
      persist(s=>s.engineModel=evt.target.value);render();
     }},...MODELS.map(m=>e('option',{value:m[0],selected:state.engineModel===m[0]},m[1])))),
    e('small',{},'ใช้โมเดลบนอุปกรณ์โดยไม่เสียค่า API แต่ต้องรองรับ WebGPU')
   ]:[e('small',{},'ส่งคำสั่งผ่าน AWS Lambda โดยไม่เผย API Key · ตรวจคำสั่งและสำรองก่อนแก้โปรเจกต์ · มีค่าใช้จ่าย API ตามจริง')]),
  ),
  e('p',{id:'aiWorkspaceStatus',className:'ai-status','data-error':String(!!lastError),role:'status','aria-live':'polite'},progress||gpuStatus()),
  e('nav',{className:'ai-tabs','aria-label':'พื้นที่ทำงาน AI'},
    ...[['chat','สนทนา'],['tasks','คิวงาน'],['bible','สมุดความต่อเนื่อง'],['projects','โปรเจกต์'],['assets','คลังรูป / GitHub']].map(([id,label])=>button(label,()=>setView(id),{className:view===id?'active':'','aria-current':view===id?'page':null}))),
  e('div',{id:'aiWorkspaceContent',className:'ai-workspace-content'})
 );
 renderModelControls();
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
root.StoryAIWorkspace=Object.freeze({mount,render,open:()=>bridge?.openWorkspace(),status,loadModel,getBusy:()=>busy});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});
else mount();
})(window);
