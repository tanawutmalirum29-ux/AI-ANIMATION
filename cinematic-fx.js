/* Story Studio — Cinematic Effects Engine 1.0
 * Time-driven Canvas2D effects. Same painter is used for Preview and Export.
 * Scene-local data: cinematicFx; visual layers remain deterministic at any playhead.
 */
(function(){
'use strict';
if(typeof S==='undefined'||typeof draw!=='function'||typeof filmSceneLight!=='function'||typeof STUDIO_CURRENT_TOOL==='undefined'||!document.getElementById('studioToolBody'))return;
const FIELDS=[['fog','หมอกหลายระยะ'],['light','ความแรงแสง'],['dust','ฝุ่น / ละออง'],['water','ระลอกน้ำ'],['parallax','พารัลแลกซ์'],['grade','ปรับโทนสี'],['shadow','เงาเคลื่อนไหว']];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number.isFinite(Number(v))?Number(v):a));
const mix=(a,b,f)=>a+(b-a)*f;
const presets={
 moon:{label:'แสงจันทร์',kind:'moon',tint:'#8db3ef',fog:.28,light:.5,dust:.12,water:.25,parallax:.5,grade:.24,shadow:.28},
 dawn:{label:'รุ่งเช้า',kind:'sun',tint:'#ffbb85',fog:.3,light:.8,dust:.2,water:.38,parallax:.65,grade:.42,shadow:.4},
 flashlight:{label:'ไฟฉายกลางคืน',kind:'flashlight',tint:'#f4e6b8',fog:.38,light:.88,dust:.4,water:.06,parallax:.28,grade:.1,shadow:.55},
 storm:{label:'พายุฝน',kind:'moon',tint:'#6b8ea8',fog:.7,light:.18,dust:.18,water:.64,parallax:.86,grade:.42,shadow:.75},
 lake:{label:'ริมน้ำ',kind:'sun',tint:'#ffe6b0',fog:.2,light:.64,dust:.16,water:.92,parallax:.52,grade:.24,shadow:.2},
 none:{label:'ปรับเอง',kind:'moon',tint:'#b6cced',fog:.0,light:.4,dust:.0,water:.0,parallax:.0,grade:.0,shadow:.0}
};
function initialScene(scene,name){
 const p=presets[name]||presets.moon,d=Math.max(.1,Number(scene.duration)||4);
 const frame={fog:p.fog,light:p.light,dust:p.dust,water:p.water,parallax:p.parallax,grade:p.grade,shadow:p.shadow};
 return {enabled:true,preset:name||'moon',kind:p.kind,tint:p.tint,blend:'source-over',
  lightX:68,lightY:27,lightAngle:80,lightWidth:29,waterline:73,fadeIn:0,fadeOut:0,
  start:0,end:d,easing:'smooth',keyframes:[{t:0,...frame},{t:d,...frame}]};
}
function cfg(scene){const f=scene&&scene.cinematicFx;return f&&typeof f==='object'?f:null}
function sameFx(a,b){const x=cfg(a),y=cfg(b);return !!(x&&y&&x.enabled&&y.enabled&&x.preset===y.preset&&x.kind===y.kind)}
function active(scene,local,mul){
 const f=cfg(scene);if(!f||!f.enabled)return null;
 const dur=Math.max(.1,Number(scene.duration)||4),start=clamp(f.start,0,dur),end=clamp(f.end??dur,start,dur);
 if(local<start||local>end)return null;
 const points=(Array.isArray(f.keyframes)?f.keyframes:[]).filter(k=>k&&Number.isFinite(Number(k.t))).sort((a,b)=>a.t-b.t);
 const fallback=presets[f.preset]||presets.moon,at={};
 const p=points.length?points:[{t:0,...fallback}];
 const here=p.findIndex(k=>local<=Number(k.t));let left,right,alpha;
 if(here<0){left=p.at(-1);right=left;alpha=0}
 else if(here===0){left=p[0];right=left;alpha=0}
 else{left=p[here-1];right=p[here];alpha=clamp((local-left.t)/Math.max(.001,right.t-left.t),0,1)}
 if(f.easing==='smooth')alpha=alpha*alpha*(3-2*alpha);
 for(const [key] of FIELDS){const a=clamp(left[key]??fallback[key]??0,0,1),b=clamp(right[key]??fallback[key]??0,0,1);at[key]=mix(a,b,alpha)}
 const sc=ep().scenes,ix=sc.indexOf(scene);
 const contIn=ix>0&&start<=.01&&sameFx(sc[ix-1],scene)&&clamp(cfg(sc[ix-1]).end??sc[ix-1].duration,0,sc[ix-1].duration)>=sc[ix-1].duration-.01;
 const contOut=ix>=0&&ix<sc.length-1&&end>=dur-.01&&sameFx(sc[ix+1],scene)&&clamp(cfg(sc[ix+1]).start,0,sc[ix+1].duration)<=.01;
 const fadeIn=contIn?0:clamp(f.fadeIn||0,0,dur),fadeOut=contOut?0:clamp(f.fadeOut||0,0,dur);
 at.gate=Math.min(1,fadeIn>0?(local-start)/fadeIn:1,fadeOut>0?(end-local)/fadeOut:1);
 at.gate=clamp(at.gate,0,1)*(mul===undefined?1:mul);
 return {fx:f,v:at};
}
function hexRGB(hex){
 const s=String(hex||'#b6cced').replace('#','');
 if(!/^[\da-f]{6}$/i.test(s))return [182,204,237];
 return [0,2,4].map(i=>parseInt(s.slice(i,i+2),16));
}
function rand(n){const x=Math.sin(n*127.1+66.47)*43758.5453;return x-Math.floor(x)}
function shift(scene,local,strength){
 const cam=scene.camera||{},p=clamp(local/Math.max(.1,scene.duration),0,1),kind=cam.type||'static';
 const dx=kind==='pan-left'||kind==='panorama'?-1:kind==='pan-right'?1:kind==='orbit'||kind==='follow'?.65:kind==='handheld'||kind==='shake'?.15:0;
 const dy=kind==='pan-up'||kind==='crane'?-1:kind==='pan-down'?1:kind==='tilt'?.4:0;
 const pan=kind==='panorama'?clamp((Number(cam.endX)||100)-(Number(cam.startX)||0),-100,100)/100:1;
 return {x:(p-.5)*2*dx*strength*pan,y:(p-.5)*2*dy*strength};
}
function layerOffsets(scene,local,w,h){
 const a=active(scene,local),zero={art:[0,0],set:[0,0],setf:[0,0]};
 if(!a||a.v.parallax<=.005)return zero;
 const m=shift(scene,local,a.v.parallax*a.v.gate);
 return {art:[-m.x*w*.022,-m.y*h*.012],set:[-m.x*w*.012,-m.y*h*.007],
  setf:[m.x*w*.032,m.y*h*.02]};
}
function paintCross(ctx,scene,local,w,h){
 const E=ep().scenes,ix=E.indexOf(scene);
 if(ix>0&&typeof sceneBlend==='function'){const b=sceneBlend(scene,local,ix,0);
  if(b&&cfg(b.prev)&&!sameFx(b.prev,scene))paint(ctx,b.prev,Math.max(0,b.prev.duration-.001),w,h,1-b.e)}
 return paint(ctx,scene,local,w,h)}
