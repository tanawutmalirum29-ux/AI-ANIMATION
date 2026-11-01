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
  const acts=clone(sc.actors),before=JSON.stringify(acts);
  const sorted=acts.map((a,i)=>({i,a,x:a?.x,y:a?.y,move:movable(a)}))
   .filter(x=>Number.isFinite(x.x)&&Number.isFinite(x.y))
   .sort((a,b)=>a.x-b.x||a.i-b.i);
  const neighbors=(l,r)=>Math.abs(l.y-r.y)<8;
  // A bounded local projection, not a physics/semantic model. A movement
  // can be vetoed by author locks, custom motion keys, explicit routes,
  // screen margins, or manually chosen depth.
  for(let pass=0;pass<Math.max(1,sorted.length*24);pass++){
   let changed=false;
   for(let j=1;j<sorted.length;j++){
    const left=sorted[j-1],right=sorted[j];
    if(!neighbors(left,right))continue;
    const gap=right.x-left.x;
    if(gap>=minGap-.05)continue;
    const need=minGap-gap;
    const lb=left.move?bounds(left.a):[left.x,left.x];
    const rb=right.move?bounds(right.a):[right.x,right.x];
    const leftRoom=Math.max(0,left.x-lb[0]),rightRoom=Math.max(0,rb[1]-right.x);
    let moveLeft=Math.min(leftRoom,need/2);
    const moveRight=Math.min(rightRoom,need-moveLeft);
    moveLeft+=Math.min(leftRoom-moveLeft,need-moveLeft-moveRight);
    if(moveLeft+moveRight<.02)continue;
    left.x=Math.round((left.x-moveLeft)*10000)/10000;
    right.x=Math.round((right.x+moveRight)*10000)/10000;
    changed=true;
   }
   if(!changed)break;
  }
  for(const entry of sorted){
   const a=acts[entry.i],original=sc.actors[entry.i];
   const shift=Math.round((entry.x-original.x)*100)/100;
   if(Math.abs(shift)<.01)continue;
   a.x=Math.round((original.x+shift)*100)/100;
   if(Number.isFinite(original.toX))a.toX=Math.round((original.toX+shift)*100)/100;
  }
  const remaining=sorted.filter((r,j)=>j>0&&neighbors(sorted[j-1],r)&&
    r.x-sorted[j-1].x<minGap-.1);
  if(remaining.length)warnings.push(sc.id+': ยังมีตัวละครเริ่มใกล้กัน '+
    remaining.length+' คู่: มีขอบจอ/ตำแหน่งล็อก/เส้นทางที่ต้องให้คนตรวจ');
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