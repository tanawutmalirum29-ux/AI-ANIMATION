/* CPU-only layout feedback adapter. No network, GPU, model download or automatic labeling.
 * A user must explicitly approve before a sanitized numeric training row is exported.
 * Model inference stays opt-in/advisory until independent validation and promotion. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.StoryLayoutML=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const FEATURES=Object.freeze(['gapX','gapY','portrait','count','moving','interaction','locked','edge']);
 const clamp=(n,lo=0,hi=1)=>Math.max(lo,Math.min(hi,n));
 const pos=a=>a&&Number.isFinite(Number(a.x))&&Number.isFinite(Number(a.y));
 const count=x=>Array.isArray(x)?x.length:0;
 const motion=a=>!!(a&&(/^(walk|run)$/i.test(String(a.pose||''))||
   a.toX!==undefined||a.toY!==undefined||count(a.route)>0||count(a.motionKeys)>0));
 const compact=n=>Math.round(clamp(n)*10000)/10000;
 function features(project,scene,i,j){
  const actors=scene?.actors;
  if(!Array.isArray(actors)||i===j||i<0||j<0||!pos(actors[i])||!pos(actors[j]))
   throw Error('ต้องมีตัวละครอย่างน้อย 2 คนพร้อมตำแหน่งที่ถูกต้อง');
  const a=actors[i],b=actors[j],ratio=String(project?.aspect||'16:9').split(':').map(Number);
  const portrait=ratio[0]>0&&ratio[1]>0&&ratio[0]<ratio[1];
  return {
   gapX:compact(Math.abs(Number(a.x)-Number(b.x))/100),
   gapY:compact(Math.abs(Number(a.y)-Number(b.y))/100),
   portrait:portrait?1:0,
   count:compact(Math.min(8,actors.length)/8),
   moving:motion(a)||motion(b)?1:0,
   interaction:count(scene.interactions)>0?1:0,
   locked:a.lockPosition||b.lockPosition||a.lockMotion||b.lockMotion?1:0,
   edge:compact(Math.min(Number(a.x),Number(b.x),100-Number(a.x),100-Number(b.x))/50)
  };
 }
 function closestPair(scene){
  const actors=scene?.actors||[];let best=null;
  for(let i=0;i<actors.length;i++)for(let j=i+1;j<actors.length;j++){
   if(!pos(actors[i])||!pos(actors[j]))continue;
   const distance=Math.hypot(Number(actors[i].x)-Number(actors[j].x),
     Number(actors[i].y)-Number(actors[j].y));
   if(!best||distance<best.distance)best={i,j,distance};
  }
  if(!best)throw Error('ไม่มีตัวละครที่มีตำแหน่งสองคนให้เรียนรู้');
  return best;
 }
 function makeExample(project,scene,i,j,label,group){
  if(label!=='separate'&&label!=='keep')throw Error('ผลอนุมัติไม่ถูกต้อง');
  if(!/^[a-zA-Z0-9_-]{5,80}$/.test(String(group||'')))throw Error('โปรเจกต์ต้องมีรหัสกลุ่มแบบไม่ระบุตัวตน');
  return {schema:1,task:'layout-spacing',approved:true,source:'human',
   group:String(group),label,features:features(project,scene,i,j)};
 }
 function correction(before,after,project,group){
  if(!before||!after||before.id!==after.id)return null;
  if(!Array.isArray(before.actors)||!Array.isArray(after.actors)||
     before.actors.length!==after.actors.length)return null;
  let selected=null;
  const items=before.actors;
  for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
   const a=items[i],b=items[j],x=after.actors[i],y=after.actors[j];
   if(![a,b,x,y].every(pos))continue;
   // Never infer labels if the actor identity or ordering changed.
   if(String(a.char||a.id||'')!==String(x.char||x.id||'')||
      String(b.char||b.id||'')!==String(y.char||y.id||''))continue;
   const oldDist=Math.hypot(Number(a.x)-Number(b.x),Number(a.y)-Number(b.y));
   const newDist=Math.hypot(Number(x.x)-Number(y.x),Number(x.y)-Number(y.y));
   const gain=newDist-oldDist;
   const aspect=String(project?.aspect||'16:9').split(':').map(Number);
   // Only label a genuinely cramped pair; moving an actor away from one
   // neighbor can increase distance to a completely different actor too.
   const cramped=aspect[0]>0&&aspect[1]>0&&aspect[0]<aspect[1]?18:12;
   if(oldDist<=cramped&&gain>3&&(!selected||gain>selected.gain))
    selected={i,j,gain};
  }
  if(!selected)return null;
  return makeExample(project,before,selected.i,selected.j,'separate',group);
 }
 function predict(model,vector){
  if(!model||model.task!=='layout-spacing'||model.schema!==1||
     !Array.isArray(model.features)||model.features.join('|')!==FEATURES.join('|')||
     !Array.isArray(model.weights)||model.weights.length!==FEATURES.length||
     !Number.isFinite(model.bias)||model.weights.some(x=>!Number.isFinite(x)))
    throw Error('น้ำหนัก ML หรือสคีมาไม่รองรับ');
  const score=model.weights.reduce((a,w,k)=>a+w*clamp(Number(vector[FEATURES[k]])||0),model.bias);
  const probability=1/(1+Math.exp(-clamp(score,-30,30)));
  return {probabilitySeparate:Math.round(probability*10000)/10000,
   suggestion:probability>=.7?'review-separation':'no-automatic-change'};
 }
 return Object.freeze({FEATURES,features,closestPair,makeExample,correction,predict});
});
