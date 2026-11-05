/* Reviewed scene templates and explicit timed directions, not a trained NLP model. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./studio-cinematic-core.js'):root.StoryCinematic);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.StoryCinematicPlanner=api;})(typeof window!=='undefined'?window:globalThis,function(C){
'use strict';
const NAMES={street:'A · ถนนกลางคืน / แพนและซูม',book:'B · เดิน หยิบ อ่าน วางหนังสือ',run:'C · วิ่งผ่านทางเดิน / กล้องติดตาม',forest:'D · ไฟฉาย / หมอกหลายระยะ',school:'E · อาคารเรียน / หน้าต่าง / ประตู'};
const key=(t,x,y,pose='stand',view='side',facing='right')=>({t,x,y,pose,view,facing,easing:'linear'});
const ck=(t,x,y,zoom=1,roll=0)=>({t,x,y,zoom,roll,easing:'smooth'});
const obj=(id,kind,x,y,z,width,height,color)=>({id,kind,x,y,z,width,height,rotation:0,anchor:{x:.5,y:1},...(color?{color}:{})});
function template(name,char='cine-student'){
 if(!NAMES[name])throw Error('เลือกฉากตัวอย่างก่อน');
 const p={schema:C.SCHEMA,title:NAMES[name],duration:12,world:{width:3600,height:1800,groundY:1150,environment:'street'},camera:{mode:'path',keys:[ck(0,850,850,.9),ck(6,1600,850,.9),ck(12,1650,950,1.5)]},actors:[{id:'lead',char,height:260,z:0,stride:160,keys:[key(0,1650,1150),key(12,1650,1150)]}],objects:[],interactions:[],lighting:{preset:'night',keys:[{t:0,intensity:.6,fog:.15,angle:-15},{t:12,intensity:.6,fog:.15,angle:-15}]},shots:[{start:0,end:6,label:'ภาพกว้างและแพน'},{start:6,end:12,label:'เข้าใกล้ตัวละคร'}],source:{kind:'reviewed-template',template:name,reviewed:false},unknowns:[]};
 if(name==='street'){
  for(let i=0;i<12;i++)p.objects.push(obj('far'+i,'building',i*300+120,1160,3,260,400+(i%3)*70,'#384d66'));
  for(let i=0;i<8;i++)p.objects.push(obj('block'+i,'building',i*450+180,1150,1,300,500,'#566878'));
  for(let i=0;i<6;i++)p.objects.push(obj('light'+i,'lamp',i*600+400,1150,0,80,480));
  p.objects.push(obj('front-tree','tree',1300,1300,-.25,160,650,'#243e3d'));
 }
 if(name==='book'){
  p.world.environment='room';p.world.groundY=1150;p.camera.keys=[ck(0,1020,945,1.2),ck(3,1070,990,1.4),ck(9,1070,990,1.4),ck(12,1070,945,1.2)];
  p.actors[0].keys=[key(0,850,1150,'walk'),key(3,1010,1150),key(4,1010,1150,'carry'),key(5,1010,1150,'read'),key(8,1010,1150,'read'),key(9,1010,1150,'carry'),key(10,1010,1150),key(12,1010,1150)];
  p.objects=[obj('table','table',1190,1150,0,300,130,'#ab805c'),obj('book','book',1060,1003,-.001,52,34),obj('window','window',1330,930,1,200,320),obj('door','door',650,1150,1,180,420)];
  const table=p.objects[0];table.anchor.y=1;const book=p.objects[1];book.anchor={x:0,y:0};
  p.interactions=[{type:'pickup',actor:'lead',object:'book',t:4,duration:1},{type:'open',object:'book',t:5,duration:.6,value:1},{type:'open',object:'book',t:8,duration:.6,value:0},{type:'place',actor:'lead',object:'book',t:10,duration:1,x:1060,y:1003}];
  p.shots=[{start:0,end:3,label:'เดินเข้าหาโต๊ะ'},{start:3,end:5,label:'เอื้อมและหยิบ'},{start:5,end:9,label:'เปิดอ่านและปิดหนังสือ'},{start:9,end:12,label:'วางกลับบนโต๊ะ'}];
 }
 if(name==='run'){
  p.world.environment='school';p.world.width=5200;p.camera={mode:'follow',follow:'lead',keys:[ck(0,700,950,1.1),ck(12,4300,950,1.1)]};
  p.actors[0].stride=190;p.actors[0].keys=[key(0,700,1150,'run'),key(10,4000,1150,'stand'),key(12,4000,1150)];
  for(let i=0;i<8;i++){p.objects.push(obj('door'+i,'door',450+i*600,1150,.45,150,420),obj('window'+i,'window',720+i*600,1000,.45,220,200));}
  p.interactions=[{type:'open',object:'door5',t:7,duration:.45,value:1}];p.shots=[{start:0,end:10,label:'กล้องติดตามด้านข้าง'},{start:10,end:12,label:'หยุดและมองทางเดิน'}];
 }
 if(name==='forest'){
  p.world.environment='forest';p.camera.keys=[ck(0,1100,940,1),ck(12,1600,940,1.1)];
  p.actors[0].keys=[key(0,1100,1150,'walk'),key(10,1600,1150,'stand'),key(12,1600,1150)];
  for(let i=0;i<28;i++){const z=[2.5,1,.4][i%3];p.objects.push(obj('tree'+i,'tree',i*130,1150,z,200,500+(i%4)*80,['#364f56','#2d5251','#284a45'][i%3]));}
  p.objects.push(obj('near-tree','tree',850,1350,-.25,140,780,'#173d39'),obj('near-tree-right','tree',1980,1350,-.25,140,780,'#173d39'),obj('torch','flashlight',1150,1010,0,45,18));p.objects.at(-1).anchor={x:0,y:0};
  p.interactions=[{type:'pickup',actor:'lead',object:'torch',t:0,duration:.1}];
  p.lighting={preset:'flashlight',keys:[{t:0,intensity:.9,fog:.4,angle:-15},{t:6,intensity:.9,fog:.5,angle:-25},{t:12,intensity:.9,fog:.4,angle:-10}]};p.shots=[{start:0,end:12,label:'เดินถือไฟฉายผ่านต้นไม้และหมอก'}];
 }
 if(name==='school'){
  p.world.environment='school';p.actors[0].height=200;p.actors[0].keys=[key(0,1710,830,'stand','front'),key(8,1710,830,'stand','front'),key(10,1710,830,'surprised','backThreeQuarter'),key(12,1710,830,'stand','back')];
  p.camera.keys=[ck(0,1600,790,.65),ck(4,1680,780,1),ck(8,1710,710,2.2),ck(12,1790,740,1.7)];
  p.objects=[obj('school','building',1700,1150,0,1100,850,'#4b696a'),obj('window','window',1690,850,-.01,280,300),obj('door','door',1900,850,-.02,150,290),obj('front-tree','tree',1300,1350,-.25,220,900,'#243f3c')];
  p.actors[0].z=-.03;p.interactions=[{type:'open',object:'door',t:9,duration:2,value:1}];
  p.lighting.keys=[{t:0,intensity:.55,fog:.15,angle:-20},{t:6,intensity:.55,fog:.15,angle:-20},{t:6.15,intensity:.2,fog:.15,angle:-20},{t:6.3,intensity:.6,fog:.15,angle:-20},{t:12,intensity:.6,fog:.15,angle:-20}];
  p.shots=[{start:0,end:4,label:'ภาพกว้างอาคาร'},{start:4,end:8,label:'เคลื่อนเข้าหาหน้าต่าง'},{start:8,end:12,label:'หันกลับมองประตู'}];
 }
 return p;
}
/* Deliberately strict: these are timed directives, not arbitrary prose inference.
 * Unknown lines are returned verbatim for a human/teacher to resolve. */
