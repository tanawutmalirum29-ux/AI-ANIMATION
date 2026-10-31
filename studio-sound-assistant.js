/* Story Studio Audio AI: deterministic, free, offline cue planning.
 * Reads user-authored scenes without writing scripts, characters, shots or captions.
 * This module only plans IDs from the existing original synthesized sound catalog. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.StoryAudioAssistant=api;
})(typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const AMBIENT=[
  ['rain-heavy',/ฝนตกหนัก|พายุฝน|ห่าฝน|rainstorm|heavy rain/i],
  ['thunder',/ฟ้าคะนอง|สายฟ้า|ฟ้าร้อง|ฟ้าผ่า|thunder|lightning/i],
  ['rain-soft',/ฝน|ฝนพรำ|rain/i],
  ['waterfall',/น้ำตก|waterfall/i],
  ['stream',/ลำธาร|ลำคลอง|น้ำไหล|stream|creek/i],
  ['sea',/ทะเล|ชายหาด|คลื่น|ริมทะเล|beach|ocean|sea\b/i],
  ['night',/กลางคืน.*ป่า|ป่ายามค่ำ|จิ้งหรีด|nocturnal|night forest/i],
  ['forest',/ป่า|ต้นไม้หนาแน่น|forest|woods/i],
  ['wind',/ลมแรง|ลมพายุ|พายุลม|windy|strong wind/i],
  ['fire',/กองไฟ|ไฟลุก|เปลวไฟ|fireplace|campfire/i],
  ['snow',/หิมะ|snow|blizzard/i],
  ['traffic',/รถติด|การจราจร|ทางด่วน|traffic/i],
  ['city',/เมือง|ถนน|road|city|street/i],
  ['market',/ตลาด|market/i],
  ['cafe',/คาเฟ่|ร้านกาแฟ|cafe|coffee shop/i],
  ['train',/รถไฟ|สถานีรถไฟ|railway|train/i],
  ['office',/สำนักงาน|ออฟฟิศ|office/i],
  ['classroom',/ห้องเรียน|โรงเรียน|classroom|school/i],
  ['portal',/ประตูมิติ|portal|warp/i],
  ['magic',/เวทมนตร์|ร่ายเวท|magic|spell/i],
  ['dungeon',/คุกใต้ดิน|ดันเจียน|ถ้ำ|dungeon|cave/i],
  ['haunted',/ผีสิง|บ้านร้าง|ผี|haunted|ghost/i],
  ['spaceship',/ยานอวกาศ|กระสวยอวกาศ|spaceship|spacecraft/i],
  ['underwater',/ใต้น้ำ|ใต้ทะเล|underwater/i]
 ];
 const EVENTS=[
  ['door',/เปิดประตู|ปิดประตู|ประตูเปิด|ประตูปิด|เคาะประตู|door opens|door closes|knock/i],
  ['step',/เดินเข้า|เดินออก|เดินผ่าน|ฝีเท้า|วิ่งหนี|เดินเท้า|footsteps|running footsteps/i],
  ['hit',/ต่อย|เตะ|ฟาด|กระแทก|ปะทะ|ชนกำแพง|ฟาดฟัน|ชก|impact|punch|hit\b/i],
  ['bell',/ระฆัง|กระดิ่ง|เสียงกริ่ง|กริ่งดัง|bell rings|bell\b/i],
  ['whoosh',/พุ่งผ่าน|ลมวูบ|หายวับ|วูบผ่าน|whosh|whoosh|swoosh/i],
  ['glitch',/ระบบขัดข้อง|สัญญาณรบกวน|จอภาพแตก|glitch|static signal/i],
  ['heartbeat',/หัวใจเต้น|หัวใจเต้นแรง|ตกใจกลัว|heartbeat/i]
 ];
 const MUSIC=[
  ['m-horror',/สยอง|ผีสิง|น่ากลัว|horror/i],
  ['m-suspense',/ระทึก|ลุ้น|ไล่ล่า|คับขัน|suspense|thriller/i],
  ['m-mystery',/ปริศนา|ลึกลับ|สืบสวน|mystery/i],
  ['m-action',/สงคราม|ต่อสู้|แอ็กชัน|action|battle/i],
  ['m-sad',/เศร้า|สูญเสีย|เสียใจ|sad|grief/i],
  ['m-romance',/โรแมนติก|รักกัน|romance/i],
  ['m-comedy',/ตลก|ขำขัน|comedy/i],
  ['m-epic',/ยิ่งใหญ่|มหากาพย์|epic/i],
  ['m-fantasy',/แฟนตาซี|เวทมนตร์|fantasy/i]
 ];
 const limit=(n,lo,hi)=>Math.min(hi,Math.max(lo,Number.isFinite(+n)?+n:lo));
 const has=(text,re)=>re.test(text);
 function labelLocation(state,scene){
  const loc=(state.locations||[]).find(l=>l.id===scene.location);
  return (loc?.name||'')+' '+(loc?.promptBlock||'');
 }
 function cueText(scene){
  const parts=[scene.voiceover||'',scene.notes||'',scene.imagePrompt||'',...(scene.subtitle||[])];
  for(const cue of scene.subtitleCues||[])if(typeof cue?.text==='string')parts.push(cue.text);
  return parts.join(' ').slice(0,9000);
 }
 function eventTimes(scene,re){
  const D=limit(scene.duration,0.5,3600),events=[];
  for(const cue of scene.subtitleCues||[])if(typeof cue?.text==='string'&&has(cue.text,re)){
   const at=limit(cue.start,0,Math.max(0,D-.1));if(!events.some(t=>Math.abs(t-at)<.5))events.push(at);
  }
  if(!events.length){
   const lines=String(scene.notes||'')+' '+String(scene.voiceover||'')+' '+(scene.subtitle||[]).join(' ');
   if(has(lines,re))events.push(+Math.min(D*.4,D-0.1).toFixed(2));
  }
  return events.slice(0,1);
 }
 function selectSounds(state,scene,available){
  const context=cueText(scene)+' '+labelLocation(state,scene);
  const script=cueText(scene);
  const sounds=[],D=limit(scene.duration,0.5,3600);
  const ambient=AMBIENT.find(([id,rx])=>available.has(id)&&has(context,rx));
  if(ambient)sounds.push({presetId:ambient[0],at:0,volume:.18,loop:true,kind:'ambience'});
  // Sound effects attach to caption timestamps where present, otherwise a conservative
  // midpoint estimate. No effects inferred solely from location name.
  for(const [id,re] of EVENTS){
   if(!available.has(id))continue;
   const times=eventTimes(scene,re);
   if(times.length)sounds.push({presetId:id,at:times[0],volume:.3,loop:false,kind:'event'});
   if(sounds.filter(x=>x.kind==='event').length>=2)break;
  }
  // Only select music when the AUTHOR has explicitly described a mood or music.
  const mood=String(scene.notes||'')+' '+String(scene.voiceDirection?.notes||'');
  const music=MUSIC.find(([id,re])=>available.has(id)&&has(mood,re));
  if(music&&!ambient)sounds.push({presetId:music[0],at:0,volume:.11,loop:true,kind:'music'});
  return sounds.map(x=>({...x,at:limit(x.at,0,Math.max(0,D-.1))}));
 }
 function plan(state,catalog,scope='episode',sceneIndex=0,episodeIndex=0){
  if(!Array.isArray(state?.episodes)||!Array.isArray(catalog))throw Error('ไม่พบข้อมูลโปรเจกต์หรือคลังเสียง');
  const available=new Set(catalog.map(x=>x.id));
  const episodes=scope==='all'?state.episodes.map((e,i)=>[e,i]):[[state.episodes[episodeIndex],episodeIndex]];
  const result=[];
  for(const [ep,ei] of episodes){
   if(!ep||!Array.isArray(ep.scenes))continue;
   ep.scenes.forEach((scene,si)=>{
    if(scope==='scene'&&si!==sceneIndex) return;
    if(!scene?.id)return;
    const sounds=selectSounds(state,scene,available);
    result.push({episodeIndex:ei,sceneIndex:si,sceneId:scene.id,sounds});
   });
  }
  return result;
 }
 return Object.freeze({plan,selectSounds,cueText});
});
