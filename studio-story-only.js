/* Story-only JSON interchange for Story Studio.
 * Pure, reversible text-to-scenes adapter. No image, render, TTS, GPU or provider calls.
 * Video projects are not modified unless explicitly imported through Story Only.
 */
(function(root,factory){
'use strict';
const api=factory();
if(typeof module==='object'&&module.exports)module.exports=api;
if(root)root.StoryOnlyJSON=api;
})(typeof globalThis!=='undefined'?globalThis:null,function(){
'use strict';
const TYPE='story-only',MAX_TOTAL=200000,MAX_EPISODES=80,MAX_SCENES=400,MAX_CHUNK=1100;
const plain=v=>typeof v==='string'?v:'';
const clean=v=>String(v==null?'':v).trim();
const validId=v=>typeof v==='string'&&/^[a-z][a-z0-9_-]{0,79}$/.test(v);
const clone=obj=>JSON.parse(JSON.stringify(obj));
function appearsTextOnly(data){
 if(!data||typeof data!=='object'||Array.isArray(data))return false;
 if(data.type===TYPE||data.format===TYPE||data.project?.mode===TYPE)return true;
 if(typeof data.story==='string'||Array.isArray(data.chapters)||Array.isArray(data.paragraphs))return true;
 if(!Array.isArray(data.episodes)||!data.episodes.length)return false;
 if((data.characters||[]).length||(data.locations||[]).length)return false;
 return data.episodes.every(ep=>{
  if(!ep||typeof ep!=='object')return false;
  if(typeof ep.text==='string'||typeof ep.story==='string'||Array.isArray(ep.paragraphs))return true;
  if(!Array.isArray(ep.scenes)||!ep.scenes.length)return false;
  return ep.scenes.every(sc=>
   typeof sc==='string'||(sc&&typeof sc==='object'&&
   (typeof sc.text==='string'||typeof sc.voiceover==='string'||typeof sc.narration==='string')&&
   !['image','video','imagePrompt','actors','camera','rig','motionKeys','lighting'].some(k=>sc[k]!=null)));
 });
}
function paragraphs(text){
 const normalized=clean(text).replace(/\r\n?/g,'\n');
 if(!normalized)return [];
 // Preserve original punctuation/word order, splitting only for context size.
 const blocks=normalized.split(/\n{2,}/).map(s=>s.trim()).filter(Boolean);
 const out=[];
 for(const block of blocks){
  let remaining=block;
  while(remaining.length>MAX_CHUNK){
   const head=remaining.slice(0,MAX_CHUNK+1);
   const punctuation=Math.max(head.lastIndexOf('。'),head.lastIndexOf('ฯ'),head.lastIndexOf('!'),
    head.lastIndexOf('?'),head.lastIndexOf('।'),head.lastIndexOf('\n'));
   const whitespace=head.lastIndexOf(' ');
   const cut=punctuation>MAX_CHUNK*.55?punctuation+1:whitespace>MAX_CHUNK*.55?
    whitespace:MAX_CHUNK;
   out.push(remaining.slice(0,cut).trim());
   remaining=remaining.slice(cut).trimStart();
  }
  if(remaining.trim())out.push(remaining.trim());
 }
 return out;
}
function sceneTexts(item){
 if(typeof item==='string')return paragraphs(item);
 if(!item||typeof item!=='object')throw Error('ฉากต้องเป็นข้อความหรือ object');
 const s=plain(item.text)||plain(item.voiceover)||plain(item.narration)||plain(item.story);
 if(!s.trim())throw Error('มีฉากว่างหรือไม่มี text/voiceover');
 return paragraphs(s);
}
function episodesFrom(source){
 if(Array.isArray(source.chapters))return source.chapters.map((c,i)=>({
   title:clean(c?.title)||'บทที่ '+(i+1),
   id:validId(c?.id)?c.id:'ep'+(i+1),
   entries:Array.isArray(c?.scenes)?c.scenes:Array.isArray(c?.paragraphs)?c.paragraphs:
    [plain(c?.text)||plain(c?.story)||plain(c?.content)]
 }));
 if(Array.isArray(source.episodes))return source.episodes.map((ep,i)=>({
  title:clean(ep?.title)||'ตอนที่ '+(i+1),
  id:validId(ep?.id)?ep.id:'ep'+(i+1),
  entries:Array.isArray(ep?.scenes)?ep.scenes:Array.isArray(ep?.paragraphs)?ep.paragraphs:
   [plain(ep?.text)||plain(ep?.story)||plain(ep?.content)]
 }));
 const all=typeof source.story==='string'?source.story:Array.isArray(source.paragraphs)?
  source.paragraphs:source.text;
 return [{title:'ตอนที่ 1',id:'ep1',entries:Array.isArray(all)?all:[plain(all)]}];
}
function convert(data){
 if(!appearsTextOnly(data))throw Error('ไม่ใช่ JSON เนื้อเรื่องล้วน');
 const size=JSON.stringify(data).length;
 if(size>MAX_TOTAL)throw Error('JSON เนื้อเรื่องเกิน 200,000 ตัวอักษร');
 const requested=episodesFrom(data);
 if(!requested.length||requested.length>MAX_EPISODES)throw Error('จำนวนตอนต้องอยู่ระหว่าง 1–80');
 const used=new Set(),episodeIds=new Set(),episodes=[];
 let count=0;
 for(let i=0;i<requested.length;i++){
  const ep=requested[i];
  if(!Array.isArray(ep.entries)||!ep.entries.length)throw Error('ตอนที่ '+(i+1)+' ไม่มีเนื้อเรื่อง');
  let epId=ep.id;
  if(episodeIds.has(epId))epId='ep'+(i+1);
  if(episodeIds.has(epId))throw Error('episode id ซ้ำ');
  episodeIds.add(epId);
  const scenes=[];
  for(let j=0;j<ep.entries.length;j++){
   const original=ep.entries[j];
   const chunks=sceneTexts(original);
   for(let k=0;k<chunks.length;k++){
    if(++count>MAX_SCENES)throw Error('เนื้อเรื่องเกิน 400 ฉาก กรุณาแบ่งไฟล์');
    let id=typeof original==='object'&&validId(original.id)&&chunks.length===1?
      original.id:'s'+count;
    if(used.has(id))id='s'+count;
    if(used.has(id))throw Error('ID ฉากซ้ำ');
    used.add(id);
    scenes.push({id,voiceover:chunks[k],duration:Math.max(4,Math.min(65,
     Math.ceil([...chunks[k]].length/11))),subtitle:[],imagePrompt:'',
     notes:typeof original==='object'?clean(original.notes).slice(0,350):''});
   }
  }
  if(!scenes.length)throw Error('ตอนที่ '+(i+1)+' ไม่มีข้อความ');
  episodes.push({id:epId,title:ep.title,scenes});
 }
 const title=clean(data.project?.title||data.title||data.name)||'เรื่องใหม่';
 return {version:1,type:TYPE,project:{title:title.slice(0,160),mode:TYPE,aspect:'9:16',
  fps:30,styleSuffix:''},characters:[],locations:[],rules:[],episodes};
}
function convertIfNeeded(d){return appearsTextOnly(d)?convert(d):d}
function exportTextOnly(project){
 if(!project?.episodes||!Array.isArray(project.episodes))throw Error('ไม่มีบทให้ส่งออก');
 const episodes=project.episodes.map((ep,i)=>({id:validId(ep.id)?ep.id:'ep'+(i+1),
  title:clean(ep.title)||'ตอนที่ '+(i+1),scenes:(ep.scenes||[])
  .filter(s=>typeof s?.voiceover==='string'&&s.voiceover.trim())
  .map(s=>({id:validId(s.id)?s.id:'s'+i,text:s.voiceover,
   ...(s.notes?{notes:s.notes}:{} )}))}));
 if(!episodes.length||episodes.every(ep=>!ep.scenes.length))throw Error('โปรเจกต์ไม่มีบทพากย์');
 return {version:1,type:TYPE,title:clean(project.project?.title)||'เรื่องใหม่',
  episodes};
}
function stats(project){
 const episodes=Array.isArray(project?.episodes)?project.episodes:[];
 return {episodes:episodes.length,scenes:episodes.reduce((n,e)=>n+(e.scenes||[]).filter(
  s=>typeof s.voiceover==='string'&&s.voiceover.trim()).length,0),
  characters:episodes.reduce((n,e)=>n+(e.scenes||[]).reduce(
   (m,s)=>m+[...(s.voiceover||'')].length,0),0)};
}
return Object.freeze({TYPE,appearsTextOnly,paragraphs,convert,convertIfNeeded,exportTextOnly,stats});
});
