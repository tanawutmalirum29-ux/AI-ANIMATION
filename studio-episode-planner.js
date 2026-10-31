/* Story Studio — free, deterministic Thai script/episode planner.
 * No paid AI service. Keeps text and episode timing grounded in actual narration length.
 * All generated content is data only (never executable code). */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.StoryEpisodePlanner=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
 const clean=t=>String(t||'').replace(/\r\n?/g,'\n').trim();
 const norm=t=>String(t||'').replace(/\s+/g,' ').trim();
 function estimate(text,rate=6.5){
  const chars=Array.from(norm(text).replace(/\s/g,'')).length;
  const pauses=(String(text).match(/[.!?。！？…ฯ]/gu)||[]).length;
  return +Math.max(2.2,chars/clamp(Number(rate)||6.5,3,13)+.45*pauses+.9).toFixed(2);
 }
 function tokens(t){
  if(typeof Intl!=='undefined'&&Intl.Segmenter){
   return Array.from(new Intl.Segmenter('th',{granularity:'word'}).segment(t),x=>x.segment);
  }
  return Array.from(t);
 }
 function chunks(s,maxChars){
  const parts=[],add=x=>{if(x.trim())parts.push(x.trim())};
  let buf='';
  for(const part of tokens(s)){
   if(Array.from(buf+part).length>maxChars){
    if(buf.trim()){add(buf);buf=''}
    if(Array.from(part).length>maxChars){
     const letters=Array.from(part);for(let i=0;i<letters.length;i+=maxChars)add(letters.slice(i,i+maxChars).join(''));
     continue;
    }
   }
   buf+=part;
  }
  add(buf);return parts;
 }
 function sentences(source,maxChars=195){
  const lines=clean(source).split(/\n+/).map(t=>t.trim()).filter(Boolean);
  const units=[];
  for(const line of lines){
   // Sentence boundaries are hints, not permission to rewrite the author's words.
   const matches=line.match(/[^.!?。！？…]+[.!?。！？…]*|[.!?。！？…]+/gu)||[line];
   for(const raw of matches){
    const text=norm(raw);if(!text)continue;
    units.push(...chunks(text,maxChars));
   }
  }
  return units;
 }
 function subtitleCues(text,seconds,sceneId,max=28){
  const segments=chunks(norm(text),max);
  const letters=segments.map(x=>Math.max(1,Array.from(x).length));
  const total=letters.reduce((a,b)=>a+b,0);
  let at=0;
  return segments.map((part,i)=>{
   const start=+at.toFixed(2);
   at+=(seconds*letters[i]/total);
   return {id:sceneId+'c'+(i+1),text:part,start,end:+(i===segments.length-1?seconds:at).toFixed(2)};
  });
 }
 function plan(source,opts={}){
  const raw=clean(source);
  if(!raw)throw Error('ยังไม่มีบทสำหรับแบ่งตอน');
  if(Array.from(raw).length>60000)throw Error('บทเกิน 60,000 ตัวอักษร โปรดแบ่งนำเข้าเป็นช่วง');
  const targetMinutes=Number(opts.targetMinutes??5);
  if(!Number.isFinite(targetMinutes)||targetMinutes<1||targetMinutes>30)throw Error('ความยาวต่อตอนต้องอยู่ระหว่าง 1–30 นาที');
  const rate=Number(opts.charsPerSecond??6.5);
  if(!Number.isFinite(rate)||rate<3||rate>13)throw Error('อัตราการพากย์ไม่ถูกต้อง');
  const max=180,sceneMax=38,units=sentences(raw,max);
  if(!units.length)throw Error('ไม่พบบทพากย์ที่แบ่งได้');
  const scenes=[];let buffer='';
  function flush(){
   if(!buffer.trim())return;
   const text=norm(buffer),duration=estimate(text,rate);
   if(duration>50)throw Error('ฉากยาวเกินไป ไม่สามารถแบ่งเสียงให้ปลอดภัย');
   scenes.push({text,duration});
   buffer='';
  }
  for(const unit of units){
   const sep=buffer&&(/[A-Za-z0-9]$/.test(buffer)&&/^[A-Za-z0-9]/.test(unit)||/[.!?。！？…]$/.test(buffer))?' ':'';
   const joined=buffer?buffer+sep+unit:unit;
   if(buffer&&(Array.from(joined).length>max||estimate(joined,rate)>sceneMax))flush();
   buffer=buffer?buffer+((/[A-Za-z0-9]$/.test(buffer)&&/^[A-Za-z0-9]/.test(unit)||/[.!?。！？…]$/.test(buffer))?' ':'')+unit:unit;
  }
  flush();
  if(scenes.length>450)throw Error('บทสร้างฉากมากเกิน 450 ฉาก โปรดแบ่งนำเข้า');
  const targetSeconds=targetMinutes*60,episodes=[],random='script'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
  let collected=[],totalSeconds=0;
  const commit=()=>{
   if(!collected.length)return;
   const n=episodes.length+1,episodeId='ep'+random+n;
   let secs=0;
   const mapped=collected.map((item,i)=>{
    const id='s'+random+n+'x'+(i+1),duration=item.duration;
    secs+=duration;
    return {id,duration,voiceover:item.text,subtitle:[],subtitleCues:subtitleCues(item.text,duration,id,28),
      notes:'แบ่งบทและประมาณเวลาพากย์อัตโนมัติ · เวลาจริงอาจเปลี่ยนเมื่อสร้างเสียง'};
   });
   episodes.push({id:episodeId,title:'ตอนที่ '+n,targetSeconds,scenes:mapped,clues:[],estimatedSeconds:+secs.toFixed(2)});
   collected=[];totalSeconds=0;
  };
  for(const item of scenes){
   // Episode breaks follow speech-length estimates, not arbitrary scene count.
   if(collected.length&&totalSeconds>=targetSeconds*.65&&totalSeconds+item.duration>targetSeconds*1.08)commit();
   collected.push(item);totalSeconds+=item.duration;
  }
  commit();
  if(episodes.length>80)throw Error('จำนวนตอนเกิน 80 โปรดแบ่งนำเข้า');
  const flattened=episodes.flatMap(e=>e.scenes.map(s=>s.voiceover)).join(' ');
  const expected=norm(raw);
  if(flattened.replace(/\s+/g,'')!==expected.replace(/\s+/g,''))throw Error('ระบบตรวจพบข้อความต้นฉบับไม่ตรงกัน กรุณาลองแบ่งบทใหม่');
  const actualSeconds=episodes.reduce((a,e)=>a+e.estimatedSeconds,0);
  return {version:1,source:raw,targetSeconds,rate,episodes,totalScenes:scenes.length,totalSeconds:+actualSeconds.toFixed(2),
    warning:'เวลาที่แสดงเป็นค่าประมาณจากความยาวข้อความ ไม่ใช่เวลาของเสียงพากย์จริง'};
 }
 return Object.freeze({plan,estimate,sentences,subtitleCues});
});