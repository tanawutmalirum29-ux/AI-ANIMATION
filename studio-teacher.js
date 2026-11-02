/* AI Teacher Studio: authenticated server-side providers, reviewed edits, persistent feedback.
 * No browser-held API tokens, no arbitrary model-generated DOM, no silent edits. */
(function(root){
'use strict';
const $doc=root.document;
const MODES=[
 {id:'review',title:'ตรวจทั้งโปรเจกต์',prompt:'Review the current Thai animation project. Identify concrete continuity, narration and timing risks. Only propose supported corrections.'},
 {id:'pacing',title:'แก้จังหวะฉาก',prompt:'Audit scene pacing from the available JSON. Suggest safer durations; never claim to have measured audio that is not supplied.'},
 {id:'script',title:'ตรวจคำซ้ำและอารมณ์',prompt:'Review Thai script repetitions, intent and emotion. Preserve intentional stuttering, fear, emphasis and dialogue meaning.'},
 {id:'student',title:'สอน AI ลูก',prompt:'Teach the student from the imported JSON and archive teacher-reviewed examples in AWS without claiming owner approval.'},
 {id:'qa',title:'ตรวจโครงสร้างภาพ/เสียง',prompt:'Run a static JSON quality review for scene continuity, audio references, subtitle lengths and character placement. State which video/audio checks require actual media.'},
 {id:'produce',title:'วางแผนผลิตทุกตอน',prompt:'Create a safe execution plan to produce and validate all episodes. Do not claim to render or export without a tool that actually does so.'}
];
let bridge,container,tab='chat',provider='openrouter',statusData=null,thread=[],pending=[],busy=false,notice='',noticeError=false,lastResponse=null;
let connectionDraft={url:'',model:''};
const lessonBrowser={loaded:false,loading:false,items:[],nextCursor:null,
 query:'',label:'all',showCount:40,models:[],activeVersion:null,error:''};
let studentReview=null,studentChoice='review',studentOwnerReason='',lastStudentCandidate=null,studentCandidates=[];
const el=(tag,attrs={},...children)=>{
 const n=$doc.createElement(tag);
 for(const [key,value] of Object.entries(attrs)){
  if(value==null)continue;
  if(key==='className')n.className=value;
  else if(key==='textContent')n.textContent=value;
  else if(key==='onclick')n.addEventListener('click',value);
  else if(key==='onchange')n.addEventListener('change',value);
  else if(key==='oninput')n.addEventListener('input',value);
  else if(key==='disabled')n.disabled=!!value;
  else if(key==='selected')n.selected=!!value;
  else if(key==='value')n.value=value;
  else if(key==='type')n.type=value;
  else n.setAttribute(key,String(value));
 }
 for(const child of children){if(child!=null)n.append(child.nodeType?child:$doc.createTextNode(String(child)))}
 return n;
};
function button(label,action,cls='',disabled=false){return el('button',{type:'button',className:cls,onclick:action,disabled},label)}
function setNotice(message,isError=false){notice=message;noticeError=isError;const region=container?.querySelector('.teacher-notice');if(region){region.textContent=message;region.dataset.error=String(isError)}}
function session(){return root.StoryStudioAccess?.enabled&&root.StoryStudioAccess?.isReady?.()}
async function api(action,params={}){if(!session())throw Error('ต้องติดตั้ง AWS API และเข้าสู่ระบบสตูดิโอก่อนใช้งาน AI ครู');
 return root.StoryStudioAccess.request({action,...params});}
function getWorkspace(){
 const state=bridge.get();
 if(!state.project)throw Error('โปรเจกต์ยังไม่พร้อม');
 const core=root.StoryAIWorkspaceCore;
 state.project.aiWorkspace=core.ensure(state.project.aiWorkspace||{});
 bridge.persist();
 return state.project.aiWorkspace;
}
function projectId(){return getWorkspace().projectId}
function modelOptions(){
 return statusData?.providers||[{id:'openrouter',ready:false,model:'google/gemma-3-27b-it:free'},
  {id:'gemini',ready:false,model:'gemini-2.5-flash'}, {id:'compatible',ready:false,model:''}];
}
function sceneData(scene){
 return {id:scene.id,duration:scene.duration,voiceover:String(scene.voiceover||'').slice(0,800),
  subtitle:Array.isArray(scene.subtitle)?scene.subtitle.slice(0,3):[],
  notes:String(scene.notes||'').slice(0,350),
  actors:Array.isArray(scene.actors)?scene.actors.slice(0,8).map(a=>({char:a.char||a.id,x:a.x,y:a.y,pose:a.pose,toX:a.toX,toY:a.toY})):[]};
}
function context(){
 const s=bridge.get(),episodes=Array.isArray(s.episodes)?s.episodes:[];
 const idx=bridge.episodeIndex?.()||0;
 const selected=episodes[idx]||episodes[0];
 const current=bridge.scene?.()?.id||'';
 const scenes=(selected?.scenes||[]);
 const focus=scenes.findIndex(x=>x.id===current);
 const sample=focus>=0?scenes.slice(Math.max(0,focus-3),focus+4):scenes.slice(0,8);
 const info={project:{title:String(s.project?.title||'').slice(0,160),aspect:s.project?.aspect,fps:s.project?.fps},
  episodeOutline:episodes.slice(0,20).map(ep=>({id:ep.id,title:String(ep.title||'').slice(0,80),
    sceneCount:(ep.scenes||[]).length,scenes:(ep.scenes||[]).slice(0,12).map(sc=>({
      id:sc.id,duration:sc.duration,voiceoverPreview:String(sc.voiceover||'').slice(0,75),
      actors:(sc.actors||[]).length,audioClips:(sc.audioClips||[]).length}))})),
  selectedEpisode:selected?.id,selectedSceneId:current,
  selectedSceneDetails:sample.map(sceneData)};
 if(JSON.stringify(info).length>13000)
  info.episodeOutline=info.episodeOutline.map(ep=>({
   id:ep.id,title:ep.title,sceneCount:ep.sceneCount,
   scenes:ep.scenes.slice(0,3).map(sc=>({id:sc.id,duration:sc.duration}))}));
 if(JSON.stringify(info).length>13000)
  info.selectedSceneDetails=info.selectedSceneDetails.map(sc=>({
   ...sc,voiceover:sc.voiceover.slice(0,220),notes:sc.notes.slice(0,120),actors:sc.actors.slice(0,3)}));
 if(JSON.stringify(info).length>13000)info.selectedSceneDetails=info.selectedSceneDetails.slice(0,3);
 return JSON.stringify(info);
}
function summarizeDraft(ops){return ops.map(op=>({id:op.id,patch:op.patch}))}
function snapshotFor(ops){
 const all=bridge.get().episodes.flatMap(e=>e.scenes||[]);
 const map=new Map(all.map(x=>[x.id,x]));
 return ops.map(op=>({id:op.id,before:JSON.stringify(map.get(op.id)||null)}));
}
function saveRecovery(){
 const text=JSON.stringify(bridge.get());
 const blob=new Blob([text],{type:'application/json'});
 const url=URL.createObjectURL(blob),a=el('a',{href:url,download:'teacher-before-edit-'+Date.now()+'.json'});
 $doc.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);
}
async function loadStatus(){
 try{statusData=await api('teacher.status');const ready=modelOptions().find(x=>x.id===provider);
  if(!ready)provider='openrouter';setNotice('อ่านสถานะ AI ครูจาก AWS แล้ว');}
 catch(e){statusData=null;setNotice(String(e.message||e),true)}
 render();
}
function header(){
 return el('div',{className:'teacher-head'},
  el('div',{},el('strong',{},'AI Teacher Studio'),el('small',{},'AI ครูควบคุมงานผ่านคำสั่งที่ผ่านการตรวจสอบ · ไม่แก้โปรเจกต์เองโดยไม่อนุมัติ')),
  el('span',{className:'teacher-signal','data-ready':String(!!modelOptions().find(x=>x.id===provider)?.ready)},session()?'AWS Session':'ยังไม่เชื่อม AWS'));
}
function textField(label,value,attrs={}){
 return el('label',{className:'teacher-field'},el('span',{},label),el('input',{...attrs,value}));
}
function persistThread(){
 try{const w=getWorkspace();w.teacherConversation=thread.slice(-10).map(m=>({role:m.role,content:m.content.slice(0,1300)}));bridge.persist()}
 catch(e){}
}
function addMessage(role,content){thread.push({role,content:String(content).slice(0,4000)});thread=thread.slice(-12);persistThread()}
function draftCard(info){
 const box=el('div',{className:'teacher-draft'},el('strong',{},'ข้อเสนอแก้ไข '+info.ops.length+' ฉาก (ยังไม่ได้ใช้จริง)'));
 for(const op of info.ops){
  box.append(el('div',{className:'teacher-draft-item'},
   el('b',{},'ฉาก '+op.id),
   el('pre',{},JSON.stringify(op.patch,null,2))));
 }
 box.append(el('div',{className:'teacher-row'},
  button('ตรวจและใช้ข้อเสนอ',()=>acceptDraft(info),'teacher-primary',busy),
  button('ไม่ใช้ข้อเสนอ',()=>rejectDraft(info),'',busy)));
 return box;
}
async function rejectDraft(info){
 if(!statusData?.feedbackReady){pending=[];setNotice('ไม่ใช้ข้อเสนอแล้ว · ยังไม่ได้ติดตั้งฐานข้อมูลสำหรับบันทึกผล');render();return}
 try{await api('teacher.feedback',{projectId:projectId(),record:{
  sceneId:info.ops.map(x=>x.id).join(',').slice(0,160),original:info.request,
  proposed:JSON.stringify(summarizeDraft(info.ops)).slice(0,1800),
  reason:'Rejected by studio owner',outcome:'rejected',model:info.model,provider:info.provider}});
  pending=[];setNotice('บันทึกการไม่ใช้ข้อเสนอใน AWS แล้ว');render();
 }catch(e){setNotice('บันทึกการปฏิเสธไม่สำเร็จ: '+e.message,true)}
}
async function acceptDraft(info){
 if(busy)return;
 const s=bridge.get(),scenes=new Map((s.episodes||[]).flatMap(e=>e.scenes||[]).map(x=>[x.id,x]));
 if(info.refs.some(x=>JSON.stringify(scenes.get(x.id)||null)!==x.before)){
  setNotice('โปรเจกต์เปลี่ยนไปหลัง AI วิเคราะห์ กรุณาสั่ง AI ตรวจใหม่',true);return;
 }
 const ops=info.ops.filter(x=>scenes.has(x.id)&&Object.keys(x.patch).length);
 if(!ops.length||!root.StudioAPI?.apply){setNotice('ไม่พบข้อเสนอที่ใช้กับโปรเจกต์นี้ได้',true);return}
 const dry=root.StudioAPI.apply(ops,{dryRun:true});
 if(!dry.ok){setNotice('ข้อเสนอไม่ผ่านการตรวจ JSON: '+JSON.stringify((dry.errors||dry.issues||[]).slice(0,2)),true);return}
 if(!root.confirm('อนุมัติแก้ '+ops.length+' ฉาก? ระบบจะดาวน์โหลด JSON สำรองก่อนแก้ และบันทึกตัวอย่างฝึกบน AWS หากเปิดฐานข้อมูลแล้ว'))return;
 busy=true;render();
 let saved=false,applied=false;
 try{
  if(info.refs.some(x=>JSON.stringify(scenes.get(x.id)||null)!==x.before))throw Error('ข้อมูลฉากเปลี่ยนระหว่างการตรวจ');
  saveRecovery();
  const result=root.StudioAPI.apply(ops);
  if(!result.applied)throw Error('StudioAPI ไม่ยืนยันการแก้ไข');
  applied=true;pending=[];bridge.persist();
  if(statusData?.feedbackReady){
   const record=await api('teacher.feedback',{projectId:projectId(),record:{
    sceneId:ops.map(x=>x.id).join(',').slice(0,160),original:info.request,
    proposed:JSON.stringify(summarizeDraft(ops)).slice(0,1800),
    reason:'Approved and applied by studio owner',outcome:'approved',model:info.model,provider:info.provider}});
   saved=!!record.saved;
  }
  setNotice('แก้ '+ops.length+' ฉากแล้ว'+(saved?' · บันทึกข้อมูลฝึกใน AWS แล้ว (ยังไม่ได้ฝึกน้ำหนัก)':' · ยังไม่ได้บันทึกความจำบน AWS'));
 }catch(e){setNotice((applied?'แก้ฉากแล้ว แต่บันทึกผิดพลาด: ':'ไม่ได้แก้ฉาก: ')+e.message+(saved?' · ตัวอย่างถูกบันทึกแล้ว':' '),true)}
 finally{busy=false;render()}
}
async function sendMessage(value){
 const prompt=String(value||'').trim();
 if(!prompt||busy)return;
 if(prompt.length>4500){setNotice('ข้อความยาวเกิน 4500 ตัวอักษร',true);return}
 const history=thread.slice(-6);addMessage('user',prompt);pending=[];busy=true;render();
 try{
  const result=await api('teacher.chat',{provider,message:prompt,context:context(),history});
  const reply=String(result.reply||'').trim();
  addMessage('assistant',reply||'AI ครูส่งเฉพาะข้อเสนอแก้ไข');
  lastResponse={prompt,reply,model:result.model,provider:result.provider};
  if(studentReview?.awaitingTeacher){
   studentReview.awaitingTeacher=false;
   studentReview.teacherReason=String(result.lessonDecision?.reason||reply).slice(0,600);
   if(['keep','remove','review'].includes(result.lessonDecision?.label))
    studentChoice=result.lessonDecision.label;
  }
  const safeOps=Array.isArray(result.ops)?result.ops.filter(x=>x?.op==='updateScene'
   && typeof x.id==='string'&&x.patch&&typeof x.patch==='object'&&!Array.isArray(x.patch)
   && Object.keys(x.patch).every(k=>['notes','voiceover','subtitle','duration'].includes(k))).slice(0,6):[];
  if(safeOps.length)pending=[{ops:safeOps,refs:snapshotFor(safeOps),request:prompt,model:result.model,provider:result.provider}];
  setNotice('AI ครูตอบแล้ว · '+result.provider+' / '+result.model+(pending.length?' · มีข้อเสนอรอตรวจ':''));
 }catch(e){setNotice('AI ครูทำงานไม่สำเร็จ: '+e.message,true);addMessage('assistant','ไม่สามารถเรียก AI ครูได้ — โปรดตรวจการเชื่อมต่อและโควตา')}
 finally{busy=false;render()}
}
async function saveReply(outcome){
 if(!lastResponse)return;
 busy=true;render();
 try{
  await api('teacher.feedback',{projectId:projectId(),record:{
   sceneId:bridge.scene?.()?.id||'',
   original:lastResponse.prompt,proposed:lastResponse.reply,
   reason:'Teacher answer feedback',outcome,model:lastResponse.model,provider:lastResponse.provider}});
  setNotice('บันทึกผลประเมินใน AWS แล้ว — ใช้ทบทวน/เตรียมข้อมูลฝึกได้ แต่ยังไม่ได้ฝึกโมเดล');
 }catch(e){setNotice('บันทึกข้อมูลฝึกไม่สำเร็จ: '+e.message,true)}
 finally{busy=false;render()}
}
function chatPanel(){
 const content=el('div',{className:'teacher-content'});
 if(!modelOptions().some(p=>p.ready))content.append(el('div',{className:'teacher-quick-banner'},
  el('strong',{},'ยังไม่ได้เชื่อม AI ครู'),
  el('p',{},'ใช้ลิงก์ API และ API Key เท่านั้น ระบบเลือกโมเดลเริ่มต้นให้'),
  button('เชื่อม AI ครู',()=>{tab='connect';render()},'teacher-primary')));
 const providerSelect=el('select',{onchange:ev=>{provider=ev.target.value;render()}},
  ...modelOptions().map(p=>el('option',{value:p.id,selected:p.id===provider},p.id+' · '+(p.ready?'พร้อมใช้งาน':'ยังไม่เชื่อม'))));
 content.append(el('label',{className:'teacher-field'},'AI ครูที่เลือก',providerSelect));
 const autoPanel=el('div',{className:'teacher-auto-panel'});
 if(root.StoryAutoTeach)root.StoryAutoTeach.mount(autoPanel,bridge,provider);
 content.append(autoPanel);
 const commands=el('div',{className:'teacher-commands'},...MODES.map(m=>button(m.title,
   ()=>m.id==='student'?root.StoryAutoTeach?.teach?.().catch(()=>{}):sendMessage(m.prompt),'',busy)));
 content.append(el('strong',{},'คำสั่งลัด'),commands);
 const log=el('div',{className:'teacher-log',role:'log','aria-live':'polite'});
 if(!thread.length)log.append(el('p',{className:'teacher-muted'},'พิมพ์คำสั่งภาษาไทยหรืออังกฤษได้ AI ครูจะอ่านบทภาษาไทยตามต้นฉบับ'));
 for(const msg of thread)log.append(el('div',{className:'teacher-message '+msg.role},el('b',{},msg.role==='user'?'คุณ':'AI ครู'),el('p',{},msg.content)));
 content.append(log);
 if(lastResponse)content.append(el('div',{className:'teacher-row'},
  button('คำตอบนี้มีประโยชน์',()=>saveReply('approved'),'',busy||!statusData?.feedbackReady),
  button('คำตอบนี้ไม่ถูกต้อง',()=>saveReply('rejected'),'',busy||!statusData?.feedbackReady)));
 if(pending.length)content.append(draftCard(pending[0]));
 const prompt=el('textarea',{id:'teacherPrompt',rows:'4',maxLength:'4500',placeholder:'สั่ง AI ครู... เช่น Review the selected scene and propose safe corrections.'});
 prompt.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();sendMessage(prompt.value)}});
 content.append(prompt,el('div',{className:'teacher-row'},
  button(busy?'กำลังเรียก AI ครู...':'ส่งคำสั่ง',()=>sendMessage(prompt.value),'teacher-primary',busy),
  button('ตั้งค่า API',()=>{tab='connect';render()},'',busy)));
 return content;
}
/* Quick Connect deliberately recognizes only exact provider hosts. A dashboard URL
 * identifies the provider, not credentials. Arbitrary endpoints remain AWS-allowlisted. */
