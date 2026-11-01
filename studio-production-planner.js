/* Read-only, idempotent scene production plans. Strictly local rules, not a trained model. */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.StoryProductionPlanner=api;})(typeof window!=='undefined'?window:null,function(root){
'use strict';
const stages=Object.freeze([
 {id:'composition',name:'AI-1 วางองค์ประกอบภาพ',mode:'กฎตรวจตำแหน่ง'},
 {id:'assets',name:'AI-2 วาด SVG วัตถุ',mode:'แม่แบบเวกเตอร์'},
 {id:'motion',name:'AI-3 กำกับการเคลื่อนไหว',mode:'คีย์เฟรมพื้นฐาน'},
 {id:'voice',name:'AI-4 พากย์เสียง',mode:'Edge TTS'},
 {id:'timing',name:'AI-5 ตัดต่อเวลา',mode:'ความยาวเสียงจริง'},
 {id:'qa',name:'AI-6 ตรวจคุณภาพ',mode:'ตรวจ JSON ไม่ใช่ตรวจวิดีโอ'}
]);
const clone=x=>JSON.parse(JSON.stringify(x));
function eachScene(state,fn){(state?.episodes||[]).forEach((ep,ei)=>(ep.scenes||[]).forEach((sc,si)=>{if(sc&&typeof sc==='object')fn(sc,ei,si)}));}
function canEdit(sc){return !sc.image&&!sc.video&&sc.productionManualLock!==true;}
function composition(state){
 const ops=[],warnings=[],details=[];
 const ratio=String(state?.project?.aspect||'16:9').split(':').map(Number);
 const portrait=ratio.length===2&&ratio[0]>0&&ratio[1]>0&&ratio[0]<ratio[1];
 // Verified 720x1280 exports: 10-12% x spacing still produces intersecting
 // character silhouettes. Preserve room for their arms and their screen edges.
 const minGap=portrait?24:12,minPos=portrait?11:5,maxPos=portrait?89:95,maxShift=24;
 const movable=a=>a&&Number.isFinite(a.x)&&Number.isFinite(a.y)&&
   !a.at&&!a.to&&!a.route?.length&&!a.motionKeys?.length&&
   !a.depth&&!a.lockPosition&&!a.lockMotion;
 function bounds(a){
  let lo=Math.max(minPos,a.x-maxShift),hi=Math.min(maxPos,a.x+maxShift);
  // For a basic authored toX walk/run, translate BOTH endpoints equally:
  // changing the start alone would change speed, direction or travel distance.
  if(Number.isFinite(a.toX)){
   lo=Math.max(lo,a.x+(minPos-a.toX));
   hi=Math.min(hi,a.x+(maxPos-a.toX));
  }
  return [lo,hi];
 }
 eachScene(state,sc=>{
  if(!canEdit(sc)||!Array.isArray(sc.actors)||sc.actors.length<2)return;
  // Physical contact may be deliberate (embracing, steadying or handing over
  // a wrench). Don't force actor separation for such a scene.
  const intent=String(sc.voiceover||'')+' '+String(sc.imagePrompt||'');
  if((sc.interactions||[]).length||/กอด|จับมือ|ประคอง|พยุง|ช่วย.{0,12}ทรงตัว|ส่งประแจ|ยื่นประแจ|hug|handshake|embrace|steadies|offers? (?:her|him) a wrench/i.test(intent))return;
  const crossings=[];
  const acts=clone(sc.actors),before=JSON.stringify(acts);
  // Each actor is translated as a rigid unit (x and toX together), so authored
  // travel distance, speed and direction never change. Both the START and the
  // END of a basic toX walk must keep the portrait-safe gap.
  const ents=acts.map((a,i)=>{
   if(!Number.isFinite(a?.x)||!Number.isFinite(a?.y))return null;
   const x0=a.x,e0=Number.isFinite(a.toX)?a.toX:a.x,mv=movable(a);
   const lo=mv?Math.max(-maxShift,minPos-x0,minPos-e0):0,hi=mv?Math.min(maxShift,maxPos-x0,maxPos-e0):0;
   return {i,x0,e0,y:a.y,s:0,lo:Math.min(lo,0),hi:Math.max(hi,0)};
  }).filter(Boolean);
  const pos=(en,end)=>(end?en.e0:en.x0)+en.s;
  const startOk=en=>ents.every(o=>o===en||Math.abs(o.y-en.y)>=8||Math.abs(pos(o,false)-pos(en,false))>=minGap-.05);
  // Pass 1 (priority): starting positions. Pass 2: arrival positions of authored
  // toX travel; a move is rolled back if it would re-crowd any starting pair.
  for(const end of [false,true])
  for(let pass=0;pass<Math.max(1,ents.length*24);pass++){
   let changed=false;
   for(let p=0;p<ents.length;p++)for(let q=p+1;q<ents.length;q++){
    if(Math.abs(ents[p].y-ents[q].y)>=8)continue;
    const L=pos(ents[p],end)<=pos(ents[q],end)?ents[p]:ents[q],R=L===ents[p]?ents[q]:ents[p];
    const gap=pos(R,end)-pos(L,end);
    if(gap>=minGap-.05)continue;
    const need=minGap-gap,leftRoom=Math.max(0,L.s-L.lo),rightRoom=Math.max(0,R.hi-R.s);
    let ml=Math.min(leftRoom,need/2);const mr=Math.min(rightRoom,need-ml);
    ml+=Math.min(leftRoom-ml,need-ml-mr);
    if(ml+mr<.02)continue;
    const ls=L.s,rs=R.s;L.s-=ml;R.s+=mr;
    if(end&&!(startOk(L)&&startOk(R))){L.s=ls;R.s=rs;continue;}
    changed=true;
   }
   if(!changed)break;
  }
  for(const en of ents){
   const a=acts[en.i],original=sc.actors[en.i],shift=Math.round(en.s*100)/100;
   if(Math.abs(shift)<.01)continue;
   a.x=Math.round((original.x+shift)*100)/100;
   if(Number.isFinite(original.toX))a.toX=Math.round((original.toX+shift)*100)/100;
  }
  const remaining=[];
  for(let p=0;p<ents.length;p++)for(let q=p+1;q<ents.length;q++){
   const A=acts[ents[p].i],B=acts[ents[q].i];
   if(Math.abs(A.y-B.y)>=8)continue;
   const e=v=>Number.isFinite(v.toX)?v.toX:v.x;
   const gs=Math.abs(B.x-A.x),ge=Math.abs(e(B)-e(A));
   if(gs<minGap-.1||ge<minGap-.1)remaining.push([A,B]);
   else if((B.x-A.x)*(e(B)-e(A))<0)crossings.push((A.char||A.id)+'/'+(B.char||B.id));
  }
  if(remaining.length)warnings.push(sc.id+': ยังมีตัวละครเริ่มหรือจบใกล้กัน '+
    remaining.length+' คู่: มีขอบจอ/ตำแหน่งล็อก/เส้นทางที่ต้องให้คนตรวจ');
  if(crossings.length)warnings.push(sc.id+': เส้นทางเดินตัดผ่านกัน ('+crossings.join(', ')+') ต้องให้คนตรวจ');
  if(JSON.stringify(acts)!==before){
   ops.push({op:'updateScene',id:sc.id,patch:{actors:acts}});
   details.push(sc.id+': ปรับตำแหน่งเริ่มต้นสำหรับจอ'+
    (portrait?'แนวตั้ง':'แนวนอน')+' โดยรักษาเส้นทางและข้อกำหนดที่ล็อก');
  }
 });
 return {ops,warnings,details};
}
function assets(state,assetAPI){
 const ops=[],warnings=[],details=[];
 if(!assetAPI?.events||!assetAPI?.item)return {ops,warnings:['โมดูลแม่แบบ SVG ไม่พร้อม'],details};
 eachScene(state,sc=>{
  const names=assetAPI.events(sc);if(!names.length)return;
  if(!canEdit(sc)){warnings.push(sc.id+': มีภาพ/วิดีโอเดิม ไม่วาดทับ');return;}
  const existing=Array.isArray(sc.customAssets)?sc.customAssets:[];
  const additions=clone(existing);let count=0;
  for(const kind of names){
   if(additions.some(x=>x?.eventKind===kind||x?.asset?.id==='auto-'+kind+'-v1'))continue;
   if(additions.length>=40){warnings.push(sc.id+': ถึงขีดจำกัด 40 วัตถุ');break;}
   additions.push(assetAPI.item(sc,kind));count++;details.push(sc.id+': สร้างร่าง '+assetAPI.templates[kind].name);
  }
  if(count)ops.push({op:'updateScene',id:sc.id,patch:{customAssets:additions}});
 });
 return {ops,warnings,details};
}
function motion(state,assetAPI){
 const ops=[],warnings=[],details=[];
 eachScene(state,sc=>{
  if(!canEdit(sc))return;
  const actors=Array.isArray(sc.actors)?sc.actors:[],updated=clone(actors);let count=0;
  for(const a of updated){
   if(a.lockMotion||a.motionKeys?.length||a.route?.length||a.at||a.to||
      Number.isFinite(a.toX)||Number.isFinite(a.toY))continue;
   if(!Number.isFinite(a.x)||!Number.isFinite(a.y)||!/^(walk|run)$/i.test(String(a.pose||'')))continue;
   const end=a.x<=70?a.x+12:a.x-12;
   a.motionKeys=[{t:0,x:a.x,y:a.y,pose:a.pose},{t:Math.min(60,Math.max(1,Number(sc.duration)||6)),x:end,y:a.y,pose:a.pose}];a.motionProducer='studio-production-v1';count++;
  }
  if(count){ops.push({op:'updateScene',id:sc.id,patch:{actors:updated}});details.push(sc.id+': สร้างเส้นเดิน/วิ่ง '+count+' คน');}
  if(assetAPI?.events?.(sc).length&&!((sc.customAssets||[]).length||(sc.props||[]).length))
    warnings.push(sc.id+': ยังไม่มีสินทรัพย์เหตุการณ์ให้ขยับ');
 });
 return {ops,warnings,details};
}
function plan(state,stage,assetAPI=root?.StoryProductionAssets){
 if(!Array.isArray(state?.episodes)||!state.episodes.length)throw Error('ต้องนำเข้าโปรเจกต์ JSON ก่อน');
 if(stage==='composition')return composition(state);
 if(stage==='assets')return assets(state,assetAPI);
 if(stage==='motion')return motion(state,assetAPI);
 throw Error('ไม่มีแผนสำหรับ '+stage);
}
return Object.freeze({stages,plan,canEdit});
});