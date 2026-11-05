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
 return {reviewed:outcomes.filter(Boolean).reduce((n,x)=>n+(x?1:0),0)*LIMIT,
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
root.StoryMotherProduction=Object.freeze({refresh,connections:()=>pool.slice(),
 runRole,voiceConnections,voiceChoice,ROLES});
})(window);
