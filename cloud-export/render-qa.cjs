'use strict';
// Post-render measurements, not semantic vision. Times refer to the decoded file.
const {execFileSync,spawnSync}=require('node:child_process');
function inspect(file,{expectedAudio=false,expectedFps,expectedAspect,expectedDuration,scenes=[]}={}){
 const meta=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8',timeout:30000}));
 const streams=meta.streams||[],video=streams.find(s=>s.codec_type==='video'),audio=streams.find(s=>s.codec_type==='audio'),issues=[];
 const sceneAt=t=>{let at=0;for(const s of scenes){if(t<at+s.duration)return {scene:s.id,sceneTime:+(t-at).toFixed(3)};at+=s.duration;}return {};};
 const add=(code,severity,time,message)=>issues.push({code,severity,time,...sceneAt(time),message});
 if(!video)add('video-missing','error',0,'No video stream');
 if(expectedAudio&&!audio)add('audio-missing','error',0,'Expected audio stream missing');
 const [n,d]=String(video?.avg_frame_rate||'0/1').split('/').map(Number),fps=d?n/d:0,duration=Number(meta.format?.duration)||0;
 if(expectedFps&&Math.abs(fps-expectedFps)>.05)add('frame-rate','error',0,`Expected ${expectedFps} FPS; got ${fps}`);
 if(expectedAspect&&Math.abs(video.width/video.height-expectedAspect)>.01)add('aspect','error',0,'Output aspect ratio differs from project');
 if(!duration)add('duration','error',0,'Empty duration');
 const tolerance=Math.max(.1,2/(expectedFps||fps||24));
 if(expectedDuration&&Math.abs(duration-expectedDuration)>tolerance)add('timeline-duration','error',Math.min(duration,expectedDuration),`Expected ${expectedDuration}s timeline; got ${duration}s`);
 if(expectedDuration&&Number.isFinite(Number(video?.duration))&&Math.abs(Number(video.duration)-expectedDuration)>tolerance)add('video-duration','error',Math.min(Number(video.duration),expectedDuration),'Video stream ends at a different time from the rendered timeline');
 // Scale before decoding to raw gray; capped by duration limit of existing exporter.
 const pixels=execFileSync('ffmpeg',['-v','error','-i',file,'-an','-vf','fps=2,scale=48:48,format=gray','-f','rawvideo','-'],{timeout:240000,maxBuffer:32*1024*1024});
 const size=48*48,samples=[];let freezeStart=null;
 for(let i=0;i+size<=pixels.length;i+=size){let sum=0,delta=0;for(let j=0;j<size;j++){sum+=pixels[i+j];if(i)delta+=Math.abs(pixels[i+j]-pixels[i-size+j]);}
  const t=i/size/2,luma=sum/size/255,motion=delta/size/255;samples.push({time:t,luma:+luma.toFixed(4),motion:+motion.toFixed(4)});
  if(luma<.015)add('near-black','warning',t,'Near-black decoded frame; verify intentional darkness');
  if(luma>.985)add('near-white','warning',t,'Near-white decoded frame; verify flash');
  if(i&&motion<.0004){if(freezeStart===null)freezeStart=t-.5;}
  else if(freezeStart!==null){if(t-freezeStart>=2)add('possible-freeze','warning',freezeStart,`Similar frames for ${(t-freezeStart).toFixed(1)}s; verify an intentional hold`);freezeStart=null;}
 }
 if(freezeStart!==null&&duration-freezeStart>=2)add('possible-freeze','warning',freezeStart,'Similar frames through end of video');
 let maxVolume=null,silences=[];
 if(audio){const result=spawnSync('ffmpeg',['-hide_banner','-i',file,'-vn','-af','volumedetect,silencedetect=noise=-50dB:d=0.5','-f','null','-'],{encoding:'utf8',timeout:240000,maxBuffer:4*1024*1024});
  if(result.status!==0)add('audio-decode','error',0,'Unable to decode output audio');
  else{const log=result.stderr||'',m=log.match(/max_volume:\s*(-?[\d.]+|-inf) dB/);maxVolume=m?(m[1]==='-inf'?-Infinity:Number(m[1])):null;
   if(expectedAudio&&(maxVolume===null||maxVolume< -65))add('audio-silent','error',0,'Expected audio is silent');
   silences=[...log.matchAll(/silence_start:\s*([\d.]+)/g)].map(m=>Number(m[1]));
   // Silence is measured, not assumed to be an unintended dropout.
  }
 }
 return {schema:'render-qa/1',method:'decoded-pixel-and-audio-measurements',semanticModel:false,duration,fps,width:video?.width,height:video?.height,audio:{present:!!audio,maxVolumeDB:maxVolume,silenceStarts:silences},sampleInterval:.5,samples,issues,limitations:['Does not recognize anatomy, object identity, subtitle text, intended silence or artistic holds','Camera and semantic continuity require blueprint checks and human viewing']};
}
module.exports={inspect};
if(require.main===module){try{const result=inspect(process.argv[2],{expectedAudio:process.argv.includes('--expect-audio')});console.log(JSON.stringify(result,null,2));process.exitCode=result.issues.some(i=>i.severity==='error')?1:0;}catch(e){console.error(e.message);process.exitCode=1;}}
