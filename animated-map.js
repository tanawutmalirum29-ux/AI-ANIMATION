/* Story Studio Director | Animated Map & Motion Graphics v1
   Pure Canvas rendering: same artwork in the stage preview and recorded export.
   Scene data remains in scene.animatedMap and is saved with the project JSON.
*/
(function(){
'use strict';
if (typeof S==='undefined' || typeof draw!=='function' || typeof drawGraphicCards!=='function' || !document.querySelector('#studioToolBody')) return;
const limit=(v,a,b)=>Math.max(a,Math.min(b,Number.isFinite(+v)?+v:a));
const defaultRoute=()=>[{x:12,y:82},{x:28,y:58},{x:54,y:66},{x:70,y:38},{x:88,y:17}];
function preset(theme){
 return {enabled:true,mode:'full',theme:theme||'field',title:'แผนที่เส้นทาง',start:0,end:Math.max(.1,Number(sc()?.duration)||6),timerSeconds:120,showTimer:true,marker:'route',points:defaultRoute(),startLabel:'เริ่ม',endLabel:'เป้าหมาย'};
}
function sceneMap(scene){return scene&&scene.animatedMap&&typeof scene.animatedMap==='object'?scene.animatedMap:null}
function normalizePoints(map){
 const list=Array.isArray(map.points)?map.points:defaultRoute();
 return list.slice(0,25).map(p=>({x:limit(p.x,0,100),y:limit(p.y,0,100)}));
}
function seconds(v){
 const n=Math.max(0,Math.ceil(v)),m=Math.floor(n/60);
 return String(m).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
}
function round(ctx,x,y,w,h,r){
 ctx.beginPath();
 if(typeof ctx.roundRect==='function')ctx.roundRect(x,y,w,h,r);
 else {ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath()}
}
function drawAnimatedMap(ctx,scene,local,w,h){
 const m=sceneMap(scene);
 if(!m||!m.enabled)return;
 const a=limit(m.start,0,Math.max(0,scene.duration)),b=limit(m.end??scene.duration,a+.001,Math.max(a+.001,scene.duration));
 if(local<a||local>b)return;
 const progress=limit((local-a)/Math.max(.001,b-a),0,1),inset=m.mode==='inset';
 const mw=inset?w*.43:w,mh=inset?h*.39:h,x0=inset?w-mw-w*.025:0,y0=inset?h*.07:0;
 const colors=m.theme==='night'?['#0e2632','#173c38','#285448','#2d5e7d','#d7f7c9']:m.theme==='city'?['#202e46','#34475d','#425c71','#1d6b90','#f8ddaa']:m.theme==='paper'?['#dfd6b7','#c7c89f','#b1c39b','#adc1be','#293d38']:['#112e31','#245346','#397254','#245e86','#ededa9'];
 const pts=normalizePoints(m);
 if(pts.length<2)return;
 ctx.save();ctx.translate(x0,y0);ctx.beginPath();ctx.rect(0,0,mw,mh);ctx.clip();
 ctx.fillStyle=colors[0];ctx.fillRect(0,0,mw,mh);
 const cw=mw/11,ch=mh/15;
 for(let row=0;row<15;row++)for(let col=0;col<11;col++){
  const isPond=(col*7+row*13)%29<3,shade=(col*9+row*11)%5;
  ctx.fillStyle=isPond?colors[3]:shade===0?colors[1]:colors[2];
  ctx.globalAlpha=isPond?.76:.27;ctx.fillRect(col*cw+1,row*ch+1,cw-2,ch-2);ctx.globalAlpha=1;
 }
 ctx.strokeStyle=m.theme==='paper'?'#60734d55':'#9bd9a42c';ctx.lineWidth=Math.max(.6,mw*.0015);
 for(let i=1;i<11;i++){ctx.beginPath();ctx.moveTo(i*cw,0);ctx.lineTo(i*cw,mh);ctx.stroke()}
 for(let i=1;i<15;i++){ctx.beginPath();ctx.moveTo(0,i*ch);ctx.lineTo(mw,i*ch);ctx.stroke()}
 for(let j=0;j<65;j++){
  const xx=((j*89+35)%983)/983*mw,yy=((j*157+71)%977)/977*mh;
  ctx.fillStyle=m.theme==='paper'?'#486d57':'#c5eeb0';ctx.globalAlpha=.17+(j%4)*.085;
  ctx.beginPath();ctx.arc(xx,yy,Math.max(.6,mw*.0035)*(1+j%2),0,Math.PI*2);ctx.fill();
 }
 ctx.globalAlpha=1;
 const mapx=p=>(.09+.82*p.x/100)*mw,mapy=p=>(.15+.72*p.y/100)*mh;
 const xy=pts.map(p=>[mapx(p),mapy(p)]);
 const lengths=[],sum=xy.slice(1).reduce((acc,p,i)=>{const q=xy[i],len=Math.hypot(p[0]-q[0],p[1]-q[1]);lengths.push(len);return acc+len},0);
 const lineWidth=Math.max(2,mw*.009);
 ctx.beginPath();ctx.moveTo(xy[0][0],xy[0][1]);xy.slice(1).forEach(p=>ctx.lineTo(p[0],p[1]));
 ctx.lineWidth=lineWidth;ctx.setLineDash([Math.max(3,mw*.016),Math.max(4,mw*.013)]);ctx.strokeStyle=m.theme==='paper'?'#50625699':'#e8f7e49c';ctx.stroke();ctx.setLineDash([]);
 let remaining=progress*sum,head=xy[0].slice();
 ctx.beginPath();ctx.moveTo(xy[0][0],xy[0][1]);
 for(let i=0;i<lengths.length;i++){
  const [ax,ay]=xy[i], [bx,by]=xy[i+1], seg=lengths[i];
  if(remaining>=seg){ctx.lineTo(bx,by);head=[bx,by];remaining-=seg}
  else{const f=seg?remaining/seg:0;head=[ax+(bx-ax)*f,ay+(by-ay)*f];ctx.lineTo(...head);break}
 }
 ctx.lineWidth=lineWidth*1.75;ctx.strokeStyle=m.theme==='paper'?'#d09c56':'#f3d68c';ctx.shadowColor=ctx.strokeStyle;ctx.shadowBlur=mw*.022;ctx.stroke();ctx.shadowBlur=0;
 for(const [idx,p] of [xy[0],xy[xy.length-1]].entries()){
  const r=Math.max(3.8,mw*.018);ctx.fillStyle=idx?'#f5d89a':'#b5edaa';ctx.beginPath();ctx.arc(p[0],p[1],r,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#102630';ctx.lineWidth=Math.max(1,mw*.004);ctx.stroke();
 }
 if(m.marker==='actor'&&Array.isArray(scene.actors)&&scene.actors.length&&typeof actorAtTime==='function'){
  try{const actor=actorAtTime(scene.actors[0],scene,local,scene.duration);if(Number.isFinite(actor.x)&&Number.isFinite(actor.y))head=[mapx(actor),mapy(actor)]}catch(_){}
 }
 ctx.beginPath();ctx.arc(head[0],head[1],Math.max(4,mw*.022),0,Math.PI*2);
 ctx.fillStyle='#ffe29b';ctx.shadowColor='#ffd47a';ctx.shadowBlur=mw*.038;ctx.fill();ctx.shadowBlur=0;
 ctx.beginPath();ctx.arc(head[0],head[1],Math.max(8,mw*.041),0,Math.PI*2);
 ctx.strokeStyle='#ffe29b99';ctx.lineWidth=Math.max(1,mw*.003);ctx.stroke();
 const f=Math.max(10,Math.min(40,mw*.047)),tiny=Math.max(9,f*.7);
 ctx.font='700 '+tiny+'px system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='bottom';
 ctx.fillStyle=colors[4];ctx.shadowColor='#0a151d';ctx.shadowBlur=4;
 ctx.fillText(String(m.startLabel||'เริ่ม').slice(0,22),xy[0][0],xy[0][1]-mw*.029,mw*.31);
 ctx.fillText(String(m.endLabel||'เป้าหมาย').slice(0,22),xy[xy.length-1][0],xy[xy.length-1][1]-mw*.031,mw*.34);
 ctx.shadowBlur=0;
 const title=String(m.title||'แผนที่เส้นทาง').slice(0,65);
 ctx.fillStyle=m.theme==='paper'?'#253f39':'#eaf3ed';ctx.textAlign='left';ctx.textBaseline='middle';ctx.font='700 '+f+'px system-ui, sans-serif';
 ctx.fillText(title,mw*.055,mh*.059,mw*.88);
 if(m.showTimer!==false){
  const t=seconds(limit(m.timerSeconds??120,0,7200)*(1-progress));
  const sw=Math.min(mw*.3,ctx.measureText(t).width+f*1.5),sx=mw-sw-mw*.04,sy=mh*.028;
  ctx.fillStyle=m.theme==='paper'?'#f7f2d6ed':'#0c1b2de8';round(ctx,sx,sy,sw,f*1.52,Math.max(4,f*.22));ctx.fill();
  ctx.fillStyle=m.theme==='paper'?'#233c38':'#fff6d9';ctx.font='800 '+f+'px system-ui,sans-serif';ctx.textAlign='center';ctx.fillText(t,sx+sw/2,sy+f*.76,sw-f*.35);
 }
 ctx.fillStyle=m.theme==='paper'?'#335649':'#e4f1df';ctx.globalAlpha=.55;round(ctx,mw*.055,mh*.94,mw*.89,Math.max(2,mh*.008),2);ctx.fill();
 ctx.globalAlpha=1;ctx.fillStyle='#f6d58f';round(ctx,mw*.055,mh*.94,mw*.89*progress,Math.max(2,mh*.008),2);ctx.fill();
 ctx.restore();
 if(inset){ctx.strokeStyle='#d9bd83';ctx.lineWidth=Math.max(1,w*.003);round(ctx,x0+.5,y0+.5,mw-1,mh-1,Math.max(3,w*.008));ctx.stroke()}
 ctx.restore();
}
let stageCanvas=document.getElementById('animatedMapCanvas');
if(!stageCanvas){
 stageCanvas=document.createElement('canvas');
 stageCanvas.id='animatedMapCanvas';stageCanvas.setAttribute('aria-hidden','true');
 stageCanvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:7;';
 document.getElementById('stage').appendChild(stageCanvas);
}
function paintPreview(){
 const stage=document.getElementById('stage'),w=stage.clientWidth,h=stage.clientHeight;
 if(!w||!h||!S||!S.episodes?.length)return;
 const dpr=Math.min(2,window.devicePixelRatio||1),cw=Math.round(w*dpr),ch=Math.round(h*dpr);
 if(stageCanvas.width!==cw)stageCanvas.width=cw;
 if(stageCanvas.height!==ch)stageCanvas.height=ch;
 const ctx=stageCanvas.getContext('2d');ctx.clearRect(0,0,cw,ch);ctx.save();ctx.scale(dpr,dpr);
 const E=ep(),times=starts();let i=E.scenes.findIndex((s,j)=>T<times[j]+s.duration);if(i<0)i=E.scenes.length-1;
 const scene=E.scenes[i];if(scene)drawAnimatedMap(ctx,scene,limit(T-times[i],0,scene.duration),w,h);
 ctx.restore();
}
const originalDraw=draw;draw=function(){originalDraw.apply(this,arguments);paintPreview()};
const originalGraphics=drawGraphicCards;drawGraphicCards=function(ctx,scene,loc,w,h){
 drawAnimatedMap(ctx,scene,loc,w,h);return originalGraphics.apply(this,arguments);
};
function renderEditor(){
 const root=document.getElementById('animatedMapEditor');if(!root||!S?.episodes?.length)return;
 const scene=sc(),m=sceneMap(scene),box=document.createElement('div');
 box.className='animated-map-editor';
 const add=(tag,attrs,txt)=>{const el=document.createElement(tag);if(attrs)for(const [key,val] of Object.entries(attrs)){if(key==='class')el.className=val;else if(key==='style')el.style.cssText=val;else el.setAttribute(key,String(val))}if(txt!==undefined)el.textContent=txt;return el};
 const button=(txt,fn)=>{const b=add('button',{type:'button'},txt);b.addEventListener('click',fn);return b};
 const para=(txt)=>add('p',{class:'animated-map-help'},txt);
 const group=(...nodes)=>{const g=add('div',{class:'animated-map-row'});nodes.forEach(n=>g.append(n));return g};
 const update=fn=>commit(()=>{let cfg=sceneMap(scene);if(!cfg){scene.animatedMap=preset();cfg=scene.animatedMap;}fn(cfg)});
 const field=(label,key,type='text',min=null,max=null)=>{
  const lab=add('label');lab.append(add('span',{},label));
  const input=add('input',{type,value:m?.[key]??'',...(type==='number'?{step:'0.1'}:{})});
  if(min!==null)input.min=min;if(max!==null)input.max=max;
  input.addEventListener('change',()=>update(cfg=>cfg[key]=type==='number'?limit(input.value,min??0,max??10000):input.value));
  lab.append(input);return lab;
 };
 const select=(label,key,opts)=>{
  const lab=add('label');lab.append(add('span',{},label));
  const input=add('select');opts.forEach(([value,text])=>{const op=add('option',{value},text);if(value===(m?.[key]||''))op.selected=true;input.append(op)});
  input.addEventListener('change',()=>update(cfg=>cfg[key]=input.value));lab.append(input);return lab;
 };
 box.append(add('h3',{},'แผนที่เคลื่อนไหว · เส้นทาง · ตัวจับเวลา'));
 box.append(para('แผนที่เป็นเวกเตอร์ Canvas เล่นตามเวลาในฉาก ปรับจุดบนเส้นทางได้ และบันทึกไปกับวิดีโอที่ส่งออก'));
 const picker=add('select',{'aria-label':'เลือกฉากสำหรับแผนที่'});
 ep().scenes.forEach((s,i)=>{const op=add('option',{value:i},'ฉาก '+(i+1)+' · '+(s.title||'ไม่มีชื่อ'));op.selected=i===sel;picker.append(op)});
 picker.addEventListener('change',()=>{sel=+picker.value;T=starts()[sel];playing=false;render();renderEditor()});
 box.append(group(picker));
 if(!m){
  box.append(para('ฉากนี้ยังไม่มีแผนที่ เลือกธีมเพื่อสร้างแผนที่ตัวอย่าง แล้วปรับจุดและเวลาได้ทันที'));
  box.append(group(...[['field','ทุ่งนา'],['night','กลางคืน'],['city','เมือง'],['paper','แผนที่กระดาษ']].map(([v,n])=>button('+ '+n,()=>commit(()=>scene.animatedMap=preset(v))))));
  root.replaceChildren(box);return;
 }
 const toggle=add('label',{class:'animated-map-check'});
 const cb=add('input',{type:'checkbox'});cb.checked=!!m.enabled;cb.addEventListener('change',()=>update(cfg=>cfg.enabled=cb.checked));
 toggle.append(cb,add('span',{},'เปิดแผนที่ในฉากนี้'));
 box.append(toggle);
 box.append(group(select('รูปแบบ','mode',[['full','เต็มเฟรม'],['inset','แผนที่มุมบนขวา']]),
  select('ธีม','theme',[['field','ทุ่งนา'],['night','คืนมืด'],['city','เมือง'],['paper','แผนที่กระดาษ']])));
 box.append(group(field('ชื่อแผนที่','title'),select('ตำแหน่งหมุด','marker',[['route','ตามเส้นทาง'],['actor','ตามตัวละครแรก']])));
 box.append(group(field('เริ่มแสดง (วินาที)','start','number',0,scene.duration),
  field('หยุดแสดง (วินาที)','end','number',0,scene.duration)));
 box.append(group(field('เวลาตั้งต้นนับถอยหลัง (วินาที)','timerSeconds','number',0,7200)));
 const timer=add('label',{class:'animated-map-check'}),tc=add('input',{type:'checkbox'});tc.checked=m.showTimer!==false;tc.addEventListener('change',()=>update(cfg=>cfg.showTimer=tc.checked));
 timer.append(tc,add('span',{},'แสดงเวลานับถอยหลัง'));box.append(timer);
 box.append(group(field('ชื่อจุดเริ่ม','startLabel'),field('ชื่อจุดหมาย','endLabel')));
 box.append(add('h4',{},'เส้นทาง · เรียงตามจุดที่ผ่าน'));
 const pts=normalizePoints(m);
 pts.forEach((p,i)=>{
  const row=add('div',{class:'animated-map-waypoint'});
  row.append(add('b',{},'จุด '+(i+1)));
  for(const key of ['x','y']){
   const lab=add('label');lab.append(add('span',{},key.toUpperCase()+' %'));
   const input=add('input',{type:'number',min:0,max:100,step:1,value:p[key]});
   input.addEventListener('change',()=>update(cfg=>{cfg.points=normalizePoints(cfg);cfg.points[i][key]=limit(input.value,0,100)}));lab.append(input);row.append(lab);
  }
  if(pts.length>2)row.append(button('ลบ',()=>update(cfg=>{cfg.points=normalizePoints(cfg);cfg.points.splice(i,1)})));
  box.append(row);
 });
 box.append(group(button('+ เพิ่มจุดทางผ่าน',()=>update(cfg=>{cfg.points=normalizePoints(cfg);if(cfg.points.length>=25)return;const last=cfg.points.at(-1);cfg.points.splice(cfg.points.length-1,0,{x:limit(last.x-12,0,100),y:limit(last.y+12,0,100)})})),
   button('▶ ดูครึ่งทาง',()=>{T=starts()[sel]+(limit(m.start,0,scene.duration)+limit(m.end,0,scene.duration))/2;playing=false;draw()})));
 box.append(group(button('รีเซ็ตเส้นทาง',()=>update(cfg=>cfg.points=defaultRoute())),
  button('ลบแผนที่ออกจากฉาก',()=>commit(()=>{delete scene.animatedMap}))));
 box.append(para('ตำแหน่ง X/Y เป็นเปอร์เซ็นต์ของแผนที่ (0–100) · ถ้าเลือกตามตัวละครแรก หมุดจะใช้ตำแหน่งจริงของตัวละครระหว่างเล่น'));
 root.replaceChildren(box);
}
const panel=document.createElement('section');panel.id='animatedMapEditor';panel.style.display='none';document.getElementById('studioToolBody').append(panel);
const nav=document.getElementById('studioToolNav');
const navButton=document.createElement('button');navButton.type='button';navButton.dataset.tool='map';navButton.textContent='แผนที่';navButton.addEventListener('click',()=>switchStudioTool('map'));
nav.insertBefore(navButton,document.getElementById('workspaceJumpTop')||null);
const originalSwitch=switchStudioTool;
switchStudioTool=function(id){
 if(id!=='map'){originalSwitch.apply(this,arguments);panel.style.display='none';return}
 STUDIO_CURRENT_TOOL='map';document.body.classList.remove('m-ins','m-lib');
 for(const element of document.getElementById('studioToolBody').children)element.style.display=element===panel?'':'none';
 document.getElementById('studioToolTitle').textContent='Animated Map · เส้นทาง จุดหมาย แผนที่ และตัวจับเวลา';
 for(const b of nav.querySelectorAll('button[data-tool]')){b.classList.toggle('on',b.dataset.tool===id);b.setAttribute('aria-current',b.dataset.tool===id?'page':'false')}
 renderEditor();
 if(innerWidth<=820)panel.scrollIntoView({block:'nearest',behavior:'smooth'});
};
const originalRender=render;
render=function(){originalRender.apply(this,arguments);if(STUDIO_CURRENT_TOOL==='map')renderEditor();paintPreview()};
new ResizeObserver(()=>paintPreview()).observe(document.getElementById('stage'));
paintPreview();
})();