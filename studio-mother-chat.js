/* AI Mother — dedicated grounded Q&A, separate from the editor/teaching commands.
 * Every message sends a bounded question; status inspection costs zero LLM tokens.
 * No API key, GitHub token, lesson body, full JSON, or secret is saved in chat.
 * Conversation lasts only while this browser page stays open.
 */
(function(root){
'use strict';
let host=null,bridge=null,provider='',snapshot=null,repoInfo=null,loading=false,busy=false;
let error='',draft='',attached=true,thread=[],lastLoaded=0,infoOpen=false;
const MAX_HISTORY=30;
function el(tag,cls,text){
 const node=root.document.createElement(tag);
 if(cls)node.className=cls;
 if(text!==undefined)node.textContent=String(text);
 return node;
}
function btn(label,act,cls,disabled=false){
 const b=el('button',cls,label);
 b.type='button';b.disabled=!!disabled;b.addEventListener('click',act);return b;
}
function api(payload){
 if(!root.StoryStudioAccess?.isReady?.())
  throw Error('กรุณาเข้าสู่ระบบ GitHub ก่อนคุยกับ AI แม่');
 return root.StoryStudioAccess.request(payload);
}
function projectOverview(){
 if(!attached||!bridge?.get)return null;
 try{
  const project=bridge.get()||{};
  const episodes=Array.isArray(project.episodes)?project.episodes:[];
  const selected=bridge.scene?.();
  const selectedEpisode=episodes.find(e=>Array.isArray(e?.scenes)&&e.scenes.some(s=>s?.id===selected?.id));
  return {projectId:String(project.project?.aiWorkspace?.projectId||'').slice(0,90),
   title:String(project.project?.title||'').slice(0,160),
   aspect:String(project.project?.aspect||'').slice(0,32),
   mode:String(project.project?.mode||'').slice(0,40),
   episodeCount:episodes.length,
   sceneCount:episodes.reduce((n,e)=>n+(Array.isArray(e?.scenes)?e.scenes.length:0),0),
   selectedScene:String(selected?.id||'').slice(0,100),
   selectedEpisode:String(selectedEpisode?.id||'').slice(0,100)};
 }catch(_){return null}
}
function readyProviders(){
 return (snapshot?.providers||[]).filter(p=>p?.ready===true);
}
function syncProvider(){
 const options=readyProviders();
 if(!options.some(p=>p.id===provider))provider=options[0]?.id||'';
}
function dateLabel(seconds){
 if(!Number.isFinite(Number(seconds)))return 'ไม่ทราบ';
 try{return new Date(Number(seconds)*1000).toLocaleString('th-TH')}
 catch(_){return 'ไม่ทราบ'}
}
function shortStatus(source){
 if(!source?.available)return 'ยังอ่านข้อมูล AWS ไม่สำเร็จ';
 return (source.savedLessons??'ไม่ทราบ')+' บทเรียน · '+
   (source.distinctProjects??'ไม่ทราบ')+' โปรเจกต์';
}
function openConfig(){
 const nodes=root.document.querySelectorAll('.ai-tabs button');
 for(const node of nodes){if(node.textContent.includes('AI ครู / API')){node.click();return}}
 error='เปิดแท็บ AI ครู / API เพื่อเชื่อมโมเดล';render();
}
async function refresh(){
 if(loading)return;
 loading=true;error='';render();
 try{
  const data=await api({action:'teacher.advisorStatus',project:projectOverview()});
  if(!data?.snapshot)throw Error('AWS ไม่ส่งข้อมูลภาพรวม AI แม่');
  snapshot=data.snapshot;lastLoaded=Date.now();syncProvider();
  // Repository check is read-only, no provider token spent and no secrets.
  try {
   const live=await api({action:'teacher.advisorRepoStatus'});
   repoInfo=live.repository||null;
  }catch(_){repoInfo={available:false}}
 }catch(e){error='ตรวจข้อมูล AWS ไม่สำเร็จ: '+String(e.message||e)}
 finally{loading=false;render()}
}
function featuresPanel(){
 const container=el('details','mother-knowledge');
 const heading=el('summary',null,'AI แม่รู้จักเว็บไซต์ส่วนไหนบ้าง');
 container.append(heading);
 const intro=el('p',null,'ฟีเจอร์ด้านล่างเป็นสรุปที่ดูแลในเซิร์ฟเวอร์ ส่วนคำถามที่ส่งจะดึงโค้ด GitHub main สาธารณะล่าสุดเฉพาะไฟล์ที่เกี่ยวข้อง (ถ้า GitHub พร้อมใช้งาน)');
 container.append(intro);
 for(const feature of (snapshot?.features||[])){
  const p=el('p');p.append(el('strong',null,feature.name+' — '),
    el('span',null,feature.detail));container.append(p);
 }
 if(snapshot?.boundaries?.length){
  container.append(el('strong',null,'สิ่งที่ AI แม่ยังไม่รู้หรือทำไม่ได้'));
  for(const x of snapshot.boundaries)container.append(el('p',null,x));
 }
 return container;
}
function evidence(){
 // Long AWS status belongs behind a disclosure, not above every reply.
 const box=el('details','mother-evidence');
 box.open=infoOpen;
 box.addEventListener('toggle',()=>{if(box.isConnected)infoOpen=box.open});
 const n=snapshot?.narrativeChild;
 const summary=el('summary','mother-section-title',
  'ศูนย์ข้อมูล AI · 6 ผู้ช่วยรุ่น 1 + AI แม่ + 2 โมดูล AI ลูก · '+(n?.available?(n.savedLessons??'?')+' บทเรียน':'AWS ยังตรวจไม่ได้'));
 box.append(summary);
 const info=el('div','mother-stats');
 const rep=snapshot?.repetitionChild;
 const a=el('div','mother-fact');
 a.append(el('small',null,'AI ลูก — การตรวจบท'),
  el('strong',null,n?.available?shortStatus(n):'ยังไม่ได้ตรวจสอบ'),
  el('small',null,n?.available?
   'โมเดล CPU ที่ใช้งาน: '+(n.activeVersion||'ยังไม่มีโมเดลที่เปิดใช้'):
   'ไม่มีตัวเลขที่ยืนยันได้จาก AWS'));
 const b=el('div','mother-fact');
 b.append(el('small',null,'AI ลูก — ตรวจคำซ้ำ'),
  el('strong',null,rep?.available?(rep.activeVersion||'ยังไม่มีโมเดลที่เปิดใช้'):'ยังไม่ได้ตรวจสอบ'),
  el('small',null,'โมเดลจำแนกประเภท ไม่ใช่ AI เขียนบทอิสระ'));
 info.append(a,b);box.append(info);
 const catalog=snapshot?.aiCatalog;
 if(catalog){
  box.append(el('strong',null,'แผนผัง AI ที่ใช้งานในระบบ'));
  box.append(el('p','mother-fine','6 ผู้ช่วยสมาชิก: รุ่น 1 · เป็นบทบาทเฉพาะทางจาก API ภายนอก ไม่ใช่ 6 โมเดลฝึกน้ำหนัก'));
  for(const item of catalog.memberRoles||[]){
   box.append(el('p','mother-fine',String(item.role||item.id)+
    ' · '+String(item.capability||'')));
  }
  box.append(el('p','mother-fine','AI แม่: ให้คำปรึกษาและเรียกสอนผ่าน API ที่แอดมินเชื่อมไว้; AI ลูก: จำแนกคำซ้ำและตรวจบทด้วยโมเดล CPU ที่ต้องดูสถานะเวอร์ชัน AWS'));
  box.append(el('p','mother-fine','API แม่ที่เชื่อม '+(catalog.ownerConnections?.length??0)+
   ' รายการ · ใช้จัดคิวสอน JSON ได้ผ่านแท็บสอนหลาย JSON'));
 }
 const foot=el('p','mother-fine',
   'ตรวจสถานะ AWS: '+dateLabel(snapshot?.measuredAt)+
   ' · ความรู้ฟีเจอร์อัปเดต '+(snapshot?.knowledgeVersion||'ไม่ทราบ')+
   ' · ค่าที่ไม่ทราบจะไม่ถูกเดา');
 box.append(foot);
 const repoLabel=repoInfo?.available
  ? 'GitHub main อ่านได้ · Tree '+String(repoInfo.treeSha||'').slice(0,12)+
    ' · เลือกไฟล์ตามคำถาม'
  : 'GitHub main: '+(repoInfo?'ตรวจสดไม่ได้':'ยังไม่ตรวจ');
 box.append(el('p','mother-fine',repoLabel));
 const currentJob=snapshot?.projectJob;
 if(currentJob?.available){
  const j=currentJob.job;
  box.append(el('p','mother-fine',j?
   'AWS Job: '+j.state+' · '+j.completed+'/'+j.total+' ฉาก · รหัสงาน '+j.jobId:
   'AWS Job: ไม่พบงานในโปรเจกต์ที่เปิด'));
 }else if(currentJob){
  box.append(el('p','mother-fine','AWS Job: '+currentJob.reason));
 }
 box.append(btn(loading?'กำลังตรวจ…':'อัปเดต GitHub / AWS',()=>refresh().catch(()=>{}),
  'mother-refresh',loading));
 box.append(btn('เปิดหน้าสอนหลาย JSON',()=>{
  for(const node of root.document.querySelectorAll('.ai-tabs button')){
   if(node.textContent.includes('สอนหลาย JSON')){node.click();break}
  }
 },'mother-config'));
 box.append(featuresPanel(),el('p','mother-fine',
  'การถาม AI แม่ใช้โควตา API ที่เลือก · การดูสถานะไม่เรียก LLM · ประวัติแชทเก็บเฉพาะแท็บนี้'));
 return box;
}
function quickPrompts(){
 const choices=['AI ทั้งระบบมีกี่ตัว รุ่น 1 ทำอะไรได้บ้าง และใครฝึกน้ำหนักแล้ว?',
  'AI แม่ช่วยสอนและแบ่งงานให้ AI ลูกกับผู้ช่วยทั้ง 6 อย่างไร?',
  'ตอนนี้ AI ลูกเรียนรู้อะไรแล้ว และยังขาดอะไร?',
  'โมเดล API ที่เชื่อมอยู่รู้จักเว็บเราจริงแค่ไหน?',
  'การบันทึกบทเรียนกับฝึกน้ำหนักต่างกันอย่างไร?',
  'ควรสอน AI ลูกเรื่องไหนต่อจากข้อมูล AWS ที่มี?'];
 const box=el('div','mother-prompts');
 for(const choice of choices)box.append(btn(choice,()=>{
  draft=choice;render();host?.querySelector('#motherInput')?.focus();
 },'mother-suggest',busy));
 return box;
}
function render(){
 if(!host)return;
 // Preserve manual position when reading old replies; follow the latest only
 // when the user was already at the bottom of the conversation.
 const oldLog=host.querySelector('.mother-chat-log');
 const oldTop=oldLog?.scrollTop||0;
 const atBottom=!oldLog||oldLog.scrollHeight-oldLog.clientHeight-oldTop<65;
 host.replaceChildren();
 const wrap=el('section','mother-chat');
 const title=el('div','mother-chat-heading');
 title.append(el('h3',null,'คุยกับ AI แม่'));
 const preview=btn(root.document.body.classList.contains('mother-preview')?
  'ซ่อนพรีวิว':'ดูพรีวิว',()=>{
   const showing=root.document.body.classList.toggle('mother-preview');
   preview.textContent=showing?'ซ่อนพรีวิว':'ดูพรีวิว';
   preview.setAttribute('aria-pressed',String(showing));
   root.requestAnimationFrame?.(()=>root.fit?.());
  },'mother-preview-toggle');
 preview.setAttribute('aria-pressed',String(root.document.body.classList.contains('mother-preview')));
 title.append(preview);
 wrap.append(title,
  el('p','mother-subtitle','ถามเรื่อง AI ลูกและความรู้ของเว็บ · ไม่แก้โปรเจกต์อัตโนมัติ'));
 if(error)wrap.append(el('p','mother-error',error));
 if(snapshot)wrap.append(evidence());
 else wrap.append(el('p','mother-fine',loading?'กำลังอ่านความสามารถและสถานะ AI ลูกจาก AWS…':
  'ยังไม่มีข้อมูลยืนยันจาก AWS · กดตรวจสถานะก่อนถาม'));
 const providerLabel=el('label','mother-provider','โมเดล AI แม่ที่ใช้ตอบ');
 const select=el('select');
 for(const item of snapshot?.providers||[]){
  const option=el('option',null,item.id+' · '+(item.model||'ไม่ทราบรุ่น')+
   (item.ready?'':' (ยังไม่เชื่อม)'));
  option.value=item.id;option.disabled=!item.ready;option.selected=provider===item.id;
  select.append(option);
 }
 select.disabled=loading||!readyProviders().length||busy;
 select.addEventListener('change',e=>{provider=e.target.value});
 providerLabel.append(select);wrap.append(providerLabel);
 if(!readyProviders().length)wrap.append(
  btn('ไปเชื่อม API ของ AI แม่',openConfig,'mother-config',busy));
 const log=el('div','mother-chat-log');
 log.setAttribute('role','log');log.setAttribute('aria-live','polite');
 if(!thread.length){
  log.append(el('p','mother-empty',
   'เริ่มถามได้เลย เช่น “AI ลูกตอนนี้เก่งอะไรแล้ว?” หรือ “ทำไมบทเรียนเยอะแต่ยังไม่มีโมเดลใหม่?”'));
  log.append(quickPrompts());
 }
 for(const msg of thread){
  const bubble=el('article','mother-bubble '+msg.role);
  bubble.append(el('strong',null,msg.role==='user'?'คุณ':'AI แม่'),
    el('p',null,msg.text));
  if(msg.evidence){
   const ev=msg.evidence;
   bubble.append(el('small',null,'แหล่งข้อมูล: '+(ev.githubLive?
    'GitHub main '+String(ev.githubTreeSha||'').slice(0,12)+
    ' ('+(ev.githubFiles||[]).join(', ')+')':'GitHub สดยังตรวจไม่ได้')+
    ' · สรุปฟีเจอร์ '+ev.manifestVersion+
    ' · AWS ลูกตรวจบท '+(ev.narrativeAWS?'ตรวจแล้ว':'ตรวจไม่ได้')+
    ' · AWS ลูกคำซ้ำ '+(ev.repetitionAWS?'ตรวจแล้ว':'ตรวจไม่ได้')+
    (ev.projectJobAvailable?' · AWS Job':'')+
    (ev.projectContext?' · ภาพรวม JSON ปัจจุบัน':'') ));
  }
  log.append(bubble);
 }
 if(busy)log.append(el('p','mother-fine','กำลังขอคำตอบจากผู้ให้บริการ AI…'));
 wrap.append(log);
 const composer=el('div','mother-composer');
 const input=el('textarea');
 input.id='motherInput';input.rows=2;input.maxLength=2500;
 input.placeholder='พิมพ์คำถามถึง AI แม่… (Ctrl/⌘ + Enter เพื่อส่ง)';
 input.value=draft;input.disabled=busy;
 input.addEventListener('input',e=>{draft=e.target.value});
 input.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();send().catch(()=>{})}});
 const toggle=el('label','mother-context');
 const checkbox=el('input');checkbox.type='checkbox';checkbox.checked=attached;
 checkbox.disabled=busy;checkbox.addEventListener('change',e=>{attached=e.target.checked});
 toggle.append(checkbox,el('span',null,'แนบข้อมูลย่อ JSON'));
 toggle.title='ส่งเพียงชื่อโปรเจกต์และจำนวนฉาก ไม่ส่งบททั้งหมด';
 const actions=el('div','mother-actions');
 actions.append(btn(busy?'กำลังตอบ…':'ส่งข้อความ',()=>send().catch(()=>{}),'mother-primary',
  busy||!provider||!root.StoryStudioAccess?.isReady?.()));
 actions.append(btn('ล้างบทสนทนา',()=>{
  if(busy)return;thread=[];draft='';render();
 },'mother-secondary',busy||!thread.length));
 const footer=el('div','mother-compose-footer');
 footer.append(toggle,actions);
 composer.append(input,footer);wrap.append(composer);
 host.append(wrap);
 if(atBottom)log.scrollTop=log.scrollHeight;
 else log.scrollTop=oldTop;
}
async function send(){
 const message=draft.trim();
 if(busy||!message)return;
 if(!provider){error='กรุณาเชื่อม AI แม่ก่อน';render();return}
 const history=thread.filter(m=>!m.error).slice(-8).map(m=>({
  role:m.role==='mother'?'assistant':'user',content:m.text.slice(0,900)}));
 busy=true;error='';thread.push({role:'user',text:message});
 thread=thread.slice(-MAX_HISTORY);
 render();
 try{
  const out=await api({action:'teacher.advisorChat',provider,message,
   history,project:projectOverview()});
  if(typeof out?.reply!=='string'||!out.reply.trim())
   throw Error('AI แม่ไม่ส่งข้อความที่อ่านได้');
  thread.push({role:'mother',text:out.reply.trim(),evidence:out.evidence||null});
  thread=thread.slice(-MAX_HISTORY);
  draft='';
 }catch(e){
  // Keep the question in the composer for retry, without pretending it was answered.
  const idx=thread.findLastIndex(m=>m.role==='user'&&m.text===message);
  if(idx>=0)thread.splice(idx,1);
  error='AI แม่ตอบไม่สำเร็จ: '+String(e.message||e);
 }finally{busy=false;render()}
}
function mount(target,source){
 host=target;bridge=source;render();
 if(root.StoryStudioAccess?.isReady?.()&&(!snapshot||Date.now()-lastLoaded>60000))
  refresh().catch(()=>{});
}
root.StoryMotherChat=Object.freeze({mount});
})(window);
