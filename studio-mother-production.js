/* AI Mother production pool. Connected owner keys are assigned round-robin
 * across scene batches; responses are proposals validated by StudioAPI.
 * No secret is ever stored in the browser or in the project JSON.
 */
(function(root){
'use strict';
let pool=[],lastSync=0,loading=null;
const ROLES=new Set([
 'story-analyst','continuity-keeper','scene-director','storyboard-director',
 'environment-artist','character-artist','prop-artist','layout-director',
 'motion-director','timeline-editor','quality-inspector'
]);
const LIMIT=3;
function access(){return root.StoryStudioAccess?.isAdmin?.()&&root.StoryStudioAccess?.isReady?.()}
async function refresh(force=false){
 if(!access())throw Error('งาน AI แม่ต้องเข้าสู่ระบบ GitHub แอดมินก่อน');
 if(!force&&Date.now()-lastSync<60000&&lastSync)return pool.slice();
 if(loading)return (await loading).slice();
 loading=(async()=>{
  const data=await root.StoryStudioAccess.request({action:'teacher.connection.list'});
  if(!Array.isArray(data?.connections))throw Error('AWS ไม่ส่งรายชื่อ AI แม่');
  pool=data.connections.filter(x=>x?.ready===true&&x?.id&&x?.provider);
  lastSync=Date.now();return pool;
 })();
 try{return (await loading).slice()}finally{loading=null}
}
function scenesFor(project,bridge,scope){
 const all=project?.episodes||[];
 if(scope==='scene')return [bridge.scene?.()].filter(Boolean);
 if(scope==='episode')return [...(all[bridge.episodeIndex?.()||0]?.scenes||[])];
 return all.flatMap(ep=>ep.scenes||[]);
}
function projectScene(sc){
 return {id:String(sc.id||'').slice(0,100),duration:sc.duration,
  voiceover:String(sc.voiceover||sc.text||'').slice(0,650),
  notes:String(sc.notes||'').slice(0,400),
  camera:JSON.stringify(sc.camera||{}).slice(0,250),
  actors:JSON.stringify((sc.actors||[]).slice(0,6).map(a=>({
   id:a.id||a.char,x:a.x,y:a.y,pose:a.pose,toX:a.toX,toY:a.toY,locked:!!a.lockMotion}))).slice(0,650),
  assets:JSON.stringify((sc.customAssets||[]).slice(0,6).map(a=>a.eventKind||a.id)).slice(0,300)};
}
function cleanPatch(role,sc,patch){
 if(!patch||typeof patch!=='object'||sc.productionManualLock===true)return null;
 const next={},tag='[AI แม่ '+role+']';
 if(typeof patch.notes==='string'&&patch.notes.trim()){
  const suggestion=patch.notes.replace(/[\u0000-\u001f]/g,' ').trim().slice(0,240);
  const old=String(sc.notes||'');
  // Re-running this role replaces only that role's last tagged comment.
  const blocks=old.split('\n').filter(x=>!x.startsWith(tag));
  const append=tag+' '+suggestion;
  const kept=blocks.join('\n').slice(0,Math.max(0,1000-append.length-1));
  next.notes=(kept?kept+'\n':'')+append;
 }
 if(['scene-director','timeline-editor'].includes(role)&&
    typeof patch.duration==='number'&&Number.isFinite(patch.duration)&&
    !(sc.audioClips||[]).some(x=>x.kind==='voice'&&x.data&&!x.mute)){
  const old=Number(sc.duration);
  const value=Number(patch.duration);
  // No LLM can assert duration from missing real audio.
  if(old>=.5&&value>=.5&&value<=65&&Math.abs(value-old)<=Math.min(8,old*.25))
   next.duration=Math.round(value*100)/100;
 }
 // Voiceover, manual subtitles, actor rigs, cameras, custom SVG and clip data
 // are never overwritten by a text LLM. Other existing tools own those fields.
 return Object.keys(next).length?next:null;
}
async function runRole(roleId,bridge,{scope='episode',instruction='',ensureBackup=async()=>{}}={}){
 if(!ROLES.has(roleId))throw Error('ไม่มีงาน AI แม่ตำแหน่งนี้');
 const all=await refresh(),project=bridge.get(),scenes=scenesFor(project,bridge,scope);
 if(!all.length)throw Error('ยังไม่ได้เชื่อม AI แม่ในบัญชีแอดมิน');
 if(!scenes.length)return {reviewed:0,applied:0,failures:0,mothers:0,warnings:['ไม่มีฉากในขอบเขตที่เลือก']};
 const batch=[];
 for(let i=0;i<scenes.length;i+=LIMIT)batch.push(scenes.slice(i,i+LIMIT));
 const workers=all.slice(0,Math.min(all.length,6,batch.length));
 const outcomes=new Array(batch.length),warnings=[];
 async function execute(group,index,connection){
  const out=await root.StoryStudioAccess.request({
   action:'teacher.production.review',roleId,provider:connection.provider,
   connectionId:connection.id,scenes:group.map(projectScene),
   instruction:String(instruction||'').slice(0,500)});
  if(!out?.ok||!Array.isArray(out.ops))throw Error(out?.error||'AI แม่ไม่ส่งผลที่ตรวจสอบได้');
  outcomes[index]={out,connection};
 }
 await Promise.all(workers.map(async(connection,workerIndex)=>{
  for(let i=workerIndex;i<batch.length;i+=workers.length){
   try{await execute(batch[i],i,connection)}
   catch(err){
    // A failed connection may hand the same intact batch to one other mother.
    const alternative=all.find(x=>x.id!==connection.id);
    if(alternative){
     try{await execute(batch[i],i,alternative);continue}catch(_){}
    }
    warnings.push('ชุด '+(i+1)+': '+String(err.message||err).slice(0,150));
   }
  }
 }));
 let applied=0,proposals=0;
 const editor=root.StudioAPI;
 if(!editor?.apply)throw Error('ระบบตรวจ JSON ของสตูดิโอไม่พร้อม');
 for(let index=0;index<batch.length;index++){
  const item=outcomes[index];if(!item)continue;
  const map=new Map((bridge.get().episodes||[]).flatMap(ep=>ep.scenes||[])
   .map(sc=>[String(sc.id),sc]));
  const owned=new Set(batch[index].map(x=>String(x.id)));
  const ops=[];
  for(const op of item.out.ops){
   const sc=map.get(String(op?.id||''));if(!sc||!owned.has(String(op.id)))continue;
   const patch=cleanPatch(roleId,sc,op.patch);
   if(patch)ops.push({op:'updateScene',id:sc.id,patch});
  }
  proposals+=ops.length;
  if(!ops.length)continue;
  try{
   const check=editor.apply(ops,{dryRun:true});
   if(!check.ok)throw Error('ข้อเสนอไม่ผ่าน Studio validator');
   await ensureBackup();
   const result=editor.apply(ops);
   if(!result.applied)throw Error('บันทึกข้อเสนอไม่สำเร็จ');
   applied+=ops.length;
  }catch(err){warnings.push('ชุด '+(index+1)+': '+String(err.message||err).slice(0,130));}
 }
 const reviewerCount=new Set(outcomes.filter(Boolean).map(x=>x.connection.id)).size;
 return {reviewed:outcomes.reduce((n,x,i)=>n+(x?batch[i].length:0),0),
  batches:batch.length,proposals,applied,mothers:reviewerCount,
  failures:outcomes.filter(x=>!x).length,warnings,
  reviews:outcomes.filter(Boolean).map(x=>({
   name:x.connection.name||x.connection.id,reply:x.out.reply,model:x.out.model}))};
}
function voiceConnections(){return pool.filter(x=>x.provider==='gemini'&&x.ready)}
function voiceChoice(id='auto'){
 const voices=voiceConnections();
 return (id==='auto'?voices[0]:voices.find(x=>x.id===id))||null;
}

// A multi-model visual review uses an actual rendered preview frame. Every
// external call is explicit (or part of the owner's selected hybrid mode).
// Model suggestions never get raw StudioAPI access.
function directorPatch(scene,proposal,claimed=new Set()){
 if(scene.productionManualLock||!proposal||typeof proposal!=='object')return null;
 const change={},clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
 const camera=scene.camera||{},light=scene.lighting||{};
 if(!scene.cinematicPlan&&!scene.cameraLocked&&proposal.camera&&typeof proposal.camera==='object'){
  const updated={};
  const allowed={from:[.65,1.8,.28],to:[.65,1.8,.28],
   world:[1,3.5,.35],panX:[-25,25,9],panY:[-25,25,9]};
  for(const [key,[lo,hi,delta]]of Object.entries(allowed)){
   const value=proposal.camera[key],old=Number(camera[key]??(key==='world'||key==='from'||key==='to'?1:0));
   if(!claimed.has('camera.'+key)&&typeof value==='number'&&Number.isFinite(value)&&
      value>=lo&&value<=hi&&Math.abs(value-old)<=delta&&
      !camera.lockPosition&&!camera.subjectLock&&old!==value){
    updated[key]=Math.round(value*1000)/1000;claimed.add('camera.'+key);
   }
  }
  if(Object.keys(updated).length)change.camera={...camera,...updated};
 }
 if(!scene.cinematicPlan&&!scene.lightingLocked&&proposal.lighting&&typeof proposal.lighting==='object'){
  const updated={};
  const allowed={exposure:[.6,1.5,.22],glow:[0,1,.2],vignette:[0,1,.2],
   focusX:[0,100,13],focusY:[0,100,13]};
  for(const [key,[lo,hi,delta]]of Object.entries(allowed)){
   const value=proposal.lighting[key],old=Number(light[key]??({exposure:1,glow:0,vignette:0,focusX:50,focusY:40}[key]));
   if(!claimed.has('lighting.'+key)&&typeof value==='number'&&Number.isFinite(value)&&
      value>=lo&&value<=hi&&Math.abs(value-old)<=delta&&old!==value){
    updated[key]=Math.round(value*1000)/1000;claimed.add('lighting.'+key);
   }
  }
  if(Object.keys(updated).length)change.lighting={...light,...updated};
 }
 if(!scene.cinematicPlan&&Array.isArray(proposal.actorMoves)&&
    Array.isArray(scene.actors)&&!scene.interactions?.length){
  const actors=JSON.parse(JSON.stringify(scene.actors)),used=new Set();let count=0;
  for(const move of proposal.actorMoves){
   const i=move?.index;if(!Number.isInteger(i)||i<0||i>=actors.length||used.has(i)||claimed.has('actor.'+i))continue;
   const a=actors[i];
   if(a.lockPosition||a.lockMotion||a.at||a.to||a.route?.length||a.motionKeys?.length||a.interactions?.length)continue;
   if(typeof a.x!=='number'||typeof a.y!=='number'||typeof move.dx!=='number'||typeof move.dy!=='number')continue;
   if(!Number.isFinite(move.dx)||!Number.isFinite(move.dy)||Math.abs(move.dx)>8||Math.abs(move.dy)>8)continue;
   const x=Math.round((a.x+move.dx)*100)/100,y=Math.round((a.y+move.dy)*100)/100;
   if(x<7||x>93||y<10||y>90)continue;
   if(actors.some((other,j)=>j!==i&&Number.isFinite(other?.x)&&Number.isFinite(other?.y)&&
      Math.abs(other.y-y)<8&&Math.abs(other.x-x)<11))continue;
   if(Math.abs(a.x-x)+Math.abs(a.y-y)<.15)continue;
   a.x=x;a.y=y;used.add(i);claimed.add('actor.'+i);count++;
  }
  if(count)change.actors=actors;
 }
 if(typeof proposal.notes==='string'&&proposal.notes.trim()&&!claimed.has('notes')){
  const tag='[AI แม่ visual]',note=proposal.notes.replace(/[\u0000-\u001f]/g,' ').trim().slice(0,200);
  const kept=String(scene.notes||'').split('\n').filter(s=>!s.startsWith(tag));
  const prefix=kept.join('\n').slice(0,Math.max(0,900-note.length-tag.length));
  change.notes=(prefix?prefix+'\n':'')+tag+' '+note;
  claimed.add('notes');
 }
 return Object.keys(change).length?change:null;
}
function frameScene(scene){
 return {id:String(scene.id||''),duration:scene.duration,
  voiceover:String(scene.voiceover||'').slice(0,350),
  camera:scene.camera||{},lighting:scene.lighting||{},
  actors:(scene.actors||[]).slice(0,12).map(a=>({
   char:a.char||a.id,x:a.x,y:a.y,pose:a.pose,
   lockPosition:!!a.lockPosition,lockMotion:!!a.lockMotion,
   hasRoute:!!a.route?.length,hasKeyframes:!!a.motionKeys?.length})),
  notes:String(scene.notes||'').slice(0,120),
  locks:{scene:!!scene.productionManualLock,
   camera:!!scene.cameraLocked,lighting:!!scene.lightingLocked}};
}
async function visualReview(bridge,{ensureBackup=async()=>{},instruction='',maxMothers=2}={}){
 if(!access())throw Error('ต้องเข้าสู่ระบบ GitHub แอดมินก่อนให้ AI แม่ดูภาพ');
 const mothers=(await refresh()).filter(x=>x.provider==='gemini'||x.provider==='openrouter')
  .slice(0,Math.max(1,Math.min(3,maxMothers)));
 if(!mothers.length)throw Error('ไม่พบ AI แม่ Gemini/OpenRouter ที่รองรับภาพ');
 const scene=bridge.scene?.();if(!scene?.id)throw Error('เลือกฉากก่อนตรวจภาพ');
 if(!bridge.capturePreviewFrame)throw Error('ระบบจับภาพจากพรีวิวไม่พร้อม');
 const currentId=String(scene.id),frame=await bridge.capturePreviewFrame();
 if(!frame?.startsWith('data:image/jpeg;base64,'))throw Error('ไม่ได้รับภาพเฟรม JPEG จริง');
 const input=frameScene(scene),results=await Promise.allSettled(mothers.map(async connection=>{
  const result=await root.StoryStudioAccess.request({action:'teacher.production.visualReview',
   provider:connection.provider,connectionId:connection.id,
   scene:input,frame,instruction:String(instruction||'').slice(0,450)});
  if(!result?.ok||result.sceneId!==currentId||!result.observedFrame)
   throw Error(result?.error||'โมเดลไม่ยืนยันว่าเห็นเฟรมจริง');
  return {connection,result};
 }));
 const reviews=[],warnings=[],claimed=new Set(),editor=root.StudioAPI;let applied=0;
 for(let i=0;i<results.length;i++){
  const item=results[i];
  if(item.status!=='fulfilled'){
   warnings.push((mothers[i].name||mothers[i].id)+': '+String(item.reason?.message||item.reason).slice(0,180));continue;
  }
  const {connection,result}=item.value;
  reviews.push({name:connection.name||connection.id,summary:result.summary,
   issues:result.issues||[]});
  const latest=(bridge.get().episodes||[]).flatMap(ep=>ep.scenes||[])
   .find(sc=>String(sc.id)===currentId);
  if(!latest){warnings.push('ฉากเปลี่ยนระหว่าง AI แม่ตรวจภาพ · ไม่บันทึก');break}
  const patch=directorPatch(latest,result.patch,claimed);
  if(!patch)continue;
  if(!editor?.apply){warnings.push('StudioAPI ไม่พร้อม · ไม่เขียนทับ');break;}
  const ops=[{op:'updateScene',id:currentId,patch}];
  try{
   const check=editor.apply(ops,{dryRun:true});
   if(!check.ok)throw Error('ข้อเสนอไม่ผ่าน validator');
   await ensureBackup();
   if(!editor.apply(ops).applied)throw Error('บันทึกการเปลี่ยนแปลงไม่สำเร็จ');
   applied++;
  }catch(err){warnings.push('แก้ฉากไม่สำเร็จ: '+String(err.message||err))}
 }
 return {mothers:reviews.length,attempted:mothers.length,applied,
  reviews,warnings,sceneId:currentId,observedFrame:true};
}
root.StoryMotherProduction=Object.freeze({refresh,connections:()=>pool.slice(),
 runRole,visualReview,directorPatch,voiceConnections,voiceChoice,ROLES});
})(window);