function sceneLocal(scene){
 const index=ep().scenes.indexOf(scene);
 return index>=0?clamp(T-starts()[index],0,scene.duration):Math.max(0,scene.duration||0);
}
window.STUDIO_CINEMATIC_PARALLAX=function(scene,layer,w,h){
 const item=layerOffsets(scene,sceneLocal(scene),w,h)[layer]||[0,0];
 return item.map(n=>Math.round(n*100)/100);
};
function applyLayerTransforms(scene,local){
 const offsets=layerOffsets(scene,local,100,100);
 for(const id of ['art','set','setf']){
  const el=document.getElementById(id);if(!el)continue;
  const [x,y]=offsets[id]||[0,0];
  // SVG layer dimensions match the world; percentages preserve viewport scaling.
  el.style.transform=(Math.abs(x)+Math.abs(y)>.001)?'translate('+x+'%,'+y+'%)':'none';
 }
}
function paint(ctx,scene,local,w,h,mul){
 const a=active(scene,local,mul);if(!a||a.v.gate<=0||w<2||h<2)return false;
 const clk=(typeof atmoClock==='function'&&ep().scenes.indexOf(scene)>=0)?atmoClock():local;
 const {fx:f,v}=a,g=v.gate,lightX=clamp(f.lightX??68,0,100)/100*w,lightY=clamp(f.lightY??27,0,100)/100*h,
 [cr,cg,cb]=hexRGB(f.tint);
 const kind=['moon','sun','flashlight','torch'].includes(f.kind)?f.kind:'moon';
 const cam=shift(scene,local,v.parallax),short=Math.min(w,h);
 ctx.save();if(f.blend==='screen'||f.blend==='lighter')ctx.globalCompositeOperation=f.blend;ctx.beginPath();ctx.rect(0,0,w,h);ctx.clip();
 // Color grading is a timed color-wash, not a per-pixel LUT; safe for mobile Canvas.
 if(v.grade>.001){
  const tint=ctx.createLinearGradient(0,0,0,h);
  tint.addColorStop(0,'rgba('+cr+','+cg+','+cb+','+(v.grade*g*.24)+')');
  tint.addColorStop(1,'rgba('+cr+','+cg+','+cb+','+(v.grade*g*.13)+')');
  ctx.fillStyle=tint;ctx.fillRect(0,0,w,h);
 }
 // Far, mid and near atmospheric planes use independent depth multipliers.
 if(v.fog>.001){
  const layers=[{h:.33,depth:.18,alpha:.13},{h:.64,depth:.55,alpha:.18},{h:.86,depth:1.0,alpha:.23}];
  for(let k=0;k<layers.length;k++){
   const layer=layers[k],py=h*layer.h,offset=(cam.x*layer.depth+Math.sin(clk*(.22+.11*k)+k)*.24)*w*.1;
   const gradient=ctx.createRadialGradient(w*.5+offset,py,short*.035,w*.5+offset,py,w*.88);
   gradient.addColorStop(0,'rgba(199,221,221,'+(v.fog*g*layer.alpha*1.7)+')');
   gradient.addColorStop(1,'rgba(175,209,219,0)');
   ctx.fillStyle=gradient;ctx.fillRect(0,py-h*.25,w,h*.55);
   for(let i=0;i<5;i++){
    const x=((rand(i+78*k)*1.5-.25)*w+offset+Math.sin(clk*.1+i)*short*.017),y=py+Math.sin(i*2.3+clk*.3)*short*.025;
    const fog=ctx.createRadialGradient(x,y,1,x,y,short*(.16+.09*(i%3)));
    fog.addColorStop(0,'rgba(193,221,225,'+(v.fog*g*layer.alpha*.5)+')');fog.addColorStop(1,'rgba(193,221,225,0)');
    ctx.fillStyle=fog;ctx.fillRect(x-short*.3,y-short*.23,short*.65,short*.46);
   }
  }
 }
 // Light source: radial moon/sun/torch glow or trapezoid flashlight cone.
 if(v.light>.001){
  const power=v.light*g,spread=kind==='flashlight'?w*.76:kind==='torch'?w*.42:w*.77;
  ctx.save();
  if(kind==='flashlight'){
   const angle=(Number(f.lightAngle??80))*Math.PI/180,half=clamp(f.lightWidth??29,5,85)*Math.PI/360;
   const len=Math.max(w,h)*1.5,dx=Math.cos(angle),dy=Math.sin(angle);
   const ex=lightX+dx*len,ey=lightY+dy*len;
   ctx.beginPath();ctx.moveTo(lightX,lightY);
   ctx.lineTo(lightX+Math.cos(angle-half)*len,lightY+Math.sin(angle-half)*len);
   ctx.lineTo(lightX+Math.cos(angle+half)*len,lightY+Math.sin(angle+half)*len);ctx.closePath();ctx.clip();
   const beam=ctx.createRadialGradient(lightX,lightY,short*.018,ex,ey,len);
   beam.addColorStop(0,'rgba(255,244,201,'+(power*.48)+')');
   beam.addColorStop(.75,'rgba(252,240,194,'+(power*.20)+')');beam.addColorStop(1,'rgba(249,229,172,0)');
   ctx.fillStyle=beam;ctx.fillRect(0,0,w,h);
  }else{
   const isSun=kind==='sun',radius=Math.max(short*.01,1);
   const glow=ctx.createRadialGradient(lightX,lightY,radius,lightX,lightY,spread);
   const hue=isSun?'255,188,116':kind==='torch'?'255,143,74':'176,208,255';
   glow.addColorStop(0,'rgba('+hue+','+(power*(isSun?.32:.27))+')');
   glow.addColorStop(.2,'rgba('+hue+','+(power*.19)+')');
   glow.addColorStop(1,'rgba('+hue+',0)');
   ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);
   ctx.beginPath();ctx.arc(lightX,lightY,Math.max(2,short*(isSun?.012:.008)),0,Math.PI*2);
   ctx.fillStyle='rgba(255,248,220,'+(power*.7)+')';ctx.shadowColor='#fff3d1';ctx.shadowBlur=short*.08;ctx.fill();
  }
  ctx.restore();
 }
 // Deterministic dust: absolute time, never frame-to-frame random.
 if(v.dust>.001){
  ctx.save();ctx.fillStyle=kind==='sun'?'#fff1cf':'#dcecff';
  const count=28;
  for(let i=0;i<count;i++){
   const depth=.3+rand(i*3+5)*.7;
   const px=((rand(i*17+2)*1.15+Math.sin(clk*(.16+depth*.3)+i)*.026-cam.x*depth*.035)%1.15)*w;
   const py=((rand(i*19+7)+(clk*(.015+depth*.018)))%1)*h;
   ctx.globalAlpha=v.dust*g*(.12+.32*rand(i*5+9));
   ctx.beginPath();ctx.arc(px,py,Math.max(.45,short*(.0008+.0014*depth)),0,Math.PI*2);ctx.fill();
  }ctx.restore();
 }
 // Water ripple and a distorted, time-driven vertical reflection.
 if(v.water>.001){
  const y=h*clamp(f.waterline??73,35,98)/100,power=v.water*g;
  ctx.save();ctx.beginPath();ctx.rect(0,y,w,h-y);ctx.clip();
  const sheen=ctx.createLinearGradient(0,y,0,h);
  sheen.addColorStop(0,'rgba(132,194,213,'+(power*.18)+')');sheen.addColorStop(1,'rgba(26,102,138,'+(power*.12)+')');
  ctx.fillStyle=sheen;ctx.fillRect(0,y,w,h-y);
  for(let i=0;i<20;i++){
   const yy=y+(i+.45)*(h-y)/21,drift=Math.sin(clk*1.9+i*.6)*short*.012,
    center=lightX+drift+cam.x*w*.035,s=short*(.065+rand(i+4)*.21);
   ctx.strokeStyle='rgba(190,231,245,'+(power*(.09+.24*rand(i*13+2)))+')';
   ctx.lineWidth=Math.max(.7,short*.0018);
   ctx.beginPath();ctx.moveTo(center-s/2,yy);ctx.quadraticCurveTo(center,yy+short*.005*Math.sin(clk+i),center+s/2,yy);ctx.stroke();
  }
  ctx.restore();
 }
 // Foreground silhouettes create a near parallax plane and subtle moving shadows.
 if(v.parallax>.001||v.shadow>.001){
  ctx.save();ctx.lineCap='round';
  for(let i=0;i<24;i++){
   const depth=.5+rand(i+99)*.5;
   const x=(rand(i*13+9)*1.16-.08)*w+cam.x*short*.09*depth;
   const length=short*(.06+.09*rand(i+12));
   const lean=Math.sin(clk*(.4+depth*.4)+i*.9)*short*.016;
   ctx.strokeStyle='rgba(15,39,42,'+(g*(v.parallax*.13+v.shadow*.16)*depth)+')';
   ctx.lineWidth=Math.max(.7,short*(.002+rand(i+13)*.003));
   ctx.beginPath();ctx.moveTo(x,h);ctx.quadraticCurveTo(x+lean*.7,h-length*.6,x+lean+short*.028*(rand(i+15)-.5),h-length);ctx.stroke();
  }
  if(v.shadow>.01){
   const Y=h*.78;
   ctx.fillStyle='rgba(7,21,32,'+(v.shadow*g*.16)+')';
   ctx.save();ctx.translate(w*.44+Math.sin(clk*.8)*short*.03,Y);ctx.rotate(Math.sin(clk*.4)*.1);
   ctx.beginPath();ctx.ellipse(0,0,w*.25,short*.032,0,0,Math.PI*2);ctx.fill();ctx.restore();
  }
  ctx.restore();
 }
 ctx.restore();return true;
}
const stage=document.getElementById('stage'),overlay=document.createElement('canvas');
overlay.id='cinematicFxCanvas';overlay.setAttribute('aria-hidden','true');
overlay.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;';
stage.append(overlay);
function preview(){
 const w=stage.clientWidth,h=stage.clientHeight,dpr=Math.min(2,window.devicePixelRatio||1);
 if(w<2||h<2)return;
 const cw=Math.max(1,Math.round(w*dpr)),ch=Math.max(1,Math.round(h*dpr));
 if(overlay.width!==cw)overlay.width=cw;if(overlay.height!==ch)overlay.height=ch;
 const ctx=overlay.getContext('2d');ctx.clearRect(0,0,cw,ch);
 const e=ep(),startsList=starts(),idx=Math.max(0,e.scenes.findIndex((s,i)=>T<startsList[i]+s.duration));
 const s=e.scenes[idx];if(!s)return;
 const loc=clamp(T-startsList[idx],0,s.duration);
 overlay.style.mixBlendMode=cfg(s)?.blend==='screen'?'screen':cfg(s)?.blend==='lighter'?'plus-lighter':'normal';
 applyLayerTransforms(s,loc);
 ctx.save();ctx.scale(dpr,dpr);paintCross(ctx,s,loc,w,h);ctx.restore();
}
const previousDraw=draw;
draw=function(){const result=previousDraw.apply(this,arguments);preview();return result};
const previousLight=filmSceneLight;
filmSceneLight=function(ctx,scene,w,h,local){const r=previousLight.apply(this,arguments);paintCross(ctx,scene,local,w,h);return r};
const make=(tag,txt,attrs)=>{const node=document.createElement(tag);if(txt!==undefined)node.textContent=txt;
 if(attrs)for(const [k,v] of Object.entries(attrs)){if(k==='class')node.className=v;else node.setAttribute(k,String(v))}
 return node};
