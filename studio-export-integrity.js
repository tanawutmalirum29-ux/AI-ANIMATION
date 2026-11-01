/* Story Studio export integrity: do not offer a downloaded "success" file if
   an audio-bearing project was encoded without an audio stream. No dependencies. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.StoryExportIntegrity=api;
})(typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const MAX_PROBE_BYTES=2*1024*1024;
 function asciiAt(bytes,index,value){
  if(index<0||index+value.length>bytes.length)return false;
  for(let i=0;i<value.length;i++)if(bytes[index+i]!==value.charCodeAt(i))return false;
  return true;
 }
 function hasMp4Audio(bytes){
  // ISO BMFF hdlr box: size[4] + 'hdlr'[4] + version[4] + predefined[4] + handler_type[4].
  // Require the exact 'soun' handler rather than searching arbitrary encoded audio bytes.
  for(let i=4;i+16<=bytes.length;i++){
   if(!asciiAt(bytes,i,'hdlr')||!asciiAt(bytes,i+12,'soun'))continue;
   const size=((bytes[i-4]*0x1000000)+(bytes[i-3]<<16)+(bytes[i-2]<<8)+bytes[i-1])>>>0;
   if(size>=20&&size<=65536)return true;
  }
  return false;
 }
 function hasWebmAudio(bytes){
  // WebM CodecID is in the TrackEntry near the start of the container.
  // Browsers use Opus or Vorbis for MediaRecorder's WebM audio track.
  for(const codec of ['A_OPUS','A_VORBIS','A_AAC','A_PCM']){
   for(let i=0;i+codec.length<=bytes.length;i++)if(asciiAt(bytes,i,codec))return true;
  }
  return false;
 }
 async function probeAudio(blob,ext){
  if(!blob||typeof blob.slice!=='function'||!Number.isFinite(blob.size)||blob.size<32)return false;
  const size=Math.min(MAX_PROBE_BYTES,blob.size);
  const head=new Uint8Array(await blob.slice(0,size).arrayBuffer());
  const mp4=String(ext).toLowerCase()==='mp4';
  const check=mp4?hasMp4Audio:hasWebmAudio;
  if(check(head))return true;
  if(blob.size>size){
   const tail=new Uint8Array(await blob.slice(Math.max(size,blob.size-MAX_PROBE_BYTES)).arrayBuffer());
   if(check(tail))return true;
  }
  return false;
 }
 async function requireAudio(blob,ext){
  if(!await probeAudio(blob,ext)){
   throw new Error('ไฟล์วิดีโอที่เข้ารหัสไม่มีแทร็กเสียงจริง จึงยกเลิกการดาวน์โหลด · เลือก MP4 แบบมีเสียงหรือ WebM แล้วลองใหม่ หากยังไม่สำเร็จให้ตรวจเสียงพากย์ใน Sound Desk');
  }
  return true;
 }
 return {probeAudio,requireAudio,hasMp4Audio,hasWebmAudio};
});