function compile(text,base){
 const p=JSON.parse(JSON.stringify(base)),unresolved=[],applied=[];
 const lines=String(text).split(/\n/).map(s=>s.trim()).filter(Boolean);if(lines.length>100)throw Error('คำสั่งไม่เกิน 100 บรรทัด');
 for(const line of lines){
  const m=line.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?):\s*(กล้อง|ตัวละคร)\s+x=(\d+(?:\.\d+)?)\s+y=(\d+(?:\.\d+)?)(?:\s+(zoom|ท่า)=([\w.-]+))?$/);
  if(!m){unresolved.push(line);continue;}
  const [,start,end,kind,x,y,field,value]=m,a=+start,b=+end;
  if(!(b>a&&b<=p.duration)||(kind==='กล้อง'&&field==='ท่า')||(kind==='ตัวละคร'&&field==='zoom')){unresolved.push(line);continue;}
  const target=kind==='กล้อง'?p.camera:p.actors[0];if(!target){unresolved.push(line);continue;}
  const from=C.at(target.keys,a),to={...C.at(target.keys,b),t:b,x:+x,y:+y};
  if(field==='zoom')to.zoom=+value;if(field==='ท่า'){if(!C.POSES.includes(value)){unresolved.push(line);continue;}from.pose=value;to.pose=value;}
  target.keys=target.keys.filter(k=>k.t<a||k.t>b).concat({...from,t:a},to).sort((a,b)=>a.t-b.t);
  if(kind==='กล้อง')p.camera.mode='path';applied.push(line);
 }
 p.source={kind:'explicit-timed-directions',prompt:text,template:base.source?.template,reviewed:false};p.unknowns=unresolved;
 return {plan:p,applied,unresolved,issues:C.validate(p)};
}
function brief(prompt,p){return {task:'Create a reviewed cinematic scene blueprint using the supplied schema. Preserve character IDs. Do not invent uncertain video observations. Return JSON only.',prompt,capabilities:{renderer:'2.5D layered SVG',camera:['path','follow','zoom','roll','bounded shake'],unsupported:['true 3D orbit','automatic semantic video recognition','automatic speech generation without configured voice service'],objects:C.KINDS,poses:C.POSES},example:p,validation:'schema story-cinematic/1; seconds; world coordinates; ordered keys from t=0; explicit unresolved requirements in unknowns; source.reviewed=false'};}
return Object.freeze({NAMES,template,compile,brief});
});
