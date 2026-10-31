/* Story Studio Narration Director v1 — deterministic pacing and frame planner.
   No remote AI, no external credentials: plans speech from subtitle timing and speaker.
   Keeps authored captions, protects manually recorded voice and adjusts only auto dub. */
(function(root){
'use strict';
const num=(x,d=0)=>Number.isFinite(Number(x))?Number(x):d;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function normalize(text){
 return String(text||'').replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').replace(/\.{4,}/g,'…').trim();
}
function plan(cues,options={}){
 const used=new Set(options.existing||[]),skip=options.skipExisting!==false;
 const maxChars=clamp(num(options.maxChars,240),60,450),maxCues=clamp(num(options.maxCues,4),1,8);
 const sorted=[...(cues||[])].filter(c=>c&&c.id&&normalize(c.text)).sort((a,b)=>num(a.start)-num(b.start));
 const out=[];let batch=null;
 const flush=()=>{if(batch){batch.text=batch.parts.join(' ').replace(/\s+([,.;!?。！？])/g,'$1');delete batch.parts;out.push(batch);batch=null}};
 for(const c of sorted){
  if(skip&&used.has(c.id)){flush();continue}
  const txt=normalize(c.text),speaker=String(c.speaker||options.speaker||''),emotion=String(c.emotion||options.emotion||'neutral');
  const start=Math.max(0,num(c.start)),end=Math.max(start,num(c.end,start));
  const join=batch&&batch.speaker===speaker&&batch.emotion===emotion&&
   batch.cueIds.length<maxCues&&batch.parts.join(' ').length+1+txt.length<=maxChars&&
   start-batch.end<=3.5&& !/[.!?。！？]$/.test(batch.parts[batch.parts.length-1]);
  if(!join){flush();batch={cueIds:[],parts:[],speaker,emotion,start,end}}
  batch.cueIds.push(c.id);batch.parts.push(txt);batch.end=Math.max(batch.end,end);
 }
 flush();return out;
}
/* Break overly long TTS requests into short, natural phrasing units.
 * Preserve every non-whitespace character of the author's narration. */
function splitNarration(text,maxChars=175){
 const raw=normalize(text),max=clamp(Math.floor(num(maxChars,175)),80,260);
 if(!raw)return[];
 if(Array.from(raw).length<=max)return[raw];
 const seg=typeof Intl!=='undefined'&&Intl.Segmenter?
  Array.from(new Intl.Segmenter('th',{granularity:'word'}).segment(raw),s=>s.segment):
  Array.from(raw);
 const units=[],pushChunk=s=>{if(s.trim())units.push(s.trim())};
 let chunk='';
 for(const token of seg){
  if(Array.from(chunk+token).length>max){
   if(chunk.trim())pushChunk(chunk);
   chunk='';
   if(Array.from(token).length>max){
    const letters=Array.from(token);
    for(let i=0;i<letters.length;i+=max)pushChunk(letters.slice(i,i+max).join(''));
    continue;
   }
  }
  chunk+=token;
  if(/[.!?。！？…ฯ]$/.test(chunk.trim())&&Array.from(chunk).length>=55){pushChunk(chunk);chunk=''}
 }
 pushChunk(chunk);
 // Don't silently drop author punctuation or Thai graphemes at boundaries.
 const preserve=s=>Array.from(s).filter(c=>!/\s/.test(c)).join('');
 if(preserve(units.join(''))!==preserve(raw))throw Error('Narration split changed authored text');
 return units;
}
function silenceTrim(buffer){
 if(!buffer||!buffer.length||!buffer.sampleRate||!buffer.numberOfChannels)return {start:0,end:0};
 const sr=buffer.sampleRate,windowSize=Math.max(1,Math.round(sr*.018)),maxDur=buffer.length/sr;
 const chan=Array.from({length:Math.min(2,buffer.numberOfChannels)},(_,i)=>buffer.getChannelData(i));
 let peak=0;for(let i=0;i<buffer.length;i+=Math.max(1,Math.floor(sr*.003)))
  for(const c of chan)peak=Math.max(peak,Math.abs(c[i]));
 if(peak<.006)return {start:0,end:0};
 const threshold=Math.max(.004,Math.min(.045,peak*.035));
 function energy(from,to){
  let sum=0,n=0;for(let i=from;i<to;i+=Math.max(1,Math.floor(sr*.003)))for(const c of chan){sum+=c[i]*c[i];n++}
  return Math.sqrt(sum/Math.max(1,n));
 }
 let first=0,last=buffer.length;
 for(let i=0;i<buffer.length;i+=windowSize){if(energy(i,Math.min(buffer.length,i+windowSize))>threshold){first=i;break}}
 for(let i=buffer.length;i>0;i-=windowSize){const from=Math.max(0,i-windowSize);if(energy(from,i)>threshold){last=i;break}}
 const leading=first/sr,trailing=(buffer.length-last)/sr;
 const start=leading>.16?Math.max(0,leading-.075):0;
 const end=trailing>.24?Math.max(0,trailing-.1):0;
 return {start:+clamp(start,0,maxDur*.8).toFixed(3),end:+clamp(end,0,Math.max(0,maxDur-start-.12)).toFixed(3)};
}
function isAuto(clip){return !!clip&&clip.kind==='voice'&&(clip.autoDub===true||/^auto-e\d+-s\d+-/.test(String(clip.name||'')))}
function duration(c,rateFn){const rate=clamp(num(rateFn?rateFn(c):c.rate,1),.2,4);return Math.max(0,(num(c.duration)-num(c.trimStart)-num(c.trimEnd))/rate)}
function layout(scene,options={}){
 if(!scene||!Array.isArray(scene.audioClips))return {clips:0,extended:0,seconds:0};
 const gap=clamp(num(options.gap,.16),.06,.8),padding=.18;
 const original=num(scene.duration,4),cues=Array.isArray(scene.subtitleCues)?scene.subtitleCues:[];
 const all=scene.audioClips.filter(c=>isAuto(c)&&c.data&&duration(c,options.rateOf)>0)
 .sort((a,b)=>num(a.at)-num(b.at));
 const manual=scene.audioClips.filter(c=>c.kind==='voice'&&!isAuto(c)&&c.data&&duration(c)>0)
 .map(c=>({start:num(c.at),end:num(c.at)+duration(c)})).sort((a,b)=>a.start-b.start);
 let cursor=.08,lastEnd=0;
 for(const c of all){
  const len=duration(c,options.rateOf);let pos=cursor;
  // Protect existing manual takes rather than overlapping a generated voice with them.
  for(const r of manual)if(pos<r.end+gap&&pos+len>r.start-gap)pos=r.end+gap;
  c.at=+pos.toFixed(3);const linked=new Set((c.cueIds&&c.cueIds.length?c.cueIds:[c.cueId]).filter(Boolean));
  const own=cues.filter(q=>linked.has(q.id)).sort((a,b)=>num(a.start)-num(b.start));
  if(own.length){
   const weights=own.map(q=>Math.max(1,Array.from(normalize(q.text)).length));
   const total=weights.reduce((a,b)=>a+b,0);let at=pos;
   own.forEach((q,i)=>{q.start=+at.toFixed(3);at+=len*weights[i]/total;q.end=+(i===own.length-1?pos+len:at).toFixed(3)});
  }
  cursor=pos+len+gap;lastEnd=Math.max(lastEnd,pos+len);
 }
 const needed=lastEnd+padding,extended=options.extend!==false&&needed>original+.02?Math.ceil(needed*10)/10-original:0;
 if(extended>0)scene.duration=+(original+extended).toFixed(2);
 return {clips:all.length,extended:+Math.max(0,extended).toFixed(2),seconds:+lastEnd.toFixed(2)};
}
root.StoryNarrationDirector=Object.freeze({normalize,plan,splitNarration,silenceTrim,layout,isAuto,duration});
})(typeof window!=='undefined'?window:globalThis);
