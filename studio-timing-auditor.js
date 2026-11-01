/* Imported JSON timeline audit. Observe actual voice clips; never invent a story,
 * split/duplicate animation events, or trim deliberately animated scenes.
 * Produces validated, undoable operations for Story Studio's existing API. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.StoryTimingAuditor=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const finite=(n,d=0)=>Number.isFinite(Number(n))?Number(n):d;
 const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
 const rounded=n=>Math.round(n*100)/100;
 const clipSeconds=(c,rateOf)=>Math.max(0,(finite(c.duration)-finite(c.trimStart)-finite(c.trimEnd))/
   clamp(rateOf?finite(rateOf(c),1):finite(c.rate,1),.2,4));
 function ends(scene,rateOf){
  let voice=0,other=0,voices=0;
  for(const c of scene.audioClips||[]){
   if(!c?.data||c.mute||c.loop)continue;
   const len=clipSeconds(c,rateOf);
   if(!len)continue;
   const end=Math.max(0,finite(c.at))+len;
   if(c.kind==='voice'){voice=Math.max(voice,end);voices++}
   else other=Math.max(other,end);
  }
  return {voice,other,voices};
 }
 // Ordinary characters, camera movement and decorative FX are visual content,
 // not a request to keep the frame alive for the entire imported JSON duration.
 // Protect only explicitly timed story beats and intentional holds.
 function hasTimedEvents(scene){
  const timed=x=>x&&typeof x==='object'&&
   ['at','time','start','end','duration'].some(k=>typeof x[k]==='number'&&x[k]>0);
  return !!(scene.video||
   (scene.actors||[]).some(a=>a&&(typeof a.to==='number'&&a.to>0||
     typeof a.at==='number'&&a.at>0))||
   (scene.graphicCards||[]).some(timed)||(scene.sfx||[]).some(timed)||
   // Actual timed poses / SVG events may finish after narration: never chop them.
   (scene.actors||[]).some(a=>Array.isArray(a?.motionKeys)&&
     a.motionKeys.some(k=>Number.isFinite(k?.t)&&k.t>0))||
   (scene.customAssets||[]).some(a=>Array.isArray(a?.motionKeys)&&
     a.motionKeys.some(k=>Number.isFinite(k?.t)&&k.t>0))||
   (scene.cinematicFx&&timed(scene.cinematicFx))||
   /\[(?:HOLD|PAUSE|ค้างภาพ)\]/i.test(String(scene.notes||'')));
 }
 // Leave a modest visual beat after narration. Long un-timed walks and camera
 // pans play at scene-relative speed, so a 36s imported duration must not force
 // 30 seconds of silence after the voice is finished.
 function visualTail(scene){
  const actors=scene.actors||[];
  const moving=actors.some(a=>a&&(a.toX!==undefined||a.toY!==undefined||
    Array.isArray(a.route)&&a.route.length>0||a.endPose||a.motion||
    Array.isArray(a.motionKeys)&&a.motionKeys.length>1))||
   (scene.camera&&scene.camera.type&&scene.camera.type!=='static')||
   (scene.customAssets||[]).some(a=>a?.animated||a?.motionKeys?.length>1)||!!scene.cinematicFx;
  // Measured 2026-11-01 user exports: six ~2.5–2.7s silent tails per episode.
  // Keep only a short visual breath after completed speech. Longer dramatic
  // holds must be marked explicitly ([HOLD], [PAUSE], or timed events).
  return moving?.9:actors.length?.65:.45;
 }
 function audit(state,options={}){
  const eps=state?.episodes;if(!Array.isArray(eps))throw Error('ไม่มี episodes จากโปรเจกต์');
  const scope=options.scope||'episode',index=Math.max(0,finite(options.episodeIndex)),
   sceneId=options.sceneId,rateOf=options.rateOf;
  const target=clamp(finite(options.targetMinutes,1),1,30)*60;
  const results=[],ops=[],episodeReports=[];
  let shortened=0,extended=0,covered=0,unvoiced=0;
  eps.forEach((ep,ei)=>{
   if(scope!=='all'&&ei!==index)return;
   let total=0,nextTotal=0,clipCount=0;
   (ep.scenes||[]).forEach((s,si)=>{
    const old=Math.max(.1,finite(s.duration,4));
    const bounds=ends(s,rateOf),hasEvents=hasTimedEvents(s);
    const q=(s.subtitleCues||[]).filter(x=>x&&typeof x.text==='string'&&x.text.trim());
    const cueEnd=q.length?Math.max(...q.map(x=>finite(x.end))):0;
    const last=Math.max(bounds.voice,bounds.other);
    let updated=old,kind='ok';
    if(bounds.voices){
     covered++;clipCount+=bounds.voices;
     // Long scene with narration still running: expand rather than cut off audio.
     const required=Math.max(1.2,last+.35);
     if(required>old+.12){updated=rounded(required);kind='extend';extended+=updated-old}
     else if(old-last>1.3){
      if(hasEvents||bounds.other>bounds.voice+.25)kind='review';
      else {
       // Measure the end of ALL non-looping audio, not the imported subtitle
       // timestamps (which may have inherited the bad 36-second duration).
       // A visible actor alone does not mean 36 seconds of scripted motion.
       const held=Math.max(1.5,last+visualTail(s));
       if(old-held>=1.3){updated=rounded(held);kind='shorten';shortened+=old-updated}
      }
     }
    }else{
     unvoiced++;
     if(String(s.voiceover||'').trim())kind='needs-dub';
     else if(old>25)kind='review';
    }
    if(scope==='scene'&&sceneId&&s.id!==sceneId){updated=old;kind='other'}
    total+=old;nextTotal+=updated;
    const report={episode:ei+1,episodeId:ep.id,scene:si+1,sceneId:s.id,old:rounded(old),
     suggested:rounded(updated),voicedSeconds:rounded(bounds.voice),clips:bounds.voices,
     cueEnd:rounded(cueEnd),hasTimedEvents:hasEvents,
     visualTailSeconds:rounded(visualTail(s)),kind};
    results.push(report);
    if(Math.abs(updated-old)>.01){
     const patch={duration:rounded(updated)};
     // Imported caption cues sometimes inherited an exaggerated scene duration.
     // Align their timing to the actual completed narration on passive scenes.
     if(kind==='shorten'&&q.length&&cueEnd>updated-.1){
      const scale=Math.min(1,(updated-.1)/Math.max(.1,cueEnd));
      patch.subtitleCues=s.subtitleCues.map(cue=>{
       if(!cue||typeof cue!=='object')return cue;
       return {...cue,start:rounded(Math.max(0,finite(cue.start)*scale)),
        end:rounded(clamp(finite(cue.end)*scale,0,updated-.05))};
      });
     }
     ops.push({op:'updateScene',id:s.id,patch});
    }
   });
   episodeReports.push({episode:ei+1,id:ep.id,old:rounded(total),projected:rounded(nextTotal),
     targetSeconds:target,hardMaxSeconds:target+5,
     overBy:rounded(Math.max(0,nextTotal-target)),
     beyondTolerance:rounded(Math.max(0,nextTotal-(target+5))),
     underBy:rounded(Math.max(0,target-nextTotal)),clips:clipCount});
  });
  const issues=results.filter(r=>!['ok','other'].includes(r.kind));
  return {ops,scenes:results,issues,episodes:episodeReports,stats:{
    inspected:results.length,withVoice:covered,withoutVoice:unvoiced,shortened:rounded(shortened),
    extended:rounded(extended),edits:ops.length,overlongEpisodes:episodeReports.filter(e=>e.overBy>5).length
  }};
 }

 /* Collaboration contract: upstream composition, SVG, and motion run before
  * dubbing and audio-aware timing, followed by final QA.
  * 60 seconds is the target, 65 seconds is the allowed +5 second upper tolerance.
  * Never add filler, truncate speech, duplicate scenes or invent missing visuals to hit 60.
  */
 const EPISODE_TARGET_SECONDS=60,EPISODE_MAX_SECONDS=65;
 function packScenes(scenes,durationOf,target,max){
  const n=scenes.length,best=Array(n+1).fill(null);
  best[n]={score:0,groups:[]};
  for(let i=n-1;i>=0;i--){
   let sum=0;
   for(let j=i+1;j<=n;j++){
    sum+=durationOf(scenes[j-1]);
    if(sum>max&&j>i+1)break; // single long scene remains indivisible
    const rest=best[j];
    if(!rest)continue;
    // Reward 60..65 second groups; make any unavoidable short tail explicit.
    const penalty=sum>max?1e6+Math.pow(sum-max,2)*1000:
     sum<target?Math.pow(target-sum,2)*2+40:Math.pow(sum-target,2)*.12;
    const candidate={score:rest.score+penalty+2,groups:[scenes.slice(i,j),...rest.groups]};
    if(!best[i]||candidate.score<=best[i].score)best[i]=candidate;
   }
  }
  return best[0]?.groups||[scenes];
 }
 /* Preserve every original event and its ordering. A single authored scene above
  * 65 seconds cannot be split safely without retiming the animation and voice. */
 function planEpisodeSplits(state,report,options={}){
  const target=clamp(finite(options.targetMinutes,1),1,30)*60,max=target+5;
  const ops=[],warnings=[],episodePlans=[];
  const updates=new Map((report?.ops||[]).filter(o=>o.op==='updateScene').map(o=>[o.id,o.patch.duration]));
  let inserted=0,created=0;
  (state.episodes||[]).forEach((ep,ei)=>{
   if(options.scope==='scene')return;
   if(options.scope!=='all'&&ei!==Math.max(0,finite(options.episodeIndex)))return;
   const scenes=Array.isArray(ep.scenes)?ep.scenes:[];
   if(!scenes.length)return;
   const durationOf=sc=>Math.max(.1,finite(updates.get(sc.id),finite(sc.duration,4)));
   const seconds=scenes.reduce((a,sc)=>a+durationOf(sc),0);
   const locked=(ep.clues||[]).length||(ep.musicClips||[]).length||ep.opening||ep.continuity;
   let groups=[scenes],reason='';
   if(seconds>max+.01){
    if(scenes.length<2)reason='มีฉากเดียวเกิน '+max+' วินาที ต้องแบ่งฉากพร้อมตรวจบท/เสียงเอง';
    else if(locked)reason='มีเพลง/เบาะแส/ข้อมูลเชื่อมต่อระดับตอน จึงไม่ย้ายฉากอัตโนมัติ';
    else groups=packScenes(scenes,durationOf,target,max);
   }
   const groupTimes=groups.map(g=>rounded(g.reduce((sum,sc)=>sum+durationOf(sc),0)));
   groupTimes.forEach((length,gi)=>{
    if(length>max+.01)warnings.push('ตอน '+(ei+1)+' ส่วน '+(gi+1)+' ยาว '+length+' วินาที เกินเพดาน '+max+
     (reason?' · '+reason:' · ฉากยาวฉากเดียวต้องจัดแบ่งโดยรักษาเหตุการณ์/ไฟล์เสียง'));
    else if(length<target-.01)warnings.push('ตอน '+(ei+1)+' ส่วน '+(gi+1)+' ยาว '+length+
     ' วินาที ยังต่ำกว่า '+target+' · ไม่ยืดภาพนิ่งหรือเพิ่มบทปลอมเพื่อให้ครบ');
   });
   if(reason&&!groupTimes.some(t=>t>max))warnings.push('ตอน '+(ei+1)+' '+reason);
   episodePlans.push({episode:ei+1,id:ep.id,before:rounded(seconds),parts:groupTimes,
    withinWindow:groupTimes.every(t=>t>=target-.01&&t<=max+.01),
    needsManualWork:groupTimes.some(t=>t>max+.01),locked:!!locked});
   if(groups.length>1){
    const suffix=(Date.now().toString(36)+ei.toString(36));
    ops.push({op:'replaceScenes',episode:ep.id,scenes:groups[0]});
    if(ep.cliffhanger)ops.push({op:'updateEpisode',id:ep.id,patch:{cliffhanger:''}});
    for(let n=1;n<groups.length;n++){
     ops.push({op:'addEpisode',index:ei+inserted+n,episode:{
      id:'split'+suffix+'p'+n,
      title:(ep.title||'ตอนที่ '+(ei+1))+' · ส่วน '+(n+1),
      targetSeconds:target,scenes:groups[n],clues:[],
      cliffhanger:n===groups.length-1?(ep.cliffhanger||''):''
     }});
     created++;
    }
    inserted+=groups.length-1;
   }
   // Existing imported episodes may have no target, or still be set to five minutes.
   if(finite(ep.targetSeconds)!==target)
    ops.push({op:'updateEpisode',id:ep.id,patch:{targetSeconds:target}});
  });
  return {ops,created,warnings,episodes:episodePlans,targetSeconds:target,maxSeconds:max};
 }
 /* The Auto Dub button operates on live projects, not on exported MP4s.
  * Return safe, undoable patches for COMPLETELY generated narration only.
  * A partial/failed TTS run must never silently cut the remaining script.
  * Preserve all manual takes and explicit timed cinematic actions. */
 function planAutoDubTightening(state,targetScenes,options={}){
  const targets=new Map((targetScenes||[]).filter(s=>s&&s.id).map(s=>[s.id,s]));
  if(!targets.size)return {ops:[],skipped:[],shortenedSeconds:0};
  const report=audit(state,{scope:'all',rateOf:options.rateOf});
  const operations=report.ops.filter(op=>op.op==='updateScene'&&
   targets.has(op.id)&&op.patch?.duration<targets.get(op.id).duration-.01);
  const ops=[],skipped=[];let shortenedSeconds=0;
  for(const op of operations){
   const scene=targets.get(op.id),voices=(scene.audioClips||[]).filter(c=>
    c?.kind==='voice'&&c.data&&!c.mute&&clipSeconds(c,options.rateOf)>.05);
   // This action is specifically for automatic narration; never re-time manual
   // voice recordings without explicit user review.
   if(!voices.length||voices.some(c=>!(c.autoDub===true||
    /^auto-e\\d+-s\\d+-/.test(String(c.name||''))))){
    skipped.push({sceneId:scene.id,reason:'manual-or-missing-voice'});continue;
   }
   const narration=String(scene.voiceover||'').trim();
   const provided=new Set(voices.flatMap(c=>[
      c.cueId,...(Array.isArray(c.cueIds)?c.cueIds:[])
   ].filter(Boolean)));
   if(narration){
    const parts=typeof options.splitNarration==='function'?
      options.splitNarration(narration,175):[];
    if(!parts.length||parts.some((_,i)=>!provided.has(
      'narration-'+scene.id+'-part'+(i+1)))){
     skipped.push({sceneId:scene.id,reason:'incomplete-narration'});continue;
    }
   }else if((scene.subtitleCues||[]).some(q=>
     String(q?.text||'').trim()&&!provided.has(q.id))){
    skipped.push({sceneId:scene.id,reason:'incomplete-subtitle-dub'});continue;
   }
   shortenedSeconds+=scene.duration-op.patch.duration;
   ops.push(op);
  }
  return {ops,skipped,shortenedSeconds:rounded(shortenedSeconds)};
 }
 return Object.freeze({audit,clipSeconds,hasTimedEvents,planAutoDubTightening,planEpisodeSplits,packScenes,EPISODE_TARGET_SECONDS,EPISODE_MAX_SECONDS});
});