const editor=document.createElement('section');editor.id='cinematicFxEditor';editor.style.display='none';
document.getElementById('studioToolBody').append(editor);
const nav=document.getElementById('studioToolNav'),tab=make('button','เอฟเฟกต์ภาพ',{'type':'button','data-tool':'cinema'});
nav.insertBefore(tab,document.getElementById('workspaceJumpTop')||null);
const commitValue=fn=>commit(()=>{if(!cfg(sc()))sc().cinematicFx=initialScene(sc(),'moon');fn(sc().cinematicFx)});
function row(...children){const d=make('div',undefined,{'class':'cinema-row'});d.append(...children);return d}
function button(label,action){const b=make('button',label,{type:'button'});b.addEventListener('click',action);return b}
function label(txt,ctrl){const l=make('label');l.append(make('span',txt),ctrl);return l}
function select(labelText,options,value,onChange){
 const s=make('select');for(const [v,n] of options){const o=make('option',n,{value:v});o.selected=String(v)===String(value);s.append(o)}
 s.addEventListener('change',()=>onChange(s.value));return label(labelText,s);
}
function number(labelText,value,min,max,step,onChange){
 const el=make('input',undefined,{type:'number',min,max,step,value:String(value)});
 el.addEventListener('change',()=>onChange(clamp(el.value,min,max)));return label(labelText,el);
}
function range(labelText,value,onChange){
 const el=make('input',undefined,{type:'range',min:0,max:1,step:.01,value:String(value)}),out=make('output',Math.round(value*100)+'%');
 el.addEventListener('input',()=>out.textContent=Math.round(el.value*100)+'%');
 el.addEventListener('change',()=>onChange(clamp(el.value,0,1)));
 const l=label(labelText,el);l.append(out);return l;
}
function renderEditor(){
 if(STUDIO_CURRENT_TOOL!=='cinema')return;
 const scene=sc(),f=cfg(scene),frame=document.createDocumentFragment();
 frame.append(make('h3','Cinematic Effects · แสง หมอก พารัลแลกซ์ และน้ำ'));
 frame.append(make('p','เลือกเอฟเฟกต์ ตั้งเวลา และเพิ่มคีย์เฟรมที่ตำแหน่ง Playhead เอฟเฟกต์จะใช้ค่าเดียวกันทั้ง Preview และ Export',{'class':'cinema-help'}));
 const scenePick=make('select',undefined,{'aria-label':'เลือกฉากสำหรับเอฟเฟกต์'});
 ep().scenes.forEach((s,i)=>{const o=make('option','ฉาก '+(i+1)+' · '+(s.title||'ไม่มีชื่อ'),{value:i});o.selected=i===sel;scenePick.append(o)});
 scenePick.addEventListener('change',()=>{sel=+scenePick.value;T=starts()[sel];playing=false;render();renderEditor()});
 frame.append(row(scenePick));
 if(!f){
  frame.append(make('p','ฉากนี้ยังไม่มี Cinematic Effects เลือกสไตล์เพื่อเพิ่มระบบโดยไม่แก้ฉากเก่า',{'class':'cinema-help'}));
  frame.append(row(...Object.entries(presets).map(([v,o])=>button('+ '+o.label,()=>commit(()=>{sc().cinematicFx=initialScene(sc(),v)})))));
  editor.replaceChildren(frame);return;
 }
 const toggle=make('label',undefined,{'class':'cinema-check'}),check=make('input',undefined,{type:'checkbox'});
 check.checked=!!f.enabled;check.addEventListener('change',()=>commitValue(x=>x.enabled=check.checked));toggle.append(check,make('span','เปิดเอฟเฟกต์ฉากนี้'));frame.append(toggle);
 const duration=Math.max(.1,scene.duration),list=(f.keyframes||[]).slice().sort((a,b)=>a.t-b.t);
 const kIndex=clamp(Number(editor.dataset.selectedFrame||0),0,Math.max(0,list.length-1));
 const k=list[kIndex]||list[0],current=clamp(T-starts()[sel],0,duration);
 frame.append(row(select('รูปแบบแสง',[['moon','จันทร์'],['sun','อาทิตย์'],['flashlight','ไฟฉาย'],['torch','คบเพลิง']],f.kind,v=>commitValue(x=>x.kind=v)),
  select('โหมดผสมแสง',[['source-over','ปกติ'],['screen','Screen'],['lighter','Additive']],f.blend||'source-over',v=>commitValue(x=>x.blend=v))));
 frame.append(row(number('เริ่ม (วินาที)',f.start??0,0,duration,.1,v=>commitValue(x=>x.start=v)),
  number('จบ (วินาที)',f.end??duration,0,duration,.1,v=>commitValue(x=>x.end=v))));
 frame.append(row(number('Fade In (วินาที)',f.fadeIn||0,0,duration,.1,v=>commitValue(x=>x.fadeIn=v)),
  number('Fade Out (วินาที)',f.fadeOut||0,0,duration,.1,v=>commitValue(x=>x.fadeOut=v))));
 frame.append(row(number('ตำแหน่งแสง X%',f.lightX??68,0,100,1,v=>commitValue(x=>x.lightX=v)),
  number('ตำแหน่งแสง Y%',f.lightY??27,0,100,1,v=>commitValue(x=>x.lightY=v))));
 frame.append(row(number('ทิศไฟฉาย (องศา)',f.lightAngle??80,0,360,1,v=>commitValue(x=>x.lightAngle=v)),
  number('มุมกว้างไฟฉาย',f.lightWidth??29,5,85,1,v=>commitValue(x=>x.lightWidth=v)),
  number('ระดับผิวน้ำ Y%',f.waterline??73,35,98,1,v=>commitValue(x=>x.waterline=v))));
 const picker=make('input',undefined,{type:'color',value:/^#[0-9a-f]{6}$/i.test(f.tint)?f.tint:'#b6cced'});
 picker.addEventListener('change',()=>commitValue(x=>x.tint=picker.value));frame.append(row(label('สีแสง / โทนภาพ',picker),
 select('Interpolation',[['smooth','นุ่มนวล'],['linear','เส้นตรง']],f.easing||'smooth',v=>commitValue(x=>x.easing=v))));
 frame.append(make('h4','คีย์เฟรม · ค่าเอฟเฟกต์ตามเวลา'));
 const kChoose=make('select',undefined,{'aria-label':'เลือกคีย์เฟรม'});list.forEach((v,i)=>{const o=make('option','คีย์เฟรม '+(i+1)+' · '+Number(v.t).toFixed(2)+' วินาที',{value:i});o.selected=i===kIndex;kChoose.append(o)});
 kChoose.addEventListener('change',()=>{editor.dataset.selectedFrame=kChoose.value;renderEditor()});
 frame.append(row(kChoose));
 if(k){
  frame.append(make('p','ปรับค่าเฉพาะคีย์เฟรมที่เลือก ระบบจะคำนวณค่าระหว่างคีย์เฟรมให้เอง',{'class':'cinema-help'}));
  const grid=make('div',undefined,{'class':'cinema-slider-grid'});
  FIELDS.forEach(([key,title])=>grid.append(range(title,clamp(k[key]??0,0,1),v=>commitValue(x=>{
   const sorted=x.keyframes.slice().sort((a,b)=>a.t-b.t);sorted[kIndex][key]=v;
  }))));
  frame.append(grid);
 }
 frame.append(row(button('+ เพิ่มคีย์เฟรมที่เวลา Playhead ปัจจุบัน',()=>{
  const atTime=clamp(T-starts()[sel],0,sc().duration);
  commitValue(x=>{const values=active(scene,atTime)?.v||list.at(-1)||presets.moon;
   const key={t:atTime};FIELDS.forEach(([id])=>key[id]=clamp(values[id]??0,0,1));
   const duplicate=x.keyframes.find(k=>Math.abs(k.t-atTime)<.02);
   if(duplicate)Object.assign(duplicate,key);else x.keyframes.push(key);
   x.keyframes.sort((a,b)=>a.t-b.t);editor.dataset.selectedFrame=String(x.keyframes.findIndex(k=>k===duplicate||k===key));
  });
 }),button('▶ ดูที่ Playhead',()=>{playing=false;draw()})));
 frame.append(row(button('ลบคีย์เฟรมที่เลือก',()=>{
  if(list.length<=1)return;
  commitValue(x=>{const sorted=x.keyframes.slice().sort((a,b)=>a.t-b.t);const target=sorted[kIndex];
   x.keyframes.splice(x.keyframes.indexOf(target),1);editor.dataset.selectedFrame='0'});
 }),button('ล้างเอฟเฟกต์จากฉาก',()=>commit(()=>{delete scene.cinematicFx;editor.dataset.selectedFrame='0'}))));
 frame.append(make('p','Parallax ขยับเลเยอร์ฉาก SVG หลัง/หน้า และหมอกหลายชั้นตามกล้อง · ภาพฉากที่เป็นไฟล์แบนจะใช้ Parallax เฉพาะบรรยากาศ ไม่แยกวัตถุในภาพให้เอง',{'class':'cinema-help'}));
 editor.replaceChildren(frame);
}
const oldSwitch=switchStudioTool;
switchStudioTool=function(id){
 if(id!=='cinema'){oldSwitch.apply(this,arguments);editor.style.display='none';return}
 STUDIO_CURRENT_TOOL='cinema';document.body.classList.remove('m-ins','m-lib');
 for(const child of document.getElementById('studioToolBody').children)child.style.display=child===editor?'':'none';
 document.getElementById('studioToolTitle').textContent='Cinematic Effects · Keyframes, Atmosphere, Light & Water';
 for(const b of nav.querySelectorAll('button[data-tool]')){const yes=b.dataset.tool==='cinema';b.classList.toggle('on',yes);b.setAttribute('aria-current',yes?'page':'false')}
 renderEditor();if(innerWidth<=820)editor.scrollIntoView({block:'nearest',behavior:'smooth'});
};
tab.addEventListener('click',()=>switchStudioTool('cinema'));
const oldRender=render;
render=function(){const r=oldRender.apply(this,arguments);renderEditor();preview();return r};
new ResizeObserver(()=>preview()).observe(stage);
preview();
})();
