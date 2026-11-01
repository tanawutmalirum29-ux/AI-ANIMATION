// Regression: narration must preview continuously and must never disappear from export silently.
const {chromium}=require('playwright');
const {Script}=require('node:vm');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).forEach(s=>new Script(s));
const server=http.createServer((req,res)=>{
 const route=decodeURIComponent((req.url||'/').split('?')[0]);
 const p=path.resolve(process.cwd(),route==='/'?'index.html':route.slice(1));
 if(!p.startsWith(process.cwd()+path.sep)||!/\.(html|js|css|json)$/.test(p)||!fs.existsSync(p)){res.writeHead(404);res.end();return}
 res.writeHead(200,{'Content-Type':p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html; charset=utf-8'});
 res.end(fs.readFileSync(p));
});
(async()=>{
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 const errors=[];
 try{
  const page=await browser.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'load'});
  await page.locator('#sceneSwitchSelect').waitFor();
  const result=await page.evaluate(async()=>{
   function wav(){
    const rate=16000,n=rate,b=new ArrayBuffer(44+n*2),v=new DataView(b);
    const str=(at,s)=>{for(let i=0;i<s.length;i++)v.setUint8(at+i,s.charCodeAt(i))};
    str(0,'RIFF');v.setUint32(4,36+n*2,true);str(8,'WAVE');str(12,'fmt ');
    v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
    v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);
    v.setUint16(34,16,true);str(36,'data');v.setUint32(40,n*2,true);
    for(let i=0;i<n;i++)v.setInt16(44+i*2,Math.round(Math.sin(i/15)*8000),true);
    const bytes=new Uint8Array(b);let s='';for(let i=0;i<bytes.length;i++)s+=String.fromCharCode(bytes[i]);
    return 'data:audio/wav;base64,'+btoa(s);
   }
   const voice={id:'reliability-test',kind:'voice',name:'Test voice',data:wav(),duration:1,at:0,volume:1,rate:1,trimStart:0,trimEnd:0,fadeIn:0,fadeOut:0,mute:false};
   commit(()=>{const E=ep();E.scenes=[Object.assign(newScene(),{duration:2,voiceover:'เสียงฉากแรก',audioClips:[voice]}),Object.assign(newScene(),{duration:2,voiceover:'เสียงฉากที่สอง',audioClips:[]})];sel=0;T=0});
   const missing=missingNarrationScenes();
   openVideoExport();await startVideoExport();const status=document.querySelector('#videoStatus').textContent;
   const ctx=previewContext();await ctx.resume();await primeVoicePreview(voice);
   toggle();
   const playingWebAudio=VOICE_PREVIEW_SOURCES.has('reliability-test:0');
   const htmlVoice=AUDIO_PLAYERS.has('reliability-test:0');
   toggle();
   const prep=await prepareExportAudio(ep(),{id:'webm'});
   const clips=prep.buffers.length,tracks=prep.destination.stream.getAudioTracks().length;
   for(const src of prep.sources)try{src.stop()}catch(e){};await prep.audio.close();
   ep().scenes[0].audioClips[0].data='data:audio/wav;base64,YmFk';
   let rejectsBadAudio=false;
   try{const broken=await prepareExportAudio(ep(),{id:'webm'});await broken.audio.close()}catch(e){rejectsBadAudio=true}
   // Exercise a real browser-recorded WebM with a 1-second synthesized WAV.
   // Merely counting MediaStream tracks does not prove the encoder muxed sound.
   const format=compatibleVideoFormats().find(f=>f.id==='webm8')||compatibleVideoFormats().find(f=>f.id==='webmauto');
   let actualExport=null;
   if(format){
    const realVoice={...voice,id:'verified-output',data:wav(),duration:1,at:0};
    commit(()=>{ep().scenes=[Object.assign(newScene(),{duration:1.4,voiceover:'ทดสอบเสียงจริง',audioClips:[realVoice]})];sel=0;T=0});
    document.querySelector('#videoFormat').value=format.id;
    document.querySelector('#videoResolution').value='540';
    document.querySelector('#videoFPS').value='12';
    await startVideoExport();
    actualExport={size:LAST_VIDEO?.blob.size||0,hasAudio:LAST_VIDEO?await StoryExportIntegrity.probeAudio(LAST_VIDEO.blob,'webm'):false,status:document.querySelector('#videoStatus').textContent};
   }
   return{missing,status,playingWebAudio,htmlVoice,clips,tracks,rejectsBadAudio,actualExport,exportGuardLoaded:typeof StoryExportIntegrity?.requireAudio==='function',silentMp4Exposed:VIDEO_FORMATS.some(f=>f.id==='mp4video'||f.name.includes('ไม่มีเสียง'))};
  });
  assert.deepEqual(result.missing,[2],'a narrated scene without its actual audio is flagged');
  assert.match(result.status,/ยังส่งออกไม่ได้/,'export is blocked instead of silently omitting narration');
  assert.equal(result.playingWebAudio,true,'voice playback is scheduled by WebAudio');
  assert.equal(result.htmlVoice,false,'voice must not fall back to blocked HTMLAudio');
  assert.equal(result.clips,1,'one audio clip reaches the export mixer');
  assert.equal(result.tracks,1,'export mixer exposes one audio track');
  assert.equal(result.rejectsBadAudio,true,'unreadable audio must abort instead of exporting silent video');
  assert.equal(result.exportGuardLoaded,true,'export must load output audio verifier');
  assert.equal(result.silentMp4Exposed,false,'video-only MP4 option must not be offered');
  assert.ok(result.actualExport?.size>2000,'actual browser encoder should produce an output video');
  assert.equal(result.actualExport?.hasAudio,true,'real exported WebM must contain a muxed audio track');
  assert.deepEqual(errors,[],'no browser exceptions');
  console.log('PASS audio preview / export integrity',result);
 }finally{await browser.close();await new Promise(done=>server.close(done))}
})().catch(e=>{console.error(e);process.exitCode=1});
