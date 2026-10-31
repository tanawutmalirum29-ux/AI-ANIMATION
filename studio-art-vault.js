/* Studio Art Vault: browse reusable vector artwork, place in scene, propose new entries via GitHub PR. */
(function(root){
'use strict';
const core=root.StoryAssetCore;if(!core)return;
let bridge=null,host=null,catalog=null,draft='',message='',pending=false,filter='all',view='catalog';
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
 try{
  const res=await fetch('./assets/library.json',{cache:'no-store'});if(!res.ok)throw Error('HTTP '+res.status);
  const d=await res.json();if(!Array.isArray(d.assets)||d.assets.length>300)throw Error('รายการสินทรัพย์ไม่ถูกต้อง');
  catalog=d.assets.map(a=>{try{return core.asset(a)}catch(e){return null}}).filter(Boolean);
 }catch(err){catalog=[];announce('โหลดคลัง GitHub ไม่สำเร็จ: '+err.message)}
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
 if(!root.StoryStudioAccess?.enabled){announce('การส่ง PR ต้องติดตั้งรหัสผ่านเว็บไซต์และ Lambda Gateway ก่อน');return}
 if(!root.StoryStudioAccess.isReady()){announce('กรุณาล็อกอินเว็บไซต์ก่อนส่ง PR');return}
 let a;try{a=parsed()}catch(err){announce('ตรวจรูปไม่ผ่าน: '+err.message);return}
 if(!root.confirm('ส่ง "'+a.name+'" ไป GitHub เป็น Pull Request เพื่อรอตรวจและ Merge หรือไม่? โค้ดเว็บจะไม่ถูกแก้โดยอัตโนมัติ'))return;
 pending=true;render();
 try{
  const out=await root.StoryStudioAccess.request({action:'proposeAsset',asset:a});
  if(!/^https:\/\/github\.com\/tanawutmalirum29-ux\/AI-ANIMATION\/pull\/\d+$/.test(out.url||''))throw Error('เซิร์ฟเวอร์ไม่ส่งลิงก์ PR ที่ถูกต้อง');
  message='สร้าง Pull Request #'+out.number+' สำเร็จ — เมื่อ Merge และ Deploy แล้วของจะปรากฏในคลังทุกโปรเจกต์';
  root.open(out.url,'_blank','noopener,noreferrer');
 }catch(err){message='ส่ง GitHub ไม่สำเร็จ: '+err.message}
 finally{pending=false;render()}
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
function render(){
 if(!host)return;
 host.replaceChildren(el('div',{className:'ai-section-head'},el('h3',{},'Art Vault · คลังของสำเร็จรูปจาก GitHub'),
  el('span',{},'สร้าง/ตรวจรูปในเว็บ → ส่ง Pull Request → Merge → ใช้ซ้ำได้ทุกโปรเจกต์')),
  el('div',{className:'ai-actions'},btn('ของสำเร็จรูป',()=>{view='catalog';render()},view==='catalog'?'ai-primary':''),btn('ออกแบบ / ส่ง PR',()=>{view='create';render()},view==='create'?'ai-primary':''),
   btn('สร้างตัวอย่าง',example),btn('โหลดคลังใหม่',()=>{catalog=null;load().then(render)})),
  el('p',{id:'studioArtStatus',className:'ai-status',role:'status','aria-live':'polite'},message||'ของจาก GitHub จะปรากฏเมื่อ Merge เข้า main และ Amplify Deploy แล้ว'),
  el('p',{className:'ai-help'},'AI ในเครื่องเสนอรูปทรง JSON ได้ แต่จะไม่เข้าถึง GitHub Token และไม่มีสิทธิ์แก้โค้ดเอง การส่ง PR ต้องมีการยืนยันก่อนทุกครั้ง'));
 const area=el('div');
 host.append(area);
 if(view==='catalog')renderGallery(area);else renderEditor(area);
}
function mount(target,newBridge){host=target;bridge=newBridge;load().then(render);render()}
root.StoryArtVault=Object.freeze({mount,render,fromTask,load,previewAsset:preview,asset:core.asset});
})(window);
