/* Shared, deterministic choreography for the existing SVG renderer. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.StoryMotion=api;
})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 const moving=pose=>['walk','run','sneak'].includes(pose);
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 const finite=(v,f=0)=>Number.isFinite(v)?v:f;
 const clone=v=>JSON.parse(JSON.stringify(v));
 const smooth=u=>u*u*(3-2*u);
 function clock(scene,local){
  const duration=Math.max(.001,finite(scene?.duration,4));
  const original=scene?.choreography?.mode==='fit-scene'?finite(scene.choreography.duration,duration):duration;
  const authored=original>0?original:duration;
  return {time:Math.max(0,finite(local))*authored/duration,duration:authored,scale:duration/authored};
 }
 function keysOf(actor){
  const source=(Array.isArray(actor?.motionKeys)?actor.motionKeys:[]).filter(k=>k&&Number.isFinite(k.t)&&k.t>=0);
  const unique=new Map();source.forEach(k=>unique.set(k.t,k));
  return [...unique.values()].sort((a,b)=>a.t-b.t);
 }
 // Carry omitted fields forward. A sparse rotation/pose key must not reset x/y.
 function sample(keys,t,base={},fields=['x','y','scale','bodyYaw','headYaw','angle','intensity']){
  if(!keys.length)return {...base};
  let current={...base},low=null,high=null;
  for(const key of keys){
   if(key.t<=t){current={...current,...key,override:{...current.override,...key.override}};low=key;}
   else{high=key;break;}
  }
  if(!low)return {...base,...keys[0],override:{...base.override,...keys[0].override}};
  if(!high)return current;
  const u=clamp((t-low.t)/Math.max(.00001,high.t-low.t),0,1),k=low.easing==='linear'?u:smooth(u);
  const output={...current};
  for(const field of fields)if(Number.isFinite(high[field])&&Number.isFinite(current[field]))output[field]=current[field]+(high[field]-current[field])*k;
  const override={...current.override};
  for(const [name,value]of Object.entries(high.override||{}))if(Number.isFinite(value)&&Number.isFinite(override[name]))override[name]+=(value-override[name])*k;
  output.override=override;return output;
 }
 function poseProgress(actor,progress,phaseDuration){
  if(actor.poseBlend==='throughout'||!moving(actor.pose)||moving(actor.endPose))return progress;
  // End poses describe arrival. Do not fade a run into standing from frame 1.
  const blend=clamp(finite(actor.arrivalBlend,.18),0,Math.min(.35,Math.max(.01,phaseDuration)*.15));
  return blend>0?clamp((progress*phaseDuration-(phaseDuration-blend))/blend,0,1):progress>=1?1:0;
 }
 function distance(actor,t,width=90){
  const keys=keysOf(actor);let total=0,previous={x:finite(actor.x,50),y:finite(actor.y,90)},last=0;
  for(const key of keys){
   const end={x:finite(key.x,previous.x),y:finite(key.y,previous.y)};
   if(key.t>last){
    const u=clamp((t-last)/(key.t-last),0,1),e=previous.easing==='linear'?u:smooth(u);
    total+=Math.hypot((end.x-previous.x)*width/100,(end.y-previous.y)*.9)*e;
   }
   if(t<=key.t)break;
   previous={...previous,...key,...end};last=key.t;
  }
  return total;
 }
 function gait(actor,frame,t,width=90){
  if(actor.gait!=='distance'||!moving(frame.pose))return frame;
  const d=distance(actor,t,width),d0=distance(actor,Math.max(0,t-.01),width),d1=distance(actor,t+.01,width);
  const stride=clamp(finite(actor.stride,9),2,100),frequency=frame.pose==='run'?2.1:1.25;
  const inMotion=Math.abs(d1-d0)>.00001;
  return {...frame,pose:inMotion?frame.pose:'stand',_phaseTime:inMotion?d/stride/frequency:t,_travelDistance:d,_moving:inMotion};
 }
 function light(prop,local){
  const initial={angle:finite(prop?.angle),intensity:finite(prop?.light?.intensity,.55)};
  const value=sample(keysOf({motionKeys:prop?.light?.keys}),local,initial,['angle','intensity']);
  return {angle:clamp(finite(value.angle),-180,180),intensity:prop?.light?.enabled===false?0:clamp(finite(value.intensity,.55),0,1),range:clamp(finite(prop?.light?.range,42),8,100),cone:clamp(finite(prop?.light?.cone,22),4,65)};
 }
 function keyPose(actor,frame,t){
  if(!actor.poseTransitions)return frame;
  const next=keysOf(actor).find(k=>k.t>t&&k.pose&&k.pose!==frame.pose);
  if(!next)return frame;
  const amount=clamp(1-(next.t-t)/.16,0,1);
  return amount?{...frame,endPose:next.pose,endOverride:{...frame.override,...next.override},_pr:amount,_posePr:amount}:frame;
 }
 function target(scene,actor,local,width,assetFrame){
  const contact=actor.handTarget;
  if(!contact||local<finite(contact.start)||local>finite(contact.end,Infinity))return null;
  if(Number.isFinite(contact.x)&&Number.isFinite(contact.y))return {x:contact.x*width/100,y:contact.y*.9};
  const item=(scene.customAssets||[]).find(x=>x.asset?.id===contact.asset||x.eventKind===contact.asset);
  if(!item||!assetFrame)return null;
  const f=assetFrame(item,local),k=f.scale*.42*(item.producer==='studio-production-v1'?Math.min(1,width/90)*(item.eventKind==='beacon'?.78:1):1);
  const x=(finite(contact.anchor?.x,50)-50)*k*(item.flip?-1:1),y=(finite(contact.anchor?.y,35)-85)*k,r=f.rotate*Math.PI/180;
  return {x:f.x*width/100+x*Math.cos(r)-y*Math.sin(r),y:f.y*.9+x*Math.sin(r)+y*Math.cos(r)};
 }
 function audit(scene){
  const result=[],duration=clock(scene,scene.duration).duration,scale=clock(scene,0).scale;
  for(const actor of scene.actors||[]){
   const keys=keysOf(actor);let lastMove=0,sawMove=false;
   for(let i=1;i<keys.length;i++){
    const a=sample(keys,keys[i-1].t,actor),b=sample(keys,keys[i].t,actor);
    if(Math.hypot(b.x-a.x,b.y-a.y)>.1){lastMove=keys[i].t;sawMove=true;}
   }
   if(sawMove&&duration-lastMove>.55&&!actor.intentionalHold){
    result.push({code:'motion-early-stop',severity:'warning',scene:scene.id,element:actor.char,time:+(lastMove*scale).toFixed(2),message:`เส้นทางจบก่อนฉาก ${((duration-lastMove)*scale).toFixed(1)} วินาที ตรวจว่าต้องหยุดหรือเคลื่อนต่อจนตัดฉาก`});
   }
   if(keys.at(-1)?.t>duration+.02)result.push({code:'motion-outside-scene',severity:'warning',scene:scene.id,element:actor.char,time:scene.duration,message:'มีคีย์เฟรมอยู่นอกความยาวฉาก'});
  }
  for(const [i,item]of (scene.customAssets||[]).entries())if(['school-flashlight','school-key'].includes(item.eventKind))result.push({code:'detached-handheld',severity:'warning',scene:scene.id,element:'customAssets.'+i,time:0,message:'สิ่งของนี้เป็นภาพลอยแยกจากตัวละคร ควรเปลี่ยนเป็นพร็อพที่ผูกมือ'});
  for(const hold of scene.interactionInitialHold||[]){
   if(!scene.actors?.some(a=>a.char===hold.actor)||!scene.props?.[hold.propIndex])result.push({code:'invalid-grip',severity:'error',scene:scene.id,element:hold.actor,time:0,message:'ไม่พบตัวละครหรือสิ่งของที่ระบุให้ถือ'});
  }
  return result;
 }
 function continueToCut(actor,scene){
  const out=clone(actor),keys=keysOf(out),duration=clock(scene,scene.duration).duration;
  let last=0,first=-1;
  for(let i=1;i<keys.length;i++){const a=sample(keys,keys[i-1].t,out),b=sample(keys,keys[i].t,out);if(Math.hypot(b.x-a.x,b.y-a.y)>.1){last=i;if(first<0)first=i-1;}}
  if(!last)throw Error('ไม่มีเส้นทางเคลื่อนที่ให้ปรับ');
  const finish=keys[last].t,start=keys[first].t;
  if(finish<=start)throw Error('ช่วงการเคลื่อนที่ไม่ถูกต้อง');
  const pose=[...keys.slice(0,last+1)].reverse().find(k=>moving(k.pose))?.pose||(moving(out.pose)?out.pose:'walk');
  out.motionKeys=keys.slice(0,last+1).map(k=>({...k,t:k.t<=start?k.t:start+(k.t-start)*(duration-start)/(finish-start)}));
  out.motionKeys.at(-1).pose=pose;delete out.endPose;out.intentionalHold=false;
  return out;
 }
 return Object.freeze({clock,keysOf,sample,poseProgress,distance,gait,light,keyPose,target,audit,continueToCut,moving});
});
