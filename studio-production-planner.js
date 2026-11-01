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
 eachScene(state,sc=>{
  if(!canEdit(sc)||!Array.isArray(sc.actors)||sc.actors.length<2)return;
  if((sc.interactions||[]).length||/กอด|จับมือ|ประคอง|hug|handshake/i.test(String(sc.voiceover||'')+' '+String(sc.imagePrompt||'')))return;
  const acts=clone(sc.actors);let count=0;
  for(let i=0;i<acts.length;i++)for(let j=i+1;j<acts.length;j++){
   const a=acts[i],b=acts[j];
   // A short linear walk can be offset without modifying its travel distance.
   // Explicit routes, motion keys, anchors, physical interactions and locks win.
   const free=x=>Number.isFinite(x.x)&&Number.isFinite(x.y)&&
     !x.at&&!x.to&&!x.route?.length&&!x.motionKeys?.length&&!x.depth&&!x.lockPosition;
   if(!free(a)||!free(b)||Math.abs(a.x-b.x)>=10||Math.abs(a.y-b.y)>=8)continue;
   const prefer=b.x<a.x?a.x-12:a.x+12;
   const alternate=b.x<a.x?a.x+12:a.x-12;
   const good=nx=>nx>=5&&nx<=95&&(!Number.isFinite(b.toX)||
     b.toX+nx-b.x>=5&&b.toX+nx-b.x<=95);
   const nx=good(prefer)?prefer:good(alternate)?alternate:null;
   if(nx===null){warnings.push(sc.id+': ตำแหน่งชนกัน ต้องตรวจเอง');continue;}
   const delta=nx-b.x;
   if(Number.isFinite(b.toX))b.toX=Math.round((b.toX+delta)*100)/100;
   b.x=Math.round(nx*100)/100;count++;
  }
  if(count){ops.push({op:'updateScene',id:sc.id,patch:{actors:acts}});details.push(sc.id+': แยกตำแหน่ง '+count+' คู่');}
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
   a.motionKeys=[{t:0,x:a.x,y:a.y,pose:a.pose},{t:Math.min(60,Math.max(1,Number(sc.duration)||6)),x:end,y:a.y,pose:a.pose}];count++;
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