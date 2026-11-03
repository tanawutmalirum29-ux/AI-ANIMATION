/* Six fixed member v1 positions with ONLY real AWS/CPU child models.
 * Non-admins never enter API keys, call external AI, train or mutate source.
 * Dynamic catalog marks unsupported roles as requiring training.
 */
(function(root){
'use strict';
const roles=[
 ['composition','AI-1 จัดองค์ประกอบ','รอโมเดลจัดองค์ประกอบภาพ'],
 ['assets','AI-2 SVG','รอโมเดล SVG ที่ฝึกจริง'],
 ['motion','AI-3 โมชั่น','รอโมเดลท่าทางและการเคลื่อนไหว'],
 ['voice','AI-4 ภาษาในบทพากย์','ตรวจบทด้วย AI ลูกภาษาไทย'],
 ['structure','AI-5 โครงเรื่อง','ใช้ AI ลูกตรวจโครงเรื่องเมื่อผ่าน QA'],
 ['qa','AI-6 ตรวจบทและ QA','ใช้ AI ลูกภาษาไทยและโมเดลตรวจเรื่องที่เปิดใช้']
];
let host=null,account=null,access=null,role='qa',prompt='',context='',
 contextName='',busy=false,error='',catalog=null,history={};
const node=(tag,cls,txt)=>{
 const el=root.document.createElement(tag);
 if(cls)el.className=cls;
 if(txt!==undefined)el.textContent=String(txt);
 return el;
};
const button=(txt,fn,cls)=>{
 const el=node('button',cls,txt);el.type='button';el.onclick=fn;return el;
};
const field=(txt,el)=>{const label=node('label',null,txt);label.append(el);return label};
const guest=()=>account?.role==='guest';
const storageKey=()=>account?'storyMember.cpu.v1.'+account.id:'';
function restore(){
 history={};
 if(guest())return;
 try{
  const raw=JSON.parse(root.localStorage.getItem(storageKey())||'{}');
  if(raw&&typeof raw==='object'&&!Array.isArray(raw))history=raw;
 }catch(_){}
}
function persist(){
 if(guest())return;
 try{root.localStorage.setItem(storageKey(),JSON.stringify(history))}
 catch(_){error='บันทึกประวัติลงอุปกรณ์ไม่ได้'}
}
async function loadCatalog(){
 const id=account?.id;
 try{
  const result=await access.request({action:'member.ai.catalog'});
  if(account?.id===id){catalog=result;render()}
 }catch(e){if(account?.id===id){error=String(e.message||e);render()}}
}
function mount({profile,request,logout}){
 if(!profile||!['member','guest'].includes(profile.role))return;
 const changed=!account||account.id!==profile.id;
 account=profile;access={request,logout};
 if(changed){prompt='';context='';contextName='';error='';catalog=null;role='qa';restore()}
 if(!host){host=node('div');host.id='storyMemberPortal';root.document.body.append(host)}
 host.hidden=false;render();
 if(changed)loadCatalog().catch(()=>{});
}
function hide(){
 if(host)host.hidden=true;
 account=null;access=null;prompt='';context='';contextName='';
 error='';catalog=null;history={};
}
function readiness(id){
 return catalog?.modules?.find(m=>m.id===id)||null;
}
function extractNarrations(raw){
 const scenes=[];
 function walk(value){
  if(scenes.length>=6)return;
  if(Array.isArray(value)){
   for(const x of value.slice(0,30)){walk(x);if(scenes.length>=6)break}
  }else if(value&&typeof value==='object'){
   const v=value.voiceover||value.narration||value.text;
   if(typeof v==='string'&&v.trim().length>=4)scenes.push(v.trim().slice(0,1200));
   else for(const key of ['episodes','scenes','story','content'])if(key in value)walk(value[key]);
  }
 }
 walk(raw);return scenes;
}
function render(){
 if(!host||!account||!access)return;
 host.replaceChildren();
 const header=node('header');
 header.append(node('div',null,'AI-ANIMATION · AI ลูก รุ่น 1 · '+
  (guest()?'ผู้เยี่ยมชมชั่วคราว':'GitHub: '+account.login)),
  button('ออกจากระบบ',access.logout));
 host.append(header);
 const main=node('main','member-content');
 main.append(node('h1',null,'AI ลูกที่กำลังฝึก · 6 ตำแหน่ง'),
  node('p','subtle',
   'ไม่มีการเชื่อม Gemini / OpenAI / OpenRouter และไม่มี API Key ของสมาชิก · ยังไม่จำกัดโควตาทดลอง · ไม่ใช่โมเดลเขียนบทแบบ LLM'),
  node('p','subtle',guest()?'บัญชีทดลองอายุ 2 ชั่วโมง ประวัติไม่เก็บข้ามเซสชัน':
   'ประวัติผลวิเคราะห์บันทึกเฉพาะในอุปกรณ์นี้'));
 if(catalog){
  const models=(catalog.trainedModels||[]).map(m=>m.id+' '+m.status).join(' · ');
  main.append(node('p','subtle','โมเดล CPU ที่ตรวจพบ: '+(models||'ยังไม่มี')+
   ' · มีตำแหน่งทั้งหมด '+catalog.moduleCount));
 }
 const nav=node('nav','member-roles');
 for(const [id,title,desc] of roles){
  const info=readiness(id),ready=info?.ready===true;
  const b=button(title,()=>{role=id;error='';render()},
   'member-role'+(role===id?' active':''));
  b.append(node('small',null,(catalog?(ready?'พร้อมทดลอง · ':'รอฝึก · '):'กำลังตรวจ… · ')+desc));
  nav.append(b);
 }
 main.append(nav);
 const chosen=roles.find(r=>r[0]===role)||roles[0];
 const info=readiness(role),ready=info?.ready===true;
 const section=node('section','member-card');
 section.append(node('h2',null,chosen[1]),
  node('p','subtle',info?.capability||chosen[2]),
  node('p','subtle',ready?
   'ผลเป็นข้อเสนอจากโมเดล CPU ที่ฝึกไว้ ไม่แก้ JSON ต้นฉบับ':
   'ยังไม่มีโมเดลฝึกเฉพาะงานที่พร้อมใช้งาน จะไม่เรียก API ภายนอกมาทดแทน'));
 const file=node('input');file.type='file';file.accept='.json,application/json';
 file.onchange=async()=>{
  const uploaded=file.files?.[0];
  if(!uploaded)return;
  if(uploaded.size>1000000){error='JSON ต้องมีขนาดไม่เกิน 1 MB';render();return}
  try{
   const parsed=JSON.parse(await uploaded.text());
   const scenes=extractNarrations(parsed);
   if(!scenes.length)throw Error('ไม่พบข้อความบทพากย์');
   context=JSON.stringify({scenes:scenes.map(text=>({text}))});
   contextName=uploaded.name;error='';render();
  }catch(e){error='นำเข้า JSON ไม่สำเร็จ: '+String(e.message||e);render()}
 };
 section.append(field('JSON เนื้อเรื่องสำหรับตรวจ (ไม่บังคับ)',file));
 if(contextName)section.append(node('p','subtle',
  'ไฟล์ '+contextName+' · ตรวจข้อความได้สูงสุด 6 ฉากต่อครั้งในรุ่นทดลอง'));
 const textarea=node('textarea');textarea.rows=4;textarea.maxLength=2000;
 textarea.value=prompt;textarea.placeholder='ใส่ข้อความบทหรือคำขอให้โมเดลตรวจ';
 textarea.oninput=e=>prompt=e.target.value;
 section.append(field('บทหรือคำขอตรวจ',textarea));
 if(error)section.append(node('p','member-error',error));
 const go=button(busy?'กำลังตรวจด้วยโมเดล CPU…':'ตรวจด้วย AI ลูก รุ่น 1',run,'member-primary');
 go.disabled=busy||!ready;
 section.append(go);main.append(section);
 const sectionHistory=node('section','member-card');
 sectionHistory.append(node('h2',null,'ประวัติผล '+chosen[1]));
 const logs=Array.isArray(history[role])?history[role]:[];
 if(!logs.length)sectionHistory.append(node('p','subtle','ยังไม่มีผลวิเคราะห์'));
 for(const entry of logs.slice(-20).reverse()){
  const details=node('details');
  if(entry===logs[logs.length-1])details.open=true;
  details.append(node('summary',null,entry.date+' · '+entry.question.slice(0,90)),
   node('pre','member-result',entry.reply),
   button('คัดลอก',()=>root.navigator.clipboard?.writeText(entry.reply).catch(()=>{})));
  sectionHistory.append(details);
 }
 sectionHistory.append(button('ลบประวัติในเครื่อง',()=>{
  if(root.confirm('ลบประวัติของตำแหน่งนี้?')){
   history[role]=[];persist();render()
  }
 }));
 main.append(sectionHistory);host.append(main);
}
async function run(){
 if(busy||!access)return;
 if(!prompt.trim()&&!context.trim()){error='กรุณาใส่บทหรือเปิด JSON ก่อน';render();return}
 busy=true;error='';render();
 const selected=role,question=prompt.trim()||'ตรวจบทพากย์ที่แนบตามหน้าที่ของโมดูล';
 try{
  const data=await access.request({action:'member.ai.run',release:'member-six-v1',
    role:selected,message:question,context});
  if(!Array.isArray(history[selected]))history[selected]=[];
  history[selected].push({
   date:new Date().toLocaleString('th-TH'),question,
   reply:String(data.reply||''),modelVersions:data.modelVersions||{},
   externalAPIUsed:false});
  history[selected]=history[selected].slice(-20);
  persist();prompt='';
 }catch(e){error=String(e.message||e)}
 finally{busy=false;render()}
}
root.StoryMemberPortal=Object.freeze({mount,hide});
})(window);
