/* Fictional Thai-school environments for Story Studio; panoramic scenery stays behind actors.
   Responsive frame geometry; deterministic for live preview and exported video. */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.StorySchoolWorld=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const TYPES=Object.freeze(['school-front','school-yard','school-hall','school-room','school-stairs','school-roof']);
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number.isFinite(+v)?+v:a));
 const num=v=>(Math.round(v*100)/100).toString();
 function render(set,layer,width,local=0,scene={}){
  if(layer!=='back'||!TYPES.includes(set?.worldArt))return '';
  const W=clamp(width,20,400), X=v=>num(W*v/100);
  const R=(x,y,w,h,c,rx=0,opacity=1)=>'<rect x="'+X(x)+'" y="'+num(y)+'" width="'+X(w)+'" height="'+num(h)+'" rx="'+num(rx)+'" fill="'+c+'" opacity="'+num(opacity)+'"/>';
  const L=(x,y,u,v,c,t=.7)=>'<line x1="'+X(x)+'" y1="'+num(y)+'" x2="'+X(u)+'" y2="'+num(v)+'" stroke="'+c+'" stroke-width="'+num(t)+'" stroke-linecap="round"/>';
  const P=(pts,c)=>'<polygon points="'+pts.map(p=>X(p[0])+','+num(p[1])).join(' ')+'" fill="'+c+'"/>';
  const E=(x,y,rx,ry,c)=>'<ellipse cx="'+X(x)+'" cy="'+num(y)+'" rx="'+X(rx)+'" ry="'+num(ry)+'" fill="'+c+'"/>';
  const doorOpen=()=>{const keys=Array.isArray(scene.schoolDoorKeys)?scene.schoolDoorKeys:[];
   if(!keys.length)return 0;
   const ks=keys.filter(k=>Number.isFinite(k?.t)&&Number.isFinite(k?.open)).sort((a,b)=>a.t-b.t);
   if(!ks.length)return 0;
   const t=clamp(local,0,1000);
   if(t<=ks[0].t)return clamp(ks[0].open,0,1);
   for(let i=1;i<ks.length;i++)if(t<=ks[i].t){
    const u=clamp((t-ks[i-1].t)/Math.max(.001,ks[i].t-ks[i-1].t),0,1);
    return clamp(ks[i-1].open+(ks[i].open-ks[i-1].open)*u,0,1);
   }
   return clamp(ks[ks.length-1].open,0,1);
  };
  function door(x,y,w,h,open){
   const shut=1-open*.79;
   return R(x-1,y-2,w+2,h+3,'#d1c4a5',.45)+R(x,y,w,h,'#1c3037')+
     R(x+.7,y+.9,w*shut-1.1,h-1.7,'#46655c',.3)+
     R(x+1.8,y+3.5,w*shut-3,h*.35,'#66867a',.3,.8)+
     (shut>.31?E(x+w*shut-1.65,y+h*.59,.55,.63,'#e2c182'):'');
  }
  const kind=set.worldArt;
  let out=R(0,0,100,90,kind==='school-roof'?'#243d57':'#8ba7a1');
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
   out+=door(77,38,17,41,doorOpen());
  }
  if(kind==='school-stairs'){
   out+=R(0,0,100,19,'#839b96')+R(0,19,100,58,'#9baea7')+
        R(0,77,100,13,'#647a79')+
        R(37,21,27,23,'#ced8c8')+R(39,23,23,19,'#537681')+
        R(40,24,21,17,'#334e5d');
   for(let i=0;i<6;i++){
    const y=71-i*4.1,x=4+i*5.8;
    out+=R(x,y,36,3.8,i%2?'#657975':'#738780')+L(x,y+3.8,x+36,y+3.8,'#3d5559',.6);
   }
   out+=L(4,77,40,50,'#ddc9a1',1.1)+L(10,77,45,50,'#5e7271',.6)+
        R(51,58,41,18,'#83938c')+R(52,62,39,2.5,'#5c7374');
  }
  if(kind==='school-roof'){
   out+=R(0,0,100,45,'#243c53')+R(0,45,100,15,'#2d465a');
   for(let i=0;i<15;i++){
    const x=i*7.8,y=52-(i%4)*2.5;
    out+=R(x,y,5.4,13,'#243a4a');
   }
   out+=R(0,64,100,7,'#a2ada6')+R(0,70,100,20,'#687975')+
        R(0,64,100,1.6,'#c4c8b7');
   for(let x of [0,23,46,69,92])out+=L(x,75,x+8,90,'#7f8f87',.4);
   out+=door(72,34,19,45,doorOpen())+
        R(0,78,100,2,'#4f6666');
  }
  // Story event is drawn as a crack on the existing corridor window, not a floating square.
  if(kind==='school-hall'&&Number.isFinite(scene?.worldEffects?.windowCrackAt)&&local>=scene.worldEffects.windowCrackAt){
   out+=L(87,29,90,37,'#d6e5de',.9)+L(90,37,84,43,'#d6e5de',.65)+
        L(84,43,91,55,'#d6e5de',.65)+L(84,43,80,53,'#d6e5de',.55);
  }
  return out;
 }
 return Object.freeze({TYPES,render});
});