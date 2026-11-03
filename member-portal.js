/* Member release v1.0: six WEBSITE-hosted specialists, no BYOK controls.
 * Signed GitHub members and temporary guests are isolated from admin studio.
 * The browser NEVER receives a model/API credential.
 */
(function(root){
'use strict';
const roles=[
 ['composition','AI-1 จัดองค์ประกอบ','จัดภาพ/ตำแหน่งตัวละคร'],
 ['assets','AI-2 สร้าง SVG','เวกเตอร์และสิ่งของประกอบ'],
 ['motion','AI-3 กำกับโมชั่น','คีย์เฟรมและการเคลื่อนไหว'],
 ['voice','AI-4 พากย์เสียง','วรรคตอนและน้ำเสียง'],
 ['structure','AI-5 จัดเวลา','ฉากและความยาวตอน'],
 ['qa','AI-6 ตรวจคุณภาพ','ตรวจความต่อเนื่องและข้อผิดพลาด']
];
let host=null,account=null,access=null,role='composition',prompt='',
 source='',sourceName='',busy=false,error='',jobs={},release=null;
function node(tag,cls,text){
 const x=root.document.createElement(tag);
 if(cls)x.className=cls;
 if(text!==undefined)x.textContent=String(text);
 return x;
}
function button(text,fn,cls){
 const e=node('button',cls,text);e.type='button';e.onclick=fn;return e;
}
function field(title,control){
 const e=node('label',null,title);e.append(control);return e;
}
const isGuest=()=>account?.role==='guest';
const storeKey=()=>account?'storyMember.tasks.'+account.id:'';
function restore(){
 if(isGuest()){jobs={};return}
 try{
  const v=JSON.parse(root.localStorage.getItem(storeKey())||'{}');
  jobs=v&&typeof v==='object'&&!Array.isArray(v)?v:{};
 }catch(_){jobs={}}
}
function persist(){
 if(isGuest())return;
 try{root.localStorage.setItem(storeKey(),JSON.stringify(jobs))}
 catch(_){error='ไม่สามารถบันทึกประวัติลงอุปกรณ์นี้ได้'}
}
async function loadCatalog(){
 const id=account?.id;
 try{
  const info=await access.request({action:'member.ai.catalog'});
  if(account?.id===id){release=info;render()}
 }catch(e){if(account?.id===id){error=String(e.message||e);render()}}
}
function mount({profile,request,logout}){
 if(!profile||!['member','guest'].includes(profile.role))return;
 const changed=!account||account.id!==profile.id;
 account=profile;access={request,logout};
 if(changed){role='composition';prompt='';source='';sourceName='';
  release=null;restore()}
 if(!host){host=node('div');host.id='storyMemberPortal';root.document.body.append(host)}
 host.hidden=false;render();
 if(changed)loadCatalog().catch(()=>{});
}
function hide(){
 if(host)host.hidden=true;
 account=null;access=null;source='';sourceName='';prompt='';release=null;jobs={};
}
function render(){
 if(!host||!account||!access)return;
 host.replaceChildren();
 const guest=isGuest();
 const head=node('header');
 head.append(node('div',null,'AI-ANIMATION · ผู้ช่วย 6 บทบาท รุ่น 1 · '+
  (guest?'ผู้เยี่ยมชมชั่วคราว':'GitHub: '+account.login)),
  button('ออกจากระบบ',access.logout));
 host.append(head);
 const main=node('main','member-content');
 main.append(node('h1',null,'ผู้ช่วย AI ของเว็บไซต์ · รุ่น 1.0'),
  node('p','subtle',
   'AI 6 ตำแหน่งใช้โมเดลที่เว็บไซต์เชื่อมไว้ · ไม่ต้องกรอก API Key · ไม่ใช่โมเดลที่ฝึกน้ำหนักแยกกัน 6 ตัว · ไม่เข้าถึง AWS หรือ GitHub แอดมิน'));
 if(guest)main.append(node('p','subtle',
  'บัญชีชั่วคราวใช้ได้ 2 ชั่วโมง จำกัด 4 คำขอต่อวันและการออกเซสชันตามเครือข่าย · ไม่มีการบันทึกประวัติข้ามเครื่อง'));
 else main.append(node('p','subtle',
  'สมาชิก GitHub จำกัด 20 คำขอต่อวัน · ประวัติคำตอบบันทึกเฉพาะในอุปกรณ์นี้'));
 const nav=node('nav','member-roles');
 for(const [id,name,description] of roles){
  const btn=button(name,()=>{role=id;error='';render()},
   'member-role'+(role===id?' active':''));
  btn.append(node('small',null,description));nav.append(btn);
 }
 main.append(nav);
 const section=node('section','member-card'),chosen=roles.find(x=>x[0]===role);
 section.append(node('h2',null,'รุ่น 1 · '+chosen[1]+' · '+chosen[2]),
  node('p','subtle','AI เว็บทำงานเป็นผู้ช่วยแนะนำจากข้อความ/JSON ที่คุณส่ง · ไม่แก้ไฟล์หรือผลิตวิดีโอเอง'));
 const file=node('input');file.type='file';file.accept='.json,application/json';
 file.onchange=async()=>{
  const item=file.files?.[0];if(!item)return;
  if(item.size>1000000){error='ไฟล์ต้องไม่เกิน 1 MB';render();return}
  try{
   const raw=await item.text();JSON.parse(raw);
   source=raw.slice(0,4000);sourceName=item.name;error='';render();
  }catch(_){error='JSON ไม่ถูกต้อง';render()}
 };
 section.append(field('นำเข้า JSON เรื่อง/งาน (ไม่บังคับ)',file));
 if(sourceName)section.append(node('p','subtle','ไฟล์: '+sourceName+
  ' · ส่งเฉพาะ 4,000 ตัวอักษรแรกเพื่อจำกัดโควตา'));
 const textarea=node('textarea');textarea.rows=4;textarea.maxLength=1500;
 textarea.value=prompt;textarea.placeholder='ระบุงานที่ต้องการให้ AI ตัวนี้ทำ';
 textarea.oninput=e=>prompt=e.target.value;
 section.append(field('คำสั่งงาน',textarea));
 if(error)section.append(node('p','member-error',error));
 const submit=button(busy?'กำลังเรียก AI ของเว็บไซต์…':
  'สั่ง '+chosen[1]+' ทำงาน',run,'member-primary');
 submit.disabled=busy;section.append(submit);main.append(section);
 const history=node('section','member-card');
 history.append(node('h2',null,'ประวัติงาน '+chosen[1]));
 const rows=Array.isArray(jobs[role])?jobs[role]:[];
 if(!rows.length)history.append(node('p','subtle','ยังไม่มีประวัติ'));
 for(const item of rows.slice(-30).reverse()){
  const details=node('details'),sum=node('summary',null,item.date+' · '+item.question.slice(0,90));
  if(item===rows[rows.length-1])details.open=true;
  details.append(sum,node('p','subtle',item.question),
   node('pre','member-result',item.reply),
   button('คัดลอกคำตอบ',()=>root.navigator.clipboard?.writeText(item.reply).catch(()=>{})));
  history.append(details);
 }
 history.append(button('ลบประวัติ AI ตัวนี้',()=>{
  if(root.confirm('ลบประวัติที่เก็บในอุปกรณ์นี้?')){
   jobs[role]=[];persist();render()
  }
 }));
 main.append(history);host.append(main);
}
async function run(){
 if(busy||!access)return;
 if(!prompt.trim()){error='โปรดใส่คำสั่งงาน';render();return}
 const id=role,question=prompt.trim();busy=true;error='';render();
 try{
  const result=await access.request({
   action:'member.ai.run',release:'member-six-v1',
   role:id,message:question,context:source.slice(0,4000)});
  if(!Array.isArray(jobs[id]))jobs[id]=[];
  jobs[id].push({
   date:new Date().toLocaleString('th-TH'),question,
   reply:String(result.reply||''),provider:result.provider,
   sourceFile:sourceName});
  jobs[id]=jobs[id].slice(-40);persist();prompt='';
 }catch(e){error=String(e.message||e)}
 finally{busy=false;render()}
}
root.StoryMemberPortal=Object.freeze({mount,hide});
})(window);
