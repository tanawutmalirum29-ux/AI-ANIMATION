/* Studio Art Vault: browse reusable vector artwork, place in scene, propose new entries via GitHub PR. */
(function(root){
'use strict';
const core=root.StoryAssetCore;if(!core)return;
let bridge=null,host=null,catalog=null,draft='',message='',pending=false,filter='all',view='catalog';
const LOCAL_KEY='storyStudio.artVault.local.v1';
const AUTO_KEY='storyStudio.artVault.autoPublish.v1';
const LINKS_KEY='storyStudio.artVault.gitHubLinks.v1';
const repoCatalog='https://raw.githubusercontent.com/tanawutmalirum29-ux/AI-ANIMATION/main/assets/library.json';
let localAssets=readLocal(),autoPublish=readSetting(),submittedLinks=readLinks();
function readJSON(key,fallback){try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch(e){return fallback}}
function readLocal(){const v=readJSON(LOCAL_KEY,[]);return Array.isArray(v)?v.slice(-60).map(a=>{try{return core.asset(a)}catch(e){return null}}).filter(Boolean):[]}
function readSetting(){return readJSON(AUTO_KEY,false)===true}
function readLinks(){const v=readJSON(LINKS_KEY,{});return v&&typeof v==='object'&&!Array.isArray(v)?v:{}}
function nameKey(a){return String(a.name||'').trim().toLocaleLowerCase('th')}
function storeLocal(input){
 const a=core.asset(input);
 if(!a.id)a.id='vault-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
 const previous=localAssets.find(x=>nameKey(x)===nameKey(a));
 if(previous){if(catalog&&!catalog.some(x=>nameKey(x)===nameKey(a)))catalog.push(previous);return {asset:previous,created:false}}
 localAssets=[...localAssets,a].slice(-60);
 try{localStorage.setItem(LOCAL_KEY,JSON.stringify(localAssets))}catch(e){throw Error('พื้นที่บันทึกคลังรูปในเครื่องเต็ม')}
 if(catalog&&!catalog.some(x=>nameKey(x)===nameKey(a)))catalog.push(a);
 return {asset:a,created:true};
}
async function publishConnected(a){
 const github=root.StoryGithubArt;
 if(!github?.status().connected)throw Error('ยังไม่ได้เชื่อม GitHub ในแท็บนี้');
 if(submittedLinks[nameKey(a)])return {url:submittedLinks[nameKey(a)],alreadyExists:true};
 const result=await github.publish(a);
 if(result.url){
  submittedLinks[nameKey(a)]=result.url;
  try{localStorage.setItem(LINKS_KEY,JSON.stringify(submittedLinks))}catch(e){}
 }
 return result;
}
async function saveFromAI(source){
 let saved;
 try{saved=storeLocal(source)}catch(err){announce('AI วาดรูปแล้วแต่บันทึกคลังไม่ได้: '+err.message);return {saved:false,error:err.message}}
 if(!saved.created){announce('มี '+saved.asset.name+' ในคลังส่วนตัวอยู่แล้ว');return {saved:true,published:false,duplicate:true}}
 announce('AI เพิ่ม '+saved.asset.name+' เข้าคลังส่วนตัวแล้ว ใช้ในฉากได้ทันที');
 if(autoPublish&&root.StoryGithubArt?.status().connected){
  try{
   const result=await publishConnected(saved.asset);
   announce('เพิ่ม '+saved.asset.name+' ในคลังแล้ว · ส่ง GitHub '+(result.url?'PR #'+result.number:'(มีอยู่แล้ว)'));
   return {saved:true,published:!!result.url,url:result.url||null};
  }catch(err){
   announce('รูป '+saved.asset.name+' เก็บในเครื่องแล้ว แต่ส่ง GitHub ไม่ผ่าน: '+err.message);
   return {saved:true,published:false,error:err.message}
  }
 }
 return {saved:true,published:false};
}
const LABEL={prop:'สิ่งของ',decor:'ตกแต่ง',nature:'ธรรมชาติ',architecture:'สถานที่',fx:'เอฟเฟกต์'};
const DEFAULT={name:'โคมไฟประดับ',category:'prop',description:'ของประกอบฉากที่ออกแบบเอง',shapes:[
 {type:'rect',x:46,y:35,w:8,h:52,fill:'#937150'},
 {type:'polygon',points:[[30,25],[70,25],[61,45],[39,45]],fill:'#f1ce82'},
 {type:'ellipse',cx:50,cy:88,rx:18,ry:4,fill:'#816546'}]};
const el=(tag,attrs={},...children)=>{
 const node=document.createElement(tag);
 for(const [k,v]of Object.entries(attrs)){
  if(k==='className')node.className=v;
  else if(k==='value')node.value=v;
  else if(k==='style')node.style.cssText=v;
  else if(k.startsWith('on')&&typeof v==='function')node.addEventListener(k.slice(2),v);
  else if(v!==undefined&&v!==null)node.setAttribute(k,String(v));
 }
 for(const c of children.flat())if(c!==undefined&&c!==null)node.append(c instanceof Node?c:document.createTextNode(String(c)));
 return node;
};
const btn=(label,fn,cl='')=>el('button',{type:'button',onclick:fn,className:cl},label);
const preview=a=>{const node=el('div',{className:'ai-art-preview',role:'img','aria-label':a.name});node.innerHTML=core.svg(a);return node};
function announce(text){message=text;const e=host?.querySelector('#studioArtStatus');if(e)e.textContent=text}
async function load(){
 if(catalog)return catalog;
 let local=[],remote=[];
 const parse=async res=>{
  if(!res.ok)throw Error('HTTP '+res.status);
  const d=await res.json();if(!Array.isArray(d.assets)||d.assets.length>300)throw Error('รายการสินทรัพย์ไม่ถูกต้อง');
  return d.assets.map(a=>{try{return core.asset(a)}catch(e){return null}}).filter(Boolean);
 };
 const ctrl=new AbortController(),limit=setTimeout(()=>ctrl.abort(),2000);
 try{
  // A bundled catalog always works offline; merge newly integrated GitHub entries if reachable.
  const [base,live]=await Promise.allSettled([
   fetch('./assets/library.json',{cache:'no-store'}).then(parse),
   fetch(repoCatalog,{cache:'no-store',signal:ctrl.signal}).then(parse)
  ]);
  if(base.status==='fulfilled')local=base.value;
  if(live.status==='fulfilled')remote=live.value;
  if(!local.length&&!remote.length)announce('โหลดคลังเว็บและ GitHub ไม่สำเร็จ · ใช้คลังส่วนตัวแทน');
 }finally{clearTimeout(limit)}
 const seen=new Set();
 catalog=[...remote,...local,...localAssets].filter(a=>{
  const key=nameKey(a);if(seen.has(key))return false;seen.add(key);return true;
 });
 return catalog;
}
function useAsset(a){
 if(!bridge?.addAsset){announce('สตูดิโอไม่พร้อมเพิ่มสินทรัพย์',true);return}
 try{
  const safe=core.asset(a);
  bridge.addAsset(safe);
  announce('เพิ่ม '+safe.name+' ลงฉากที่กำลังเลือกแล้ว (Undo ได้ และติดไปกับโปรเจกต์ JSON)');
 }catch(err){announce(err.message)}
}
function example(){draft=JSON.stringify(DEFAULT,null,2);view='create';render()}
function loadDraft(a){try{draft=JSON.stringify(core.asset(a),null,2);view='create';render()}catch(e){announce(e.message)}}
function fromTask(task){if(!task)return;try{loadDraft(task)}catch(e){announce(e.message)}}
function parsed(){
 if(draft.length>14000)throw Error('JSON ยาวเกิน 14,000 ตัวอักษร');
 return core.asset(JSON.parse(draft));
}
async function submit(){
 if(pending)return;
 let a;try{a=parsed()}catch(err){announce('ตรวจรูปไม่ผ่าน: '+err.message);return}
 pending=true;render();
 try{
  const saved=storeLocal(a);
  const out=await publishConnected(saved.asset);
  message=out.url?'สร้าง GitHub PR #'+out.number+' แล้ว · คลังส่วนตัวใช้ได้ทันที':'GitHub มีชิ้นนี้อยู่แล้ว · ใช้จากคลังได้ทันที';
 }catch(err){message='บันทึกส่วนตัว/ส่ง GitHub ไม่สำเร็จ: '+err.message}
 finally{pending=false;render()}
}
function renderConnect(container){
 const gh=root.StoryGithubArt,connected=!!gh?.status().connected;
 container.append(el('h3',{},'เชื่อม GitHub · เฉพาะโปรเจกต์ AI-ANIMATION'),
  el('p',{className:'ai-help'},'เชื่อมครั้งเดียวต่อการเปิดแท็บ ด้วย Fine-grained PAT ที่จำกัดเฉพาะ Repo นี้: Contents Read/Write และ Pull requests Read/Write. Token อยู่ใน RAM ของแท็บเท่านั้น ไม่เขียนลงเว็บ ไฟล์ JSON หรือ GitHub'),
  el('p',{className:'ai-help'},connected?'GitHub เชื่อมต่อแล้ว · พร้อมสร้าง PR จากรูป AI โดยไม่ต้องคัดลอกไฟล์':'ยังไม่ได้เชื่อม GitHub · สามารถบันทึกรูปส่วนตัวและใช้ในฉากได้โดยไม่ต้องเชื่อม'));
 const form=el('form',{'className':'ai-github-connect'});
 const input=el('input',{type:'password',autocomplete:'off',placeholder:'github_pat_…','aria-label':'GitHub fine-grained token',required:true});
 form.append(input,btn('เชื่อม GitHub',async()=>{
  if(pending)return;
  pending=true;announce('กำลังตรวจสิทธิ์ GitHub...');
  try{await gh.connect(input.value);input.value='';message='เชื่อม GitHub แล้ว (เฉพาะแท็บนี้)';render()}
  catch(err){message='เชื่อมไม่สำเร็จ: '+err.message;render()}
  finally{pending=false}
 },'ai-primary'));
 form.addEventListener('submit',evt=>{evt.preventDefault();form.querySelector('button')?.click()});
 container.append(form);
 if(connected)container.append(btn('ตัดการเชื่อมต่อและล้าง token ออกจาก RAM',()=>{
  gh.disconnect();autoPublish=false;localStorage.setItem(AUTO_KEY,'false');message='ยกเลิก GitHub แล้ว';render();
 }));
 const toggle=el('label',{className:'ai-auto-toggle'},el('input',{type:'checkbox',...(autoPublish?{checked:'checked'}:{}),
  onchange:evt=>{autoPublish=evt.target.checked;try{localStorage.setItem(AUTO_KEY,JSON.stringify(autoPublish))}catch(e){};render()}}),
  ' ส่งผลงานใหม่จาก AI เข้า GitHub เป็น PR อัตโนมัติ (ใช้ของในคลังส่วนตัวได้ทันที)');
 container.append(toggle,el('p',{className:'ai-help'},'โหมดส่ง GitHub ทำงานเฉพาะเมื่อเชื่อม token แล้ว และ AI สร้างรูปทรง JSON ที่ผ่านตรวจเท่านั้น · ไม่ให้สิทธิ์แก้ซอร์สโค้ดหรือไฟล์อื่น · GitHub Actions ตรวจ PR ก่อนรวม main · ไม่มีค่า AI API'));
}
function renderGallery(container){
 const assets=catalog||[];
 const categories=[['all','ทั้งหมด'],...core.categories.map(c=>[c,LABEL[c]])];
 const choice=el('div',{className:'ai-art-filter'},...categories.map(([id,label])=>btn(label,()=>{filter=id;render()},id===filter?'active':'')));
 container.append(choice);
 const list=el('div',{className:'ai-art-grid'}),filtered=assets.filter(a=>filter==='all'||a.category===filter);
 if(!filtered.length)list.append(el('p',{className:'ai-help'},'ยังไม่มีรายการในหมวดนี้ หรือเว็บไซต์ยังไม่ได้รับไฟล์คลังจาก GitHub'));
 for(const a of filtered){
  list.append(el('article',{className:'ai-art-card'},preview(a),el('strong',{},a.name),el('small',{},a.description||LABEL[a.category]),
    el('div',{className:'ai-actions'},btn('ใช้ในฉาก',()=>useAsset(a),'ai-primary'),btn('ใช้เป็นต้นแบบ',()=>loadDraft(a)))));
 }
 container.append(list);
}
function renderEditor(container){
 const input=el('textarea',{'aria-label':'JSON รูปวาด',rows:13,spellcheck:'false',oninput:evt=>{draft=evt.target.value}});
 input.value=draft||JSON.stringify(DEFAULT,null,2);
 if(!draft)draft=input.value;
 const left=el('div',{className:'ai-art-editor'},el('p',{className:'ai-help'},'สร้างรูปวาดจากรูปทรง rect, circle, ellipse, line, polygon ด้วยพิกัด 0–100 และสี #RRGGBB ไม่รับโค้ด SVG/JavaScript ที่ AI สร้าง'),input);
 const right=el('div',{className:'ai-art-review'});function paint(){
  right.replaceChildren();
  try{const a=parsed();right.append(preview(a),el('strong',{},a.name),el('p',{},a.description||LABEL[a.category]),el('small',{},a.shapes.length+' รูปทรง · ผ่านการตรวจรูปแบบแล้ว'),
   el('div',{className:'ai-actions'},btn('เพิ่มในฉากทันที',()=>useAsset(a),'ai-primary'),btn('ส่ง GitHub เป็น PR',submit)));}
  catch(err){right.append(el('p',{className:'ai-error'},'ตรวจรูปแบบไม่ผ่าน: '+err.message))}
 }
 input.addEventListener('input',paint);paint();
 container.append(el('div',{className:'ai-art-edit-grid'},left,right));
}
function renderCurrent(container){
 const scene=bridge?.scene?.(),list=Array.isArray(scene?.customAssets)?scene.customAssets:[];
 const panel=el('section',{className:'ai-art-current'},el('h4',{},'ของที่ใช้ในฉากนี้ ('+list.length+')'));
 if(!list.length)panel.append(el('p',{className:'ai-help'},'เลือก “ใช้ในฉาก” จากคลังเพื่อเริ่มวางรูป'));
 list.forEach((item,index)=>{
  let safe;try{safe=core.asset(item.asset)}catch(e){return}
  const control=(key,label,min,max,step)=>el('label',{},label,el('input',{
   type:'number',min,max,step,value:Number(item[key]??(key==='scale'?1:50)).toFixed(key==='scale'?1:0),
   onchange:ev=>bridge.updateAsset(index,{[key]:Number(ev.target.value)})
  }));
  panel.append(el('article',{className:'ai-art-placement'},preview(safe),
   el('div',{className:'ai-art-placement-fields'},el('strong',{},safe.name),
    el('div',{className:'ai-art-number-row'},control('x','ตำแหน่ง X',0,100,1),
      control('y','ตำแหน่ง Y',0,100,1),control('scale','ขนาด',.1,3,.1)),
    el('label',{},el('input',{type:'checkbox',...(item.front?{checked:'checked'}:{}),
       onchange:ev=>bridge.updateAsset(index,{front:ev.target.checked})}),' วาดหน้าตัวละคร'),
    btn('ลบจากฉาก',()=>bridge.removeAsset(index)))));
 });
 container.append(panel);
}
function render(){
 if(!host)return;
 host.replaceChildren(el('div',{className:'ai-section-head'},el('h3',{},'Art Vault · คลังของสำเร็จรูปจาก GitHub'),
  el('span',{},'ของจาก AI ใช้ได้ทันทีในเครื่อง · เชื่อม GitHub ครั้งเดียว แล้วให้ระบบส่ง PR ได้เอง')),
  el('div',{className:'ai-actions'},btn('ของสำเร็จรูป',()=>{view='catalog';render()},view==='catalog'?'ai-primary':''),btn('ออกแบบ / ส่ง PR',()=>{view='create';render()},view==='create'?'ai-primary':''),
   btn('เชื่อม GitHub',()=>{view='connect';render()},view==='connect'?'ai-primary':''),btn('สร้างตัวอย่าง',example),btn('โหลดคลังใหม่',()=>{catalog=null;load().then(render)})),
  el('p',{id:'studioArtStatus',className:'ai-status',role:'status','aria-live':'polite'},message||'AI สามารถบันทึกรูปในเครื่องได้เอง ส่วนการส่ง GitHub ต้องเชื่อมสิทธิ์ก่อน'),
  el('p',{className:'ai-help'},'ไม่มี API AI แบบเสียเงิน · GitHub Token ไม่เก็บถาวรในเบราว์เซอร์ · เมื่อเชื่อมแล้ว สามารถเปิดส่ง PR อัตโนมัติในแท็บเชื่อม GitHub'));
 const area=el('div');
 host.append(area);
 if(view==='connect'){renderConnect(area)}
 else{renderCurrent(area);if(view==='catalog')renderGallery(area);else renderEditor(area)}
}
function mount(target,newBridge){host=target;bridge=newBridge;load().then(render);render()}
root.StoryArtVault=Object.freeze({mount,render,fromTask,load,saveFromAI,previewAsset:preview,asset:core.asset});
})(window);
