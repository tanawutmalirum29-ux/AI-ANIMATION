'use strict';
const {execFileSync}=require('node:child_process');

// MediaRecorder and AAC buffering can leave a silent tail beyond the final
// video frame. Bound both streams to the timeline the browser actually rendered.
// The browser validates playable audio against that timeline before exporting.
function encodeMP4(source,output,{expectedDuration,expectedFps=24,expectedAudio=false,timeout=65*60*1000}={}){
 if(!Number.isFinite(expectedDuration)||expectedDuration<=0||expectedDuration>1800)throw Error('Invalid rendered timeline duration');
 if(![12,24,30].includes(expectedFps))throw Error('Unsupported output frame rate');
 execFileSync('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-y','-i',source,
  '-map','0:v:0','-map','0:a:0?','-c:v','libx264','-preset','veryfast','-crf','23',
  '-pix_fmt','yuv420p','-r',String(expectedFps),'-c:a','aac','-b:a','128k',
  '-movflags','+faststart',...(expectedAudio?['-af','apad']:[]),'-t',String(expectedDuration),output],
 {stdio:'pipe',timeout,maxBuffer:20*1024*1024});
}
module.exports={encodeMP4};
