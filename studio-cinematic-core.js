/* Deterministic 2.5D scene evaluator. No network, trained-model or 3D claims.
 * World units and scene seconds are independent of screen pixels. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.StoryCinematic=api;})(typeof window!=='undefined'?window:globalThis,function(){
'use strict';
const SCHEMA='story-cinematic/1';
const KINDS=['building','tree','lamp','table','chair','book','phone','flashlight','door','window','fence'];
const POSES=['stand','walk','run','read','carry','phone','openDoor','point','sit','surprised','talk'];
const EASE=['linear','smooth','ease-in','ease-out'];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a+(b-a)*t;
const num=n=>Number.isFinite(n)?Math.round(n*1000)/1000:0;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const color=(s,f)=>/^#[\da-f]{6}$/i.test(s||'')?s:f;
function ease(t,kind){t=clamp(t,0,1);return kind==='linear'?t:kind==='ease-in'?t*t:kind==='ease-out'?1-(1-t)**2:t*t*(3-2*t);}
function at(keys,t){
 if(!keys?.length)return {};
 let a=keys[0],b=a;
 for(let i=1;i<keys.length;i++){b=keys[i];if(t<b.t)break;a=b;}
 if(t>=b.t||t<=keys[0].t)return {...(t<=keys[0].t?keys[0]:b)};
 const f=ease((t-a.t)/(b.t-a.t),a.easing||'linear'),out={...a};
 for(const k of Object.keys(b))if(k!=='t'&&typeof a[k]==='number'&&typeof b[k]==='number')out[k]=mix(a[k],b[k],f);
 return out;
}
function validate(p){
 const issues=[],add=(path,message)=>issues.push({severity:'error',path,message});
 if(!p||p.schema!==SCHEMA)return [{severity:'error',path:'schema',message:'ต้องใช้ '+SCHEMA}];
 const finite=(v,min,max,path)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)add(path,`ต้องเป็นตัวเลข ${min}–${max}`)};
 finite(p.duration,.1,180,'duration');
 const w=p.world||{};finite(w.width,900,20000,'world.width');finite(w.height,900,10000,'world.height');finite(w.groundY,0,w.height,'world.groundY');
 if(!['street','room','school','forest'].includes(w.environment))add('world.environment','ไม่รองรับสถานที่นี้');
 const keys=(ks,path,fields)=>{
  if(!Array.isArray(ks)||!ks.length||ks.length>240){add(path,'ต้องมีคีย์เฟรม 1–240 จุด');return;}
  let last=-1;
  ks.forEach((k,i)=>{if(!k||typeof k!=='object'){add(path+'.'+i,'คีย์เฟรมไม่ถูกต้อง');return;}
   finite(k.t,0,p.duration,path+'.'+i+'.t');if(k.t<=last)add(path+'.'+i+'.t','เวลาต้องเรียงและไม่ซ้ำ');last=k.t;
   for(const [f,min,max] of fields)finite(k[f],min,max,path+'.'+i+'.'+f);
   if(k.easing!==undefined&&!EASE.includes(k.easing))add(path+'.'+i+'.easing','easing ไม่รองรับ');
  });
  if(ks[0]?.t!==0)add(path,'ต้องเริ่มที่เวลา 0');
 };
 keys(p.camera?.keys,'camera.keys',[['x',0,w.width],['y',0,w.height],['zoom',.5,4],['roll',-25,25]]);
 if(p.camera?.mode&&!['path','follow'].includes(p.camera.mode))add('camera.mode','รองรับ path/follow เท่านั้น; ไม่ใช่ 3D orbit');
 if(p.camera?.shake!==undefined)finite(p.camera.shake,0,8,'camera.shake');
 const ids=new Set(),checkId=(id,path)=>{if(!/^[\w-]{1,64}$/.test(id||'')||ids.has(id))add(path,'id ต้องไม่ซ้ำ ใช้อักษรอังกฤษ ตัวเลข _ -');ids.add(id)};
 if(!Array.isArray(p.actors)||p.actors.length>12)add('actors','นักแสดงได้ไม่เกิน 12 คน');
 for(const [i,a] of (Array.isArray(p.actors)?p.actors:[]).entries()){
  if(!a){add('actors.'+i,'นักแสดงไม่ถูกต้อง');continue;}
  checkId(a.id,'actors.'+i+'.id');if(typeof a.char!=='string'||!a.char)add('actors.'+i+'.char','ต้องอ้างอิงตัวละครเดิม');
  finite(a.height,60,600,'actors.'+i+'.height');finite(a.z,-.3,8,'actors.'+i+'.z');finite(a.stride,30,400,'actors.'+i+'.stride');
  keys(a.keys,'actors.'+i+'.keys',[['x',0,w.width],['y',0,w.height]]);
  for(const k of Array.isArray(a.keys)?a.keys:[]){if(!POSES.includes(k?.pose))add('actors.'+i+'.pose','ท่าไม่รองรับ');if(!['front','side','back','threeQuarter','backThreeQuarter'].includes(k?.view))add('actors.'+i+'.view','มุมตัวละครไม่รองรับ');if(!['left','right'].includes(k?.facing))add('actors.'+i+'.facing','ทิศไม่รองรับ');}
 }
 if(!Array.isArray(p.objects)||p.objects.length>160)add('objects','วัตถุได้ไม่เกิน 160 ชิ้น');
 for(const [i,o] of (Array.isArray(p.objects)?p.objects:[]).entries()){
  if(!o){add('objects.'+i,'วัตถุไม่ถูกต้อง');continue;}
  checkId(o.id,'objects.'+i+'.id');if(!KINDS.includes(o.kind))add('objects.'+i+'.kind','ชนิด asset ไม่รองรับ ห้ามแทนด้วยชนิดอื่น');
  for(const [f,min,max] of [['x',0,w.width],['y',0,w.height],['z',-.3,8],['width',2,4000],['height',2,4000],['rotation',-180,180]])finite(o[f],min,max,'objects.'+i+'.'+f);
  finite(o.anchor?.x,0,1,'objects.'+i+'.anchor.x');finite(o.anchor?.y,0,1,'objects.'+i+'.anchor.y');
  if(o.keys)keys(o.keys,'objects.'+i+'.keys',[['x',0,w.width],['y',0,w.height],['rotation',-180,180]]);
 }
 const actors=new Set((Array.isArray(p.actors)?p.actors:[]).filter(Boolean).map(a=>a.id)),objects=new Map((Array.isArray(p.objects)?p.objects:[]).filter(Boolean).map(o=>[o.id,o]));
 if(p.camera?.mode==='follow'&&!actors.has(p.camera.follow))add('camera.follow','ไม่พบนักแสดงเป้าหมาย');
 if(p.interactions!==undefined&&(!Array.isArray(p.interactions)||p.interactions.length>100))add('interactions','เหตุการณ์ได้ไม่เกิน 100');
 const held=new Map();let last=-1;
 for(const [i,e] of (Array.isArray(p.interactions)?p.interactions:[]).entries()){
  const path='interactions.'+i;if(!e){add(path,'เหตุการณ์ไม่ถูกต้อง');continue;}
  finite(e.t,0,p.duration,path+'.t');finite(e.duration,.05,10,path+'.duration');if(e.t<last)add(path,'เรียงเหตุการณ์ตามเวลา');last=e.t;
  const o=objects.get(e.object);if(!o)add(path+'.object','ไม่พบวัตถุ');
  if(!['pickup','place','open'].includes(e.type))add(path+'.type','ชนิดเหตุการณ์ไม่รองรับ');
  if(e.type==='open'){if(!['door','book'].includes(o?.kind))add(path,'เปิดได้เฉพาะประตู/หนังสือ');finite(e.value,0,1,path+'.value');}
  else{
   if(!actors.has(e.actor))add(path+'.actor','ไม่พบนักแสดง');
   if(!['book','phone','flashlight'].includes(o?.kind))add(path,'วัตถุนี้ยังไม่รองรับการถือ');
   if(e.type==='pickup'){if(held.has(e.object))add(path,'วัตถุถูกถืออยู่แล้ว');if([...held.values()].includes(e.actor))add(path,'มือขวาถือวัตถุอื่นอยู่');held.set(e.object,e.actor);}
   if(e.type==='place'){if(held.get(e.object)!==e.actor)add(path,'ต้องหยิบก่อนวางด้วยคนเดิม');held.delete(e.object);finite(e.x,0,w.width,path+'.x');finite(e.y,0,w.height,path+'.y');}
  }
 }
 if(p.lighting?.keys)keys(p.lighting.keys,'lighting.keys',[['intensity',0,1],['fog',0,.7],['angle',-180,180]]);
 if(p.lighting?.preset&&!['night','dusk','day','flashlight'].includes(p.lighting.preset))add('lighting.preset','แสงไม่รองรับ');
 if(p.shots!==undefined&&(!Array.isArray(p.shots)||p.shots.length>60))add('shots','ช็อตได้ไม่เกิน 60');
 for(const [i,s] of (Array.isArray(p.shots)?p.shots:[]).entries()){finite(s?.start,0,p.duration,'shots.'+i+'.start');finite(s?.end,0,p.duration,'shots.'+i+'.end');if(s?.end<=s?.start)add('shots.'+i,'เวลาจบต้องมากกว่าเริ่ม');}
 return issues;
}
function assertPlan(p){const errors=validate(p);if(errors.length)throw Error(errors[0].path+': '+errors[0].message);return p;}
function pathDistance(keys,t){let d=0;for(let i=1;i<keys.length;i++){const a=keys[i-1],b=keys[i];if(t<=a.t)break;const f=ease((Math.min(t,b.t)-a.t)/(b.t-a.t),a.easing||'linear');d+=Math.hypot(b.x-a.x,b.y-a.y)*f;}return d;}
function actorState(a,t){const k=at(a.keys,t),distance=pathDistance(a.keys,t);const future=at(a.keys,Math.min(a.keys.at(-1).t,t+.01));const speed=Math.hypot(future.x-k.x,future.y-k.y)/.01;
 return {...a,...k,phase:['walk','run'].includes(k.pose)?distance/a.stride/(k.pose==='run'?2.1:1.25):t,stationary:speed<.1};}
function cameraAt(p,t,aspect){const c=at(p.camera.keys,t),vH=900,vW=vH*aspect;
 if(p.camera.mode==='follow'){const a=actorState(p.actors.find(a=>a.id===p.camera.follow),t);c.x=a.x;c.y=a.y-a.height*.65;}
 const shake=p.camera.shake||0;c.x+=shake*(Math.sin(t*17)+Math.sin(t*31)*.3);c.y+=shake*Math.cos(t*21)*.6;
 // Enclose the rotated viewport, then clamp to world bounds; no blank world edges.
 const r=c.roll*Math.PI/180,rx=(Math.abs(Math.cos(r))*vW+Math.abs(Math.sin(r))*vH)/2,ry=(Math.abs(Math.sin(r))*vW+Math.abs(Math.cos(r))*vH)/2;
 c.zoom=Math.max(c.zoom,rx*2/p.world.width,ry*2/p.world.height);
 c.x=clamp(c.x,rx/c.zoom,p.world.width-rx/c.zoom);c.y=clamp(c.y,ry/c.zoom,p.world.height-ry/c.zoom);
 return {...c,width:vW,height:vH};
}
function project(pt,c){const k=c.zoom/(1+(pt.z||0)),dx=(pt.x-c.x)*k,dy=(pt.y-c.y)*k,r=-c.roll*Math.PI/180;return {x:c.width/2+dx*Math.cos(r)-dy*Math.sin(r),y:c.height/2+dx*Math.sin(r)+dy*Math.cos(r),scale:k};}
/* Two-bone IK only for cinematic actors. Keeps limb lengths; unreachable targets report QA. */
function rigIK(points,reach){if(!reach||![reach.x,reach.y,reach.weight].every(Number.isFinite)||reach.weight<0||reach.weight>1)return points;const k=points.map(p=>p&&p.slice()),s=k[2],e=k[3],h=k[4];if(!s||!e||!h)return k;
 const target=[mix(h[0],reach.x,reach.weight),mix(h[1],reach.y,reach.weight)],l1=Math.hypot(e[0]-s[0],e[1]-s[1]),l2=Math.hypot(h[0]-e[0],h[1]-e[1]);
 const dx=target[0]-s[0],dy=target[1]-s[1],raw=Math.hypot(dx,dy),d=clamp(raw,Math.abs(l1-l2)+.001,l1+l2-.001),a=Math.atan2(dy,dx),b=Math.acos(clamp((l1*l1+d*d-l2*l2)/(2*l1*d),-1,1));
 k[3]=[s[0]+l1*Math.cos(a+b),s[1]+l1*Math.sin(a+b)];k[4]=[s[0]+d*Math.cos(a),s[1]+d*Math.sin(a)];return k;
}
function evaluate(p,t,aspect=9/16,figure){
 t=clamp(t,0,p.duration);const c=cameraAt(p,t,aspect),actors=p.actors.map(a=>actorState(a,t));
 const objects=p.objects.map(o=>({...o,...(o.keys?at(o.keys,t):{}),open:0,held:null}));
 const events=p.interactions||[];
 for(const e of events){if(e.t>t)continue;const o=objects.find(o=>o.id===e.object);if(e.type==='pickup')o.held=e.actor;if(e.type==='place'){o.held=null;o.x=e.x;o.y=e.y;}if(e.type==='open')o.open=mix(1-e.value,e.value,ease((t-e.t)/e.duration,'smooth'));}
 for(const a of actors){
  const sign=a.facing==='left'?-1:1,scale=a.height/50;
  let reach=null;
  // Reach the contact point before pick-up / put-down, with a smooth release.
  for(const e of events.filter(e=>e.actor===a.id&&e.type!=='open')){
   const o=objects.find(o=>o.id===e.object);
   if(t>=e.t-e.duration&&t<=e.t+.6){
    const original=p.objects.find(o=>o.id===e.object),x=e.type==='place'?e.x:original.x,y=e.type==='place'?e.y:original.y;
    const weight=t<=e.t?ease((t-e.t+e.duration)/e.duration,'smooth'):1-ease((t-e.t)/.6,'smooth');
    reach={x:(x-a.x)/scale/sign,y:(y-a.y)/scale,weight};
   }
  }
  a.heldKind=objects.find(o=>o.held===a.id)?.kind;
  const visual=figure?figure(a,reach):{svg:'',hand:[8,-25],bounds:{x:-12,y:-50,width:24,height:50}};
  a.visual=visual;a.hand={x:a.x+visual.hand[0]*scale*sign,y:a.y+visual.hand[1]*scale,z:a.z};a.screen=project(a,c);a.reach=reach;
 }
 for(const o of objects){if(o.held){const a=actors.find(a=>a.id===o.held);o.x=a.hand.x;o.y=a.hand.y;o.z=a.z-.001;o.facing=a.facing;}o.screen=project(o,c);}
 const lighting=at(p.lighting?.keys||[{t:0,intensity:.55,fog:.1,angle:-20}],t);
 return {t,camera:c,actors,objects,lighting};
}
const rect=(x,y,w,h,fill,rx=0)=>`<rect x="${num(x)}" y="${num(y)}" width="${num(Math.max(0,w))}" height="${num(Math.max(0,h))}" rx="${rx}" fill="${fill}"/>`;
function asset(o,t){const w=o.width,h=o.height,fill=color(o.color,'#586b7a');let b='';
 if(o.kind==='building'){
  b=rect(0,0,w,h,fill)+rect(-8,-8,w+16,12,'#253243');
  for(let y=30;y<h-30;y+=75)for(let x=18;x<w-25;x+=55)b+=rect(x,y,28,42,'#192c42',2)+rect(x+3,y+3,10,33,(Math.floor(x+y)%3===0?'#e2c783':'#5d7884'));
  b+=rect(w*.4,h-70,w*.2,70,'#182b37');
 }else if(o.kind==='tree'){b=rect(w*.45,h*.35,w*.1,h*.65,'#49413c')+`<g transform="rotate(${num(Math.sin(t*1.4+o.x)*1.4)} ${w/2} ${h*.6})" fill="${fill}"><ellipse cx="${w*.5}" cy="${h*.28}" rx="${w*.45}" ry="${h*.27}"/><ellipse cx="${w*.28}" cy="${h*.43}" rx="${w*.28}" ry="${h*.2}"/><ellipse cx="${w*.72}" cy="${h*.42}" rx="${w*.28}" ry="${h*.2}"/></g>`;
 }else if(o.kind==='lamp'){b=rect(w*.45,20,w*.12,h-20,'#4e5962')+rect(w*.2,8,w*.6,28,'#f1d9a2',6)+`<path d="M${w*.3} 28 L${-w} ${h} L${w*2} ${h} L${w*.7} 28Z" fill="#ffdb88" opacity=".09"/>`;
 }else if(o.kind==='table'){b=rect(0,0,w,15,'#ba8b61',4)+rect(10,15,12,h-15,'#705849')+rect(w-22,15,12,h-15,'#705849')+rect(10,20,w-20,16,'#926846');
 }else if(o.kind==='chair'){b=rect(0,0,w,12,fill,4)+rect(0,12,8,h-12,fill)+rect(w-8,12,8,h-12,fill)+rect(0,h*.55,w,10,fill)+rect(w*.3,5,5,h*.5,fill);
 }else if(o.kind==='book'){b=rect(0,-h/2,w,h,'#e7d5b3',3)+rect(0,-h/2,5,h,'#914e4c')+`<path d="M${w*.5} ${-h*.4}V${h*.4}" stroke="#aa9780"/>`+(o.open>.01?`<path d="M0 ${-h/2}L${num(-w*.6*o.open)} ${-h*.8}V${h*.3}L0 ${h/2}Z" fill="#9e5b57"/>`:'');
 }else if(o.kind==='phone'){b=rect(-w/2,-h,w,h,'#172432',5)+rect(-w/2+3,-h+5,w-6,h-12,'#82abb8',3);
 }else if(o.kind==='flashlight'){b=rect(0,-h/2,w,h,'#9ba8a5',3)+rect(w*.7,-h*.7,w*.3,h*1.4,'#e8d9ab',2);
 }else if(o.kind==='door'){b=rect(0,0,w,h,'#112332')+rect(0,0,w*(1-.85*o.open),h,fill)+rect(8,10,w*(1-.85*o.open)-16,h*.32,'#78918e',2)+`<circle cx="${num(w*(1-.85*o.open)*.85)}" cy="${h*.57}" r="4" fill="#e7bf78"/>`;
 }else if(o.kind==='window'){b=rect(0,0,w,h,'#bec4b0',3)+rect(6,6,w-12,h-12,'#3b6578')+rect(w/2-2,6,4,h-12,'#b1c4bb')+rect(6,h/2-2,w-12,4,'#b1c4bb');
 }else if(o.kind==='fence'){for(let x=0;x<w;x+=28)b+=rect(x,0,7,h,fill);b+=rect(0,h*.2,w,7,fill)+rect(0,h*.7,w,7,fill);}
 return b;
}
function render(p,t,aspect,figure){const f=evaluate(p,t,aspect,figure),{width:w,height:h}=f.camera;
 const night=p.lighting?.preset!=='day',sky=night?'#14243b':'#aac9d3',floor=night?'#263a43':'#77897d';
 let body=`<defs><linearGradient id="cine-sky" x2="0" y2="1"><stop stop-color="${sky}"/><stop offset="1" stop-color="${night?'#536274':'#d9c6a7'}"/></linearGradient><radialGradient id="cine-glow"><stop stop-color="#ffe9b6" stop-opacity=".5"/><stop offset="1" stop-color="#ffe9b6" stop-opacity="0"/></radialGradient></defs>`+rect(0,0,w,h,'url(#cine-sky)');
 const ground=project({x:f.camera.x,y:p.world.groundY,z:0},f.camera).y;
 if(p.world.environment==='room'||p.world.environment==='school')body+=rect(0,0,w,h,night?'#344d54':'#8eaaa0')+rect(0,Math.max(0,ground-15),w,h,'#526665');
 else body+=`<circle cx="${w*.8}" cy="${h*.17}" r="28" fill="#d9e3dc" opacity=".7"/>`+rect(0,Math.max(0,ground-20),w,h,floor);
 const layers=[...f.objects.map(o=>({kind:'object',v:o})),...f.actors.map(a=>({kind:'actor',v:a}))].sort((a,b)=>b.v.z-a.v.z||a.v.y-b.v.y);
 for(const {kind,v} of layers){const s=v.screen;
  if(kind==='actor'){
   const k=s.scale*v.height/50,sign=v.facing==='left'?-1:1;
   body+=`<g data-cine-id="${esc(v.id)}"><ellipse cx="${num(s.x)}" cy="${num(s.y+3)}" rx="${num(v.height*.23*s.scale)}" ry="${num(8*s.scale)}" fill="#07131f" opacity=".28"/><g transform="translate(${num(s.x)} ${num(s.y)}) rotate(${-f.camera.roll}) scale(${num(k*sign)} ${num(k)})">${v.visual.svg}</g></g>`;
  }else{
   body+=`<g data-cine-id="${esc(v.id)}" transform="translate(${num(s.x)} ${num(s.y)}) rotate(${num(v.rotation-f.camera.roll)}) scale(${num(s.scale*(v.facing==='left'?-1:1))} ${num(s.scale)}) translate(${num(-v.width*v.anchor.x)} ${num(-v.height*v.anchor.y)})">${asset(v,t)}</g>`;
   if(v.kind==='lamp')body+=`<ellipse cx="${num(s.x)}" cy="${num(s.y-v.height*s.scale)}" rx="${num(100*s.scale)}" ry="${num(95*s.scale)}" fill="url(#cine-glow)" opacity="${num(f.lighting.intensity)}"/>`;
   if(v.kind==='flashlight'&&v.held)body+=`<path d="M0 0L430 -100L430 100Z" transform="translate(${num(s.x+v.width*s.scale*(v.facing==='left'?-1:1))} ${num(s.y)}) rotate(${num((v.facing==='left'?180-f.lighting.angle:f.lighting.angle)-f.camera.roll)}) scale(${num(s.scale)})" fill="#ffecb0" opacity="${num(f.lighting.intensity*.18)}"/>`;
  }
 }
 if(night)body+=rect(0,0,w,h,`#0b1735` ).replace('/>',` opacity="${num((1-f.lighting.intensity)*.2)}"/>`);
 for(let i=0;i<3;i++)body+=`<ellipse cx="${num(w*(.2+i*.4)+Math.sin(t*.18+i)*w*.1)}" cy="${num(h*(.65+i*.08))}" rx="${num(w*.8)}" ry="${60+i*30}" fill="#c7d5db" opacity="${num(f.lighting.fog*(.16+i*.08))}"/>`;
 return {svg:`<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${num(w)} ${h}" preserveAspectRatio="xMidYMid meet">${body}</svg>`,frame:f};
}
function qa(p,aspect=9/16,figure){const issues=validate(p);if(issues.length)return issues;
 const report=(code,t,id,message,severity='warning')=>{if(!issues.some(i=>i.code===code&&i.element===id))issues.push({code,severity,time:num(t),element:id,message});};
 const times=new Set([0,p.duration,...p.camera.keys.map(k=>k.t),...(p.interactions||[]).flatMap(e=>[Math.max(0,e.t-.001),e.t,e.t+.1])]);
 for(let t=0;t<p.duration;t+=.25)times.add(t);
 for(const t of times){const f=evaluate(p,t,aspect,figure);for(const a of f.actors){
  const s=a.screen,head=s.y-a.height*s.scale;
  if(s.x<0||s.x>f.camera.width||s.y<0||head>900)report('subject-outside',t,a.id,'ตัวละครออกนอกกรอบ ตรวจว่าตั้งใจหรือไม่');
  if(s.y>780&&head<900&&head>700)report('subtitle-overlap',t,a.id,'ใบหน้าอาจอยู่ในพื้นที่คำบรรยายด้านล่าง');
  if(figure&&a.reach?.weight>.99){const sign=a.facing==='left'?-1:1,tx=a.x+a.reach.x*a.height/50*sign,ty=a.y+a.reach.y*a.height/50;if(Math.hypot(a.hand.x-tx,a.hand.y-ty)>8)report('unreachable-hand',t,a.id,'มือเอื้อมไม่ถึงจุดสัมผัส ต้องขยับคนหรือวัตถุ','error');}
 }
 for(const o of f.objects)if(o.held){const a=f.actors.find(a=>a.id===o.held);if(Math.hypot(o.x-a.hand.x,o.y-a.hand.y)>.1)report('floating-prop',t,o.id,'วัตถุไม่ติดมือ','error');}
 }
 if(Array.isArray(p.unknowns)&&p.unknowns.length)report('unresolved-directions',0,'prompt','ยังมีคำสั่ง '+p.unknowns.length+' รายการที่ไม่ได้แปลงเป็นเหตุการณ์ในแผน');
 if(p.source?.reviewed!==true)report('review-required',0,'plan','แผนยังไม่ผ่านการตรวจโดยผู้ใช้');
 return issues;
}
function review(p,verdict,note){if(!['accept','revise'].includes(verdict))throw Error('คำตัดสินไม่ถูกต้อง');return {schema:'cinematic-review/1',kind:'review-example',trained:false,verdict,note:String(note||'').slice(0,2000),plan:JSON.parse(JSON.stringify(p)),at:new Date().toISOString()};}
return Object.freeze({SCHEMA,KINDS,POSES,validate,assertPlan,at,ease,actorState,cameraAt,project,evaluate,render,rigIK,qa,review,esc,num});
});
