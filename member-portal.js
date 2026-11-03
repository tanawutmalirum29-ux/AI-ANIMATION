/* Six role-based members. No admin tools exposed. Provider keys in RAM only. */
(function(root){
 'use strict';
 const roles=[
 ['composition','AI-1 จัดองค์ประกอบ','จัดภาพ/ตำแหน่งตัวละคร'],
 ['assets','AI-2 สร้าง SVG','เวกเตอร์และสิ่งของประกอบ'],
 ['motion','AI-3 กำกับโมชั่น','คีย์เฟรมและการเคลื่อนไหว'],
 ['voice','AI-4 พากย์เสียง','วรรคตอนและน้ำเสียง'],
 ['structure','AI-5 จัดเวลา','ฉากและความยาวตอน'],
 ['qa','AI-6 ตรวจคุณภาพ','ตรวจความต่อเนื่องและข้อผิดพลาด']];
 let host=null,account=null,access=null,role='composition',provider='gemini',
  model='',apiKey='',prompt='',source='',sourceName='',busy=false,error='',jobs={};
 function node(tag,cls,text){const el=document.createElement(tag);
  if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el}
 function button(text,fn,cls){const el=node('button',cls,text);el.type='button';el.onclick=fn;return el}
 const storeKey=()=>account?'storyMember.tasks.'+account.id:'';
 function restore(){try{const v=JSON.parse(localStorage.getItem(storeKey())||'{}');
   jobs=v&&typeof v==='object'&&!Array.isArray(v)?v:{};}catch(_){jobs={}}}
 function persist(){try{localStorage.setItem(storeKey(),JSON.stringify(jobs))}catch(_){
   error='ไม่สามารถบันทึกประวัติงานบนเบราว์เซอร์นี้ได้'}}
 function mount({profile,request,logout}){
  if(!profile||profile.role!=='member')return;
  if(!account||account.id!==profile.id){account=profile;restore();apiKey='';source='';sourceName=''}
  access={request,logout};
  if(!host){host=node('div');host.id='storyMemberPortal';document.body.append(host)}
  host.hidden=false;render();
 }
 function hide(){if(host)host.hidden=true;account=null;access=null;apiKey='';source=''}
 function field(title,control){const el=node('label',null,title);el.append(control);return el}
 function render(){
  if(!host||!account||!access)return;host.replaceChildren();
  const head=node('header');head.append(node('div',null,'AI-ANIMATION · ผู้ช่วย 6 ตัว | GitHub: '+account.login),
    button('ออกจากระบบ',access.logout));
  host.append(head);
  const main=node('main','member-content');
  main.append(node('h1',null,'พื้นที่ทำงาน AI ของสมาชิก'),
   node('p','subtle','เลือกงาน AI แยกตามตัว พร้อมเชื่อม API ส่วนตัว · ไม่มีสิทธิ์เข้าหน้าฝึก AI แม่ สตูดิโอแอดมิน หรือข้อมูลส่วนตัวของผู้อื่น'));
  const nav=node('nav','member-roles');
  for(const [id,name,description] of roles){const btn=button(name,()=>{role=id;error='';render()},
   'member-role'+(role===id?' active':''));btn.append(node('small',null,description));nav.append(btn)}
  main.append(nav);
  const box=node('section','member-card');
  box.append(node('h2',null,'API ส่วนตัวของคุณ'));
  const columns=node('div','member-columns'),sel=node('select');
  for(const [id,label] of [['gemini','Google Gemini'],['openrouter','OpenRouter ฟรี']]){
   const opt=node('option',null,label);opt.value=id;opt.selected=id===provider;sel.append(opt)}
  sel.onchange=ev=>{provider=ev.target.value;model='';render()};
  const md=node('input');md.value=model;md.placeholder=provider==='gemini'?
   'gemini-3.5-flash-lite':'openrouter/free';md.oninput=ev=>model=ev.target.value;
  columns.append(field('ผู้ให้บริการ',sel),field('Model ID',md));box.append(columns);
  const key=node('input');key.type='password';key.autocomplete='off';key.value=apiKey;
  key.placeholder='ใส่ API Key ของบัญชีคุณ';key.oninput=ev=>apiKey=ev.target.value;
  box.append(field('API Key',key),node('p','subtle',
   'คีย์อยู่เฉพาะหน่วยความจำในแท็บ ไม่บันทึก AWS หรือประวัติงาน · หลังรีเฟรชต้องใส่ใหม่ · ตรวจโควตา/ค่าบริการกับผู้ให้บริการเอง'),
   button('ล้างคีย์',()=>{apiKey='';render()}));
  main.append(box);
  const section=node('section','member-card'),chosen=roles.find(x=>x[0]===role);
  section.append(node('h2',null,'งาน '+chosen[1]+' · '+chosen[2]));
  const file=node('input');file.type='file';file.accept='.json,application/json';
  file.onchange=async()=>{
   const item=file.files?.[0];if(!item)return;
   if(item.size>1000000){error='ไฟล์ต้องไม่เกิน 1 MB';render();return}
   try{const raw=await item.text();JSON.parse(raw);
    source=raw;sourceName=item.name;error='';render()}
   catch(_){error='JSON ไม่ถูกต้อง';render()}
  };
  section.append(field('นำเข้า JSON เรื่อง/งานของคุณ',file));
  if(sourceName)section.append(node('p','subtle','เลือกไฟล์: '+sourceName+
   ' · ส่งเนื้อหาไม่เกิน 9,000 ตัวอักษรต่อคำขอ'));
  const text=node('textarea');text.rows=4;text.maxLength=2500;text.value=prompt;
  text.placeholder='ระบุงานที่ต้องการให้ AI ตัวนี้ทำ';
  text.oninput=e=>prompt=e.target.value;
  section.append(field('คำสั่งงาน',text));
  if(error)section.append(node('p','member-error',error));
  const submit=button(busy?'กำลังเรียก AI…':'สั่ง '+chosen[1]+' ทำงาน',run,'member-primary');
  submit.disabled=busy;section.append(submit);main.append(section);
  const history=node('section','member-card');
  history.append(node('h2',null,'ประวัติงาน '+chosen[1]+' · แยกแต่ละ AI'));
  const rows=Array.isArray(jobs[role])?jobs[role]:[];
  if(!rows.length)history.append(node('p','subtle','ยังไม่มีประวัติ'));
  for(const item of rows.slice(-30).reverse()){
   const details=node('details'),sum=node('summary',null,item.date+' · '+item.question.slice(0,90));
   // Newly completed work must be visible immediately rather than buried
   // inside a collapsed history accordion.
   if(item===rows[rows.length-1])details.open=true;
   details.append(sum,node('p','subtle',item.question),node('pre','member-result',item.reply),
    button('คัดลอกคำตอบ',()=>navigator.clipboard?.writeText(item.reply).catch(()=>{})));
   history.append(details)}
  history.append(button('ลบประวัติ AI ตัวนี้',()=>{
   if(root.confirm('ลบประวัติงานที่เก็บในอุปกรณ์นี้?')){jobs[role]=[];persist();render()}
  }));
  main.append(history);host.append(main);
 }
 async function run(){
  if(busy||!access)return;
  if(!apiKey.trim()){error='โปรดใส่ API Key ของคุณ';render();return}
  if(!prompt.trim()){error='โปรดใส่คำสั่งงาน';render();return}
  const id=role,question=prompt.trim();busy=true;error='';render();
  try{
   const res=await access.request({action:'member.ai.run',role:id,provider,
    model:model.trim(),apiKey,message:question,context:source.slice(0,9000)});
   if(!Array.isArray(jobs[id]))jobs[id]=[];
   jobs[id].push({date:new Date().toLocaleString('th-TH'),question,
     reply:String(res.reply||''),provider,sourceFile:sourceName});
   jobs[id]=jobs[id].slice(-40);persist();prompt='';
  }catch(e){error=String(e.message||e)}
  finally{busy=false;render()}
 }
 root.StoryMemberPortal=Object.freeze({mount,hide});
})(window);
