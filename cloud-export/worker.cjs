'use strict';
// Runs ONLY inside AWS CodeBuild. It uses a full Chromium browser to render the
// existing Story Studio timeline, then ffmpeg to produce portable H.264/AAC MP4.
// No video frames are rendered on the user's phone.
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const scratch = '/tmp/story-cloud-export';
const jobId = process.env.STUDIO_JOB_ID || '';
const bucket = process.env.STUDIO_BUCKET || '';
const key = 'jobs/' + jobId;
const aws = (...args) => execFileSync('aws', args, {encoding:'utf8',timeout:120000});
const run = (bin,args) => execFileSync(bin,args,{encoding:'utf8',stdio:'pipe',timeout:65*60*1000,maxBuffer:20*1024*1024});
const exists = p => fs.existsSync(p);
function fail(message) {throw new Error(message);}
function audioExpected(E) {
 const clips = [...(E.musicClips || []), ...(E.scenes||[]).flatMap(s=>s.audioClips||[])];
 return clips.some(c=>c && c.data && !c.mute && (c.volume===undefined || Number(c.volume)>0));
}
function remux(src,out,needAudio) {
 // Force a real encode instead of relabeling WebM as MP4. AAC audio is REQUIRED
 // when original episode has playable clips.
 run('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-y','-i',src,
  '-map','0:v:0','-map','0:a:0?', '-c:v','libx264','-preset','veryfast',
  '-crf','23','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k',
  '-movflags','+faststart','-shortest',out]);
 const streams=run('ffprobe',['-v','error','-show_entries','stream=codec_type',
  '-of','csv=p=0',out]).trim().split(/\r?\n/);
 if(!streams.includes('video'))fail('Output video track missing');
 if(needAudio && !streams.includes('audio'))fail('Output audio track missing');
 if(fs.statSync(out).size<2048)fail('Output video is empty');
}
async function main(){
 if(!/^[0-9a-f-]{36}$/.test(jobId)||!bucket)fail('Missing/invalid job configuration');
 fs.mkdirSync(scratch,{recursive:true});
 const inputFile=path.join(scratch,'input.json');
 aws('s3','cp','s3://'+bucket+'/'+key+'/input.json',inputFile,'--only-show-errors');
 const input=JSON.parse(fs.readFileSync(inputFile,'utf8'));
 if(!input.project || !Array.isArray(input.project.episodes)||!input.project.episodes.length)fail('Project has no episodes');
 const settings=input.settings||{};
 const scope=['current','separate','combined'].includes(settings.scope)?settings.scope:'current';
 const index=Math.max(0,Math.min(input.project.episodes.length-1,Math.floor(Number(settings.episodeIndex)||0)));
 const resolution=[540,720,1080].includes(Number(settings.resolution))?Number(settings.resolution):720;
 const fps=[12,24].includes(Number(settings.fps))?Number(settings.fps):24;
 const expected=scope==='current'?audioExpected(input.project.episodes[index]):input.project.episodes.some(audioExpected);
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required',
  '--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 let outputFile;
 try{
  const page=await browser.newPage({acceptDownloads:true,viewport:{width:1280,height:800},reducedMotion:'no-preference'});
  page.setDefaultTimeout(65*60*1000);
  const browserErrors=[];
  page.on('pageerror',e=>browserErrors.push(e.message));
  // Our site is static. Running it from a local HTTP server preserves canvas,
  // asset fetching, and the same render functions as the production website.
  const http=require('node:http');
  const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
  const server=http.createServer((req,res)=>{
   const raw=decodeURIComponent((req.url||'/').split('?')[0]);
   const file=path.resolve(root,raw==='/'?'index.html':raw.slice(1));
   if(!(file===path.join(root,'index.html')||file.startsWith(root+path.sep))||!exists(file)||!types[path.extname(file)]){
    res.writeHead(404);res.end();return;
   }
   res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-store'});
   fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
   await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'load'});
   const outcome=await page.evaluate(async ({project,scope,index,resolution,fps,captions})=>{
    S=normalize(project);selEp=index;sel=0;T=0;playing=false;fix();render();
    openVideoExport();
    document.querySelector('#videoScope').value=scope;
    document.querySelector('#videoResolution').value=String(resolution);
    document.querySelector('#videoFPS').value=String(fps);
    document.querySelector('#videoCaptions').checked=captions!==false;
    const formats=compatibleVideoFormats();
    const fmt=formats.find(x=>x.id==='webm8')||formats.find(x=>x.id==='webm')||formats.find(x=>x.id==='webmauto');
    if(!fmt)throw Error('Server Chromium does not support WebM with audio');
    document.querySelector('#videoFormat').value=fmt.id;
    // Suppress auto-downloading intermediate episodes; download final artifact
    // by an explicit browser click once the queue is complete.
    const original=window.dlBlob;window.dlBlob=()=>{};
    try{await startVideoExport()}finally{window.dlBlob=original}
    const status=document.querySelector('#videoStatus').textContent||'';
    const completed=scope==='separate'?!!EXPORT_BATCH_ZIP:!!LAST_VIDEO&&EXPORT_JOB_OUTCOME;
    return {completed,status,filename:scope==='separate'?EXPORT_BATCH_ZIP?.name:LAST_VIDEO?.filename};
   },{project:input.project,scope,index,resolution,fps,captions:settings.captions});
   if(!outcome.completed)fail('Browser export failed: '+outcome.status.slice(0,500));
   if(browserErrors.length)console.warn('Browser warnings:',browserErrors.slice(0,3));
   const dlPromise=page.waitForEvent('download',{timeout:60000});
   if(scope==='separate')await page.locator('#videoBatchResults .batch-download').click();
   else await page.locator('#videoDownload').click();
   const dl=await dlPromise;
   const source=path.join(scratch,scope==='separate'?'source.zip':'source.webm');
   await dl.saveAs(source);
   if(scope==='separate'){
    const unpack=path.join(scratch,'unpacked'),converted=path.join(scratch,'converted');
    fs.mkdirSync(unpack);fs.mkdirSync(converted);
    run('unzip',['-q','-j',source,'-d',unpack]);
    const webms=fs.readdirSync(unpack).filter(x=>x.endsWith('.webm'));
    if(webms.length!==input.project.episodes.length)fail('Incomplete episode export');
    for(let i=0;i<webms.length;i++){
     const name=webms[i];
     // ZIP is produced by the app in episode order, but enumeration order can vary.
     const matching=webms.find(x=>x.endsWith('-'+(i+1)+'.webm'));
     if(!matching)fail('Episode '+(i+1)+' missing');
     remux(path.join(unpack,matching),path.join(converted,matching.replace(/\.webm$/i,'.mp4')),audioExpected(input.project.episodes[i]));
    }
    outputFile=path.join(scratch,'result.zip');
    run('zip',['-q','-j',outputFile,...fs.readdirSync(converted).map(x=>path.join(converted,x))]);
   } else {
    outputFile=path.join(scratch,'result.mp4');
    remux(source,outputFile,expected);
   }
  }finally{await new Promise(resolve=>server.close(resolve))}
 }finally{await browser.close()}
 const ext=scope==='separate'?'zip':'mp4';
 aws('s3','cp',outputFile,'s3://'+bucket+'/'+key+'/result.'+ext,
  '--content-type',scope==='separate'?'application/zip':'video/mp4','--only-show-errors');
 console.log('Cloud export success',jobId,ext,fs.statSync(outputFile).size);
}
main().catch(err=>{
 console.error('Cloud export failure:',err.stack||err);
 try{
  const filename=path.join(scratch,'error.txt');fs.mkdirSync(scratch,{recursive:true});
  fs.writeFileSync(filename,String(err.message||err).slice(0,1000));
  if(/^[0-9a-f-]{36}$/.test(jobId)&&bucket)aws('s3','cp',filename,'s3://'+bucket+'/'+key+'/error.txt','--only-show-errors');
 }catch(e){console.error('Could not publish failure:',e.message)}
 process.exitCode=1;
});
