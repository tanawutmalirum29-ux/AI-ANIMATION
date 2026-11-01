'use strict';
// Verify that headless Chromium (the AWS render environment) can encode the real
// Story Studio canvas + audio mixer without requiring a human click or a GPU.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json'};
const server=http.createServer((req,res)=>{
 const raw=decodeURIComponent((req.url||'/').split('?')[0]);
 const file=path.resolve(root,raw==='/'?'index.html':raw.slice(1));
 if(!file.startsWith(root+path.sep)||!types[path.extname(file)]||!fs.existsSync(file)){
  res.writeHead(404);res.end();return;
 }
 res.setHeader('Content-Type',types[path.extname(file)]);
 res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling']});
 try{
  const page=await browser.newPage({acceptDownloads:true,viewport:{width:1280,height:800}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'load'});
  const result=await page.evaluate(async()=>{
   const seconds=1.5,rate=16000,n=Math.floor(rate*seconds),b=new ArrayBuffer(44+n*2),view=new DataView(b);
   const w=(i,s)=>{for(let k=0;k<s.length;k++)view.setUint8(i+k,s.charCodeAt(k))};
   w(0,'RIFF');view.setUint32(4,36+n*2,true);w(8,'WAVE');w(12,'fmt ');
   view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
   view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);
   view.setUint16(34,16,true);w(36,'data');view.setUint32(40,n*2,true);
   for(let k=0;k<n;k++)view.setInt16(44+2*k,Math.sin(k/8)*12500,true);
   const bytes=new Uint8Array(b);let raw='';for(const v of bytes)raw+=String.fromCharCode(v);
   const audio='data:audio/wav;base64,'+btoa(raw);
   const E=newEp(1),sc=newScene();sc.duration=seconds;sc.voiceover='ทดสอบเสียง';
   sc.audioClips=[{id:'cloud-sound-test',kind:'voice',name:'test audio',data:audio,
    duration:seconds,at:0,volume:1,rate:1,trimStart:0,trimEnd:0,mute:false}];
   E.scenes=[sc];S=blank();S.project.title='cloud-export-test';S.episodes=[E];selEp=0;sel=0;T=0;
   fix();render();openVideoExport();
   document.getElementById('videoResolution').value='540';document.getElementById('videoFPS').value='12';
   const f=compatibleVideoFormats().find(f=>f.id==='webm8')||compatibleVideoFormats().find(f=>f.id==='webm');
   if(!f)throw new Error('WebM with audio unavailable on Chromium runner');
   document.getElementById('videoFormat').value=f.id;
   const orig=window.dlBlob;window.dlBlob=()=>{};
   try{await startVideoExport()}finally{window.dlBlob=orig}
   return {completed:EXPORT_JOB_OUTCOME,bytes:LAST_VIDEO?.blob?.size||0,
    status:document.getElementById('videoStatus').textContent,
    track:LAST_VIDEO?.blob?.type||'',
    processor:document.querySelector('#videoProcessor').value};
  });
  assert.equal(result.processor,'local','local remains the default');
  assert.equal(result.completed,true,result.status);
  assert.ok(result.bytes>2048,'real browser video was encoded');
  assert.match(result.track,/webm/i);
  const downloadWait=page.waitForEvent('download');
  await page.locator('#videoDownload').click();
  const file=await downloadWait;
  assert.match(file.suggestedFilename(),/\.webm$/);
  assert.deepEqual(errors,[],'no uncaught client-side errors');
  console.log('PASS AWS-like headless render using real browser: '+JSON.stringify(result));
 }finally{await browser.close();await new Promise(done=>server.close(done))}
})().catch(e=>{console.error(e);process.exitCode=1});
