#!/usr/bin/env node
'use strict';
// Static intake validator. Does not claim playback, audio, or visual QA.
const fs=require('node:fs');
const path=require('node:path');
function validate(doc){
 const issues=[],warn=[];
 const error=(where,message)=>issues.push({where,message});
 const warning=(where,message)=>warn.push({where,message});
 if(!doc||typeof doc!=='object'||Array.isArray(doc))return {ok:false,errors:[{where:'root',message:'Expected JSON object'}],warnings:[]};
 if(doc.version!==1)error('version','Expected version 1');
 const arrays=['episodes','characters','locations','voiceProfiles'];
 for(const k of arrays)if(!Array.isArray(doc[k]))error(k,'Expected array');
 const eps=Array.isArray(doc.episodes)?doc.episodes:[];
 const ids=(key)=>new Set((Array.isArray(doc[key])?doc[key]:[]).map(x=>x&&x.id).filter(Boolean));
 const chars=ids('characters'),locs=ids('locations'),voices=ids('voiceProfiles');
 const seen=new Set(),summaries=[];
 for(const [ei,ep] of eps.entries()){
  const prefix='episodes['+ei+']';
  if(!ep||typeof ep!=='object'){error(prefix,'Expected object');continue;}
  if(!ep.id||seen.has('episode:'+ep.id))error(prefix+'.id','Missing or duplicate episode ID');
  seen.add('episode:'+ep.id);
  if(!Array.isArray(ep.scenes)||!ep.scenes.length){error(prefix+'.scenes','No scenes');continue;}
  let total=0;
  for(const [si,s] of ep.scenes.entries()){
   const at=prefix+'.scenes['+si+']';
   if(!s||typeof s!=='object'){error(at,'Expected scene object');continue;}
   if(!s.id||seen.has('scene:'+s.id))error(at+'.id','Missing or duplicate scene ID');
   seen.add('scene:'+s.id);
   if(typeof s.duration!=='number'||!Number.isFinite(s.duration)||s.duration<=0)error(at+'.duration','Expected positive finite seconds');
   else total+=s.duration;
   if(!locs.has(s.location))error(at+'.location','Unknown location '+s.location);
   if(!Array.isArray(s.characters))error(at+'.characters','Expected array');
   else for(const id of s.characters)if(!chars.has(id))error(at+'.characters','Unknown character '+id);
   if(!Array.isArray(s.actors))error(at+'.actors','Expected array');
   else for(const actor of s.actors)if(!chars.has(actor?.char))error(at+'.actors','Unknown actor '+actor?.char);
   if(typeof s.voiceover!=='string'||!s.voiceover.trim())warning(at+'.voiceover','No narration text');
   if(s.voiceDirection?.voiceProfileId&&!voices.has(s.voiceDirection.voiceProfileId))error(at+'.voiceDirection','Unknown voice profile');
   if(Array.isArray(s.subtitleCues))for(const [ci,cue] of s.subtitleCues.entries()){
    if(typeof cue.start!=='number'||typeof cue.end!=='number'||cue.start<0||cue.end<=cue.start||cue.end>s.duration)error(at+'.subtitleCues['+ci+']','Cue outside scene duration');
   }
   if(!s.audio&&!Array.isArray(s.audioClips))warning(at+'.audio','No audio metadata');
   if(!s.audio&&(!s.audioClips||!s.audioClips.length))warning(at+'.timing','Duration is not verified against recorded narration');
  }
  summaries.push({episode:ep.id,scenes:ep.scenes.length,plannedSeconds:Number(total.toFixed(3)),targetSeconds:ep.targetSeconds??60});
  if(total>65)warning(prefix+'.duration','Planned duration exceeds 65 seconds');
 }
 if(!eps.length)error('episodes','No episodes');
 return {ok:issues.length===0,errors:issues,warnings:warn,summaries,counts:{episodes:eps.length,scenes:summaries.reduce((n,e)=>n+e.scenes,0),characters:chars.size,locations:locs.size}};
}
if(require.main===module){
 const files=process.argv.slice(2);
 if(!files.length){console.error('Usage: node training-lab/validate-story.cjs <story.json> [...]');process.exit(2);}
 let bad=false;
 for(const file of files){try{
  const report=validate(JSON.parse(fs.readFileSync(file,'utf8')));
  console.log(JSON.stringify({file:path.basename(file),...report},null,2));
  if(!report.ok)bad=true;
 }catch(e){bad=true;console.error(JSON.stringify({file,error:String(e.message)}));}}
 if(bad)process.exitCode=1;
}
module.exports={validate};
