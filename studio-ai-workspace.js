/* Story Studio AI Workspace - three production helpers (timing, dubbing, narration/subtitles).
 * Everything runs as deterministic on-device rules: no AI model download, no API key, no server.
 * Edits are dry-run validated and backed up before they are applied.
 */
(function(root){
'use strict';
const core=root.StoryAIWorkspaceCore;
if(!core)return;
const DB='storyStudio.projectLibrary.v1',STORE='snapshots';
let bridge,rootElement,view='chat',audioScope='episode',busy=false,progress='',lastError='',db=null,dbPromise=null;
const EPISODE_TARGET_SECONDS=60,EPISODE_GRACE_SECONDS=5;
let targetMinutes=1,splitEpisodes=true,lastAudit=null;
const MAX_TASKS=130;


let narrativeReport='';
function narrativeScenes(){
 const state=bridge.get(),index=bridge.episodeIndex(),ep=state.episodes[index];
 if(!ep)throw Error('ไม่พบตอนปัจจุบัน');
 const list=audioScope==='all'?state.episodes: [ep];
 return list.flatMap(episode=>(audioScope==='scene'?[episode.scenes[bridge.sceneIndex?.()||0]]:episode.scenes)
 .filter(Boolean).map(scene=>({id:scene.id,episode:episode.id,duration:scene.duration,
  voiceover:String(scene.voiceover||''),
  subtitle:Array.isArray(scene.subtitle)?scene.subtitle:[],
  subtitleCues:Array.isArray(scene.subtitleCues)?scene.subtitleCues:[],
  notes:String(scene.notes||'').slice(0,250)})));
}
function narrativeChunks(source,limit=24){
 const value=String(source||'').replace(/\s+/g,' ').trim();
 if(!value)return [];
 const segmented=typeof Intl!=='undefined'&&Intl.Segmenter;
 const units=segmented?[...new Intl.Segmenter('th',{granularity:'word'}).segment(value)].map(x=>x.segment):[value];
 const graphemes=str=>segmented?[...new Intl.Segmenter('th',{granularity:'grapheme'}).segment(str)].map(x=>x.segment):[...str];
 const chunks=[];let current='';
 const length=str=>[...str].length;
 const push=()=>{if(current.trim())chunks.push(current.trim());current=''};
 for(const unit of units){
  if(length(current+unit)<=limit){current+=unit;continue}
  push();
  if(length(unit)<=limit){current=unit;continue}
  for(const glyph of graphemes(unit)){
   if(length(current+glyph)>limit)push();
   current+=glyph;
  }
 }
 push();return chunks;
}
function standardNarrative(sc){
 const source=String(sc.voiceover||(sc.subtitle||[]).join(' ')).trim();
 if(!source)return null;
 // Never discard text after 3 lines. One subtitle page can contain 1-2 lines,
 // but many timed cues may be needed to cover the complete original narration.
 const chunks=narrativeChunks(source,24);
 const current=Array.isArray(sc.subtitle)?sc.subtitle:[];
 const subtitle=current.length>0&&current.length<=3&&current.every(x=>[...x].length<=28)?
  current:chunks.slice(0,3);
 let subtitleCues=null;
 if(!sc.subtitleCues?.length){
  const cueText=[];
  for(let i=0;i<chunks.length;i+=2)cueText.push(chunks.slice(i,i+2).join('\n'));
  const weights=cueText.map(x=>Math.max(2,[...x].length));
  const sum=weights.reduce((v,n)=>v+n,0)||1;
  const duration=Math.max(.2,Number(sc.duration)||4);
  let elapsed=0;
  subtitleCues=cueText.map((text,i)=>{
   const end=i===cueText.length-1?duration:Math.min(duration,elapsed+duration*weights[i]/sum);
   const cue={id:'ai3'+sc.id+'c'+i,text,start:+elapsed.toFixed(2),end:+end.toFixed(2)};
   elapsed=end;return cue;
  });
 }
 return {id:sc.id,voiceover:sc.voiceover,subtitle,subtitleCues};
}
async function runNarrative(config={}){
 const coordinated=!!config.coordinated;
 if(busy&&!coordinated)return;
 if(!coordinated)busy=true;
 render();
 try{
  const scenes=narrativeScenes();
  if(!scenes.length)throw Error('ไม่มีฉากให้ปรับ');
  const changes=scenes.map(standardNarrative).filter(Boolean);
  const byId=new Map(scenes.map(x=>[x.id,x])),ops=[],summary=[];
  for(const item of changes){
   const old=byId.get(item.id);
   if(!old||!Array.isArray(item.subtitle)||item.subtitle.length>3)continue;
   const subtitle=item.subtitle.map(x=>String(x||'').trim());
   if(subtitle.some(x=>!x))continue;
   if(subtitle.some(x=>[...x].length>28))continue;
   const voiceover=old.voiceover;
   if(!voiceover&&!subtitle.some(Boolean))continue;
   if(/[\u0e00-\u0e7f]/.test(old.voiceover||'')&& !/[\u0e00-\u0e7f]/.test(voiceover)||
    /[\u0e00-\u0e7f]/.test(old.voiceover||'')&&subtitle.some(line=>!/[\u0e00-\u0e7f]/.test(line)))continue;
   const patch={voiceover,subtitle};
   // Keep explicitly authored subtitle timings. Estimated cues are created only
   // for the standard mode when the scene previously had no timed captions.
   if(voiceover!==old.voiceover){
    patch.subtitleCues=[];
    // Voice clips from the OLD script must not silently pass AI-2 as current.
    // Keep original media as muted backups, never delete user's recordings.
    const live=bridge.get().episodes.flatMap(ep=>ep.scenes||[]).find(sc=>sc.id===old.id);
    if((live?.audioClips||[]).some(c=>c.kind==='voice'&&c.data&&!c.mute)){
     patch.audioClips=live.audioClips.map(c=>c.kind==='voice'&&c.data?
      {...c,mute:true,staleNarration:true}:c);
    }
   }
   else if(Array.isArray(item.subtitleCues)&&
    item.subtitleCues.length&&!(old.subtitleCues||[]).length)patch.subtitleCues=item.subtitleCues;
   const changedCues=Object.prototype.hasOwnProperty.call(patch,'subtitleCues');
   if(voiceover===old.voiceover&&JSON.stringify(subtitle)===JSON.stringify(old.subtitle)&&!changedCues)continue;
   ops.push({op:'updateScene',id:old.id,patch});
   summary.push(old.id+': '+(voiceover!==old.voiceover?'ปรับบทบรรยายและซับ':
    changedCues?'จัดช่วงเวลาซับโดยประมาณ':'จัดซับใหม่'));
  }
  if(ops.length){
   const editor=root.StudioAPI;
   if(!editor?.apply)throw Error('StudioAPI ไม่พร้อม');
   const dry=editor.apply(ops,{dryRun:true});
   if(!dry.ok)throw Error('ตรวจรูปแบบการแก้ไขไม่ผ่าน: '+JSON.stringify((dry.errors||[]).slice(0,3))+' · '+JSON.stringify((dry.issues||[]).filter(x=>x.level==='error').slice(0,3)));
   await backupBeforeEdit();
   const result=editor.apply(ops);
   if(!result.applied)throw Error('ไม่สามารถใช้แผน AI-3: '+JSON.stringify((result.errors||[]).slice(0,3)));
  }
  const changedVoice=ops.some(o=>o.patch.subtitleCues?.length===0&&o.patch.voiceover);
  narrativeReport='AI-3 ปรับ '+ops.length+' ฉาก'+
   (ops.length?'\n'+summary.join('\n'):'\nไม่มีการแก้ไขใหม่ที่ผ่านเกณฑ์ หรือทุกฉากมีบทและซับเหมาะสมอยู่แล้ว')+
   (changedVoice?'\nบทเปลี่ยนแล้ว: พากย์เก่าถูกพักเสียงไว้โดยไม่ลบไฟล์ · กรุณาพากย์ใหม่ด้วย AI-2':
    ops.some(o=>o.patch.subtitleCues?.length)?'\nเวลาซับเป็นการประมาณจากความยาวฉาก ยังไม่ใช่การจับเวลาตามเสียงพากย์จริง':'');
  if(!coordinated&&typeof bridge.persist==='function')recordHandoff('AI-3','script_ready',narrativeReport,{pendingDub:ops.some(o=>o.patch.voiceover!==byId.get(o.id)?.voiceover)});
  status(narrativeReport);
  return {edits:ops.length,report:narrativeReport};
 }catch(err){
  narrativeReport='AI-3 ไม่สำเร็จ: '+String(err.message||err);status(narrativeReport,true);
  if(coordinated)throw err;
 }finally{
  if(!coordinated)busy=false;
  render();
 }
}
const e=(tag,props={},...children)=>{
 const element=document.createElement(tag);
 for(const [k,v]of Object.entries(props)){
   if(k==='className')element.className=v;
   else if(k==='value')element.value=v;
   else if(k==='checked')element.checked=!!v;
   else if(k==='selected')element.selected=!!v;
   else if(k==='disabled')element.disabled=!!v;
   else if(k==='style')element.style.cssText=v;
   else if(k.startsWith('on')&&typeof v==='function')element.addEventListener(k.slice(2),v);
   else if(v!==null&&v!==undefined)element.setAttribute(k,String(v));
 }
 for(const ch of children.flat()){if(ch===null||ch===undefined||ch===false)continue;element.append(ch instanceof Node?ch:document.createTextNode(String(ch)))}
 return element;
};
const button=(label,handler,extra={})=>e('button',{type:'button',onclick:handler,...extra},label);
const now=()=>new Date().toISOString();
const humanDate=s=>{try{return new Date(s).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'})}catch(_){return s||''}};
function w(){return core.ensure(bridge?.get()?.project?.aiWorkspace||{})}
function persist(mutator){
 const s=bridge.get();
 if(!s.project.aiWorkspace)s.project.aiWorkspace=core.ensure({});
 const state=core.ensure(s.project.aiWorkspace);
 mutator(state);
 bridge.persist();
}
function status(message,fail=false){progress=message;lastError=fail?message:'';const node=rootElement?.querySelector('#aiWorkspaceStatus');if(node){node.textContent=message;node.dataset.error=String(!!fail)}}
function setView(id){view=id;render()}
function recordHandoff(role,stage,summary,extra={}){
 persist(w=>{
  const p=w.production;
  p.stage=stage;
  p.targetSeconds=EPISODE_TARGET_SECONDS;
  p.maxSeconds=EPISODE_TARGET_SECONDS+EPISODE_GRACE_SECONDS;
  if(typeof extra.pendingDub==='boolean')p.pendingDub=extra.pendingDub;
  p.updatedAt=now();
  p.lastRole=role;
  p.lastSummary=String(summary||'').slice(0,850);
  p.handoffs.push({role,stage,summary:p.lastSummary,createdAt:p.updatedAt});
  if(p.handoffs.length>40)p.handoffs.splice(0,p.handoffs.length-40);
 });
}
function createTask(role,scope){
 if(!['voice','structure'].includes(role))throw Error('รองรับแค่ AI ตรวจจังหวะและ AI พากย์');
 if(!['scene','episode','all'].includes(scope))throw Error('ขอบเขตไม่ถูกต้อง');
 const prompt=role==='voice'?'พากย์จากโปรเจกต์ JSON ที่นำเข้าแล้ว':'ตรวจเวลาจริงของฉากและตอนจาก JSON + คลิปพากย์จริง';
 const job={id:core.id(),role,scope,prompt,status:'queued',createdAt:now(),
  updatedAt:now(),targetMinutes,splitEpisodes:role==='structure'&&splitEpisodes,
  response:'',ops:[]};
 persist(s=>{s.role=role;s.tasks.push(job);if(s.tasks.length>MAX_TASKS)s.tasks.splice(0,s.tasks.length-MAX_TASKS);
  core.historyPush(s,{speaker:'user',role,text:prompt+' · '+scope,taskId:job.id})});
 return job;
}
function queueWork(role){
 if(busy){status('กำลังจัดการงานก่อนหน้าอยู่',true);return}
 try{const job=createTask(role,audioScope);runTask(job.id)}
 catch(err){status('เริ่มตรวจงานไม่ได้: '+err.message,true)}
}
function evaluate(scope=audioScope,minutes=targetMinutes){
 if(!bridge?.auditTiming)throw Error('ระบบตรวจเวลาจริงยังไม่พร้อม');
 return bridge.auditTiming(scope,{targetMinutes:1});
}
function previewAudit(){
 try{
  lastAudit=evaluate();
  const m=lastAudit.stats;
  const visual=root.StoryVisualQA?.inspect(bridge.get(),{scope:audioScope,episodeIndex:bridge.episodeIndex(),sceneId:bridge.scene()?.id});
  status('ตรวจจาก JSON จริง '+m.inspected+' ฉาก · มีเสียง '+m.withVoice+
   ' ฉาก · ต้องแก้เวลา '+m.edits+' ฉาก · ตอนยาวเกิน '+m.overlongEpisodes+' ตอน'+
   (visual?.issues.length?' · จุดเสี่ยงภาพ/การซ้อน '+visual.issues.length+' จุด':''));

 }catch(err){status('ตรวจโครงงานไม่สำเร็จ: '+err.message,true)}
 render();
}
async function applyTiming(scope,minutes,includeSplits){
 const audit=evaluate(scope,minutes);
 const split=includeSplits&&scope!=='scene'?root.StoryTimingAuditor?.planEpisodeSplits(
  bridge.get(),audit,{scope,episodeIndex:bridge.episodeIndex(),targetMinutes:1}):null;
 const ops=[...(split?.ops||[]),...audit.ops];
 lastAudit=audit;
 if(!ops.length)return {audit,split,changes:0};
 const editor=root.StudioAPI;
 if(!editor?.apply)throw Error('StudioAPI ไม่พร้อมแก้โปรเจกต์');
 const dry=editor.apply(ops,{dryRun:true});
 if(!dry.ok)throw Error('ตรวจ JSON ก่อนแก้ไม่ผ่าน: '+((dry.errors||[]).map(e=>e.msg).join('; ')||
 (dry.issues||[]).find(x=>x.level==='error')?.msg||'คำสั่งไม่ถูกต้อง'));
 try{await backupBeforeEdit()}catch(err){throw Error('ไม่แก้โปรเจกต์ เพราะสำรองข้อมูลไม่ได้: '+err.message)}
 const applied=editor.apply(ops);
 if(!applied.applied)throw Error('ไม่สามารถใช้แผนจัดจังหวะกับโปรเจกต์');
 lastAudit=evaluate(includeSplits?'all':scope,1);
 return {audit,split,changes:ops.length};
}

async function backupBeforeEdit(){
 const state=bridge.get(),metadata=core.summaryOfSnapshot(state);
 const snapshot=JSON.stringify(state),database=await openDb();
 const record={id:metadata.projectId+'-script-before-'+Date.now()+'-'+core.id(),projectId:metadata.projectId,
   title:metadata.title+' (ก่อนจัดบท)',savedAt:now(),episodes:metadata.episodes,scenes:metadata.scenes,
   size:snapshot.length,snapshot};
 await new Promise((resolve,reject)=>{
   const tx=database.transaction(STORE,'readwrite');
   tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error||Error('สร้างสำรองก่อนแก้ไม่สำเร็จ'));
   tx.objectStore(STORE).put(record);
 });
 return record;
}
// No pasted story or replacement script operations: work on imported JSON itself.
function setJob(id,patch){
 persist(s=>{const j=s.tasks.find(t=>t.id===id);if(j)Object.assign(j,patch,{updatedAt:now()})});
}
async function runTask(taskId){
 if(busy){status('มีงานอื่นกำลังทำอยู่',true);return}
 const task=w().tasks.find(t=>t.id===taskId);if(!task)return;
 if(!['voice','structure'].includes(task.role)){
  status('งานจากบทบาท AI เก่าอ่านย้อนหลังได้อย่างเดียว',true);return;
 }
 busy=true;setJob(taskId,{status:'running',error:''});render();
 status(task.role==='voice'?'กำลังสร้างเสียงจาก JSON และแบ่งช่วงพูดยาวเป็นคลิปสั้น':
  'กำลังตรวจจังหวะจากเสียงจริง เหตุการณ์ และเวลาในทุกฉาก');
 try{
  let reply,summary=null;
  if(task.role==='voice'){
   const result=await bridge.narrate(task.scope||'episode');
   if(!result?.ok)throw Error(result?.error||'บริการ Edge TTS ยังไม่พร้อม');
   reply='พากย์เสร็จ '+result.made+' คลิป'+(result.failed?' · ผิดพลาด '+result.failed+' คลิป':'');
   if(result.made){
    try{
     const fixed=await applyTiming(task.scope,1,true);
     reply+=' · ตรวจเสียงและจัดตอน 60–65 วินาที '+fixed.changes+' จุด'+(fixed.split?.created?' · แยกเพิ่ม '+fixed.split.created+' ตอน':'');
     if(fixed.split?.warnings?.length)reply+=' · ยังมีจุดที่ต้องตรวจ '+fixed.split.warnings.length+' จุด';
     summary=fixed.audit.stats;
    }catch(err){reply+=' · ยังปรับเวลาอัตโนมัติไม่ได้: '+err.message}
   }
   reply+=' · รักษาเนื้อเรื่องและเหตุการณ์เดิม';
  }else{
   const fixed=await applyTiming(task.scope,task.targetMinutes,task.splitEpisodes);
   const stats=fixed.audit.stats;
   summary={...stats,newEpisodes:fixed.split?.created||0,warnings:fixed.split?.warnings||[]};
   reply='ตรวจ '+stats.inspected+' ฉากจาก JSON เดิม · เสียงจริง '+stats.withVoice+
    ' ฉาก · ปรับเวลา '+fixed.audit.ops.length+' ฉาก'+
    (fixed.split?.created?' · แบ่งเพิ่ม '+fixed.split.created+' ตอน':'')+
    ' · เป้าหมาย '+EPISODE_TARGET_SECONDS+'–'+(EPISODE_TARGET_SECONDS+EPISODE_GRACE_SECONDS)+' วินาที/ตอน'+
    (stats.withoutVoice?' · ยังไม่มีคลิปเสียง '+stats.withoutVoice+' ฉาก':'')+
    (summary.warnings?.length?' · ตอนที่มีเพลง/เหตุการณ์ต่อเนื่องยังไม่ย้ายฉากเอง':'')+
    ' · ไม่เขียนเรื่องหรือสร้างฉากปลอม';
   const visual=root.StoryVisualQA?.inspect(bridge.get(),{
    scope:task.scope||'episode',episodeIndex:bridge.episodeIndex(),sceneId:bridge.scene()?.id
   });
   if(visual?.issues.length){
    reply+=' · QA ภาพต้องตรวจ '+visual.issues.length+' จุด (ตรวจจาก JSON เท่านั้น)';
    summary.visualIssues=visual.issues.slice(0,30);
   }
  }
  recordHandoff(task.role==='voice'?'AI-2':'AI-1',task.role==='voice'?'dub_ready':'timing_review',reply,
   {pendingDub:task.role==='voice'?false:undefined});
  setJob(taskId,{status:'done',response:reply,ops:[],planSummary:summary});
  persist(s=>core.historyPush(s,{speaker:'assistant',role:task.role,text:reply,taskId}));
  status(reply);
 }catch(err){
  const msg=String(err.message||err).slice(0,450);
  setJob(taskId,{status:'failed',error:msg});status('งานยังไม่เสร็จ: '+msg,true);
 }finally{busy=false;render()}
}

/* One-button stages use a shared, persistent JSON project. These are bounded
 * local rule modules, not six neural models conversing or trained in secret. */
function productionSteps(){
 const names=root.StoryProductionPlanner?.stages||[];
 return names.map(x=>({id:x.id,name:x.name,mode:x.mode,status:'pending',summary:''}));
}
function patchProductionStep(taskId,id,update){
 persist(state=>{
  const t=state.tasks.find(x=>x.id===taskId);
  if(!t)return;
  const step=t.steps?.find(x=>x.id===id);
  if(step)Object.assign(step,update,{updatedAt:now()});
  t.updatedAt=now();
 });
 render();
}
async function applyProductionPlan(stage,ensureBackup){
 const planner=root.StoryProductionPlanner,editor=root.StudioAPI;
 if(!planner?.plan||!editor?.apply)throw Error('ยังโหลดระบบ '+stage+' ไม่ครบ');
 const result=planner.plan(bridge.get(),stage,root.StoryProductionAssets);
 if(!result.ops?.length)return {applied:0,warnings:result.warnings||[],details:[]};
 const dry=editor.apply(result.ops,{dryRun:true});
 if(!dry.ok)throw Error('แผน '+stage+' ไม่ผ่าน validator: '+
  ((dry.errors||[]).map(x=>x.msg).join('; ')||
   (dry.issues||[]).find(x=>x.level==='error')?.msg||'รูปแบบไม่ถูกต้อง'));
 await ensureBackup();
 const applied=editor.apply(result.ops);
 if(!applied.applied)throw Error('ไม่สามารถบันทึกผล '+stage);
 return {applied:result.ops.length,warnings:result.warnings||[],details:result.details||[]};
}
function countVoiceCoverage(state){
 let expected=0,voiced=0;
 for(const ep of state.episodes||[])for(const sc of ep.scenes||[]){
  if(!String(sc.voiceover||(sc.subtitle||[]).join(' ')).trim())continue;
  expected++;
  if((sc.audioClips||[]).some(c=>c.kind==='voice'&&c.data&&!c.mute&&!c.staleNarration))voiced++;
 }
 return {expected,voiced,missing:Math.max(0,expected-voiced)};
}
async function runCoordinatedProduction(){
 if(busy){status('มีงานผลิตกำลังทำงานอยู่',true);return}
 const planner=root.StoryProductionPlanner,stages=productionSteps();
 if(!planner?.plan||stages.length!==6){
  status('ไม่พบโมดูลผู้ช่วยผลิตทั้ง 6 ขั้น รีเฟรชเว็บไซต์ก่อน',true);return;
 }
 const job={id:core.id(),role:'production',scope:'all',
  prompt:'ผลิตจาก JSON เดิม: จัดองค์ประกอบ → SVG → Motion → พากย์ → จัดเวลา → QA',
  status:'running',createdAt:now(),updatedAt:now(),steps,response:'',ops:[]};
 try{persist(w=>{w.tasks.push(job);if(w.tasks.length>MAX_TASKS)w.tasks.splice(0,w.tasks.length-MAX_TASKS)});}
 catch(err){status('บันทึกงานผลิตไม่ได้: '+err.message,true);return}
 const oldScope=audioScope;let backedUp=false;
 const messages=[],warnings=[],results={},failures=[];
 const ensureBackup=async()=>{if(!backedUp){await backupBeforeEdit();backedUp=true;}};
 busy=true;audioScope='all';render();
 async function step(id,fn){
  const index=stages.findIndex(x=>x.id===id),name=stages[index].name;
  patchProductionStep(job.id,id,{status:'running',summary:'กำลังดำเนินการ'});
  status('ขั้นที่ '+(index+1)+'/6 · '+name);
  try{
   const outcome=await fn();
   const summary=String(outcome?.summary||'เสร็จ').slice(0,350);
   const w=outcome?.warnings||[];
   warnings.push(...w);
   const phaseStatus=outcome?.status||(w.length?'warning':'done');
   patchProductionStep(job.id,id,{status:phaseStatus,summary});
   messages.push(name+': '+summary);
   results[id]=outcome;
   recordHandoff(name,id,summary);
  }catch(err){
   const message=String(err?.message||err).slice(0,340);
   patchProductionStep(job.id,id,{status:'failed',summary:message});
   warnings.push(name+': '+message);failures.push(id);
   messages.push(name+': ไม่สำเร็จ ('+message+')');
   recordHandoff(name,'needs_attention',message);
  }
 }
 try{
  await step('composition',async()=>{
   const r=await applyProductionPlan('composition',ensureBackup);
   return {summary:r.applied?'จัดตำแหน่ง '+r.applied+' ฉาก':'ไม่มีจุดซ้อนที่แก้ได้อย่างปลอดภัย',
    status:r.applied?'done':'skipped',warnings:r.warnings};
  });
  await step('assets',async()=>{
   const r=await applyProductionPlan('assets',ensureBackup);
   return {summary:r.applied?'เพิ่มภาพร่างเวกเตอร์ '+r.applied+' ฉาก':'ไม่พบวัตถุที่สร้างจากแม่แบบได้',
    status:r.applied?'done':'skipped',warnings:r.warnings};
  });
  await step('motion',async()=>{
   const r=await applyProductionPlan('motion',ensureBackup);
   return {summary:r.applied?'เพิ่ม keyframe ตัวละคร '+r.applied+' ฉาก; วัตถุจาก AI-2 มีคีย์เฟรมของตัวเอง':'รักษา motion เดิม; แอนิเมชันวัตถุใหม่พร้อมใช้งาน',
    status:r.applied?'done':'skipped',warnings:r.warnings};
  });
  await step('voice',async()=>{
   const before=countVoiceCoverage(bridge.get());
   if(before.expected===0)return {summary:'ไม่มีเนื้อหาพากย์',status:'skipped'};
   if(before.missing===0)return {summary:'เสียงพากย์ครบ '+before.voiced+'/'+before.expected+' ฉาก ไม่พากย์ทับ',status:'skipped'};
   // Caption preparation uses the existing conservative helper (not a storywriter).
   await runNarrative({coordinated:true});
   if(!bridge.narrate)return {status:'warning',summary:'ยังไม่เชื่อมบริการ Edge TTS',
     warnings:['ไม่พบระบบพากย์; ข้ามการสร้างเสียง']};
   const result=await bridge.narrate('all');
   const after=countVoiceCoverage(bridge.get());
   const incomplete=(result?.failed||0)>0||after.missing>0||!result?.ok;
   return {status:incomplete?'warning':'done',
    summary:'สร้างเสียงเพิ่ม '+(result?.made||0)+' คลิป · มีเสียง '+after.voiced+'/'+after.expected+' ฉาก',
    warnings:incomplete?['พากย์บางฉากยังไม่ครบ: '+after.missing+' ฉาก; '+String(result?.error||'ตรวจบริการ TTS')]:[]};
  });
  await step('timing',async()=>{
   const before=countVoiceCoverage(bridge.get());
   if(before.voiced===0)return {status:'skipped',summary:'ยังไม่มีคลิปเสียงจริง; ไม่เดาเวลาพากย์',
     warnings:before.missing?['ต้องเชื่อม Edge TTS หรือเพิ่มเสียงจริงก่อนจัดจังหวะ']:[]};
   const result=await applyTiming('all',1,true);
   return {summary:'แก้เวลาหรือแบ่งตอน '+result.changes+' จุด; ไม่ยืดภาพนิ่งให้ครบ 60 วิ',
    status:result.changes?'done':'skipped',warnings:result.split?.warnings||[]};
  });
  await step('qa',async()=>{
   const state=bridge.get(),v=root.StoryVisualQA?.inspect(state,{scope:'all'}),
     timing=evaluate('all',1),voice=countVoiceCoverage(state);
   const diag=root.StudioAPI?.validate?.();
   const errors=(diag?.issues||[]).filter(x=>x.level==='error');
   const over=timing.episodes.filter(x=>x.projected>65.01);
   const visual=v?.issues||[];
   const needs=!!(errors.length||visual.length||voice.missing||over.length);
   const info=['เสียง '+voice.voiced+'/'+voice.expected+' ฉาก',
    'เสี่ยงภาพ '+visual.length+' จุด','ตอนเกิน 65 วิ '+over.length,'JSON error '+errors.length];
   return {status:needs?'warning':'done',summary:info.join(' · '),
    warnings:[...visual.slice(0,12).map(x=>'ตอน '+x.episode+' ฉาก '+x.scene+': '+x.title),
     ...over.map(x=>'ตอน '+x.episode+' เกิน 65 วินาที'),
     ...errors.slice(0,4).map(x=>'JSON: '+x.msg)]};
  });
  const voice=countVoiceCoverage(bridge.get()),last=results.qa;
  const ready=failures.length===0&&voice.missing===0&&last?.status==='done';
  const report='ประมวลผล 6 ขั้นครบแล้ว · '+(ready?'พร้อมส่งออกเพื่อตรวจภาพ/เสียงจริง':
   'ยังมีข้อจำกัดที่ต้องตรวจเพิ่มเติม')+'\n'+messages.join('\n')+
   (warnings.length?'\nคำเตือน: '+warnings.slice(0,12).join(' · '):'')+
   '\nระบบยังไม่ตรวจ pixel ของวิดีโอหรือฝึกน้ำหนักโมเดล AI';
  recordHandoff('production',ready?'ready':'needs_attention',report,{pendingDub:voice.missing>0});
  setJob(job.id,{status:'done',response:report,
   planSummary:{ready,failures,warnings:warnings.slice(0,50),steps:stages.length}});
  persist(w=>core.historyPush(w,{speaker:'assistant',role:'production',text:report,taskId:job.id}));
  status(report,!ready);
 }catch(err){
  const message=String(err?.message||err).slice(0,600);
  setJob(job.id,{status:'failed',error:message});
  recordHandoff('production','needs_attention','งานหยุด: '+message);
  status('งานผลิตหยุด: '+message+' · ข้อมูลก่อนแก้ยังอยู่ในสำรอง',true);
 }finally{audioScope=oldScope;busy=false;render();}
}

function exportText(name,data,mime='application/json'){
 const url=URL.createObjectURL(new Blob([data],{type:mime+';charset=utf-8'}));
 const a=e('a',{href:url,download:name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}

function renderChat(container){
 const pane=e('section',{className:'ai-chat-panel'});
 pane.append(e('h3',{},'ผู้ช่วย 3 ตัว · ใช้โปรเจกต์ JSON จาก AI ภายนอกโดยตรง'),
  e('p',{className:'ai-help'},'บท ฉาก ภาพ ตัวละคร และเหตุการณ์มาจาก JSON ที่นำเข้าแล้ว ผู้ช่วยตรวจงานจริง ไม่ให้วางบทใหม่ และไม่สร้างเนื้อเรื่องแทน'));
 const production=w().production;
 pane.append(e('section',{className:'ai-audio-agent'},
  e('h4',{},'ทำงานร่วมกัน · จัดทุกตอนให้ใกล้ 60 วินาที (สูงสุด 65 วินาที)'),
  e('p',{},'นำเข้า JSON จาก AI ภายนอกได้ยาวเกิน 60 วินาที · ระบบจะใช้ AI-3 มาตรฐานจัดซับ → AI-2 สร้างเสียงจริง → AI-1 วัดเสียงและแบ่งตอนตามรอยต่อฉากที่ปลอดภัย'),
  button(busy?'กำลังประสาน 3 ผู้ช่วย…':'ให้ AI-3 → AI-2 → AI-1 ทำงานร่วมกันทั้งโปรเจกต์',
   runCoordinatedProduction,{disabled:busy,className:'ai-primary'}),
  e('small',{},'เป้า 60–65 วินาทีต่อหนึ่งตอน · ไม่ตัดคำพากย์ ไม่ยืดความเงียบเพื่อให้ครบ 60 · ถ้าฉากเดียวยาวกว่า 65 วินาทีจะเตือนให้จัดฉากใหม่'),
  ...(production?.lastSummary?[e('pre',{className:'ai-response',style:'white-space:pre-wrap;overflow-wrap:anywhere'},
    'สถานะล่าสุด '+production.stage+' · '+production.lastSummary)]:[])
 ));
 const cards=e('div',{className:'ai-audio-agents'});
 const scope=e('select',{'aria-label':'ขอบเขตตรวจและพากย์',onchange:evt=>{audioScope=evt.target.value;lastAudit=null;render()}},
  ...[['scene','เฉพาะฉากปัจจุบัน'],['episode','ตอนปัจจุบัน'],['all','ทุกตอนในโปรเจกต์']].map(([id,label])=>
   e('option',{value:id,selected:id===audioScope},label)));
 const minutes=e('span',{className:'ai-help'},'เป้าหมาย 60 วินาที · อนุโลมเพิ่มสูงสุด 5 วินาที (65 วินาที)');
 const splitting=e('label',{className:'ai-auto-toggle'},e('input',{type:'checkbox',checked:splitEpisodes,
  onchange:evt=>{splitEpisodes=!!evt.target.checked}}),
  ' แบ่งตอนที่ยาวเกิน ณ รอยต่อฉากเดิม (เฉพาะเมื่อย้ายได้อย่างปลอดภัย)');
 const structure=e('article',{className:'ai-audio-agent'},
  e('h4',{},'AI-1 · ตรวจจังหวะฉากและความยาวตอนจากงานจริง'),
  e('p',{},'วัดเสียงพากย์จริง ลดภาพค้าง แบ่งตอนจากฉากเดิมให้เข้าใกล้ 60 วินาที และไม่เกิน 65 วินาทีหากแบ่งอย่างปลอดภัยได้'),
  e('div',{className:'ai-script-settings'},e('label',{},'ตรวจขอบเขต',scope),
    e('label',{},'เวลาต่อตอน',minutes)),
  splitting,
  e('div',{className:'ai-actions'},
    button('ตรวจปัญหา (ยังไม่แก้)',previewAudit,{disabled:busy}),
    button(busy?'กำลังตรวจ…':'ตรวจและปรับโปรเจกต์',()=>queueWork('structure'),{disabled:busy,className:'ai-primary'})),
  e('small',{},'ใช้เวลาจากไฟล์เสียงจริงเมื่อมี · รักษาฉาก/ตัวละครและจุดเปลี่ยนฉาก · งานที่ต่ำกว่า 60 หรือฉากเดียวยาวกว่า 65 จะมีคำเตือน ไม่ยัดภาพค้างเพื่อให้ครบ'));
 if(lastAudit){
  const m=lastAudit.stats;
  const report=e('div',{className:'ai-response'},e('strong',{},'ผลตรวจจาก JSON ที่กำลังเปิด'),
   e('p',{},'ตรวจ '+m.inspected+' ฉาก · มีไฟล์เสียง '+m.withVoice+' · ยังไม่มีเสียง '+m.withoutVoice+
    ' · ฉากต้องปรับ '+m.edits+' · ตอนยาวเกิน '+m.overlongEpisodes));
  for(const ep of lastAudit.episodes)report.append(e('p',{},
   'ตอน '+ep.episode+' — '+ep.old.toFixed(1)+' วินาที → ประเมินหลังแก้ '+
   ep.projected.toFixed(1)+' วินาที'+(ep.beyondTolerance>0?' · เกิน 65 วินาที '+ep.beyondTolerance.toFixed(1):ep.underBy>0?' · ต่ำกว่า 60 วินาที '+ep.underBy.toFixed(1):' · อยู่ในช่วงเป้าหมาย')));
  for(const issue of lastAudit.issues.slice(0,10))report.append(e('small',{},
   'ตอน '+issue.episode+' ฉาก '+issue.scene+' · '+({shorten:'ภาพค้างหลังพากย์',extend:'เสียงยาวเกินฉาก',
    review:'ต้องตรวจเหตุการณ์ประกอบ', 'needs-dub':'ยังไม่มีไฟล์เสียง'}[issue.kind]||'ตรวจเพิ่มเติม')+
   (issue.kind==='shorten'||issue.kind==='extend'?' ('+issue.old+' → '+issue.suggested+' วินาที)':'')));
  const visual=root.StoryVisualQA?.inspect(bridge.get(),{
   scope:audioScope,episodeIndex:bridge.episodeIndex(),sceneId:bridge.scene()?.id
  });
  if(visual?.issues.length){
   report.append(e('strong',{},'QA ภาพ: ต้องตรวจ '+visual.issues.length+' จุด (ตรวจจาก JSON ไม่ใช่ตรวจวิดีโอจริง)'));
   for(const issue of visual.issues.slice(0,14))report.append(e('small',{},
    'ตอน '+issue.episode+' ฉาก '+issue.scene+' · '+issue.title+' — '+issue.message));
   if(visual.issues.length>14)report.append(e('small',{},'อีก '+(visual.issues.length-14)+' จุดที่ยังไม่แสดง'));
  }
  structure.append(report);
 }
 const voice=e('article',{className:'ai-audio-agent'},
  e('h4',{},'AI-2 · พากย์เสียงจากฉากที่เขียนเสร็จ'),
  e('p',{},'พากย์ข้อความ voiceover / subtitle จาก JSON เดิม แบ่งข้อความที่ยาวเป็นคลิปสั้นเพื่อลดการเว้นวรรคนานเกินไป ใช้ความยาว MP3 จริงจัดจังหวะอีกครั้งหลังจบ'),
  button(busy?'กำลังพากย์…':'พากย์และจัดเวลาหลังพากย์',()=>queueWork('voice'),{disabled:busy,className:'ai-primary'}),
  e('small',{},'ทำงานบน Edge TTS ที่เชื่อมไว้เดิม · หากบริการไม่พร้อม จะแจ้งว่าไม่สามารถพากย์ได้ ไม่แสดงผลสำเร็จปลอม'));
 const narrative=e('article',{className:'ai-audio-agent'},
 e('h4',{},'AI-3 · ผู้กำกับบทบรรยายและซับไตเติล'),
 e('p',{},'ใช้ JSON ภายนอกเป็นต้นฉบับ · รักษาบทเดิม แบ่งซับและกระจายเวลาซับตามความยาวฉาก · สำรองก่อนแก้'),
button(busy?'กำลังทำงาน…':'ให้ AI-3 จัดบทและซับ',()=>runNarrative(),{disabled:busy,className:'ai-primary'}),
 ...(narrativeReport?[e('pre',{className:'ai-response',style:'white-space:pre-wrap;overflow-wrap:anywhere'},narrativeReport)]:[]));
 cards.append(structure,voice,narrative);
 pane.append(cards,e('p',{className:'ai-help'},'เครื่องมืออื่น เช่น Sound Desk กล้อง เอฟเฟกต์ และคลัง GitHub ยังอยู่ แต่ไม่ได้เป็นผู้ช่วย AI เพิ่ม'));
 container.append(pane);
}

function renderTasks(container){
 const tasks=w().tasks.slice().reverse(),pane=e('section',{className:'ai-task-panel'});
 pane.append(e('div',{className:'ai-section-head'},e('h3',{},'ประวัติการตรวจจังหวะและพากย์'),e('span',{},'บันทึกงานเก่าไว้เป็นประวัติ · มีผู้ช่วย 3 ตัวเท่านั้น')));
 if(!tasks.length)pane.append(e('p',{className:'ai-help'},'ยังไม่มีงาน กดตรวจ JSON หรือเริ่มพากย์เสียง'));
 for(const task of tasks){
  const role=core.roles.find(r=>r.id===task.role);
  const box=e('article',{className:'ai-task','data-task-id':task.id});
  box.append(e('div',{className:'ai-task-head'},e('strong',{},role?.name||(task.role==='production'?'เวิร์กโฟลว์ AI-3 → AI-2 → AI-1':'งาน AI เก่า (อ่านอย่างเดียว)')),
   e('span',{className:'ai-task-state','data-state':task.status},
    ({queued:'รอทำ',running:'กำลังทำ',done:'เสร็จ',failed:'ผิดพลาด',applied:'งานเก่า',interrupted:'หยุดไป'}[task.status]||task.status))));
  box.append(e('p',{},task.prompt||''));
  if(task.response)box.append(e('div',{className:'ai-response'},e('p',{},task.response)));
  if(task.error)box.append(e('p',{className:'ai-error'},task.error));
  const actions=e('div',{className:'ai-actions'});
  if(['voice','structure'].includes(task.role)&&['queued','failed','interrupted'].includes(task.status))
   actions.append(button('ลองทำงานอีกครั้ง',()=>runTask(task.id),{disabled:busy,className:'ai-primary'}));
  if(task.response)actions.append(button('คัดลอกผล',()=>navigator.clipboard?.writeText(task.response).then(()=>status('คัดลอกแล้ว')).catch(()=>status('คัดลอกไม่สำเร็จ',true))));
  box.append(actions);pane.append(box);
 }
 container.append(pane);
}
function renderBible(container){
 const s=w(),pane=e('section',{className:'ai-bible-panel'});
 pane.append(e('h3',{},'สมุดความต่อเนื่อง (Story Bible)'),e('p',{className:'ai-help'},'บันทึกข้อมูลที่ต้องจำข้ามฉากและข้ามตอน ข้อมูลนี้จะถูกส่งเป็นบริบทให้ AI ในเครื่องโดยอัตโนมัติ — ไม่ใช่ความจำถาวรของโมเดล'));
 const fields=[['premise','แนวเรื่อง / แกนหลัก','ธีม แนวทางและตอนจบที่วางไว้'],['world','โลก / กฎ / สถานที่','สิ่งที่เปลี่ยนไม่ได้และบรรยากาศ'],['characters','ตัวละคร / ความสัมพันธ์','นิสัย ความสัมพันธ์ เสียงและข้อมูลคงที่'],['timeline','เหตุการณ์ / ลำดับเวลา','เหตุการณ์สำคัญ ใครรู้เรื่องอะไรแล้ว'],['threads','ปมค้าง / สิ่งที่ต้องตามต่อ','เบาะแส ปริศนา สัญญาที่ต้องกลับมาเฉลย']];
 for(const [key,label,placeholder]of fields){
   const input=e('textarea',{rows:3,placeholder,onchange:evt=>{persist(w=>w.bible[key]=evt.target.value.slice(0,10000));status('บันทึกสมุดความต่อเนื่องแล้ว')}});
   input.value=s.bible[key]||'';pane.append(e('label',{className:'ai-field'},label,input));
 }
 const ep=bridge.episode(),id=ep?.id;
 if(id){const note=e('textarea',{rows:5,placeholder:'ตอนนี้เกิดอะไรขึ้น? ตัวละครรู้ข้อมูลอะไร ปมไหนยังไม่เฉลย? เขียนสรุปก่อนเริ่มตอนถัดไป',onchange:evt=>{persist(w=>w.summaries[id]=evt.target.value.slice(0,10000));status('บันทึกสรุปตอนแล้ว')}});note.value=s.summaries[id]||'';pane.append(e('label',{className:'ai-field'},'สรุปตอนปัจจุบัน · '+ep.title,note))}
 pane.append(e('div',{className:'ai-actions'},button('สร้างตอนถัดไปแบบต่อเนื่อง',()=>{if(root.confirm('สร้างตอนถัดไปโดยคงฉาก ตัวละคร และบรรยากาศท้ายตอนเดิม? กรุณาบันทึกสรุปตอนปัจจุบันก่อน')){bridge.continueEpisode();status('สร้างตอนถัดไปต่อเนื่องแล้ว · อัปเดตสรุปตอนใหม่ก่อนส่ง AI');render()}},{className:'ai-primary'}),button('ดาวน์โหลดสมุดเรื่อง',()=>exportText('story-bible.json',JSON.stringify({bible:s.bible,summaries:s.summaries},null,2))),button('คัดลอกบริบทให้ AI ภายนอก',()=>{navigator.clipboard?.writeText(JSON.stringify(core.context(bridge.get(),bridge.episodeIndex()),null,2)).then(()=>status('คัดลอกบริบทแล้ว')).catch(()=>status('ไม่รองรับการคัดลอก กรุณาดาวน์โหลด JSON',true))})));
 container.append(pane);
}
function openDb(){
 if(db)return Promise.resolve(db);
 if(dbPromise)return dbPromise;
 dbPromise=new Promise((resolve,reject)=>{
   if(!('indexedDB' in root)){reject(Error('เบราว์เซอร์นี้ไม่รองรับ IndexedDB'));return}
   const req=indexedDB.open(DB,1);
   req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE,{keyPath:'id'})};
   req.onsuccess=()=>{db=req.result;resolve(db)};
   req.onerror=()=>reject(req.error||Error('เปิดฐานข้อมูลไม่ได้'));
 }).catch(err=>{dbPromise=null;throw err});
 return dbPromise;
}
async function records(){
 const database=await openDb();
 return new Promise((resolve,reject)=>{const q=database.transaction(STORE,'readonly').objectStore(STORE).getAll();q.onsuccess=()=>resolve(q.result.sort((a,b)=>String(b.savedAt).localeCompare(String(a.savedAt))));q.onerror=()=>reject(q.error||Error('อ่านโปรเจกต์ไม่ได้'))});
}
async function saveRevision(){
 const state=bridge.get(),s=core.ensure(state.project.aiWorkspace||{});state.project.aiWorkspace=s;
 bridge.persist();const snapshot=JSON.stringify(state);const meta=core.summaryOfSnapshot(state);
 const record={id:s.projectId+'-'+Date.now()+'-'+core.id(),projectId:s.projectId,title:meta.title,savedAt:now(),episodes:meta.episodes,scenes:meta.scenes,size:snapshot.length,snapshot};
 try{
  const database=await openDb();
  await new Promise((resolve,reject)=>{
    const tx=database.transaction(STORE,'readwrite');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||Error('พื้นที่ไม่พอ'));tx.objectStore(STORE).put(record);
  });
  status('บันทึกโปรเจกต์เวอร์ชัน '+humanDate(record.savedAt)+' ลงเครื่องแล้ว · แนะนำให้ดาวน์โหลด JSON สำรองด้วย');renderLibrary();
 }catch(err){status('บันทึกลงเครื่องไม่ได้: '+err.message+' — กรุณาดาวน์โหลด JSON เพื่อสำรอง',true)}
}
async function openRevision(id){
 try{
  const database=await openDb(),record=await new Promise((resolve,reject)=>{const q=database.transaction(STORE,'readonly').objectStore(STORE).get(id);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});
  if(!record)throw Error('ไม่พบเวอร์ชัน');
  const project=core.validateSnapshot(JSON.parse(record.snapshot));
  if(!root.confirm('เปิดเวอร์ชัน “'+record.title+'” ? โปรเจกต์ปัจจุบันจะถูกแทนที่ กรุณาบันทึกเวอร์ชันหรือดาวน์โหลด JSON ก่อน'))return;
  bridge.load(project);status('เปิดเวอร์ชัน '+humanDate(record.savedAt)+' สำเร็จ');
  view='projects';render();
 }catch(err){status('เปิดเวอร์ชันไม่สำเร็จ: '+err.message,true)}
}
async function deleteRevision(id){
 if(!root.confirm('ลบเวอร์ชันนี้ออกจากเครื่องถาวร? หากไม่มี JSON สำรองจะกู้ไม่ได้'))return;
 try{
  const database=await openDb();
  await new Promise((resolve,reject)=>{const tx=database.transaction(STORE,'readwrite');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.objectStore(STORE).delete(id)});
  status('ลบเวอร์ชันแล้ว');renderLibrary();
 }catch(err){status('ลบไม่ได้: '+err.message,true)}
}
async function renderLibrary(){
 const target=rootElement?.querySelector('#aiProjectLibrary');if(!target)return;
 target.replaceChildren(e('p',{className:'ai-help'},'กำลังโหลดรายการโปรเจกต์...'));
 try{
  const list=await records();
  if(!target.isConnected)return;
  target.replaceChildren();
  if(!list.length)target.append(e('p',{className:'ai-help'},'ยังไม่มีเวอร์ชันที่บันทึกในเครื่อง กด “บันทึกเวอร์ชัน” เพื่อเริ่ม'));
  for(const record of list.slice(0,100)){
    target.append(e('article',{className:'ai-snapshot'},
      e('div',{},e('strong',{},record.title),e('small',{},humanDate(record.savedAt)+' · '+record.episodes+' ตอน · '+record.scenes+' ฉาก · '+(record.size/1048576).toFixed(2)+' MB')),
      e('div',{className:'ai-actions'},
        button('เปิดเวอร์ชัน',()=>openRevision(record.id),{className:'ai-primary'}),
        button('ดาวน์โหลด JSON',()=>exportText('story-studio-'+record.savedAt.slice(0,10)+'.json',record.snapshot)),
        button('ลบ',()=>deleteRevision(record.id))
      )
    ));
  }
  if(list.length>100)target.append(e('p',{className:'ai-help'},'แสดง 100 เวอร์ชันล่าสุด'));
 }catch(err){target.replaceChildren(e('p',{className:'ai-error'},'ไม่สามารถอ่านคลังโปรเจกต์: '+err.message+' (ยังดาวน์โหลด JSON ได้)'))}
}
function renderProjects(container){
 const pane=e('section',{className:'ai-project-panel'},
  e('h3',{},'บันทึกโปรเจกต์และเวอร์ชัน'),
  e('p',{className:'ai-help'},'เก็บโปรเจกต์ในอุปกรณ์นี้ผ่าน IndexedDB และส่งออก JSON สำหรับย้ายเครื่อง ข้อมูลเสียงและภาพในโปรเจกต์จะถูกรวมในไฟล์ด้วย'),
  e('div',{className:'ai-actions'},
    button('บันทึกเวอร์ชันในเครื่อง',saveRevision,{className:'ai-primary'}),
    button('ดาวน์โหลดโปรเจกต์ JSON',()=>bridge.exportJSON()),
    button('เปิดโปรเจกต์จาก JSON',()=>bridge.importJSON())
  ),
  e('p',{className:'ai-help'},'สำคัญ: ข้อมูลในเบราว์เซอร์อาจถูกลบเมื่อเคลียร์ข้อมูลเว็บหรือเปลี่ยนเครื่อง — ไม่ใช่ Cloud Save และยังไม่มีการซิงก์ข้ามอุปกรณ์'),
  e('div',{id:'aiProjectLibrary',className:'ai-project-list'})
 );
 container.append(pane);renderLibrary();
}
function render(){
 if(!rootElement||!bridge)return;
 rootElement.replaceChildren(
  e('div',{className:'ai-header'},e('div',{},e('h2',{},'AI Production · 3 ผู้ช่วย'),
   e('p',{},'ตรวจฉากจาก JSON จริง · เทียบเสียงกับความยาว · พากย์เสียง'))),
  e('p',{id:'aiWorkspaceStatus',className:'ai-status','data-error':String(!!lastError),role:'status','aria-live':'polite'},
    progress||'เปิด JSON ที่ AI ภายนอกเขียนไว้ แล้วตรวจความยาวฉาก/ตอนจากไฟล์จริงได้เลย'),
  e('nav',{className:'ai-tabs','aria-label':'พื้นที่ทำงาน AI'},
   ...[['chat','3 ผู้ช่วย AI'],['tasks','ประวัติ'],['bible','ข้อมูลเรื่อง'],['projects','โปรเจกต์'],['assets','คลังรูป / GitHub']].map(([id,label])=>
    button(label,()=>setView(id),{className:view===id?'active':'','aria-current':view===id?'page':null}))),
  e('div',{id:'aiWorkspaceContent',className:'ai-workspace-content'})
 );
 const area=rootElement.querySelector('#aiWorkspaceContent');
 if(view==='chat')renderChat(area);
 else if(view==='tasks')renderTasks(area);
 else if(view==='bible')renderBible(area);
 else if(view==='assets'){if(root.StoryArtVault)root.StoryArtVault.mount(area,bridge);else area.append(e('p',{className:'ai-error'},'ไม่พบโมดูลคลังรูป'))}
 else renderProjects(area);
}
function mount(){
 bridge=root.StoryStudioBridge;
 rootElement=document.querySelector('#aiWorkspacePanel');
 if(!rootElement||!bridge)return;
 const state=w();
 if(state.tasks.some(t=>t.status==='running'))persist(s=>{for(const t of s.tasks)if(t.status==='running')t.status='interrupted'});
 render();
}
root.StoryAIWorkspace=Object.freeze({mount,render,open:()=>bridge?.openWorkspace(),status,getBusy:()=>busy});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});
else mount();
})(window);
