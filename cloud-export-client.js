/* Cloud export interface: the phone uploads the project only. Rendering runs on AWS CodeBuild. */
(function(root){
 'use strict';
 const $=id=>document.getElementById(id);
 const choice=$('videoProcessor'),start=$('videoStart'),cancel=$('videoCancel');
 if(!choice||!start||!cancel)return;
 const configured=!!root.STORY_STUDIO_CONFIG?.cloudExportEnabled;
 const storeKey='storyStudio.cloudExport.pending.v1';
 let pending=null,busy=false,checking=false,timer=null,uploadAbort=null;
 const localStart=start.onclick,localCancel=cancel.onclick;
 const result=$('videoCloudResult'),hint=$('videoProcessorHint');
 const cloud=()=>choice.value==='server';
 function status(msg){$('videoStatus').textContent=msg}
 function pendingJob(value){pending=value;try{if(value)localStorage.setItem(storeKey,JSON.stringify(value));else localStorage.removeItem(storeKey)}catch(e){}}
 function loadJob(){try{const v=JSON.parse(localStorage.getItem(storeKey)||'null');if(v&&/^[0-9a-f-]{36}$/.test(v.jobId))return v}catch(e){}return null}
 function controls(){
  if(hint)hint.textContent=cloud()?
   (configured?'เซิร์ฟเวอร์ AWS เรนเดอร์ MP4 พร้อมเสียง · อัปโหลด JSON/ไฟล์เสียงจากโปรเจกต์ก่อน · มีค่าประมวลผลและค่าจัดเก็บบน AWS':
    'ยังไม่ได้ติดตั้ง Cloud Export: ต้อง Deploy ตัวเรนเดอร์บน AWS ก่อนใช้งาน'):
   'เครื่องนี้: เข้ารหัสในเบราว์เซอร์ ใช้ CPU/RAM ของโทรศัพท์ ไม่คิดค่าเรนเดอร์บน AWS';
  const localFormats=typeof compatibleVideoFormats==='function'?compatibleVideoFormats().length>0:true;
  choice.disabled=busy;
  start.disabled=busy||(cloud()?(!configured||!root.StoryStudioAccess?.isReady?.()):!localFormats);
  if($('videoFormat'))$('videoFormat').disabled=cloud();
  if($('videoPipelineStandard'))$('videoPipelineStandard').disabled=cloud()||busy;
  if($('videoPipelineTurbo'))$('videoPipelineTurbo').disabled=cloud()||busy;
  if(!cloud()&&typeof updateExportPipelineHint==='function')updateExportPipelineHint();
  if($('videoPipelineHint')&&cloud())$('videoPipelineHint').textContent='เซิร์ฟเวอร์: ส่งออกเป็น MP4 (H.264 + AAC) โดยใช้ Chromium และ FFmpeg บน AWS';
  cancel.disabled=!busy;
 }
 function setBusy(v){busy=!!v;controls();cancel.disabled=!busy}
 function showDownload(url,ext){
  if(!result)return;
  result.replaceChildren();result.hidden=false;
  const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';
  link.textContent='↓ ดาวน์โหลดวิดีโอ'+(ext==='zip'?'ทุกตอน (ZIP)':' MP4');
  link.style.cssText='display:inline-flex;padding:12px 16px;border-radius:10px;background:#e2c28c;color:#18263d;font-weight:700;text-decoration:none';
  result.append(link);
 }
 function api(payload){return root.StoryStudioAccess.request(payload)}
 function fail(err){
  setBusy(false);if(timer){clearTimeout(timer);timer=null}
  status('ส่งออกผ่านเซิร์ฟเวอร์ไม่สำเร็จ: '+String(err?.message||err));
 }
 async function poll(){
  if(!pending||checking||!root.StoryStudioAccess?.isReady?.())return;
  checking=true;
  try{
   const info=await api({action:'export.status',jobId:pending.jobId});
   if(info.state==='SUCCEEDED'&&info.downloadUrl){
    const finished=pending;pending=null;
    try{localStorage.setItem(storeKey,JSON.stringify({...finished,finished:true}))}catch(e){}
    setBusy(false);$('videoProgress').value=100;
    status('เรนเดอร์บนเซิร์ฟเวอร์สำเร็จ · ดาวน์โหลดไฟล์ได้ด้านล่าง (ลิงก์มีอายุ 15 นาที)');
    showDownload(info.downloadUrl,info.extension);return;
   }
   if(['FAILED','FAULT','TIMED_OUT','STOPPED'].includes(info.state)){
    pendingJob(null);fail(info.error||'AWS หยุดงานส่งออก ('+info.state+')');return;
   }
   setBusy(true);$('videoProgress').removeAttribute('value');
   status(info.state==='QUEUED'||info.state==='UPLOADING'?
    'อยู่ในคิว AWS · สามารถสลับแอปหรือกลับมาใหม่ได้ งานไม่หยุด':
    'AWS กำลังเรนเดอร์วิดีโอ · ปิดหน้าจอหรือสลับแอปได้');
  }catch(err){
   if(err.status===401||err.status===403){status('เข้าสู่สตูดิโอใหม่เพื่อดูผลการส่งออก');return}
   status('กำลังเชื่อมต่อ AWS อีกครั้ง: '+String(err?.message||err));
  }finally{
   checking=false;
   if(pending)timer=setTimeout(poll,6000);
  }
 }
 async function cloudStart(){
  if(busy||!configured)return;
  if(!root.StoryStudioAccess?.isReady?.()){status('กรุณาเข้าสู่ระบบสตูดิโอก่อน');return}
  const current=String($('videoScope')?.value||'current');
  if(!['current','combined','separate'].includes(current)){status('ขอบเขตส่งออกไม่ถูกต้อง');return}
  const selection=Number($('videoResolution')?.value||720),fps=Number($('videoFPS')?.value||24);
  // Copy serializable app state INCLUDING embedded audio. No local video frames.
  let payload;
  try{
   const snapshot=JSON.parse(JSON.stringify(S));
   if(!snapshot.episodes?.length)throw Error('ไม่มีตอนสำหรับส่งออก');
   const targets=current==='current'?[snapshot.episodes[selEp]]:snapshot.episodes;
   for(const episode of targets){
    if(!episode.scenes?.length||episode.scenes.reduce((n,s)=>n+Number(s.duration||0),0)>1800)throw Error('ตอนยาวเกิน 30 นาทีหรือไม่มีฉาก');
    for(let i=0;i<episode.scenes.length;i++){
     const s=episode.scenes[i];
     if(String(s.voiceover||'').trim()&&!((s.audioClips||[]).some(c=>c.kind==='voice'&&c.data&&!c.mute)))
      throw Error('ตอน '+(snapshot.episodes.indexOf(episode)+1)+' ฉาก '+(i+1)+' มีบทพากย์แต่ยังไม่มีไฟล์เสียงจริง');
    }
   }
   if(current==='combined'&&targets.reduce((n,E)=>n+E.scenes.reduce((a,s)=>a+Number(s.duration||0),0),Math.max(0,targets.length-1)*2.5)>1800)
    throw Error('วิดีโอรวมเกิน 30 นาที · เลือกทุกตอนแบบแยกไฟล์');
   payload=JSON.stringify({project:snapshot,settings:{
    scope:current,episodeIndex:selEp,resolution:selection,fps,captions:$('videoCaptions').checked
   }});
  }catch(e){status('ยังส่งออกไม่ได้: '+e.message);return}
  const bytes=new Blob([payload],{type:'application/json'});
  if(bytes.size>100*1024*1024){status('ไฟล์โปรเจกต์เกิน 100 MB · กรุณาลดขนาดไฟล์เสียง/รูปก่อน');return}
  setBusy(true);if(result){result.hidden=true;result.replaceChildren()}
  uploadAbort=new AbortController();
  try{
   status('กำลังเตรียมงานและส่งไฟล์โปรเจกต์ขึ้น AWS…');$('videoProgress').removeAttribute('value');
   const prepared=await api({action:'export.prepare'});
   if(!prepared.jobId||!prepared.uploadUrl)throw Error('ไม่ได้รับลิงก์อัปโหลดจาก AWS');
   const uploaded=await fetch(prepared.uploadUrl,{method:'PUT',
    headers:{'Content-Type':'application/json'},body:bytes,signal:uploadAbort.signal});
   if(!uploaded.ok)throw Error('อัปโหลดโปรเจกต์ไม่สำเร็จ (HTTP '+uploaded.status+')');
   pendingJob({jobId:prepared.jobId,createdAt:Date.now()});
   const result=await api({action:'export.start',jobId:prepared.jobId});
   if(result.error)throw Error(result.error);
   uploadAbort=null;
   status('ส่งงานสำเร็จ · AWS กำลังเตรียมคิวเรนเดอร์ ไม่ต้องเปิดหน้าเว็บค้างไว้');
   await poll();
  }catch(err){
   uploadAbort=null;
   pendingJob(null);
   fail(err);
  }
 }
 choice.addEventListener('change',controls);
 start.onclick=function(){if(cloud())void cloudStart();else if(localStart)localStart.call(this)};
 cancel.onclick=function(){
  if(!cloud()){if(localCancel)localCancel.call(this);return}
  if(uploadAbort)uploadAbort.abort();
  if(pending){const id=pending.jobId;pendingJob(null);api({action:'export.cancel',jobId:id}).catch(()=>{})}
  if(timer){clearTimeout(timer);timer=null}
  setBusy(false);status('ส่งคำขอยกเลิกไปยัง AWS แล้ว');
 };
 function resume(){
  if(!configured||pending||!root.StoryStudioAccess?.isReady?.())return;
  const saved=loadJob();if(!saved)return;
  pending=saved;setBusy(true);status('พบงานบน AWS ที่ยังไม่ได้รับผล · กำลังตรวจสอบ');
  void poll();
 }
 root.addEventListener('story-studio-access-change',()=>{controls();resume()});
 controls();resume();
})(window);