function resolveTeacherApiLink(value){
 let raw=String(value||'').trim();
 if(!raw)return {error:'กรุณาวางลิงก์ API หรือเลือกผู้ให้บริการด้านล่าง'};
 if(/^(?:openrouter\.ai|aistudio\.google\.com|generativelanguage\.googleapis\.com)(?:\/|$)/i.test(raw))raw='https://'+raw;
 let uri;try{uri=new URL(raw)}catch(_){return {error:'ลิงก์ไม่ถูกต้อง ต้องเป็น URL แบบ https://'};}
 if(uri.protocol!=='https:'||uri.username||uri.password||uri.search||uri.hash||!['','443'].includes(uri.port))
  return {error:'ใช้ HTTPS และอย่าใส่คีย์ในลิงก์ ให้แยก API Key ลงช่องด้านล่าง'};
 const host=uri.hostname.toLowerCase(),path=uri.pathname.replace(/\/+$/,'')||'/';
 if(host==='openrouter.ai'||host==='www.openrouter.ai')
  return {provider:'openrouter',url:'https://openrouter.ai/api/v1',name:'OpenRouter'};
 if(['aistudio.google.com','ai.google.dev','generativelanguage.googleapis.com'].includes(host))
  return {provider:'gemini',url:'https://generativelanguage.googleapis.com/v1beta',name:'Google Gemini'};
 if(!/^[a-z0-9.-]+$/i.test(host)||host==='localhost')
  return {error:'โดเมน API ไม่ถูกต้อง'};
 const base=path.replace(/\/chat\/completions$/,'').replace(/\/+$/,'');
 if(!base||base==='/')return {error:'ลิงก์ API อื่นต้องระบุ Base URL เช่น https://api.example.com/v1'};
 return {provider:'compatible',url:uri.origin+base,name:'OpenAI-compatible'};
}
function teacherModelFor(providerId){
 return modelOptions().find(x=>x.id===providerId)?.model||
  (providerId==='gemini'?'gemini-2.5-flash':providerId==='openrouter'?'google/gemma-3-27b-it:free':'');
}
async function saveConnection(){
 if(busy)return;
 const input=container.querySelector('#teacherQuickUrl');
 const link=resolveTeacherApiLink(input?.value||connectionDraft.url);
 if(link.error){setNotice(link.error,true);return;}
 const p=link.provider,configured=modelOptions().find(x=>x.id===p);
 const model=(container.querySelector('#teacherAdvancedModel')?.value||'').trim()||teacherModelFor(p);
 if(p==='compatible'&&!model){setNotice('สำหรับ API อื่น ต้องใส่ Model ID ในตัวเลือกขั้นสูงก่อน',true);return;}
 const keyInput=container.querySelector('#teacherQuickKey');
 const apiKey=keyInput?.value.trim()||'';
 if(!apiKey&&!configured?.ready){setNotice('ยังไม่มี API Key ที่บันทึกไว้ ต้องใส่ API Key ก่อน (ลิงก์อย่างเดียวใช้ไม่ได้)',true);return;}
 if(!session()){setNotice('กรุณาเข้าสู่ระบบสตูดิโอก่อนเชื่อม API',true);return;}
 busy=true;
 if(keyInput)keyInput.value='';
 const submit=container.querySelector('#teacherQuickSubmit');
 if(submit)submit.disabled=true;
 try{
  const data=await api('teacher.configure',{provider:p,model,apiKey,
   baseUrl:p==='compatible'?link.url:''});
  if(!data.ok)throw Error('AWS ไม่ยืนยันการบันทึกการเชื่อมต่อ');
  statusData=await api('teacher.status');
  if(!statusData.providers?.some(x=>x.id===p&&x.ready))
   throw Error('ยังตรวจไม่พบการบันทึกคีย์บน AWS');
  provider=p;connectionDraft={url:link.url,model:''};tab='chat';
  setNotice('บันทึก API '+link.name+' บน AWS แล้ว · ทดลองส่งคำสั่งในแชตเพื่อตรวจการตอบจริง');
 }catch(e){
  setNotice('เชื่อม API ไม่สำเร็จ: '+String(e.message||e),true);
 }finally{busy=false;render();}
}
function connectPanel(){
 const content=el('div',{className:'teacher-content'});
 const sample=connectionDraft.url||'';
 const initial=resolveTeacherApiLink(sample);
 const connected=modelOptions().filter(p=>p.ready);
 const saved=initial.provider&&connected.some(p=>p.id===initial.provider);
 content.append(el('h3',{},'เชื่อม AI ครูแบบง่าย'),
  el('p',{className:'teacher-muted'},'วางลิงก์ API → ใส่ API Key → กดเชื่อม ระบบจะรู้จัก OpenRouter หรือ Gemini ให้อัตโนมัติ'),
  el('label',{className:'teacher-field'},el('span',{},'1. ลิงก์ API'),
   el('input',{id:'teacherQuickUrl',value:connectionDraft.url,inputMode:'url',autocomplete:'off',
    spellcheck:'false',placeholder:'https://openrouter.ai/api/v1',
    oninput:ev=>{
      connectionDraft.url=ev.target.value;
      const match=resolveTeacherApiLink(ev.target.value);
      const hint=container.querySelector('#teacherUrlHint');
      if(hint)hint.textContent=match.error?match.error:'ตรวจพบ '+match.name+
       ' · โมเดล '+(connectionDraft.model||teacherModelFor(match.provider)||'ตั้งค่าในขั้นสูง');
    }})),
  el('p',{id:'teacherUrlHint',className:'teacher-muted'},
    initial.provider?'ตรวจพบ '+initial.name+' · '+(saved?'มีคีย์บันทึกไว้แล้ว':'ต้องใส่ API Key'): 'รองรับลิงก์ OpenRouter, Google AI Studio และ API ที่อนุญาตบน AWS'),
  el('div',{className:'teacher-row teacher-provider-preset'},
   button('OpenRouter',()=>{connectionDraft.url='https://openrouter.ai/api/v1';connectionDraft.model='';render()}),
   button('Gemini',()=>{connectionDraft.url='https://generativelanguage.googleapis.com/v1beta';connectionDraft.model='';render()})),
  el('label',{className:'teacher-field'},el('span',{},'2. API Key'),
   el('input',{id:'teacherQuickKey',type:'password',autocomplete:'new-password',spellcheck:'false',
    placeholder:saved?'มีคีย์เดิมบน AWS แล้ว (เว้นว่างได้)':'วาง API Key ที่นี่'})),
  el('details',{className:'teacher-advanced'},
   el('summary',{},'ตัวเลือกขั้นสูง · เลือกโมเดลเอง / API อื่น'),
   el('p',{className:'teacher-muted'},'OpenRouter ใช้เฉพาะโมเดล :free ตามค่าเริ่มต้น API อื่นต้องมี Model ID และโดเมนต้องอยู่ในรายการที่อนุญาตบน AWS'),
   textField('Model ID (ไม่บังคับสำหรับ OpenRouter / Gemini)',connectionDraft.model,{
    id:'teacherAdvancedModel',placeholder:'เว้นว่างเพื่อเลือกให้อัตโนมัติ',
    oninput:ev=>{connectionDraft.model=ev.target.value;}})),
  el('div',{className:'teacher-row'},
   button(busy?'กำลังบันทึก...':'เชื่อมต่อ AI ครู',saveConnection,'teacher-primary',busy||!session()),
   button('ตรวจสถานะ AWS',loadStatus,'',busy)),
  el('p',{className:'teacher-muted'},'ต้องใช้ API Key ของผู้ให้บริการด้วย (ลิงก์อย่างเดียวไม่ใช่สิทธิ์ใช้งาน AI) · คีย์จะส่งผ่าน HTTPS และเก็บใน SSM SecureString หรือ Secrets Manager ไม่บันทึกลงโปรเจกต์หรือ GitHub'));
 if(connected.length)content.append(el('p',{className:'teacher-muted'},'บันทึกคีย์ไว้แล้ว: '+connected.map(x=>x.id).join(', ')+' · ยังต้องทดลองส่งข้อความเพื่อยืนยันว่าโมเดลตอบได้จริง'));
 if(!statusData?.settingsReady)content.append(el('p',{className:'teacher-warning'},'ยังไม่ได้ตรวจพบสถานะที่เก็บคีย์บน AWS กรุณาเข้าสู่ระบบและกดตรวจสถานะ'));
 return content;
}
async function showHistory(){
 if(busy)return;
 busy=true;setNotice('กำลังโหลด Feedback ของโปรเจกต์นี้จาก AWS');
 try{const data=await api('teacher.history',{projectId:projectId()});
  const area=container.querySelector('.teacher-history');
  if(area){area.replaceChildren();
   if(!data.items?.length)area.append(el('p',{className:'teacher-muted'},'ยังไม่มีข้อมูลที่บันทึกใน AWS'));
   for(const item of data.items||[]){
    const r=item.record||{};
    area.append(el('article',{className:'teacher-memory-item'},
      el('strong',{},r.outcome||'unknown'),el('small',{},new Date((item.createdAt||0)*1000).toLocaleString('th-TH')),
      el('p',{},String(r.original||'').slice(0,180)),el('p',{},String(r.proposed||'').slice(0,180))));
   }
  }
  setNotice('โหลด Feedback ของโปรเจกต์นี้ '+(data.items?.length||0)+' รายการ (แยกจากบทเรียน AI ลูก)');
 }catch(e){setNotice('อ่านความจำไม่สำเร็จ: '+e.message,true)}
 finally{busy=false}
}

