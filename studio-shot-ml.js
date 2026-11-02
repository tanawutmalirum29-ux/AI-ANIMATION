/* Human-review shot-framing ML. No video, script, or actor identities in training rows.
 * Browser records explicit numeric feedback; only independently approved CPU
 * weights may suggest a safe camera edit after another user click.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.StoryShotML=api;})(typeof window!=='undefined'?window:null,function(){
'use strict';
const FEATURES=Object.freeze(['portrait','world','zoom','panDistance','targetOffset','gateOverlap','actorCount','moving','action','duration']);
const clamp=(n,a=0,b=1)=>Math.min(b,Math.max(a,n));
const round=n=>Math.round(clamp(n)*10000)/10000;
function subject(scene,kind){
 const fx=scene?.worldEffects||{};
 if(kind==='coastal-harbor'){
  if(fx.safeHill)return .885;
  if(fx.marketWarning||fx.evacuation)return .76;
  if(fx.marketFlood)return .825;
  if(fx.gateLeak)return .535;
  if(fx.waterRise)return .735;
  return .74;
 }
 const actor=Array.isArray(scene?.actors)?scene.actors.find(a=>Number.isFinite(a?.x)):null;
 return actor?clamp(actor.x/100):.5;
}
function featureVector(project,scene,location,camera=scene?.camera){
 if(!scene||!camera)throw Error('ไม่พบฉากหรือกล้อง');
 const kind=String(location?.set?.worldArt||'');
 if(kind!=='coastal-harbor')throw Error('ML รุ่นนี้รองรับการฝึกมุมกล้องท่าเรือก่อน ยังไม่รองรับฉากอื่น');
 const extent=clamp(Number(camera.world)||1,1,3.5);
 const start=clamp(Number(camera.startX)||0,0,100)/100;
 const end=clamp(camera.endX===undefined?100:Number(camera.endX),0,100)/100;
 const zoom=clamp(((Number(camera.from)||1)+(Number(camera.to)||1))/2,.7,2.5);
 const center=(.5/extent)+(extent-1)/extent*(start+end)/2;
 const viewport=1/(extent*zoom);
 const focus=subject(scene,kind);
 const gateWanted=!!scene.worldEffects?.gateLeak&&!scene.worldEffects?.marketWarning&&!scene.worldEffects?.marketFlood&&!scene.worldEffects?.safeHill;
 const lo=center-viewport/2,hi=center+viewport/2;
 const overlap=gateWanted?0:Math.max(0,Math.min(hi,.615)-Math.max(lo,.445))/viewport;
 const acts=Array.isArray(scene.actors)?scene.actors:[];
 return {portrait:/^\s*(9:16|3:4)\s*$/.test(project?.aspect||'')?1:0,
  world:round((extent-1)/2.5),zoom:round((zoom-.7)/1.8),
  panDistance:round(Math.abs(start-end)),
  targetOffset:round(Math.abs(focus-center)/Math.max(.02,viewport)),
  gateOverlap:round(overlap),actorCount:round(Math.min(8,acts.length)/8),
  moving:acts.some(a=>a?.toX!==undefined||a?.toY!==undefined||/walk|run/i.test(a?.pose||''))?1:0,
  action:['marketWarning','marketFlood','gateLeak','safeHill','waterRise'].some(k=>scene.worldEffects?.[k]===true)?1:0,
  duration:round((Number(scene.duration)||0)/65)};
}
function makeExample(project,scene,location,label,group){
 if(!['keep','reframe'].includes(label))throw Error('กรุณาประเมินมุมกล้องว่าดีแล้วหรือควรแก้');
 if(!/^[a-zA-Z0-9_-]{5,80}$/.test(String(group||'')))throw Error('รหัสโปรเจกต์ไม่ถูกต้อง');
 return {schema:1,task:'shot-framing',source:'human',approved:true,group,label,
  features:featureVector(project,scene,location)};
}
function modelUsable(model){
 if(model?.schema!==1||model?.task!=='shot-framing'||model?.active!==true||model?.status!=='approved'
 ||model?.training?.mode!=='approved'||!Array.isArray(model.features)
 ||model.features.join('|')!==FEATURES.join('|')||!Array.isArray(model.weights)
 ||model.weights.length!==FEATURES.length||model.weights.some(w=>!Number.isFinite(w))
 ||!Number.isFinite(model.bias))return false;
 const t=model.training;
 return Number.isInteger(t.examples)&&t.examples>=50&&Number.isInteger(t.holdoutExamples)&&t.holdoutExamples>=20&&
  Number.isFinite(t.model?.macroF1)&&t.model.macroF1>=.7&&
  Number.isFinite(t.baseline?.macroF1)&&t.model.macroF1>=t.baseline.macroF1+.02&&
  Number.isFinite(t.model?.accuracy)&&Number.isFinite(t.baseline?.accuracy)&&t.model.accuracy>=t.baseline.accuracy;
}
function predict(model,features){
 if(!modelUsable(model))throw Error('โมเดลยังไม่ผ่านการอนุมัติหรือข้อมูลทดสอบ');
 if(FEATURES.some(k=>typeof features[k]!=='number'||features[k]<0||features[k]>1))throw Error('คุณลักษณะฉากไม่ถูกต้อง');
 const z=model.weights.reduce((sum,w,i)=>sum+w*features[FEATURES[i]],model.bias);
 return Math.round(1/(1+Math.exp(-clamp(z,-35,35)))*10000)/10000;
}
function recommend(model,project,scene,location){
 if(scene?.productionManualLock||scene?.camera?.subjectLock||scene?.image||scene?.video||
    scene?.camera?.type!=='panorama')throw Error('มุมกล้องถูกล็อกหรือไม่รองรับการปรับอัตโนมัติ');
 const base=scene.camera,world=clamp(Number(base.world)||1,1,3.5);
 if(world<1.5)throw Error('ต้องใช้กล้อง panorama และแมปกว้างอย่างน้อย 1.5');
 const current=predict(model,featureVector(project,scene,location));
 const goal=subject(scene,String(location?.set?.worldArt||''));
 // The camera center for an image of width 1/world: center = 1/(2w) + (w-1)/w * track.
 const track=clamp((goal-.5/world)*world/(world-1),0,1);
 const center=track*100;
 const choices=[0,3,-3,6,-6].map(d=>{
  const x=clamp(center+d,0,100);
  const camera={...base,startX:Math.round(x*100)/100,endX:Math.round(x*100)/100};
  return {camera,probabilityReframe:predict(model,featureVector(project,scene,location,camera))};
 }).sort((a,b)=>a.probabilityReframe-b.probabilityReframe);
 const best=choices[0];
 if(!(current>=.5&&best.probabilityReframe<=current-.08))
  return {applicable:false,current,best:best.probabilityReframe,reason:'โมเดลยังไม่มั่นใจว่ามุมใหม่ดีกว่าอย่างน้อย 8 จุดเปอร์เซ็นต์'};
 return {applicable:true,current,best:best.probabilityReframe,camera:best.camera};
}
return Object.freeze({FEATURES,subject,featureVector,makeExample,modelUsable,predict,recommend});
});
