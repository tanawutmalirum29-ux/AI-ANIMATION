// Regression: narration preview must stay on one decoded Web Audio source instead of seeking MP3 every frame.
const {chromium}=require('playwright');
const {Script}=require('node:vm');
const fs=require('node:fs'),http=require('node:http');
const assert=require('node:assert/strict');
const paths=['index.html','animated-map.js','animated-map.css','cinematic-fx.js','cinematic-fx.css','character-interaction.js','character-interaction.css'];
const html=fs.readFileSync('index.html','utf8');
[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).forEach(x=>new Script(x));
const server=http.createServer((req,res)=>{const p=(req.url||'/').split('?')[0].slice(1)||'index.html';if(!paths.includes(p)){res.writeHead(404);res.end('missing');return}res.writeHead(200,{'Content-Type':p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'text/html; charset=utf-8'});res.end(fs.readFileSync(p))});
(async()=>{
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 const errors=[];
 try{
  const page=await browser.newPage();
  page.on('pageerror',e=>errors.push(e.stack||e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'load'});
  await page.locator('#sceneSwitchSelect').waitFor({timeout:15000});
  const out=await page.evaluate(async()=>{
   const wav=(sec=1.6,rate=16000)=>{const n=Math.floor(sec*rate),b=new ArrayBuffer(44+n*2),v=new DataView(b);
    const str=(at,s)=>{for(let i=0;i<s.length;i++)v.setUint8(at+i,s.charCodeAt(i))};
    str(0,'RIFF');v.setUint32(4,36+n*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,n*2,true);
    for(let i=0;i<n;i++)v.setInt16(44+i*2,Math.round(Math.sin(i/16)*7000),true);
    const a=new Uint8Array(b);let s='';for(let i=0;i<a.length;i++)s+=String.fromCharCode(a[i]);return 'data:audio/wav;base64,'+btoa(s)};
   const data=wav();const make=(id,at)=>({id,kind:'voice',name:id,data,duration:1.6,at,volume:1,trimStart:0,trimEnd:0,rate:1,fadeIn:0,fadeOut:0,mute:false});
   commit(()=>{const scene=sc();scene.duration=4;scene.audioClips=[make('narration-a',0),make('narration-b',1.7)]});
   const ctx=previewContext();await ctx.resume();
   const buffer=await ctx.decodeAudioData(await(await fetch(data)).arrayBuffer());
   rememberVoicePreviewBuffer(data,buffer);
   syncAudioAt(.1,true);
   const first=VOICE_PREVIEW_SOURCES.get('narration-a:0');
   const firstCount=VOICE_PREVIEW_SOURCES.size,htmlCount=AUDIO_PLAYERS.size;
   syncAudioAt(.19,true);syncAudioAt(.24,true);
   const sameSource=VOICE_PREVIEW_SOURCES.get('narration-a:0')?.source===first?.source;
   syncAudioAt(1.45,true);
   const secondEarly=VOICE_PREVIEW_SOURCES.has('narration-b:0');
   syncAudioAt(1.85,true);
   const secondActive=VOICE_PREVIEW_SOURCES.has('narration-b:0');
   const firstGone=!VOICE_PREVIEW_SOURCES.has('narration-a:0');
   syncAudioAt(3.6,true);
   const ended=VOICE_PREVIEW_SOURCES.size===0;
   syncAudioAt(.1,true);syncAudioAt(.1,false);
   const paused=VOICE_PREVIEW_SOURCES.size===0;
   const exp=await prepareExportAudio(ep(),{id:'webm'});
   const exportClips=exp.buffers.filter(x=>x.clip.kind==='voice').length;
   for(const source of exp.sources)try{source.stop()}catch(e){};await exp.audio.close();
   return{firstCount,htmlCount,sameSource,secondEarly,secondActive,firstGone,ended,paused,exportClips,cacheCount:VOICE_PREVIEW_BUFFERS.size};
  });
  assert.equal(out.firstCount,1,'voice begins with one Web Audio source');
  assert.equal(out.htmlCount,0,'voice must not fall back to HTML Audio on supported browser');
  assert.ok(out.sameSource,'continuous playback must reuse the same source across frames');
  assert.ok(out.secondEarly,'next cue must be scheduled before its start');
  assert.ok(out.secondActive&&out.firstGone,'next cue takes over without restarting previous voice');
  assert.ok(out.ended&&out.paused,'finished or paused sources must be released');
  assert.equal(out.exportClips,2,'export audio must still include both cues');
  assert.deepEqual(errors,[],'page exceptions');
  console.log('PASS voice preview uninterrupted buffer scheduling:',JSON.stringify(out));
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);process.exit(1)});
