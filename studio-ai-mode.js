/* Story Studio · AI-only mode (หน้าเดียว: งานกับ AI)
 *
 * While <html class="ai-only"> is set (the default, decided by an inline script in <head>), the editor shows
 * only the AI workflow:
 *   hub   - "ส่งให้ AI" (copy guide / context, download pack) + "นำงานกลับเข้า" (paste JSON / open file)
 *   ai    - the existing AI Workspace (6 helpers, history, story bible, ML Lab)
 *   smart - the existing Smart Director check
 * The ☰ menu is replaced by a short list of those pages plus a way back to the full editor.
 * Nothing in the project data or in the full editor is changed; switching mode only toggles visibility.
 */
(function(root){
'use strict';
const doc=document,html=doc.documentElement;
const KEY='storyStudio.uiMode';
const REQUIRED=['aiGuide','aiContext','dl','downloadAiPackage','downloadAiGuide','downloadAiContext','switchStudioTool','renderTop','setMenuOpen','fit'];
if(REQUIRED.some(n=>typeof root[n]!=='function'))return;

const q=s=>doc.querySelector(s);
const el=(tag,attrs={},...kids)=>{
 const n=doc.createElement(tag);
 for(const [k,v] of Object.entries(attrs)){
  if(k==='className')n.className=v;
  else if(k.startsWith('on')&&typeof v==='function')n.addEventListener(k.slice(2),v);
  else if(v!==false&&v!==null&&v!==undefined)n.setAttribute(k,v===true?'':String(v));
 }
 for(const c of kids.flat())if(c!==null&&c!==undefined&&c!==false)n.append(c);
 return n;
};
const isAi=()=>html.classList.contains('ai-only');
const page=()=>html.dataset.aiPage||'hub';

let hub=null,adv=null,statusNode=null,summaryNode=null,ignoreClose=0;

/* ---------------- hub page ---------------- */
function summary(){
 try{
  const e=S.episodes[selEp];
  return (S.project.title||'โปรเจกต์')+' · ตอน '+(selEp+1)+' จาก '+S.episodes.length+' · '+e.scenes.length+' ฉากในตอนนี้';
 }catch(_){return ''}
}
function say(message,fail=false){
 if(!statusNode)return;
 statusNode.textContent=message||'';
 statusNode.dataset.error=String(!!fail);
}
async function copyOrSave(text,okMessage,fileName,mime){
 try{
  if(!navigator.clipboard||!navigator.clipboard.writeText)throw new Error('no clipboard');
  await navigator.clipboard.writeText(text);
  say('✓ '+okMessage+' ('+text.length.toLocaleString('th-TH')+' ตัวอักษร) — ไปวางในแชต AI ได้เลย');
 }catch(_){
  root.dl(fileName,text,mime);
  say('คัดลอกอัตโนมัติไม่ได้ในเบราว์เซอร์นี้ จึงดาวน์โหลดเป็นไฟล์ให้แทน',true);
 }
}
function buildHub(){
 if(hub)return;
 statusNode=el('p',{className:'aih-status',role:'status','aria-live':'polite','data-error':'false'});
 summaryNode=el('p',{id:'aihSummary'},summary());
 hub=el('main',{id:'aiHub','aria-label':'งานกับ AI'},
  el('div',{className:'aih-head'},el('h2',{},'งานกับ AI'),summaryNode),
  statusNode,
  el('section',{className:'aih-card','aria-labelledby':'aihSend'},
   el('h3',{id:'aihSend'},el('span',{className:'aih-step','aria-hidden':'true'},'1'),'ส่งให้ AI'),
   el('p',{},'คัดลอกไปวางในแชต AI ภายนอก (หรือดาวน์โหลดเป็นไฟล์) แล้วบอกว่าต้องการให้แก้อะไร'),
   el('div',{className:'aih-actions'},
    el('button',{type:'button',className:'aih-primary',onclick:()=>copyOrSave(root.aiGuide(),'คัดลอกคู่มือ AI แล้ว','story-studio-ai-guide.md','text/markdown')},'คัดลอกคู่มือ AI'),
    el('button',{type:'button',className:'aih-primary',onclick:()=>copyOrSave(root.aiContext(),'คัดลอกบริบทงานแล้ว','story-studio-ai-context.md','text/markdown')},'คัดลอกบริบทงาน'),
    el('button',{type:'button',onclick:()=>{root.downloadAiPackage();say('✓ ดาวน์โหลดแพ็กให้ AI แล้ว — แนบไฟล์นี้ในแชต AI')}},'ดาวน์โหลดแพ็ก (.json)')),
   el('details',{},
    el('summary',{},'ดาวน์โหลดคู่มือ / บริบท แยกเป็นไฟล์ .md'),
    el('div',{className:'aih-actions'},
     el('button',{type:'button',onclick:()=>{root.downloadAiGuide();say('✓ ดาวน์โหลดคู่มือ AI (.md) แล้ว')}},'คู่มือ AI (.md)'),
     el('button',{type:'button',onclick:()=>{root.downloadAiContext();say('✓ ดาวน์โหลดบริบท AI (.md) แล้ว')}},'บริบทงาน (.md)')))),
  el('section',{className:'aih-card','aria-labelledby':'aihImport'},
   el('h3',{id:'aihImport'},el('span',{className:'aih-step','aria-hidden':'true'},'2'),'นำงานกลับเข้า'),
   el('p',{},'วาง JSON ที่ AI ตอบกลับ แล้วกด “นำเข้า” · ย้อนกลับได้ด้วย ↶ ด้านบน'),
   el('div',{id:'aihImportSlot'}),
   el('div',{className:'aih-file'},
    el('button',{type:'button',onclick:()=>{const f=doc.getElementById('file');if(f)f.click()}},'เปิดไฟล์ .json จากเครื่อง'))));
 const anchor=doc.getElementById('studioWorkspace');
 if(anchor)anchor.before(hub);else doc.body.append(hub);
}

/* ---------------- the import dialog, embedded inline ---------------- */
function embedImport(){
 const dlg=q('#dlg'),slot=q('#aihImportSlot');
 if(!dlg||!slot||dlg.classList.contains('aih-embedded'))return;
 const label=dlg.querySelector('label[for="mode"]'),select=dlg.querySelector('#mode'),smart=dlg.querySelector('#smartImportWrap');
 if(dlg.open){ignoreClose++;dlg.close()}
 adv=el('details',{className:'aih-adv'},el('summary',{},'ตัวเลือกการนำเข้า (ปกติไม่ต้องแตะ)'));
 if(label)adv.append(label);if(select)adv.append(select);if(smart)adv.append(smart);
 dlg.append(adv);
 dlg.classList.add('aih-embedded');
 slot.append(dlg);
 dlg.show();
}
function restoreImport(){
 const dlg=q('#dlg');
 if(!dlg||!dlg.classList.contains('aih-embedded'))return;
 if(dlg.open)dlg.close();
 const hint=dlg.querySelector('#impHint');
 if(adv){
  const parts=[...adv.children].filter(n=>n.tagName!=='SUMMARY');
  if(hint)hint.before(...parts);else dlg.prepend(...parts);
  adv.remove();adv=null;
 }
 dlg.classList.remove('aih-embedded');
 doc.body.append(dlg);
}
/* importIt() closes the dialog after a successful import: keep it open as the page's paste box. */
(function watchImportClose(){
 const dlg=q('#dlg');
 if(!dlg)return;
 dlg.addEventListener('close',()=>{
  if(!isAi()||!dlg.classList.contains('aih-embedded'))return;
  if(ignoreClose){ignoreClose--;return}
  const box=q('#imp');
  if(box)box.value='';
  if(typeof root.updateImportHint==='function')root.updateImportHint();
  dlg.show();
  say('✓ นำเข้างานจาก AI แล้ว — ถ้าไม่ถูกใจกด ↶ ด้านบนเพื่อย้อนกลับ');
  if(hub)hub.scrollTop=0;
  root.scrollTo(0,0);
 });
})();

/* ---------------- page switching ---------------- */
const origSwitch=root.switchStudioTool;
function setPage(p){
 html.dataset.aiPage=p;
 if(hub)hub.scrollTop=0;
 root.scrollTo(0,0);
 buildMenu();
 if(p==='hub'&&summaryNode)summaryNode.textContent=summary();
}
root.switchStudioTool=function(id){
 if(!isAi())return origSwitch.apply(this,arguments);
 if(id==='ai'||id==='smart'){setPage(id);return origSwitch.call(this,id)}
 setPage('hub'); /* any other tool (scene, export, ...) falls back to the hub in AI mode */
};

/* ---------------- menu ---------------- */
function menuAction(label,fn,icon,cls=''){
 return el('button',{type:'button',className:'menu-action '+cls,'aria-current':null,onclick:()=>{root.setMenuOpen(false);fn()}},
  el('span',{className:'mi','aria-hidden':'true'},icon),el('span',{className:'ml'},label));
}
function buildMenu(){
 const menu=q('#menu');
 if(!menu||!isAi())return;
 const here=page();
 const item=(id,label,icon,fn)=>{
  const b=menuAction(label,fn,icon,'wide'+(here===id?' primary':''));
  if(here===id)b.setAttribute('aria-current','page');
  return b;
 };
 menu.replaceChildren(
  el('div',{className:'menu-head'},
   el('div',{},el('strong',{},'เมนูงาน AI'),el('small',{},'ไปหน้าที่ใช้กับ AI')),
   el('button',{type:'button',className:'menu-close','aria-label':'ปิดเมนู',onclick:()=>root.setMenuOpen(false)},'×')),
  el('section',{className:'menu-group'},
   el('h3',{},'หน้าทำงานกับ AI'),
   el('div',{className:'menu-grid'},
    item('hub','ส่งให้ AI · นำงานเข้า','⌁',()=>setPage('hub')),
    item('ai','AI สั่งงาน · 6 ผู้ช่วย','✦',()=>root.switchStudioTool('ai')),
    item('smart','AI ตรวจงาน · Smart Director','✓',()=>root.switchStudioTool('smart')))),
  el('section',{className:'menu-group'},
   el('h3',{},'ต้องการแก้ภาพ เสียง หรือส่งออกวิดีโอ'),
   el('div',{className:'menu-grid'},
    menuAction('เปิดโหมดตัดต่อเต็ม (พรีวิว · ไทม์ไลน์ · ส่งออก)',()=>setMode('full'),'▶','wide'))));
}
/* In the full editor, add one way back into AI-only mode at the top of the existing AI group. */
function augmentFullMenu(){
 const menu=q('#menu');
 if(!menu||isAi())return;
 const group=[...menu.querySelectorAll('.menu-group')].find(g=>(g.querySelector('h3')||{}).textContent==='ทำงานกับ AI');
 const grid=group&&group.querySelector('.menu-grid');
 if(grid&&!grid.querySelector('[data-ai-mode-entry]')){
  const b=menuAction('โหมดหน้าเรียบ · เหลือแค่งาน AI',()=>setMode('ai'),'◐','wide primary');
  b.dataset.aiModeEntry='1';
  grid.prepend(b);
 }
}
const prevTop=root.renderTop;
root.renderTop=function(){
 prevTop.apply(this,arguments);
 if(isAi()){buildMenu();if(summaryNode&&page()==='hub')summaryNode.textContent=summary()}
 else augmentFullMenu();
};

/* ---------------- mode switch ---------------- */
function remember(mode){try{localStorage.setItem(KEY,mode)}catch(_){}}
function enterAi(){
 buildHub();
 html.classList.add('ai-only');
 embedImport();
 setPage('hub');
 root.renderTop();
}
function leaveAi(){
 restoreImport();
 html.classList.remove('ai-only');
 delete html.dataset.aiPage;
 origSwitch.call(root,'scene');
 root.renderTop();
 requestAnimationFrame(()=>{try{root.fit()}catch(_){}root.scrollTo(0,0)});
}
function setMode(mode){
 remember(mode);
 if(mode==='ai')enterAi();else leaveAi();
}
root.StoryAIMode=Object.freeze({set:setMode,page:()=>page(),isAi});

/* ---------------- boot ---------------- */
buildHub();
if(isAi()){
 embedImport();
 setPage('hub');
 /* the inline <head> script already hid the full UI; make sure the workspace is on a safe tool */
 try{origSwitch.call(root,'scene')}catch(_){}
}
root.renderTop();
})(window);
