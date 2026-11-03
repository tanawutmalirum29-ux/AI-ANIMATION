/* Member release v1: six fixed specialist prompt roles, never six fine-tuned LLMs.
 * Saved BYOK credentials are encrypted on AWS and scoped to signed GitHub ID.
 * Never persist an API Key in browser storage or project data.
 */
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
 let keys=[],selectedKey='',loadingKeys=false,savingKey=false,
     release=null,loadedAccountId=null;
 function node(tag,cls,text){const el=document.createElement(tag);
  if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el}
 function button(text,fn,cls){const el=node('button',cls,text);el.type='button';el.onclick=fn;return el}
 const storeKey=()=>account?'storyMember.tasks.'+account.id:'';
 function restore(){try{const v=JSON.parse(localStorage.getItem(storeKey())||'{}');
   jobs=v&&typeof v==='object'&&!Array.isArray(v)?v:{};}catch(_){jobs={}}}
 function persist(){try{localStorage.setItem(storeKey(),JSON.stringify(jobs))}catch(_){
   error='ไม่สามารถบันทึกประวัติงานบนเบราว์เซอร์นี้ได้'}}
 async function refreshKeys(){
  if(!account||!access||loadingKeys)return;
  const id=account.id;
  loadingKeys=true;render();
  try{
   const [saved,catalog]=await Promise.all([
    access.request({action:'member.keys.list'}),
    access.request({action:'member.ai.catalog'})]);
   // Never show data returned for a prior account after rapid logout/login.
   if(!account||account.id!==id)return;
   keys=Array.isArray(saved.connections)?saved.connections:[];
   keys.sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)||a.name.localeCompare(b.name));
   release=catalog;
   if(!keys.some(x=>x.id===selectedKey))selectedKey=keys[0]?.id||'';
   const chosen=keys.find(x=>x.id===selectedKey);
   if(chosen){provider=chosen.provider;model=chosen.model}
  }catch(e){if(account?.id===id)error='โหลด API Key ของบัญชีไม่สำเร็จ: '+String(e.message||e)}
  finally{loadingKeys=false;render()}
 }
 async function saveKey(){
  if(!apiKey.trim()||savingKey)return;
  savingKey=true;error='';render();
  const requested={provider,model:model.trim(),apiKey};
  try{
   const saved=await access.request({action:'member.keys.add',...requested});
   apiKey='';
   selectedKey=saved.connection.id;
   await refreshKeys();
  }catch(e){error='บันทึกคีย์ใน AWS ไม่สำเร็จ: '+String(e.message||e)}
  finally{savingKey=false;render()}
 }
 async function removeKey(){
  if(!selectedKey)return;
  const key=keys.find(x=>x.id===selectedKey);
  if(!key||!root.confirm('ลบ API Key '+key.name+' ออกจากบัญชี GitHub นี้?'))return;
  try{
   await access.request({action:'member.keys.remove',
    connectionId:selectedKey,confirmRemove:true});
   selectedKey='';await refreshKeys();
  }catch(e){error='ลบ API Key ไม่สำเร็จ: '+String(e.message||e);render()}
 }
 function mount({profile,request,logout}){
  if(!profile||profile.role!=='member')return;
  if(!account||account.id!==profile.id){
   account=profile;restore();apiKey='';source='';sourceName='';
   keys=[];selectedKey='';release=null;loadedAccountId=null;
  }
  access={request,logout};
  if(!host){host=node('div');host.id='storyMemberPortal';document.body.append(host)}
  host.hidden=false;render();
  if(loadedAccountId!==account.id){
   loadedAccountId=account.id;refreshKeys().catch(()=>{});
  }
 }
 function hide(){if(host)host.hidden=true;account=null;access=null;apiKey='';source='';
  keys=[];selectedKey='';release=null;loadedAccountId=null}
 function field(title,control){const el=node('label',null,title);el.append(control);return el}
 function render(){
  if(!host||!account||!access)return;host.replaceChildren();
  const head=node('header');head.append(node('div',null,
   'AI-ANIMATION · ผู้ช่วย 6 บทบาท รุ่น 1 | GitHub: '+account.login),
    button('ออกจากระบบ',access.logout));
  host.append(head);
  const main=node('main','member-content');
  main.append(node('h1',null,'โมดูลผู้ช่วยรุ่น 1 · 6 ตำแหน่ง'),
   node('p','subtle','รุ่น '+(release?.version||'1.0')+
    ' · ปรับบทบาทตามงานด้วย API ภายนอก ไม่ใช่โมเดลฝึกน้ำหนัก 6 ตัว · ไม่อัปเกรดน้ำหนักจาก AI ลูกอัตโนมัติ · ไม่มีสิทธิ์ดู AI แม่หรือฐานข้อมูลฝึกของแอดมิน'));
  const nav=node('nav','member-roles');
  for(const [id,name,description] of roles){const btn=button(name,()=>{role=id;error='';render()},
   'member-role'+(role===id?' active':''));btn.append(node('small',null,description));nav.append(btn)}
  main.append(nav);
  const box=node('section','member-card');
  box.append(node('h2',null,'API ของบัญชี GitHub นี้'),
   node('p','subtle','เก็บคีย์แบบเข้ารหัสใน AWS ผูกกับ GitHub User ID · เปลี่ยนเครื่องแล้วล็อกอินบัญชีเดิมจะเรียกคืนได้ · คีย์ไม่แสดงกลับในเบราว์เซอร์'));
  const saved=node('select');saved.setAttribute('aria-label','API Key ที่บันทึกในบัญชี');
  const choose=node('option',null,'เพิ่มใหม่ / ใช้คีย์ชั่วคราว');choose.value='';
  choose.selected=!selectedKey;saved.append(choose);
  for(const item of keys){
   const option=node('option',null,item.name);option.value=item.id;
   option.selected=item.id===selectedKey;saved.append(option);
  }
  saved.onchange=e=>{
   selectedKey=e.target.value;
   const chosen=keys.find(x=>x.id===selectedKey);
   if(chosen){provider=chosen.provider;model=chosen.model;apiKey=''}
   render();
  };
  box.append(field('เชื่อมต่อที่บันทึกไว้ (เรียงตามวันที่เพิ่ม)',saved));
  const columns=node('div','member-columns'),sel=node('select');
  for(const [id,label] of [['gemini','Google Gemini'],['openrouter','OpenRouter ฟรี']]){
   const opt=node('option',null,label);opt.value=id;opt.selected=id===provider;sel.append(opt)}
  sel.disabled=!!selectedKey;
  sel.onchange=ev=>{provider=ev.target.value;model='';selectedKey='';render()};
  const md=node('input');md.value=model;md.disabled=!!selectedKey;
  md.placeholder=provider==='gemini'?
   'gemini-3.5-flash-lite':'openrouter/free';md.oninput=ev=>model=ev.target.value;
  columns.append(field('ผู้ให้บริการ',sel),field('Model ID',md));box.append(columns);
  const key=node('input');key.type='password';key.autocomplete='off';key.value=apiKey;
  key.disabled=!!selectedKey||savingKey;
  key.placeholder=selectedKey?'คีย์บันทึกใน AWS แล้ว ไม่แสดงคีย์':'ใส่ API Key ใหม่ของบัญชีคุณ';
  key.oninput=ev=>apiKey=ev.target.value;
  box.append(field('API Key ใหม่',key),node('p','subtle',
   'กดบันทึกเพื่อใช้คีย์ข้ามเครื่องได้จนกว่าจะลบ · หากไม่กดบันทึก จะใช้คีย์ได้เฉพาะแท็บนี้ · ประวัติงานยังคงอยู่ในเครื่องเดิม'));
  const keysActions=node('div','member-columns');
  const saveButton=button(savingKey?'กำลังบันทึก…':'บันทึกคีย์กับ GitHub',saveKey);
  saveButton.disabled=!!selectedKey||!apiKey.trim()||savingKey;
  const deleteButton=button('ลบคีย์ออกจาก AWS',removeKey);
  deleteButton.disabled=!selectedKey||savingKey;
  keysActions.append(saveButton,deleteButton);
  box.append(keysActions);
  main.append(box);
  const section=node('section','member-card'),chosen=roles.find(x=>x[0]===role);
  section.append(node('h2',null,'รุ่น 1 · '+chosen[1]+' · '+chosen[2]));
  section.append(node('p','subtle','เวอร์ชันนี้คงความสามารถตามที่เผยแพร่แล้ว ยังไม่มีโมเดลฝึกน้ำหนักเฉพาะบทบาท'));
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
  if(!selectedKey&&!apiKey.trim()){error='โปรดเลือก API Key ที่บันทึกไว้ หรือใส่คีย์ชั่วคราว';render();return}
  if(!prompt.trim()){error='โปรดใส่คำสั่งงาน';render();return}
  const id=role,question=prompt.trim();busy=true;error='';render();
  try{
   const payload={action:'member.ai.run',release:'member-six-v1',
    role:id,provider,model:model.trim(),message:question,context:source.slice(0,9000)};
   if(selectedKey)payload.connectionId=selectedKey;
   else payload.apiKey=apiKey;
   const res=await access.request(payload);
   if(!Array.isArray(jobs[id]))jobs[id]=[];
   jobs[id].push({date:new Date().toLocaleString('th-TH'),question,
     reply:String(res.reply||''),provider,sourceFile:sourceName});
   jobs[id]=jobs[id].slice(-40);persist();prompt='';
  }catch(e){error=String(e.message||e)}
  finally{busy=false;render()}
 }
 root.StoryMemberPortal=Object.freeze({mount,hide});
})(window);
