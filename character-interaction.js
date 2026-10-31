/* Story Studio v20 — Character Interaction & Scene Switching.
 * Pure timeline evaluation. SVG prop and rig hooks ensure preview/recorded frames match.
 * No network access, and all data is stored inside scene props/interactions.
 */
(function(){
'use strict';
if(typeof S==='undefined'||typeof commit!=='function'||typeof rigKeys!=='function'||!document.getElementById('stage'))return;
const clamp=(v,min,max)=>Math.max(min,Math.min(max,Number.isFinite(Number(v))?Number(v):min));
const TYPES={pickup:'หยิบและถือ',place:'วางสิ่งของ',door:'เปิด/ปิดประตู'};
const allowed=['lamp','crate','sign','plant','rock','star','cart','monitor','book','door'];
const duplicate=x=>JSON.parse(JSON.stringify(x));
function sceneOffset(scene){const i=ep().scenes.indexOf(scene);return i>=0?starts()[i]:0}
function localTime(scene){return clamp(T-sceneOffset(scene),0,scene.duration||4)}
function events(scene){return (Array.isArray(scene.interactions)?scene.interactions:[]).filter(e=>e&&TYPES[e.type]).slice().sort((a,b)=>Number(a.at)-Number(b.at))}
function stateAt(scene,index,loc){
 const prop=Array.isArray(scene.props)?scene.props[index]:null;if(!prop)return {hidden:false,x:null,y:null,scale:1};
 const v={hidden:false,actor:null,hand:'right',x:prop.x??50,y:prop.y??85,scale:1,kind:prop.kind,color:prop.color||'',size:prop.scale||1};
 const init=(scene.interactionInitialHold||[]).find(it=>it.propIndex===index);
 if(init){v.hidden=true;v.actor=init.actor;v.hand=init.hand||'right'}
 let opened=0;
 for(const e of events(scene)){
  if(Number(e.at)>loc+1e-5)break;if(Number(e.propIndex)!==index)continue;
  if(e.type==='pickup'){v.hidden=true;v.actor=e.actor;v.hand=e.hand||'right'}
  if(e.type==='place'){v.hidden=false;v.actor=null;v.x=clamp(e.x??v.x,0,100);v.y=clamp(e.y??v.y,0,100)}
  if(e.type==='door'){const t=clamp((loc-(+e.at))/(Math.max(.05,(+e.duration)||.7)),0,1);opened=Number(e.open??1)?t:1-t}
 }
 v.openScale=prop.kind==='door'?1-.78*opened:1;return v;
}
window.STUDIO_INTERACTION_PROP_STATE=function(scene,p,index){
 if(!p)return null;const v=stateAt(scene,index,localTime(scene));
 if(v.hidden)return null;
 return Object.assign({},p,{x:v.x,y:v.y,_openScale:v.openScale});
};
window.STUDIO_INTERACTION_HELD_SVG=function(character,actor,scene,local){
 const props=scene.props||[],wrist=rigKeys(character,actor,actor._phaseTime||local);let result='';
 props.forEach((p,i)=>{
  const v=stateAt(scene,i,local);
  if(!v.hidden||v.actor!==actor.char||typeof PROPS[p.kind]!=='function')return;
  const hand=v.hand==='left'?7:4,pt=wrist[hand];
  if(!pt)return;
  const size=clamp((p.scale||1)*.27,.08,.52),fill=p.color?colOK(p.color,''):'';
  const moveY=clamp(p.kind==='lamp'?-7:p.kind==='plant'?-3:0,-10,0);
  result+='<g data-held-prop="'+i+'" transform="translate('+f2(pt[0])+' '+f2(pt[1]+moveY)+') scale('+f2(size)+')">'+PROPS[p.kind](fill)+'</g>';
 });
 return result;
};
function activeHeld(scene){
 const at=Math.max(0,(Number(scene.duration)||4)-.001),output=[];
 (scene.props||[]).forEach((p,index)=>{const state=stateAt(scene,index,at);if(state.hidden&&state.actor&&p.kind){
  output.push({actor:state.actor,hand:state.hand,prop:{kind:p.kind,x:50,y:85,scale:p.scale||1,front:false,...(p.color?{color:p.color}:{})}});
 }});
 return output;
}
function goto(index){
 sel=clamp(index,0,ep().scenes.length-1);
 T=starts()[sel];playing=false;resetTransitionCache();render();
}
function continueAt(location,art){
 const src=sc(),end=activeHeld(src);
 commit(()=>{
  const s=followScene(src,true);
  s.interactions=[];s.props=[];
  s.interactionInitialHold=[];
  for(const v of end){
   const propIndex=s.props.push(v.prop)-1;
   s.interactionInitialHold.push({propIndex,actor:v.actor,hand:v.hand});
  }
  if(location&&location!=='same'){
   s.location=location;s.image=null;s.art='';
   s.light='';s.lighting={...newScene().lighting};s.atmosphere='none';
  }
  if(art&&art!=='none'){s.art=art;s.image=null;s.location=''}
  ep().scenes.splice(sel+1,0,s);sel+=1;playing=false;
 });
 resetTransitionCache();refreshBar();
}
function generateEvent(type,actor,propIndex,time){
 const e={id:'ci'+uid(),type,actor,propIndex,at:clamp(time,0,sc().duration),hand:'right'};
 if(type==='place'){e.x=50;e.y=85}
 if(type==='door'){e.duration=.7;e.open=1}
 return e;
}
function h(tag,attrs={},content){
 const n=document.createElement(tag);Object.entries(attrs).forEach(([k,v])=>{if(k==='class')n.className=v;else if(k==='value')n.value=v;else n.setAttribute(k,v)});
 if(content!==undefined)n.textContent=content;return n;
}
function btn(s,fn){const b=h('button',{type:'button'},s);b.addEventListener('click',fn);return b}
function field(label,node){const el=h('label');el.append(h('span',{},label),node);return el}
function choose(list,value,cb){
 const n=h('select');list.forEach(([k,t])=>{const o=h('option',{value:String(k)},t);if(String(k)===String(value))o.selected=true;n.append(o)});
 n.addEventListener('change',()=>cb(n.value));return n;
}
function numeric(value,min,max,step,cb){
 const n=h('input',{type:'number',min:String(min),max:String(max),step:String(step),value:String(value)});
 n.addEventListener('change',()=>cb(clamp(n.value,min,max)));return n;
}
function group(...elements){const div=h('div',{class:'interaction-row'});div.append(...elements);return div}
const top=h('div',{id:'sceneSwitchBar'});
const p=h('section',{id:'interactionEditor'});p.style.display='none';
document.getElementById('studioToolBody').append(p);
const nav=document.getElementById('studioToolNav');
const tab=btn('ตัวละคร / เปลี่ยนฉาก',()=>switchStudioTool('interaction'));tab.dataset.tool='interaction';
nav.insertBefore(tab,document.getElementById('workspaceJumpTop')||null);
document.getElementById('ctl').after(top);
function refreshBar(){
 const scene=ep().scenes[sel],t=localTime(scene);
 const chooser=choose(ep().scenes.map((s,i)=>[i,'ฉาก '+(i+1)+' · '+(s.subtitle?.[0]||S.locations.find(x=>x.id===s.location)?.name||s.art||'ฉากใหม่').slice(0,42)]),sel,v=>goto(Number(v)));
 chooser.setAttribute('aria-label','เลือกฉากที่ต้องการตัดต่อ');chooser.id='sceneSwitchSelect';
 top.replaceChildren(btn('◀',()=>goto(sel-1)),chooser,btn('▶',()=>goto(sel+1)),
   btn('＋ เปลี่ยนฉาก',()=>switchStudioTool('interaction')));
 top.dataset.scene=String(sel);top.dataset.count=String(ep().scenes.length);
}
function renderPanel(){
 if(STUDIO_CURRENT_TOOL!=='interaction')return;
 const scn=sc(),sceneIndex=sel,frame=document.createDocumentFragment(),actors=scn.actors||[];
 frame.append(h('h3',{},'เปลี่ยนฉากและจัดการการโต้ตอบ'));
 frame.append(h('p',{class:'interaction-note'},'สร้างฉากถัดไปได้โดยคงตัวละคร ท่ายืนสุดท้าย และสิ่งที่กำลังถือไว้ · การเปลี่ยนสถานที่จะแยกพื้นหลังออกจากฉากเดิม'));
 const locOptions=[['same','สถานที่เดิม'],...S.locations.map(l=>[l.id,l.name])];
 const target=choose(locOptions,'same',()=>{}),art=choose([['none','ไม่ใช้ภาพเวกเตอร์ใหม่'],...ART_OPTS.filter(v=>v[0])],'none',()=>{});
 frame.append(group(field('สถานที่ของฉากใหม่',target),field('ภาพเวกเตอร์ฉากใหม่ (ถ้ามี)',art)));
 frame.append(group(btn('＋ สร้างฉากถัดไปแบบต่อเนื่อง',()=>continueAt(target.value,art.value)),btn('▶ ดูฉากที่เลือก',()=>goto(sceneIndex))));
 frame.append(h('h4',{},'จัดการฉากปัจจุบัน'));
 const place=choose([['','ไม่มีสถานที่'],...S.locations.map(l=>[l.id,l.name])],scn.location||'',v=>commit(()=>{scn.location=v;scn.art='';scn.image=null;scn.video=null}));
 const artCurrent=choose([['','ไม่มี'],...ART_OPTS.filter(v=>v[0])],scn.art||'',v=>commit(()=>{scn.art=v;if(v){scn.image=null;scn.location=''}}));
 frame.append(group(field('เปลี่ยนสถานที่ฉากนี้',place),field('ฉากเวกเตอร์',artCurrent)));
 frame.append(h('p',{class:'interaction-note'},'การเลือกสถานที่/ภาพเวกเตอร์จะล้างภาพนิ่งหรือฉากประกอบประเภทที่ขัดกัน เพื่อให้ผลลัพธ์ที่เลือกแสดงทันที'));
 frame.append(h('h4',{},'หยิบ ถือ วาง และเปิดประตูตามเวลา'));
 if(!actors.length){frame.append(h('p',{class:'interaction-note'},'ต้องเพิ่มตัวละครในฉากก่อนจึงจะสร้างการโต้ตอบได้'));
 }else if(!scn.props?.length){frame.append(h('p',{class:'interaction-note'},'เพิ่มสิ่งของที่เมนู ฉาก → ของประกอบฉาก ก่อนสร้างการโต้ตอบ'));
 }else{
  const action=choose(Object.entries(TYPES),'pickup',()=>{});
  const person=choose(actors.map(a=>[a.char,S.characters.find(c=>c.id===a.char)?.name||a.char]),actors[0].char,()=>{});
  const prop=choose(scn.props.map((p,i)=>[i,(PROP_LABELS[p.kind]||p.kind)+' #'+(i+1)]),0,()=>{});
  const time=numeric(clamp(T-starts()[sel],0,scn.duration),0,scn.duration,.1,()=>{});
  const hand=choose([['right','ขวา'],['left','ซ้าย']],'right',()=>{});
  frame.append(group(field('ประเภทการกระทำ',action),field('ตัวละคร',person),field('สิ่งของ',prop)));
  frame.append(group(field('เวลาในฉาก (วินาที)',time),field('มือ',hand)));
  frame.append(group(btn('＋ เพิ่มการโต้ตอบ',()=>{
   const typ=action.value,idx=Number(prop.value),kind=scn.props[idx]?.kind;
   if(typ==='door'&&kind!=='door'){alert('เลือกพร็อพประตูก่อนใช้แอ็กชันเปิด/ปิด');return}
   const e={id:'ci'+uid(),type:typ,actor:person.value,propIndex:idx,at:clamp(time.value,0,scn.duration),hand:hand.value};
   if(typ==='place'){const a=actors.find(x=>x.char===e.actor);const cur=a?actorAtTime(a,scn,e.at,scn.duration):null;e.x=clamp(cur?.x??50,0,100);e.y=clamp(cur?.y??85,0,100)}
   if(typ==='door'){e.duration=.65;e.open=1}
   commit(()=>{scn.interactions??=[];scn.interactions.push(e)});
  })));
 }
 const list=events(scn);
 if(!list.length)frame.append(h('p',{class:'interaction-note'},'ยังไม่มีการโต้ตอบในฉากนี้'));
 list.forEach((e,i)=>{
  const prop=scn.props?.[e.propIndex],block=h('div',{class:'interaction-event'});
  block.append(h('strong',{},'จังหวะ '+(i+1)+' · '+(TYPES[e.type]||e.type)+' · '+Number(e.at).toFixed(2)+'s · '+(PROP_LABELS[prop?.kind]||prop?.kind||'ไม่มีพร็อพ')));
  block.append(group(field('เวลา',numeric(e.at,0,scn.duration,.1,v=>commit(()=>e.at=v))),
    field('มือ',choose([['right','ขวา'],['left','ซ้าย']],e.hand||'right',v=>commit(()=>e.hand=v)))));
  if(e.type==='place')block.append(group(field('จุดวาง X%',numeric(e.x??50,0,100,1,v=>commit(()=>e.x=v))),field('จุดวาง Y%',numeric(e.y??85,0,100,1,v=>commit(()=>e.y=v)))));
  if(e.type==='door')block.append(group(field('ระยะเวลาเปิด',numeric(e.duration??.65,.05,10,.1,v=>commit(()=>e.duration=v))),
   field('สถานะ',choose([[1,'เปิด'],[0,'ปิด']],e.open??1,v=>commit(()=>e.open=Number(v))))));
  block.append(group(btn('▶ ดูจังหวะ',()=>{T=starts()[sel]+e.at;playing=false;draw()}),btn('ลบการกระทำ',()=>commit(()=>scn.interactions.splice(scn.interactions.indexOf(e),1)))));
  frame.append(block);
 });
 frame.append(h('p',{class:'interaction-note'},'แอนิเมชันหยิบ/ถือใช้จุดข้อมือของ Rig จริง ส่งออกไปกับ SVG และวิดีโอ ส่วนประตูใช้การย่อหน้าบานประตูแบบ 2D (ไม่ใช่ฟิสิกส์ 3D)'));
 p.replaceChildren(frame);
}
const oldSwitch=switchStudioTool;
switchStudioTool=function(id){
 if(id!=='interaction'){oldSwitch.apply(this,arguments);p.style.display='none';return}
 STUDIO_CURRENT_TOOL='interaction';document.body.classList.remove('m-ins','m-lib');
 [...document.getElementById('studioToolBody').children].forEach(n=>n.style.display=n===p?'':'none');
 document.getElementById('studioToolTitle').textContent='Character Interaction · เปลี่ยนฉาก';
 nav.querySelectorAll('button[data-tool]').forEach(n=>{const yes=n.dataset.tool==='interaction';n.classList.toggle('on',yes);n.setAttribute('aria-current',yes?'page':'false')});
 renderPanel();if(innerWidth<=820)p.scrollIntoView({block:'nearest',behavior:'smooth'});
};
const oldRender=render;
render=function(){const r=oldRender.apply(this,arguments);refreshBar();renderPanel();return r};
const oldDraw=draw;let lastScene=-1;
draw=function(){const r=oldDraw.apply(this,arguments);const i=ep().scenes.findIndex((s,j)=>T<starts()[j]+s.duration);
 if(!drawingPreviousFrame&&i>=0&&i!==lastScene){lastScene=i;refreshBar()}
 return r};
refreshBar();
})();
