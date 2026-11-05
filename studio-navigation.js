/* Task-oriented navigation. Presentation only; AWS remains the authority for roles. */
(function(root){
'use strict';
const doc=document, q=s=>doc.querySelector(s);
const groups={visual:{label:'1 · ฉากและภาพ',tools:['scene','characters','library'],hint:'เริ่มจากเลือกฉาก แล้วจัดตัวละครและภาพประกอบ ตรวจผลได้ในพรีวิว'},director:{label:'กำกับภาพ',tools:['cinematic','motion','map','cinema','interaction'],hint:'สร้าง Blueprint หรือตั้งค่ากล้อง เอฟเฟกต์ และเหตุการณ์ของฉาก'},sound:{label:'2 · เสียง',tools:['record','voices','audio'],hint:'เลือกโทนเสียง → อัดเสียงพากย์ → จัดเวลาและระดับเสียง'},finish:{label:'3 · ตรวจและส่งออก',tools:['smart','export'],hint:'ตรวจงานและเล่นพรีวิวให้ครบ ก่อนเลือกรูปแบบวิดีโอและส่งออก'},assist:{label:'ผู้ช่วย AI',tools:['ai'],hint:'เลือกงานที่ต้องการให้ AI ช่วย แล้วตรวจผลก่อนนำไปใช้'}};
let group='visual';
const node=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n};
const button=(label,fn,cls='')=>{const n=node('button',cls,label);n.type='button';n.onclick=fn;return n};
const isAdmin=()=>root.StoryStudioAccess?.isAdmin?.()===true;
const home=node('main','ux-home');home.id='studioHome';home.setAttribute('aria-label','หน้าเริ่มต้น');
const nav=node('nav','ux-groups');nav.setAttribute('aria-label','ขั้นตอนสร้างวิดีโอ');
const hint=node('p','ux-hint');hint.id='workspaceGuide';
function selectGroup(id){group=id;nav.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.group===id)));q('#studioToolNav').dataset.group=id;for(const b of q('#studioToolNav').querySelectorAll('[data-tool]'))b.hidden=!groups[id].tools.includes(b.dataset.tool);hint.textContent=groups[id].hint;}
function editor(tool='scene'){
 doc.body.classList.remove('ux-home-open');home.hidden=true;
 if(root.StoryAIMode?.isAi())root.StoryAIMode.set('full');
 root.switchStudioTool(tool);
 requestAnimationFrame(()=>{root.fit?.();q('#studioToolTitle')?.focus({preventScroll:true})});
}
function card(number,title,description,label,action){
 const n=node('article','ux-card');n.append(node('span','ux-number',number),node('h2','',title),node('p','',description),button(label,action));return n;
}
function showHome(admin=false,focus=true){
 if(admin&&!isAdmin())admin=false;
 root.setMenuOpen?.(false);
 doc.body.classList.remove('export-focus','mother-focus','mother-preview');
 home.replaceChildren();
 const intro=node('section','ux-intro');
 intro.append(node('span','ux-eyebrow',admin?'ADMIN WORKSPACE':'STORY STUDIO / CREATE'),node('h1','',admin?'พื้นที่ผู้ดูแลระบบ':'เริ่มเรื่องราวของคุณ'),node('p','',admin?'จัดการ AI และระบบสอน แยกจากพื้นที่สร้างวิดีโอของผู้ใช้':'จากฉากแรกสู่คลิปที่พร้อมแชร์ ค่อย ๆ ทำทีละขั้นตอน'));
 const actions=node('div','ux-home-actions');
 actions.append(button(admin?'กลับไปสร้างวิดีโอ':'เปิดพื้นที่ตัดต่อ',()=>admin?showHome(false):editor(),'ux-primary'));
 if(!admin)actions.append(button('เปิดไฟล์โปรเจกต์',()=>{editor();q('#file')?.click()}));
 intro.append(actions);home.append(intro);
 const cards=node('section','ux-cards');cards.setAttribute('aria-label',admin?'เครื่องมือผู้ดูแล':'ขั้นตอนเริ่มต้น');
 if(admin){
  [['01','AI ครูและการเชื่อมต่อ','ตรวจการเชื่อมต่อและตั้งค่าผู้ให้บริการ AI','ตั้งค่า AI ครู','teacher'],['02','สอนและตรวจข้อมูล','นำเข้าชุด JSON สำหรับสอนและตรวจผล','จัดการชุดสอน','batch'],['03','ประวัติการทำงาน','ติดตามสถานะงานและตรวจผลการประมวลผล','ดูประวัติ','tasks']].forEach(([n,t,d,l,v])=>cards.append(card(n,t,d,l,()=>{if(!isAdmin())return;editor('ai');root.StoryAIWorkspace?.navigate(v)})));
 }else{
  cards.append(card('01','วางเรื่องและจัดฉาก','เลือกฉาก เพิ่มตัวละคร และปรับภาพให้เล่าเรื่องได้ชัดเจน','เริ่มจัดฉาก',()=>editor('scene')),card('02','เติมเสียงให้เรื่องราว','อัดเสียงพากย์ เลือกโทนเสียง แล้วจัดคลิปบนไทม์ไลน์','ทำงานกับเสียง',()=>editor('record')),card('03','ตรวจแล้วส่งออก','ตรวจความพร้อม ดูพรีวิว และบันทึกเป็นวิดีโอ','ตรวจงาน',()=>editor('smart')));
 }
 home.append(cards);
 const foot=node('section','ux-home-foot');
 const summary=root.StoryStudioBridge?.get();
 foot.append(node('h2','',admin?'สิทธิ์ผู้ดูแลระบบ':'โปรเจกต์ปัจจุบัน'),node('p','',admin?'เครื่องมือส่วนนี้แสดงเฉพาะบัญชีแอดมินที่ระบบยืนยันแล้ว':(summary?.project?.title||'โปรเจกต์')+' · '+(summary?.episodes?.length||0)+' ตอน — เปิดพื้นที่ตัดต่อเพื่อทำงานต่อ'));
 if(isAdmin())foot.append(button(admin?'กลับหน้าเริ่มต้น':'ไปพื้นที่ผู้ดูแลระบบ',()=>showHome(!admin)));
 home.append(foot);home.hidden=false;doc.body.classList.add('ux-home-open');
 if(focus){const title=home.querySelector('h1');title.tabIndex=-1;title.focus()}
}
function topEntry(){
 const top=q('#top');if(!top||q('#studioHomeButton'))return;
 const b=button('หน้าหลัก',()=>showHome());b.id='studioHomeButton';top.prepend(b);
 const role=node('span','ux-role',isAdmin()?'แอดมิน':root.StoryStudioAccess?.user()?.role==='guest'?'ผู้เยี่ยมชม':'พื้นที่สร้างวิดีโอ');top.append(role);
}
function init(){
 if(!q('#studioWorkspace'))return;
 // Preserve explicitly bookmarked experimental AI workspaces.
 if(new URLSearchParams(location.search).get('mode')==='ai')return;
 if(root.StoryAIMode?.isAi())root.StoryAIMode.set('full');
 doc.body.classList.add('ux-ready');doc.body.append(home);
 for(const [id,g] of Object.entries(groups)){const b=button(g.label,()=>editor(g.tools[0]));b.dataset.group=id;nav.append(b)}
 q('#studioToolNav').before(nav);q('#studioToolTitle').after(hint);q('#studioToolTitle').tabIndex=-1;
 const original=root.switchStudioTool;
 root.switchStudioTool=function(id){
  if(!home.hidden){home.hidden=true;doc.body.classList.remove('ux-home-open');}
  const result=original.apply(this,arguments);
  const key=Object.keys(groups).find(k=>groups[k].tools.includes(id));if(key)selectGroup(key);
  return result;
 };
 // Keep existing event handlers and DOM IDs, including export/voice initialization.
 const more=node('details','ux-preview-more');more.append(node('summary','','ตัวเลือกพรีวิว'));
 const options=node('div','ux-preview-options');
 for(const id of ['motionQuick','capToggle','labelToggle']){const n=q('#'+id);if(n)options.append(n)}
 more.append(options);q('.preview-actions').append(more);
 const render=root.renderTop;root.renderTop=function(){const result=render.apply(this,arguments);topEntry();return result};
 selectGroup('visual');topEntry();
 root.addEventListener('story-studio-access-change',()=>{q('#studioHomeButton')?.remove();q('.ux-role')?.remove();topEntry();if(!home.hidden)showHome(false,false)});
 // Explicit editor URLs are useful for bookmarks, integrations and regression tests.
 const params=new URLSearchParams(location.search);
 if(params.get('workspace')==='editor'||params.get('mode')==='full')editor();else showHome(false,false);
}
if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(window);
