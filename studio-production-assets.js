/* Bounded SVG production templates. No model execution or arbitrary SVG input. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.StoryProductionAssets=api;})(typeof window!=='undefined'?window:null,function(){
'use strict';
const R=(x,y,w,h,fill,rx=0)=>({type:'rect',x,y,w,h,fill,rx});
const C=(cx,cy,r,fill)=>({type:'circle',cx,cy,r,fill});
const L=(x1,y1,x2,y2,stroke,strokeWidth=2)=>({type:'line',x1,y1,x2,y2,stroke,strokeWidth});
const templates={
 bridge:{name:'สะพานไม้ (ภาพร่าง)',category:'architecture',x:50,y:75,scale:2.1,front:false,shapes:[R(0,38,100,12,'#6f513b',2),R(4,20,7,58,'#564339'),R(89,20,7,58,'#564339'),L(8,20,92,20,'#b7a083',5),L(8,34,92,34,'#b7a083',2)]},
 toolbox:{name:'กล่องเครื่องมือ (ภาพร่าง)',category:'prop',x:66,y:60,scale:.9,front:true,shapes:[R(18,34,64,43,'#ac473f',4),R(21,32,59,10,'#e16a50',3),R(40,22,20,11,'#59565b',3),R(46,34,8,10,'#f5d381',2)]},
 reflector:{name:'แผ่นสะท้อนแสง (ภาพร่าง)',category:'prop',x:65,y:60,scale:1.1,front:false,shapes:[C(50,45,32,'#d9e8ed'),C(50,45,26,'#91b2c1'),R(45,19,10,52,'#f7fbfb',3),L(50,77,50,97,'#626e73',8)]},
 belt:{name:'สายพาน (ภาพร่าง)',category:'prop',x:55,y:77,scale:.8,front:false,shapes:[R(6,38,88,18,'#6b5446',7),R(8,42,84,9,'#a38864',5),R(48,36,6,21,'#3f3834',1)]},
 beacon:{name:'แสงสามวาบ (ภาพร่าง)',category:'fx',x:60,y:40,scale:1.5,front:false,shapes:[C(50,45,46,'#f6dc80'),C(50,45,28,'#fff7b9'),C(50,45,12,'#ffffff')]},
 flood:{name:'น้ำที่ไหลบ่า (ภาพร่าง)',category:'nature',x:50,y:99,scale:2.1,front:true,shapes:[R(0,40,100,60,'#316c96'),L(0,42,32,44,'#a7d6e3',3),L(36,45,68,43,'#a7d6e3',3),L(71,42,100,44,'#a7d6e3',3)]}
};
const rules=[
 ['bridge',/สะพาน.{0,32}(?:ยุบ|พัง|ถล่ม)|(?:bridge|walkway).{0,40}collaps/i],
 ['toolbox',/กล่องเครื่องมือ.{0,40}(?:หลุด|ตก|หาย|จม|ร่วง)|(?:dropped|falling) toolbox/i],
 ['reflector',/(?:แผ่นสะท้อน|กระจกสะท้อน|reflector).{0,35}(?:หมุน|หัน|เคลื่อน|rotat|turn)/i],
 ['belt',/(?:สายพาน|belt).{0,35}(?:ขาด|หลุด|snap|break)/i],
 ['beacon',/(?:หนึ่งวาบ.{0,42}สองวาบ|สามวาบ|แสง.{0,20}สามครั้ง|three flashes)/i],
 ['flood',/น้ำ.{0,30}(?:ทะลัก|ท่วม|เอ่อ)|(?:flood|surge).{0,35}(?:market|street|village)/i]
];
function events(scene){const s=String(scene?.voiceover||'')+' '+String(scene?.imagePrompt||'');return rules.filter(r=>r[1].test(s)).map(r=>r[0]);}
function beats(kind,duration){
 const d=Math.max(1,Math.min(80,Number(duration)||7)),at=q=>Math.round(d*q*100)/100;
 if(kind==='bridge')return[{t:0,rotate:0,y:75},{t:at(.4),rotate:0,y:75},{t:at(.72),rotate:-16,y:84},{t:d,rotate:-24,y:92}];
 if(kind==='toolbox')return[{t:0,x:66,y:60,rotate:0},{t:at(.35),x:66,y:60},{t:at(.83),x:73,y:96,rotate:45},{t:d,x:76,y:100,rotate:65,opacity:0}];
 if(kind==='reflector')return[{t:0,rotate:-30},{t:at(.45),rotate:0},{t:d,rotate:65}];
 if(kind==='belt')return[{t:0,rotate:0},{t:at(.44),rotate:0},{t:at(.7),rotate:32},{t:d,rotate:60,opacity:.1}];
 if(kind==='beacon'){const k=[{t:0,opacity:0}];for(let i=0;i<3;i++)k.push({t:at(.16+i*.23),opacity:0},{t:at(.20+i*.23),opacity:1},{t:at(.25+i*.23),opacity:1},{t:at(.30+i*.23),opacity:0});k.push({t:d,opacity:0});return k;}
 if(kind==='flood')return[{t:0,y:99,opacity:.38},{t:at(.4),y:90,opacity:.5},{t:d,y:79,opacity:.65}];
 return [];
}
function item(scene,kind){const t=templates[kind];if(!t)return null;return {asset:{version:1,id:'auto-'+kind+'-v1',name:t.name,category:t.category,description:'Auto draft; inspect visuals before publishing.',shapes:t.shapes.map(s=>({...s}))},x:t.x,y:t.y,scale:t.scale,front:t.front,producer:'studio-production-v1',eventKind:kind,motionKeys:beats(kind,scene.duration)};}
return Object.freeze({templates,events,beats,item});
});