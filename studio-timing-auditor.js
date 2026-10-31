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
 function hasTimedEvents(scene){
  return !!(scene.video||(scene.actors||[]).length||(scene.graphicCards||[]).length||
   (scene.sfx||[]).length||(scene.customAssets||[]).some(a=>a?.animated)||
   scene.cinematicFx||scene.notes?.includes('[HOLD]')||scene.notes?.includes('[ค้างภาพ]'));
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
     else if(!hasEvents&&!bounds.other&&bounds.voice>0){
      // Only compress a truly passive scene. Respect timed captions and scene events.
      const held=Math.max(bounds.voice+.65,cueEnd+.12,1.5);
      if(old-held>=1.3){updated=rounded(held);kind='shorten';shortened+=old-updated}
     }else if(old-bounds.voice>1.3)kind='review';
    }else{
     unvoiced++;
     if(String(s.voiceover||'').trim())kind='needs-dub';
     else if(old>25)kind='review';
    }
    if(scope==='scene'&&sceneId&&s.id!==sceneId){updated=old;kind='other'}
    total+=old;nextTotal+=updated;
    const report={episode:ei+1,episodeId:ep.id,scene:si+1,sceneId:s.id,old:rounded(old),
     suggested:rounded(updated),voicedSeconds:rounded(bounds.voice),clips:bounds.voices,
     cueEnd:rounded(cueEnd),hasTimedEvents:hasEvents,kind};
    results.push(report);
    if(Math.abs(updated-old)>.01)ops.push({op:'updateScene',id:s.id,patch:{duration:rounded(updated)}});
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
 return Object.freeze({audit,clipSeconds,hasTimedEvents});
});