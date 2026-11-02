/* AI Teacher Studio: authenticated server-side providers, reviewed edits, persistent feedback.
 * No browser-held API tokens, no arbitrary model-generated DOM, no silent edits. */
(function(root){
'use strict';
const $doc=root.document;
const MODES=[
 {id:'review',title:'ตรวจทั้งโปรเจกต์',prompt:'Review the current Thai animation project. Identify concrete continuity, narration and timing risks. Only propose supported corrections.'},
 {id:'pacing',title:'แก้จังหวะฉาก',prompt:'Audit scene pacing from the available JSON. Suggest safer durations; never claim to have measured audio that is not supplied.'},
 {id:'script',title:'ตรวจคำซ้ำและอารมณ์',prompt:'Review Thai script repetitions, intent and emotion. Preserve intentional stuttering, fear, emphasis and dialogue meaning.'},
 {id:'student',title:'สอน AI ลูก',prompt:'Evaluate the current student AI outputs, identify mistakes and suggest specific examples to submit for human-reviewed training feedback.'},
 {id:'qa',title:'ตรวจโครงสร้างภาพ/เสียง',prompt:'Run a static JSON quality review for scene continuity, audio references, subtitle lengths and character placement. State which video/audio checks require actual media.'},
 {id:'produce',title:'วางแผนผลิตทุกตอน',prompt:'Create a safe execution plan to produce and validate all episodes. Do not claim to render or export without a tool that actually does so.'}
];
let bridge,container,tab='chat',provider='openrouter',statusData=null,thread=[],pending=[],busy=false,notice='',noticeError=false,lastResponse=null;
let connectionDraft={url:'',model:''};
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
 const commands=el('div',{className:'teacher-commands'},...MODES.map(m=>button(m.title,()=>sendMessage(m.prompt),'',busy)));
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
 busy=true;setNotice('กำลังอ่านความจำ AI ลูกจาก AWS');render(false);
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
  setNotice('อ่านข้อมูลที่บันทึกแล้ว '+(data.items?.length||0)+' รายการ · ยังไม่ได้ฝึกน้ำหนัก');
 }catch(e){setNotice('อ่านความจำไม่สำเร็จ: '+e.message,true)}
 finally{busy=false}
}
function memoryPanel(){
 const content=el('div',{className:'teacher-content'},
  el('strong',{},'Training Feedback Memory'),
  el('p',{className:'teacher-muted'},'ตัวอย่างที่คุณอนุมัติหรือปฏิเสธจะเก็บบน AWS DynamoDB ไม่ใช่การเปลี่ยนน้ำหนักโมเดลทันที'),
  el('div',{className:'teacher-row'},
    button('โหลดประวัติการสอน',showHistory,'teacher-primary',busy||!statusData?.feedbackReady),
    button('ดู GitHub Training Lab',()=>root.open('https://github.com/tanawutmalirum29-ux/AI-ANIMATION/tree/main/training-lab','_blank','noopener'))),
  el('div',{className:'teacher-history'},el('p',{className:'teacher-muted'},'กดโหลดประวัติเพื่อดูตัวอย่างที่บันทึกอยู่ใน AWS')));
 if(!statusData?.feedbackReady)content.append(el('p',{className:'teacher-warning'},'ฐานข้อมูล Feedback ยังไม่ได้ติดตั้งบน AWS การกดเลือกจะไม่อ้างว่าบันทึกเป็นความจำ'));
 return content;
}
function render(reset=true){
 if(!container)return;
 const active=$doc.activeElement;
 if(!reset&&active&&container.contains(active))active.blur();
 container.replaceChildren(header(),
  el('nav',{className:'teacher-tabs','aria-label':'AI Teacher Studio'},
    ...[['chat','คุย / สั่งงาน'],['connect','เชื่อม API'],['memory','ความจำ AI ลูก']].map(([id,label])=>
     button(label,()=>{tab=id;render()},tab===id?'active':''))),
  el('p',{className:'teacher-notice',role:'status','aria-live':'polite','data-error':String(noticeError)},notice||'AI ครูต้องเชื่อมต่อ API ก่อนใช้งาน'),
  tab==='connect'?connectPanel():tab==='memory'?memoryPanel():chatPanel());
}
function mount(target,source){
 container=target;bridge=source;getWorkspace();
 const stored=getWorkspace().teacherConversation;
 if(Array.isArray(stored)&&!thread.length)thread=stored.filter(x=>['user','assistant'].includes(x.role)&&typeof x.content==='string').slice(-10);
 render();if(session()&&!statusData&&!busy)loadStatus();
}
root.StoryTeacherStudio=Object.freeze({mount,render});
})(window);
