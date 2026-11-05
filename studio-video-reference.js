/* Local video measurements. Semantic observations remain explicitly unknown. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.StoryVideoReference=api;})(typeof window!=='undefined'?window:globalThis,function(){
'use strict';
function difference(a,b){if(!a||!b||!a.length||a.length!==b.length)return 0;let d=0;for(let i=0;i<a.length;i++)d+=Math.abs(a[i]-b[i]);return d/a.length/255;}
function blueprint(samples,duration,meta={}){
 if(!Number.isFinite(duration)||duration<=0)throw Error('ความยาววิดีโอไม่ถูกต้อง');
 const cuts=[{time:0,score:0}];
 for(let i=1;i<samples.length;i++){const s=samples[i];if(s.delta>.12&&s.time-cuts.at(-1).time>.6&&duration-s.time>.25)cuts.push({time:s.time,score:s.delta});}
 return {schema:'video-reference/1',method:'sampled-frame-difference',semanticModel:false,cutThreshold:.12,duration,...meta,
  limitations:['จุดเปลี่ยนภาพเป็นข้อเสนอจากความต่างพิกเซล แฟลชหรือกล้องเร็วอาจเป็นผลบวกลวง','เวลาคลาดเคลื่อนได้ตามช่วงสุ่มเฟรม; ช็อตสั้นอาจไม่ถูกตรวจพบ','ยังไม่ตรวจตัวละคร สิ่งของ ท่าทาง ความลึก หรือกล้องแบบ semantic','ข้อมูลภาพอยู่ในเครื่อง ไม่อัปโหลดวิดีโอ'],
  shots:cuts.map((c,i)=>({id:'shot-'+(i+1),start:c.time,end:cuts[i+1]?.time??duration,boundary:{source:'pixel-difference',score:c.score,reviewed:false},scene:null,characters:null,objects:null,camera:null,depth:null,lighting:null,actions:null,style:null,uncertainties:['ต้องตรวจรายละเอียดภาพและเหตุการณ์โดยผู้ใช้หรือโมเดลที่รองรับ']})),
  samples:samples.map(({time,delta,luma})=>({time,delta,luma}))};
}
async function analyze(file,{signal,onProgress=()=>{},step=.5,maxDuration=180}={}){
 if(!file||file.size>100*1024*1024)throw Error('เลือกวิดีโอขนาดไม่เกิน 100 MB');
 const url=URL.createObjectURL(file),video=document.createElement('video');video.muted=true;video.preload='auto';video.playsInline=true;
 const wait=(event,act)=>new Promise((resolve,reject)=>{
  let timer;const cleanup=()=>{clearTimeout(timer);video.removeEventListener(event,done);video.removeEventListener('error',fail);signal?.removeEventListener('abort',abort);};
  const done=()=>{cleanup();resolve();},fail=()=>{cleanup();reject(Error('เบราว์เซอร์อ่านวิดีโอนี้ไม่ได้ ลองใช้เบราว์เซอร์รุ่นล่าสุด หรือแปลงเป็น MP4 (H.264/AAC) หรือ WebM'));},abort=()=>{cleanup();reject(new DOMException('ยกเลิกการวิเคราะห์','AbortError'));};
  if(signal?.aborted){abort();return;}video.addEventListener(event,done,{once:true});video.addEventListener('error',fail,{once:true});signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(fail,12000);act();
 });
 try{
  await wait('loadeddata',()=>{video.src=url;video.load()});
  const duration=video.duration;if(!Number.isFinite(duration)||duration<=0||duration>maxDuration)throw Error('รองรับวิดีโอความยาวไม่เกิน '+maxDuration+' วินาที');
  const canvas=document.createElement('canvas');canvas.width=48;canvas.height=48;const ctx=canvas.getContext('2d',{willReadFrequently:true}),samples=[];let previous;
  for(let time=0;time<duration;time+=step){
   if(signal?.aborted)throw new DOMException('ยกเลิกการวิเคราะห์','AbortError');
   const target=Math.min(duration-.01,Math.max(.001,time));if(Math.abs(video.currentTime-target)>.0001)await wait('seeked',()=>{video.currentTime=target});
   ctx.drawImage(video,0,0,48,48);const pixels=ctx.getImageData(0,0,48,48).data,gray=new Uint8Array(48*48);let total=0;
   for(let j=0;j<gray.length;j++){gray[j]=Math.round(.2126*pixels[j*4]+.7152*pixels[j*4+1]+.0722*pixels[j*4+2]);total+=gray[j];}
   samples.push({time:+time.toFixed(3),delta:+difference(gray,previous).toFixed(4),luma:+(total/gray.length/255).toFixed(4)});previous=gray;
   onProgress({completed:samples.length,total:Math.ceil(duration/step),time});
  }
  return blueprint(samples,duration,{filename:file.name,width:video.videoWidth,height:video.videoHeight,sampleInterval:step});
 }finally{video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
}
return Object.freeze({difference,blueprint,analyze});
});
