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
   (scene.cinematicFx&&timed(scene.cinematicFx))||
   /\[(?:HOLD|PAUSE|ค้างภาพ)\]/i.test(String(scene.notes||'')));
 }
 // Leave a modest visual beat after narration. Long un-timed walks and camera
 // pans play at scene-relative speed, so a 36s imported duration must not force
 // 30 seconds of silence after the voice is finished.
 function visualTail(scene){
  const actors=scene.actors||[];
  const moving=actors.some(a=>a&&(a.toX!==undefined||a.toY!==undefined||
    Array.isArray(a.route)&&a.route.length>0||a.endPose||a.motion))||
   (scene.camera&&scene.camera.type&&scene.camera.type!=='static')||
   (scene.customAssets||[]).some(a=>a?.animated)||!!scene.cinematicFx;
  return moving?2.4:actors.length?1.25:.65;
 }
 function audit(state,options={}){
  const eps=state?.episodes;if(!Array.isArray(eps))throw Error('ไม่มี episodes จากโปรเจกต์');
  const scope=options.scope||'episode',index=Math.max(0,finite(options.episodeIndex)),
   sceneId=options.sceneId,rateOf=options.rateOf;
  const target=clamp(finite(options.targetMinutes,5),1,30)*60;
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
     targetSeconds:target,overBy:rounded(Math.max(0,nextTotal-target)),clips:clipCount});
  });
  const issues=results.filter(r=>!['ok','other'].includes(r.kind));
  return {ops,scenes:results,issues,episodes:episodeReports,stats:{
    inspected:results.length,withVoice:covered,withoutVoice:unvoiced,shortened:rounded(shortened),
    extended:rounded(extended),edits:ops.length,overlongEpisodes:episodeReports.filter(e=>e.overBy>5).length
  }};
 }

 /* Split only at EXISTING scene boundaries, preserving the complete original scene
  * objects and their actors/FX/audio. Never split a single rich scene or move
  * episode-level music, clue markers, opening, or explicit continuity automatically. */
 function planEpisodeSplits(state,report,options={}){
  const target=clamp(finite(options.targetMinutes,5),1,30)*60;
  const ops=[],warnings=[],updates=new Map(report.ops.filter(o=>o.op==='updateScene').map(o=>[o.id,o.patch.duration]));
  let inserted=0,created=0;
  (state.episodes||[]).forEach((ep,ei)=>{
   if(options.scope!=='all'&&ei!==Math.max(0,finite(options.episodeIndex)))return;
   const scenes=ep.scenes||[];
   const seconds=scenes.reduce((a,s)=>a+finite(updates.get(s.id),finite(s.duration,4)),0);
   if(seconds<=target*1.12||scenes.length<2)return;
   if((ep.clues||[]).length||(ep.musicClips||[]).length||ep.opening||ep.continuity){
    warnings.push('ตอน '+(ei+1)+' ยาวเกินเป้า แต่มีเพลง/เบาะแส/การเชื่อมต่อข้ามตอน ต้องเลือกจุดแบ่งเอง');
    return;
   }
   const groups=[],group=[],flush=()=>{if(group.length){groups.push(group.splice(0))}};
   let used=0;
   for(const s of scenes){
    const duration=finite(updates.get(s.id),finite(s.duration,4));
    if(group.length&&used+duration>target*1.05&&used>=target*.45){flush();used=0}
    group.push(s);used+=duration;
   }
   flush();
   if(groups.length<2){warnings.push('ตอน '+(ei+1)+' มีฉากเดียวที่ยาวเกิน ไม่แยกภาพเคลื่อนไหวอัตโนมัติ');return}
   const now=Date.now().toString(36);
   ops.push({op:'replaceScenes',episode:ep.id,scenes:groups[0]});
   if(ep.cliffhanger)ops.push({op:'updateEpisode',id:ep.id,patch:{cliffhanger:''}});
   for(let n=1;n<groups.length;n++){
    const sceneGroup=groups[n],last=n===groups.length-1;
    ops.push({op:'addEpisode',index:ei+inserted+n,episode:{
     id:'split'+now+'e'+ei+'p'+n,
     title:(ep.title||'ตอนที่ '+(ei+1))+' · ส่วน '+(n+1),
     targetSeconds:target,scenes:sceneGroup,clues:[],
     cliffhanger:last?(ep.cliffhanger||''):''
    }});
    created++;
   }
   inserted+=groups.length-1;
  });
  return {ops,created,warnings};
 }
 return Object.freeze({audit,clipSeconds,hasTimedEvents,planEpisodeSplits});
});