function currentStudentScene(){
 const state=bridge.get(),scene=bridge.scene?.();
 if(!scene?.id||!String(scene.voiceover||'').trim())throw Error('กรุณาเลือกฉากที่มีบทพากย์ก่อน');
 const episode=state.episodes?.[bridge.episodeIndex?.()||0];
 return {scene,episode};
}
async function reviewStudent(){
 if(busy)return;
 let current;
 try{current=currentStudentScene()}catch(e){setNotice(e.message,true);return}
 const ml=root.StoryScriptML;
 if(!ml?.review||!ml?.sceneContextById){setNotice('Script ML ยังไม่พร้อม โปรดรีโหลดหน้าเว็บ',true);return}
 busy=true;
 try{
  // Read long-term memory before making the student's next decision.
  try{await root.StoryStudentLearning?.load?.()}catch(_){}
  const ctx=ml.sceneContextById(bridge.get(),current.scene.id)||{};
  const original=String(current.scene.voiceover);
  const child=ml.review(original,ctx);
  if(child?.intent?.hasRepetition===false)
   throw Error('ฉากนี้ไม่พบคำซ้ำที่ต้องเรียนรู้ กรุณาเลือกฉากที่มีคำซ้ำหรือข้อสงสัย');
  studentChoice=child?.intent?.decision==='clean'?'review':
   child?.intent?.decision==='remove'?'remove':
   child?.intent?.decision==='keep'?'keep':'review';
  studentOwnerReason='';
  studentReview={sceneId:current.scene.id,episodeId:current.episode?.id||'',
   original,context:{mode:String(ctx.mode||'narration'),
   emotion:String(ctx.emotion||''),situation:String(ctx.situation||'')},
   childDecision:child?.intent?.decision||'review',
   childProposed:String(child?.proposed||original).slice(0,1200),
   childReason:String(child?.intent?.reason||'').slice(0,500),
   memory:child?.intent?.memoryAdvice||null,
   teacherReason:'',awaitingTeacher:!!modelOptions().find(x=>x.id===provider&&x.ready)};
  setNotice('AI ลูกวิเคราะห์ฉากแล้ว · '+studentReview.childDecision+
   ' · '+(studentReview.memory?'พบความจำก่อนหน้า':'ยังไม่มีความจำที่ตรงกัน'));
 }catch(e){setNotice('วิเคราะห์ AI ลูกไม่สำเร็จ: '+e.message,true)}
 finally{busy=false;render()}
 if(!studentReview?.awaitingTeacher)return;
 const prompt='Evaluate the student AI repetition decision for this Thai script. '+
  'Preserve author intent and emotion. Return JSON reply, ops:[], '+
  'and lessonDecision:{label:"keep|remove|review",reason:"..."} '+
  'as a recommendation only. Student decision: '+studentReview.childDecision+
  '. Student reason: '+studentReview.childReason+
  '. Student proposed: '+studentReview.childProposed+
  '. Context: '+JSON.stringify(studentReview.context)+
  '. Original Thai narration: '+studentReview.original.slice(0,800);
 await sendMessage(prompt.slice(0,4400));
}
async function saveStudentLesson(){
 if(busy||!studentReview)return;
 const current=bridge.get().episodes.flatMap(e=>e.scenes||[]).find(s=>s.id===studentReview.sceneId);
 if(!current||String(current.voiceover||'')!==studentReview.original){
  setNotice('บทเปลี่ยนไปหลังวิเคราะห์ กรุณาวิเคราะห์ใหม่ก่อนสอน',true);return;
 }
 if(!root.confirm('ยืนยันสอน AI ลูกว่า "'+studentChoice+
  '" ถูกต้องสำหรับฉากนี้? เก็บบทเรียนนี้บน AWS เพื่อใช้กับเรื่องถัดไป (ยังไม่ฝึกน้ำหนัก)'))return;
 busy=true;render();
 try{
  const result=await api('student.lesson',{projectId:projectId(),lesson:{
   reviewedByOwner:true,text:studentReview.original,label:studentChoice,
   sceneId:studentReview.sceneId,episodeId:studentReview.episodeId,
   context:studentReview.context,studentDecision:studentReview.childDecision,
   teacherReason:studentReview.teacherReason,ownerReason:studentOwnerReason}});
  if(!result.saved)throw Error('AWS ยังไม่ยืนยันการจัดเก็บบทเรียน');
  studentReview=null;
  try{
   await root.StoryStudentLearning?.load?.(true);
   setNotice('บันทึกบทเรียนบน AWS แล้ว · AI ลูกสามารถค้นคืนได้ในงานถัดไป (ยังไม่ได้เปลี่ยนน้ำหนักโมเดล)');
  }catch(_){
   setNotice('AWS ยืนยันว่าบันทึกบทเรียนแล้ว แต่การรีเฟรชความจำล้มเหลว · กดโหลดความจำ AWS เพื่อทดลองใหม่',true);
  }
 }catch(e){setNotice('สอน AI ลูกไม่สำเร็จ: '+e.message,true)}
 finally{busy=false;render()}
}
async function refreshStudentMemory(){
 if(busy)return;
 busy=true;render();
 try{
  const [state,versions]=await Promise.all([
   root.StoryStudentLearning.load(true),api('student.candidates')]);
  studentCandidates=Array.isArray(versions?.candidates)?versions.candidates:[];
  if(!lastStudentCandidate)lastStudentCandidate=studentCandidates.find(x=>x.metrics?.qaPassed)||null;
  setNotice('โหลดความจำจาก AWS '+state.lessonCount+' ตัวอย่าง · โมเดล '+(state.activeVersion||'ยังไม่เปิดใช้'));
 }catch(e){setNotice('โหลดความจำไม่สำเร็จ: '+e.message,true)}
 finally{busy=false;render()}
}
async function trainStudentModel(){
 if(busy)return;
 if(!root.confirm('เริ่มฝึกโมเดลคำซ้ำ CPU จากข้อมูลที่คุณอนุมัติแล้ว? ต้องมีอย่างน้อย 60 ตัวอย่าง จาก 5 เรื่อง และแต่ละ label อย่างน้อย 10 ตัวอย่าง'))return;
 busy=true;render();
 try{
  const result=await api('student.train');
  if(!result.trained)throw Error('ระบบยังไม่ยืนยันว่าฝึกโมเดล');
  lastStudentCandidate=result.candidate;
  studentCandidates.unshift(result.candidate);
  const m=result.candidate?.metrics||{};
  setNotice('ฝึกน้ำหนักแล้ว รุ่น '+result.candidate.version+
   ' · Holdout '+Math.round(Number(m.accuracy||0)*100)+'%'+
   (m.qaPassed?' · ผ่านเกณฑ์ QA รออนุมัติ':' · ยังไม่ผ่าน QA ห้ามเปิดใช้'));
 }catch(e){setNotice('ฝึกไม่สำเร็จ: '+e.message,true)}
 finally{busy=false;render()}
}
async function activateStudentModel(){
 const model=lastStudentCandidate;
 if(busy||!model?.metrics?.qaPassed)return;
 if(!root.confirm('อนุมัติโมเดล '+model.version+
  ' สำหรับให้คำแนะนำเท่านั้น? โมเดลจะไม่แก้บทหรือส่งออกโดยอัตโนมัติ'))return;
 busy=true;render();
 try{
  const result=await api('student.activate',{version:model.version,approvedByOwner:true});
  if(!result.activated)throw Error('AWS ไม่ยืนยันการเปิดใช้โมเดล');
  await root.StoryStudentLearning.load(true);
  setNotice('เปิดใช้โมเดล '+model.version+' เป็นที่ปรึกษา AI ลูกแล้ว · ยังคงตรวจและอนุมัติก่อนแก้บท');
 }catch(e){setNotice('เปิดใช้โมเดลไม่สำเร็จ: '+e.message,true)}
 finally{busy=false;render()}
}
function studentPanel(){
 const summary=root.StoryStudentLearning?.summary?.()||{};
 const content=el('div',{className:'teacher-content'},
  el('strong',{},'AI ลูกเรียนรู้จากงานจริง'),
  el('p',{className:'teacher-muted'},
   '1. นำเข้า JSON แล้วเลือกฉาก · 2. ให้ AI ลูกวิเคราะห์และ AI แม่ตรวจ · 3. เลือกผลที่ถูกต้องและบันทึกบน AWS · 4. สะสมหลายเรื่องเพื่อฝึกน้ำหนัก'),
  el('div',{className:'teacher-row'},button('AI ลูกวิเคราะห์ → AI แม่ตรวจ',reviewStudent,'teacher-primary',busy),
    button('โหลดความจำ AWS',refreshStudentMemory,'',busy),
    button('ดูบทเรียนที่บันทึก',()=>{
      tab='memory';render();
      if(!lessonBrowser.loaded&&!lessonBrowser.loading)loadLessonDashboard(true);
    },'',busy)),
  el('p',{className:'teacher-muted'},'ตัวอย่างในหน่วยความจำ '+(summary.lessonCount||0)+
   ' · โมเดลปัจจุบัน '+(summary.activeVersion||'ยังไม่มีรุ่นอนุมัติ')));
 if(studentReview){
  content.append(el('article',{className:'teacher-draft'},
   el('strong',{},'ผลวิเคราะห์ฉาก '+studentReview.sceneId),
   el('p',{},'บทต้นฉบับ: '+studentReview.original.slice(0,900)),
   el('p',{},'AI ลูก: '+studentReview.childDecision+' · '+studentReview.childReason),
   ...(studentReview.memory?[el('p',{},'ความจำเดิม: '+studentReview.memory.label+
     ' · ที่มา '+studentReview.memory.source)]:[]),
   el('p',{},'AI แม่: '+(studentReview.teacherReason||'ยังไม่ตรวจ / ใช้การตัดสินใจของคุณ')),
   el('label',{className:'teacher-field'},el('span',{},'คำตอบที่ถูกต้อง (คุณเป็นผู้อนุมัติ)'),
    el('select',{id:'studentLessonChoice',onchange:ev=>{studentChoice=ev.target.value}},
     ...[['keep','ควรเก็บคำซ้ำ'],['remove','ควรลบคำซ้ำ'],['review','ยังไม่แน่ใจ ต้องตรวจ']].map(([value,label])=>
      el('option',{value,selected:value===studentChoice},label)))),
   el('label',{className:'teacher-field'},el('span',{},'เหตุผลเพิ่มเติม (ไม่บังคับ)'),
    el('textarea',{rows:2,maxLength:700,oninput:ev=>{studentOwnerReason=ev.target.value}},studentOwnerReason)),
   button('อนุมัติและบันทึกบทเรียนบน AWS',saveStudentLesson,'teacher-primary',busy)));
 }
 content.append(el('div',{className:'teacher-memory-training'},
  el('strong',{},'ฝึกน้ำหนักโมเดล CPU'),
  el('p',{className:'teacher-muted'},
   'ฝึกจากตัวอย่างที่คุณอนุมัติอย่างน้อย 60 ตัวอย่าง / 5 เรื่อง มีชุดทดสอบแยกตามเรื่อง โมเดลจะไม่เปิดใช้เอง'),
  el('div',{className:'teacher-row'},
   button('ฝึกโมเดลรุ่นใหม่',trainStudentModel,'',busy),
   button('เปิดใช้รุ่นที่ผ่าน QA',activateStudentModel,'teacher-primary',
     busy||!lastStudentCandidate?.metrics?.qaPassed)),
  ...(studentCandidates.length?[el('label',{className:'teacher-field'},
   el('span',{},'โมเดลย้อนหลัง (เลือกรุ่นที่ผ่าน QA เพื่อเปิดใช้หรือย้อนกลับ)'),
   el('select',{onchange:ev=>{
     lastStudentCandidate=studentCandidates.find(c=>c.version===ev.target.value)||null;render();
    }},...studentCandidates.map(c=>el('option',{
       value:c.version,selected:lastStudentCandidate?.version===c.version},
       c.version+(c.metrics?.qaPassed?' · ผ่าน QA':' · ไม่ผ่าน QA')))))]:[]),
  ...(lastStudentCandidate?[el('p',{className:'teacher-muted'},'รุ่น '+lastStudentCandidate.version+
   ' · ความถูกต้องชุดทดสอบ '+Math.round(Number(lastStudentCandidate.metrics.accuracy)*100)+'%'+
   ' · '+(lastStudentCandidate.metrics.qaPassed?'ผ่าน QA':'ไม่ผ่าน QA'))]:[])));
 return content;
}
const LESSON_LABELS={keep:'ควรเก็บคำซ้ำ',remove:'ควรลบคำซ้ำ',review:'ต้องตรวจเพิ่มเติม'};
function filteredMemoryLessons(items,query,label){
 const q=String(query||'').trim().toLowerCase();
 return (Array.isArray(items)?items:[]).filter(item=>{
  if(label!=='all'&&item.label!==label)return false;
  if(!q)return true;
  return [item.text,item.label,item.projectId,item.episodeId,item.sceneId,
   item.teacherReason,item.ownerReason,item.studentDecision,
   item.context?.emotion,item.context?.situation,item.context?.mode]
   .some(v=>String(v||'').toLowerCase().includes(q));
 });
}
function lessonDate(value){
 const seconds=Number(value);
 if(!Number.isFinite(seconds)||seconds<=0)return 'ไม่ทราบวันที่';
 return new Date(seconds*1000).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'});
}
function lessonCard(item){
 const text=String(item.text||'').slice(0,1000),reason=String(item.teacherReason||'');
 const approved=String(item.ownerReason||'');
 const label=LESSON_LABELS[item.label]||'ไม่ทราบประเภท';
 const article=el('details',{className:'teacher-lesson-card'},
  el('summary',{},
   el('span',{className:'teacher-lesson-label'},label),
   el('span',{className:'teacher-lesson-snippet'},text.slice(0,130)),
   el('small',{},lessonDate(item.createdAt)+' · '+String(item.sceneId||'ไม่ระบุฉาก'))),
  el('div',{className:'teacher-lesson-detail'},
   el('strong',{},'บทต้นฉบับ'),
   el('p',{},text),
   el('strong',{},'เหตุผลของ AI ครู'),
   el('p',{},reason||'ไม่มีเหตุผลจาก AI ครูบันทึกไว้'),
   el('strong',{},'เหตุผลที่คุณบันทึก'),
   el('p',{},approved||'ไม่ได้ระบุเหตุผลเพิ่มเติม'),
   el('strong',{},'AI ลูกเคยตัดสินใจ'),
   el('p',{},String(item.studentDecision||'ไม่ทราบ')),
   el('small',{},'โปรเจกต์ '+String(item.projectId||'-')+
    ' · ตอน '+String(item.episodeId||'-')+
    ' · ฉาก '+String(item.sceneId||'-')),
   el('small',{},'บริบท: '+JSON.stringify(item.context||{})),
   el('small',{},'สถานะ: ผู้ใช้อนุมัติสำหรับการฝึก ไม่ได้ยืนยันว่าใช้ฝึกน้ำหนักแล้ว')));
 return article;
}
function paintLessonList(){
 const list=container?.querySelector('.teacher-lesson-list'),
  summary=container?.querySelector('.teacher-memory-count');
 if(!list)return;
 const filtered=filteredMemoryLessons(lessonBrowser.items,lessonBrowser.query,lessonBrowser.label);
 if(summary)summary.textContent='โหลดจาก AWS แล้ว '+lessonBrowser.items.length+
  ' บทเรียน · ตรงเงื่อนไข '+filtered.length+
  (lessonBrowser.nextCursor?' · ยังมีหน้าถัดไป':' · ไม่มีหน้าถัดไปที่ทราบ');
 list.replaceChildren();
 if(!lessonBrowser.loaded&&!lessonBrowser.loading)
  list.append(el('p',{className:'teacher-muted'},'กดโหลดข้อมูล AWS เพื่อดูบทเรียนจริง'));
 if(lessonBrowser.loading&&(!lessonBrowser.loaded||!lessonBrowser.items.length))
  list.append(el('p',{className:'teacher-muted'},'กำลังโหลดบทเรียนจาก AWS...'));
 if(lessonBrowser.error)
  list.append(el('p',{className:'teacher-warning'},lessonBrowser.error));
 if(lessonBrowser.loaded&&!filtered.length)
  list.append(el('p',{className:'teacher-muted'},lessonBrowser.items.length?
   'ไม่มีบทเรียนตรงกับคำค้นหาในรายการที่โหลดแล้ว':'ยังไม่มีบทเรียนที่ได้รับการอนุมัติบน AWS'));
 for(const item of filtered.slice(0,lessonBrowser.showCount))list.append(lessonCard(item));
 if(filtered.length>lessonBrowser.showCount)
  list.append(button('แสดงรายการที่โหลดไว้เพิ่ม',()=>{
   lessonBrowser.showCount+=40;paintLessonList()},'',lessonBrowser.loading));
 if(lessonBrowser.nextCursor)list.append(button(
  lessonBrowser.loading?'กำลังโหลด...':'โหลดบทเรียนหน้าถัดไปจาก AWS',
  ()=>loadLessonDashboard(false),'',lessonBrowser.loading));
}
function renderModelHistory(){
 const area=el('div',{className:'teacher-model-history'},
  el('strong',{},'ประวัติรุ่นโมเดล AI ลูก'),
  el('p',{className:'teacher-muted'},'แสดงรุ่นล่าสุดสูงสุด 10 รุ่น · คะแนนจากชุดทดสอบ ไม่ใช่การรับประกันความถูกต้องทุกฉาก'),
  el('p',{},'รุ่นที่เปิดใช้: '+(lessonBrowser.activeVersion||'ยังไม่มีโมเดลที่เปิดใช้')));
 if(!lessonBrowser.models.length)area.append(el('p',{className:'teacher-muted'},'ยังไม่มีโมเดลที่ฝึก หรือยังไม่ได้โหลดข้อมูล AWS'));
 for(const m of lessonBrowser.models){
  const metrics=m.metrics||{};
  const percentage=Number(metrics.accuracy);
  area.append(el('article',{className:'teacher-model-row'},
   el('strong',{},String(m.version||'-')+(m.version===lessonBrowser.activeVersion?' · กำลังใช้งาน':'')),
   el('small',{},'Holdout '+(Number.isFinite(percentage)?(percentage*100).toFixed(1)+'%':'ไม่ทราบ')+
    ' · ตัวอย่างฝึก '+String(metrics.trainRows??'-')+
    ' · ทดสอบ '+String(metrics.testRows??'-')+
    ' · '+(metrics.qaPassed?'ผ่าน QA':'ยังไม่ผ่าน QA')),
   el('small',{},'สถานะ '+String(m.status||'candidate')+
    ' · ไม่แก้บทเองโดยอัตโนมัติ')));
 }
 return area;
}
async function loadLessonDashboard(reset=true){
 if(lessonBrowser.loading)return;
 if(!session()){lessonBrowser.error='ต้องเข้าสู่ระบบสตูดิโอก่อนดูบทเรียน';paintLessonList();return}
 lessonBrowser.loading=true;lessonBrowser.error='';
 if(reset){
  lessonBrowser.loaded=false;lessonBrowser.items=[];lessonBrowser.nextCursor=null;
  lessonBrowser.showCount=40;
 }
 paintLessonList();
 try{
  const args={limit:40};
  if(!reset&&lessonBrowser.nextCursor)args.cursor=lessonBrowser.nextCursor;
  const requests=[api('student.lessons',args)];
  if(reset)requests.push(api('student.candidates'),api('student.model'));
  const data=await Promise.all(requests);
  if(!Array.isArray(data[0]?.lessons))throw Error('AWS ไม่ส่งรายการบทเรียนที่อ่านได้');
  const prev=new Map(lessonBrowser.items.map(row=>[row.id,row]));
  for(const item of data[0].lessons)if(item&&typeof item.id==='string')prev.set(item.id,item);
  lessonBrowser.items=[...prev.values()];
  lessonBrowser.nextCursor=typeof data[0].nextCursor==='string'?data[0].nextCursor:null;
  if(reset){
   lessonBrowser.models=Array.isArray(data[1]?.candidates)?data[1].candidates:[];
   lessonBrowser.activeVersion=data[2]?.active?.version||null;
  }
  lessonBrowser.loaded=true;
  setNotice('อ่านข้อมูล AI ลูกจาก AWS แล้ว '+lessonBrowser.items.length+
    ' รายการ'+(lessonBrowser.nextCursor?' · มีบทเรียนให้โหลดเพิ่ม':'')+
    ' · ไม่ได้หมายความว่าฝึกน้ำหนักแล้ว');
 }catch(e){
  lessonBrowser.error='อ่าน AWS ไม่สำเร็จ: '+String(e.message||e);
  setNotice(lessonBrowser.error,true);
 }finally{
  lessonBrowser.loading=false;
  if(tab==='memory')render();
 }
}
function memoryPanel(){
 const content=el('div',{className:'teacher-content teacher-memory-dashboard'},
  el('strong',{},'ความจำ AI ลูก · ข้อมูลจริงจาก AWS'),
  el('p',{className:'teacher-muted'},
   'บทเรียนที่คุณอนุมัติไว้จากทุกโปรเจกต์จะอยู่ใน DynamoDB ไม่หายเมื่อรีเว็บ (หากยังเก็บอยู่บน AWS) การค้นหาจะค้นเฉพาะหน้าที่โหลดมาแล้ว'),
  el('div',{className:'teacher-row'},
   button(lessonBrowser.loading?'กำลังโหลด...':'รีเฟรชข้อมูล AWS',
    ()=>loadLessonDashboard(true),'teacher-primary',lessonBrowser.loading),
   button('ไปหน้าสอน AI ลูก',()=>{tab='student';render()},'',lessonBrowser.loading)),
  el('p',{className:'teacher-memory-count',role:'status'},'ยังไม่ได้โหลดบทเรียน'),
  el('div',{className:'teacher-memory-filters'},
   el('label',{className:'teacher-field'},el('span',{},'ค้นหาบท / เหตุผล / ฉาก'),
    el('input',{id:'studentMemorySearch',type:'search',value:lessonBrowser.query,
     placeholder:'พิมพ์คำไทยหรือ Scene ID',oninput:ev=>{
      lessonBrowser.query=ev.target.value;lessonBrowser.showCount=40;paintLessonList()}})),
   el('label',{className:'teacher-field'},el('span',{},'ประเภทคำตอบ'),
    el('select',{id:'studentMemoryLabel',value:lessonBrowser.label,onchange:ev=>{
      lessonBrowser.label=ev.target.value;lessonBrowser.showCount=40;paintLessonList()}},
     ...[['all','ทุกประเภท'],['keep','ควรเก็บ'],['remove','ควรลบ'],['review','ต้องตรวจ']].map(
      ([value,label])=>el('option',{value,selected:value===lessonBrowser.label},label))))),
  el('div',{className:'teacher-lesson-list','aria-live':'polite'}),
  renderModelHistory(),
  el('details',{className:'teacher-feedback-details'},
   el('summary',{},'ประวัติ Feedback จาก AI ครู (เฉพาะโปรเจกต์นี้)'),
   el('p',{className:'teacher-muted'},'ข้อมูลนี้แยกจากบทเรียนที่อนุมัติสำหรับฝึก AI ลูก'),
   button('โหลด Feedback โปรเจกต์นี้',showHistory,'',busy),
   el('div',{className:'teacher-history'},el('p',{className:'teacher-muted'},'กดโหลดเพื่อดู Feedback รายการล่าสุด'))));
 if(!statusData?.feedbackReady)content.append(el('p',{className:'teacher-muted'},
  'หากยังไม่โหลดข้อมูล โปรดตรวจการเชื่อมต่อ AWS · บทเรียนต้องบันทึกสำเร็จจึงจะปรากฏ'));
 return content;
}

