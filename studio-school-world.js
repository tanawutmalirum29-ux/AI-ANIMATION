/* Fictional Thai-school environments for Story Studio; panoramic scenery stays behind actors.
   Responsive frame geometry; deterministic for live preview and exported video. */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.StorySchoolWorld=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const TYPES=Object.freeze(['school-front','school-yard','school-hall','school-room','school-stairs','school-landing','school-roof']);
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number.isFinite(+v)?+v:a));
 const num=v=>(Math.round(v*100)/100).toString();
 // Coordinates are world units (height = 90), shared by drawing and contacts.
 // Door size stays physical when the video aspect changes.
 function layout(set,width=50.625){
  const W=clamp(width,20,400),kind=set?.worldArt;
  if(!TYPES.includes(kind))return null;
  return {width:W,kind,floor:78,depth:5,
   door:['school-room','school-landing','school-roof'].includes(kind)?{x:W*.95-11,y:47.5,w:11,h:30.5,floor:78}:null,
   stairs:kind==='school-stairs'?{start:81,rise:1.2,tread:W*.04,count:24}:null};
 }
 function surfaceAt(set,width,x,ground={}){
  const geometry=layout(set,width);if(!geometry)return null;
  if(geometry.stairs){const s=geometry.stairs;return s.start-clamp(Math.floor((x+1e-7)/s.tread),0,s.count)*s.rise;}
  return geometry.floor+clamp(ground.lane??.6,0,1)*geometry.depth;
 }
 function groundPlacement(set,width,actor,place,soles){
  if(actor.ground?.mode!=='surface'||!layout(set,width)||!soles.length||['jump','sleep','sit','typing'].includes(actor.pose))return null;
  const contacts=soles.map(p=>{const x=place.x+p.x*place.fc*place.k,y=surfaceAt(set,width,x,actor.ground);return {...p,x,y,root:y-p.y*place.k};});
  // Touch at least one actual sole point; no sole can penetrate its tread.
  const y=Math.min(...contacts.map(p=>p.root));
  return {y,contacts:contacts.map(p=>({...p,clearance:p.root-y})),support:contacts.filter(p=>p.root-y<.06)};
 }
 function doorState(scene,local){
  const keys=(scene?.schoolDoorKeys||[]).filter(k=>Number.isFinite(k?.t)&&Number.isFinite(k?.open)).slice().sort((a,b)=>a.t-b.t);
  if(!keys.length)return 0;
  if(local<=keys[0].t)return clamp(keys[0].open,0,1);
  for(let i=1;i<keys.length;i++)if(local<=keys[i].t){const u=clamp((local-keys[i-1].t)/Math.max(.001,keys[i].t-keys[i-1].t),0,1);return clamp(keys[i-1].open+(keys[i].open-keys[i-1].open)*u,0,1);}
  return clamp(keys.at(-1).open,0,1);
 }
 function doorHandle(set,scene,local,width=50.625){
  const d=layout(set,width)?.door;if(!d)return null;
  return {x:(d.x+d.w*(1-doorState(scene,local)*.79)-1.1)*100/width,y:(d.y+d.h*.59)/.9};
 }
 function render(set,layer,width,local=0,scene={}){
  if(layer!=='back'||!TYPES.includes(set?.worldArt))return '';
  if(typeof globalThis!=='undefined'&&globalThis.StoryMotion)local=globalThis.StoryMotion.clock(scene,local).time;
  const W=clamp(width,20,400), X=v=>num(W*v/100);
  const R=(x,y,w,h,c,rx=0,opacity=1)=>'<rect x="'+X(x)+'" y="'+num(y)+'" width="'+X(w)+'" height="'+num(h)+'" rx="'+num(rx)+'" fill="'+c+'" opacity="'+num(opacity)+'"/>';
  const L=(x,y,u,v,c,t=.7)=>'<line x1="'+X(x)+'" y1="'+num(y)+'" x2="'+X(u)+'" y2="'+num(v)+'" stroke="'+c+'" stroke-width="'+num(t)+'" stroke-linecap="round"/>';
  const P=(pts,c)=>'<polygon points="'+pts.map(p=>X(p[0])+','+num(p[1])).join(' ')+'" fill="'+c+'"/>';
  const E=(x,y,rx,ry,c)=>'<ellipse cx="'+X(x)+'" cy="'+num(y)+'" rx="'+X(rx)+'" ry="'+num(ry)+'" fill="'+c+'"/>';
  const geometry=layout(set,W),doorOpen=()=>doorState(scene,local);
  function door(d,open){
   const {x,y,w,h}=d,p=v=>v*100/W;
   const shut=1-open*.79;
   return '<g data-school-door="true" data-door-floor="'+d.floor+'" data-door-height="'+h+'">'+R(p(x-.65),y-.8,p(w+1.3),h+.8,'#d1c4a5',.4)+R(p(x),y,p(w),h,'#1c3037')+
     R(p(x+.3),y+.4,p(w*shut-.6),h-.7,'#46655c',.3)+
     R(p(x+.9),y+2,p(Math.max(.15,w*shut-1.8)),h*.33,'#66867a',.3,.8)+
     (shut>.31?E(p(x+w*shut-1.1),y+h*.59,p(.32),.42,'#e2c182'):'')+
     R(p(x-.8),d.floor,p(w+1.6),.35,'#a2aaa0')+'</g>';
  }
  const kind=set.worldArt;
  const id='school-depth-'+kind;
  let out='<defs><linearGradient id="'+id+'" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#182d40" stop-opacity="0"/><stop offset="1" stop-color="#182d40" stop-opacity=".3"/></linearGradient></defs>'+R(0,0,100,90,'#8ba7a1');
  if(kind==='school-front'){
   out+=R(0,0,100,26,'#a6c4be')+R(0,72,100,18,'#737d71')+
        R(2,22,96,54,'#aabeb0')+R(0,20,100,3,'#48635b')+
        R(4,39,92,2.2,'#627a6a')+R(4,57,92,2.2,'#627a6a');
   for(let floor=0;floor<3;floor++)for(let i=0;i<5;i++){
    const x=7+i*18.8,y=25+floor*17;
    out+=R(x,y,11.8,10.5,'#334b54',.5)+R(x+.8,y+.9,10,8.6,'#25404c',.2)+
      L(x+5.8,y+1,x+5.8,y+9,'#a9bfad',.5);
   }
   out+=R(34,68,32,12,'#7e8f82')+R(40,66,20,14,'#324a4c')+R(46,66,8,14,'#1e333c')+
        R(0,78,100,12,'#64756e');
   for(let x of [4,13,22,78,87,96])out+=R(x,65,1.7,16,'#4a615b');
   out+=R(0,65,34,1.6,'#68827a')+R(66,65,34,1.6,'#68827a')+R(32,79,36,3,'#c1bba5');
   out+=R(31,16,38,5,'#e3d6b9',.7)+L(36,18.4,64,18.4,'#5b6d62',.55);
   for(let x of [10,88])out+=R(x,69,1,10,'#695d4c')+E(x,65,7,7,'#52795c');
  }
  if(kind==='school-yard'){
   out+=R(0,0,100,34,'#a2beb6')+R(0,31,100,46,'#809a8e')+
        R(0,76,100,14,'#677d6c')+P([[39,71],[61,71],[91,90],[9,90]],'#a1a99e');
   for(const a of [0,74]){out+=R(a,28,26,48,'#acc2b2')+R(a,28,26,2,'#456660');
    for(let y of [34,50])for(let dx of [3,14])out+=R(a+dx,y,8,11,'#2f4854');
    out+=R(a+2,67,22,2,'#59746a');}
   out+=R(42,54,16,19,'#687f75')+R(45,56,10,16,'#2b4550')+
        R(10,68,2,12,'#6a6656')+E(11,57,11,13,'#3d7658')+
        R(87,67,2,13,'#6a6656')+E(88,55,10,12,'#456f58')+
        L(37,90,47,71,'#c9c6b3',.8)+L(63,90,53,71,'#c9c6b3',.8);
  }
  if(kind==='school-hall'){
   out+=R(0,0,100,19,'#a1b9ad')+R(0,19,100,51,'#a7bbae')+
       R(0,70,100,20,'#697e78')+P([[31,70],[69,70],[100,90],[0,90]],'#7b8981');
   for(let x of [5,75]){
    out+=R(x,25,20,40,'#d1ccae')+R(x+2,27,16,36,'#36585d')+
         R(x+3,28,14,34,'#284752')+L(x+10,28,x+10,62,'#9eb6ac',.55);
   }
   out+=R(38,35,24,36,'#65877e')+R(41,37,18,33,'#304f54')+
        R(47,56,6,14,'#233d43')+
        L(27,24,38,35,'#c0cbb8',.45)+L(73,24,62,35,'#c0cbb8',.45);
   for(let x of [13,32,68,87])out+=L(x,79,x*.76+12,90,'#8e9d94',.38);
   out+=R(36,13,28,1.3,'#e4e6cc',.35)+R(38,14.3,24,1,'#becfc2',.3,.45)+R(35,30,30,3,'#486e66',.3);
   for(let i=0;i<5;i++)out+=L(0,74+i*3.8,100,74+i*3.8,'#a4b4a7',.22);
  }
  if(kind==='school-room'){
   out+=R(0,0,100,16,'#9eb8aa')+R(0,16,100,61,'#bac5b5')+
        R(0,77,100,13,'#7b8279')+R(3,25,54,25,'#4d6557',.7)+
        R(5,27,50,21,'#29493f',.5)+R(4,49,52,1.6,'#ad9168');
   out+=R(58,21,13,31,'#e4d5ad')+R(60,23,9,27,'#779ba0')+
        L(64.5,23,64.5,50,'#d5d9c5',.45);
   for(const x of [12,54]){
    out+=R(x,68,24,2.7,'#a38a6a',.5)+R(x+2,71,1.7,8,'#6b6057')+
         R(x+20,71,1.7,8,'#6b6057');}
   out+=door(geometry.door,doorOpen());
   out+=R(8,54,18,6,'#d5cdab',.4)+L(10,56,23,56,'#879583',.35)+L(10,58,20,58,'#879583',.35);
   for(let x of [12,34,55])out+=L(x,79,x-12,90,'#5f6e65',.25);
  }
  if(kind==='school-stairs'){
   out+=R(0,0,100,90,'#253b48')+R(0,16,100,65,'#3d5359')+R(7,23,27,24,'#9baeb0')+R(9,25,23,20,'#647f8e')+
        L(20.5,25,20.5,45,'#c4cdbd',.7)+P([[0,81],[96,52.2],[100,52.2],[100,90],[0,90]],'#697d7e');
   for(let i=0;i<geometry.stairs.count;i++){
    const y=geometry.stairs.start-i*geometry.stairs.rise,x=i*4;
    out+=L(x,y,x+4,y,'#a8b4a8',.55)+L(x+4,y,x+4,y-1.2,'#3c5360',.5);
   }
   for(let x of [4,24,44,64,84])out+=L(x,80-x*.3,x,67-x*.3,'#8eaaa6',.7);
   out+=L(0,67,96,38.2,'#c9c7ad',1.1)+R(75,20,23,32,'#1c303e')+R(72,17,28,3,'#697e7d');
  }
  if(kind==='school-landing'){
   out+=R(0,0,100,18,'#556e76')+R(0,18,100,60,'#6d8788')+R(0,78,100,12,'#526b70')+
        R(10,25,26,29,'#c7cfb9')+R(12,27,22,25,'#7b99a1')+L(23,27,23,52,'#ccd5c7',.6)+
        R(77,40,17,3,'#6c8f77',.3)+L(82,41.5,89,41.5,'#e2dfc2',.5)+door(geometry.door,doorOpen());
   for(let x of [0,25,50,75])out+=L(x,81,x-15,90,'#879c98',.3);
  }
  if(kind==='school-roof'){
   out+=R(0,0,100,45,'#819daa')+R(0,45,100,15,'#6e8998')+E(21,16,27,4,'#adbfc0')+E(70,24,34,3,'#9fb5ba');
   for(let i=0;i<15;i++){
    const x=i*7.8,y=52-(i%4)*2.5;
    out+=R(x,y,5.4,13,'#243a4a');
   }
   out+=R(0,64,100,7,'#a2ada6')+R(0,70,100,20,'#687975')+
        R(0,64,100,1.6,'#c4c8b7');
   for(let x of [0,23,46,69,92])out+=L(x,75,x+8,90,'#7f8f87',.4);
   const d=geometry.door;
   out+=R((d.x-2)*100/W,d.y-4,(d.w+4)*100/W,d.h+4,'#778b87')+
        R((d.x-2.5)*100/W,d.y-4.8,(d.w+5)*100/W,1.2,'#a6b3a7')+door(d,doorOpen());
  }
  out+=R(0,0,100,90,'url(#'+id+')');
  // Story event is drawn as a crack on the existing corridor window, not a floating square.
  if(kind==='school-hall'&&Number.isFinite(scene?.worldEffects?.windowCrackAt)&&local>=scene.worldEffects.windowCrackAt){
   out+=L(87,29,90,37,'#d6e5de',.9)+L(90,37,84,43,'#d6e5de',.65)+
        L(84,43,91,55,'#d6e5de',.65)+L(84,43,80,53,'#d6e5de',.55);
  }
  return out;
 }
 return Object.freeze({TYPES,render,doorState,doorHandle,layout,surfaceAt,groundPlacement});
});
