/* Unified AI Production workspace: preview, JSON import and real AI tools on one screen.
 * Shares the full editor's project, video preview, transport, importer and undo stack.
 * This UI does not create an AI model or silently upload files.
 */
(function(root){
'use strict';
const doc=document,html=doc.documentElement,KEY='storyStudio.uiMode';
const required=['switchStudioTool','renderTop','setMenuOpen','aiGuide','aiContext','downloadAiPackage','dl','fit'];
if(required.some(k=>typeof root[k]!=='function'))return;
const origSwitch=root.switchStudioTool,origTop=root.renderTop;
const q=s=>doc.querySelector(s);
const el=(tag,attrs={},...children)=>{
 const n=doc.createElement(tag);
 for(const [key,value] of Object.entries(attrs)){
  if(key==='className')n.className=value;
  else if(key.startsWith('on')&&typeof value==='function')n.addEventListener(key.slice(2),value);
  else if(value!==null&&value!==undefined&&value!==false)n.setAttribute(key,value===true?'':String(value));
 }
 for(const child of children.flat())if(child!==null&&child!==undefined&&child!==false)n.append(child);
 return n;
};
const aiOn=()=>html.classList.contains('ai-only');
let hub=null,statusNode=null,summaryNode=null,adv=null,ignoreClose=0;
function summary(){
 try{
  const b=root.StoryStudioBridge,s=b?.get(),epi=b?.episodeIndex()||0,episode=s?.episodes?.[epi];
  return (s?.project?.title||'โปรเจกต์')+' · ตอน '+(epi+1)+'/'+(s?.episodes?.length||0)+' · '+(episode?.scenes?.length||0)+' ฉาก';
 }catch(_){return 'โปรเจกต์ปัจจุบัน'}
}
function say(message,error=false){
 if(!statusNode)return;
 statusNode.textContent=message||'';
 statusNode.dataset.error=String(!!error);
}
async function copyOrFile(content,label,name,mime='text/plain'){
 try{
  if(!navigator.clipboard?.writeText)throw Error('clipboard unavailable');
  await navigator.clipboard.writeText(content);
  say('คัดลอก'+label+'แล้ว · วางในแชต AI ภายนอกได้');
 }catch(_){
  root.dl(name,content,mime);
  say('เบราว์เซอร์ไม่อนุญาตให้คัดลอก จึงบันทึก'+label+'เป็นไฟล์ให้');
 }
}
function openImport(){
 const details=q('#aihImportDetails');
 if(details)details.open=true;
 const input=q('#imp');
 if(input){input.focus();input.scrollIntoView({block:'nearest',behavior:'smooth'})}
}
function buildHub(){
 if(hub)return;
 const workspace=q('#studioWorkspace'),body=q('#studioToolBody');
 if(!workspace||!body)return;
 summaryNode=el('p',{className:'aih-summary'},summary());
 statusNode=el('p',{className:'aih-status',role:'status','aria-live':'polite','data-error':'false'});
 hub=el('section',{id:'aiHub','aria-label':'นำเข้า JSON และจัดการด้วย AI'},
  el('div',{className:'aih-head'},
   el('div',{},el('h2',{},'สตูดิโอ AI'),summaryNode),
   el('span',{className:'aih-live'},'พรีวิวและงาน AI ในหน้าเดียว')),
  el('div',{className:'aih-actions'},
   el('button',{type:'button',className:'aih-primary',onclick:()=>q('#file')?.click()},'เปิดไฟล์ JSON'),
   el('button',{type:'button',onclick:openImport},'วาง JSON / ตรวจสอบ'),
   el('button',{type:'button',onclick:()=>root.StoryStudioBridge?.exportJSON?.()},'บันทึก JSON'),
   el('button',{type:'button',onclick:()=>copyOrFile(root.aiContext(),'บริบทงาน','story-studio-context.md','text/markdown')},'คัดลอกบริบท'),
   el('button',{type:'button',onclick:()=>copyOrFile(root.aiGuide(),'คู่มือ AI','story-studio-ai-guide.md','text/markdown')},'คู่มือให้ AI'),
   el('button',{type:'button',onclick:()=>{root.downloadAiPackage();say('สร้างแพ็กข้อมูลส่งให้ AI ภายนอกแล้ว')}},'แพ็กให้ AI')),
  el('details',{id:'aihImportDetails',className:'aih-import'},
   el('summary',{},'นำเข้า JSON จากผู้เขียนหรือ AI · ตรวจสอบก่อนใช้'),
   el('div',{id:'aihImportSlot'})),
  statusNode
 );
 workspace.insertBefore(hub,body);
}
function embedImport(){
 const dlg=q('#dlg'),slot=q('#aihImportSlot');
 if(!dlg||!slot||dlg.classList.contains('aih-embedded'))return;
 if(dlg.open){ignoreClose++;dlg.close()}
 const label=dlg.querySelector('label[for="mode"]'),mode=q('#mode'),smart=q('#smartImportWrap');
 adv=el('details',{className:'aih-advanced'},el('summary',{},'ตัวเลือกนำเข้าขั้นสูง'));
 for(const node of [label,mode,smart])if(node)adv.append(node);
 dlg.append(adv);
 dlg.classList.add('aih-embedded');
 slot.append(dlg);
 dlg.show();
}
function restoreImport(){
 const dlg=q('#dlg');
 if(!dlg?.classList.contains('aih-embedded'))return;
 if(dlg.open){ignoreClose++;dlg.close()}
 if(adv){
  const hint=q('#impHint');
  const nodes=[...adv.children].filter(node=>node.tagName!=='SUMMARY');
  if(hint)hint.before(...nodes);else dlg.prepend(...nodes);
  adv.remove();adv=null;
 }
 dlg.classList.remove('aih-embedded');
 doc.body.append(dlg);
}
function menuButton(label,fn,icon){
 return el('button',{type:'button',className:'menu-action wide',onclick:()=>{root.setMenuOpen(false);fn()}},
  el('span',{className:'mi','aria-hidden':'true'},icon),el('span',{className:'ml'},label));
}
function buildAiMenu(){
 const menu=q('#menu');
 if(!menu||!aiOn())return;
 menu.replaceChildren(
  el('div',{className:'menu-head'},el('div',{},el('strong',{},'สตูดิโอ AI'),el('small',{},'พรีวิว · JSON · สั่งงาน')),
   el('button',{type:'button',className:'menu-close',onclick:()=>root.setMenuOpen(false),'aria-label':'ปิดเมนู'},'×')),
  el('section',{className:'menu-group'},el('div',{className:'menu-grid'},
   menuButton('กลับพื้นที่สั่งงาน AI',()=>root.switchStudioTool('ai'),'✦'),
   menuButton('เปิดไฟล์ JSON',()=>q('#file')?.click(),'↥'),
   menuButton('วาง JSON / ตรวจสอบ',openImport,'⌁'),
   menuButton('ส่งออกวิดีโอ',()=>q('#videoQuick')?.click(),'▶'),
   menuButton('เปิดสตูดิโอตัดต่อเต็ม',()=>setMode('full'),'▦')))
 );
}
function augmentFullMenu(){
 const menu=q('#menu');
 if(!menu||aiOn())return;
 const group=[...menu.querySelectorAll('.menu-group')].find(n=>n.querySelector('h3')?.textContent==='ทำงานกับ AI');
 const grid=group?.querySelector('.menu-grid');
 if(grid&&!grid.querySelector('[data-ai-mode-entry]')){
  const entry=menuButton('เปิดสตูดิโอ AI พร้อมพรีวิว',()=>setMode('ai'),'✦');
  entry.dataset.aiModeEntry='1';grid.prepend(entry);
 }
}
root.renderTop=function(){
 origTop.apply(this,arguments);
 if(aiOn()){if(summaryNode)summaryNode.textContent=summary();buildAiMenu()}
 else augmentFullMenu();
};
root.switchStudioTool=function(id){
 if(!aiOn())return origSwitch.apply(this,arguments);
 return origSwitch.call(this,['ai','smart','audio','voices','record','export'].includes(id)?id:'ai');
};
function remember(mode){try{localStorage.setItem(KEY,mode)}catch(_){}}
function setMode(mode){
 remember(mode);
 if(mode==='ai'){
  html.classList.add('ai-only');
  html.dataset.aiPage='workspace';
  buildHub();embedImport();
  origSwitch.call(root,'ai');
 }else{
  restoreImport();
  html.classList.remove('ai-only');
  delete html.dataset.aiPage;
  origSwitch.call(root,'scene');
 }
 root.renderTop();
 requestAnimationFrame(()=>{root.fit();root.scrollTo(0,0)});
}
root.StoryAIMode=Object.freeze({set:setMode,page:()=>aiOn()?'workspace':'full',isAi:aiOn});
const dlg=q('#dlg');
if(dlg)dlg.addEventListener('close',()=>{
 if(ignoreClose){ignoreClose--;return}
 if(!aiOn()||!dlg.classList.contains('aih-embedded'))return;
 const input=q('#imp');
 if(input)input.value='';
 root.updateImportHint?.();
 dlg.show();
 say('นำเข้า JSON แล้ว · ตรวจพรีวิวและผลในพื้นที่ AI · ย้อนกลับได้ด้วยปุ่ม ↶');
});
buildHub();
if(aiOn()){
 html.dataset.aiPage='workspace';
 embedImport();
 origSwitch.call(root,'ai');
}
root.renderTop();
requestAnimationFrame(()=>{if(aiOn())root.fit()});
})(window);