function storyPanel(){
 const area=el('div',{className:'teacher-content'});
 if(root.StoryStoryCoachUI)root.StoryStoryCoachUI.mount(area,bridge,provider);
 else area.append(el('p',{className:'teacher-warning'},'ยังไม่ได้โหลดระบบตรวจความต่อเนื่อง'));
 return area;
}
function render(reset=true){
 if(!container)return;
 const active=$doc.activeElement;
 if(!reset&&active&&container.contains(active))active.blur();
 container.replaceChildren(header(),
  el('nav',{className:'teacher-tabs','aria-label':'AI Teacher Studio'},
    ...[['chat','คุย / สั่งงาน'],['story','ต่อเติมบท'],['connect','เชื่อม API'],['student','สอน AI ลูก'],['memory','ประวัติ']].map(([id,label])=>
     button(label,()=>{
       tab=id;render();
       if(id==='memory'&&!lessonBrowser.loaded&&!lessonBrowser.loading)loadLessonDashboard(true);
      },tab===id?'active':''))),
  el('p',{className:'teacher-notice',role:'status','aria-live':'polite','data-error':String(noticeError)},notice||'AI ครูต้องเชื่อมต่อ API ก่อนใช้งาน'),
  tab==='connect'?connectPanel():tab==='memory'?memoryPanel():tab==='student'?studentPanel():tab==='story'?storyPanel():chatPanel());
}
function mount(target,source){
 container=target;bridge=source;getWorkspace();
 const stored=getWorkspace().teacherConversation;
 if(Array.isArray(stored)&&!thread.length)thread=stored.filter(x=>['user','assistant'].includes(x.role)&&typeof x.content==='string').slice(-10);
 render();if(session()&&!statusData&&!busy)loadStatus();
}
root.StoryTeacherStudio=Object.freeze({mount,render});
})(window);
