'use strict';
// Mobile Safari preview recovery: no silent audio on first tap, an intelligible
// diagnostic for missing audio, and a decoded-buffer fallback on desktop.
// The iPad user agent runs on Chromium in CI; real WebKit/device verification
// remains separate from this browser regression.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 const errors=[];
 const wav=String.raw`function makeTone(){
  const rate=16000,n=rate*2,b=new ArrayBuffer(44+n*2),d=new DataView(b);
  const write=(at,s)=>{for(let i=0;i<s.length;i++)d.setUint8(at+i,s.charCodeAt(i))};
  write(0,'RIFF');d.setUint32(4,36+n*2,true);write(8,'WAVE');
  write(12,'fmt ');d.setUint32(16,16,true);d.setUint16(20,1,true);
  d.setUint16(22,1,true);d.setUint32(24,rate,true);d.setUint32(28,rate*2,true);
  d.setUint16(32,2,true);d.setUint16(34,16,true);
  write(36,'data');d.setUint32(40,n*2,true);
  for(let i=0;i<n;i++)d.setInt16(44+i*2,Math.round(Math.sin(i/18)*7000),true);
  const bytes=new Uint8Array(b);let text='';for(let i=0;i<bytes.length;i++)text+=String.fromCharCode(bytes[i]);
  return 'data:audio/wav;base64,'+btoa(text);
 }`;
 try{
  const ctx=await browser.newContext({viewport:{width:390,height:844},
   userAgent:'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'});
  const page=await ctx.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.__mediaStarts=[];
   const original=HTMLMediaElement.prototype.play;
   HTMLMediaElement.prototype.play=function(...args){
    const gesture=navigator.userActivation?.isActive??false;
    window.__mediaStarts.push({kind:this.tagName,gesture});
    // Simulate Safari's policy: a new HTMLAudio.play from an animation frame
    // after the click would reject with NotAllowedError.
    if(this.tagName==='AUDIO'&&!gesture)return Promise.reject(new DOMException('User activation required','NotAllowedError'));
    return original.apply(this,args);
   };
  });
  await page.goto('file://'+path.resolve(__dirname,'../index.html'),{waitUntil:'domcontentloaded'});
  await page.locator('#pp').waitFor({state:'visible'});
  await page.evaluate(new Function(wav+';window.makeTone=makeTone;'));
  const pre=await page.evaluate(()=>{
   const c=StoryStudioBridge.get().episodes[0].scenes[0];
   c.voiceover='ทดสอบเสียงพรีวิวจริง';c.duration=4;
   c.audioClips=[{id:'mobile-voice',kind:'voice',name:'เสียงทดสอบ',
     data:window.makeTone(),duration:2,at:0,rate:1,volume:1,mute:false,
     trimStart:0,trimEnd:0}];
   StoryStudioBridge.persist();
   return {route:PREVIEW_DIRECT_VOICE,report:StoryStudioBridge.previewAudioReport()};
  });
  assert.equal(pre.route,true,'browser recognized iPad');
  assert.equal(pre.report.playable,1);
  await page.locator('#pp').click();
  await page.waitForFunction(()=>playing&&VOICE_PREVIEW_SOURCES.has('mobile-voice:0'),{timeout:15000});
  const startup=await page.evaluate(()=>({
   starts:window.__mediaStarts,
   nativePlayers:AUDIO_PLAYERS.size,buffered:PREVIEW_MOBILE_BUFFERED,
   context:PREVIEW_AUDIO_CTX?.state,source:VOICE_PREVIEW_SOURCES.has('mobile-voice:0'),
   playing,diagnostics:StoryStudioBridge.previewAudioReport()
  }));
  assert.equal(startup.buffered,true,'mobile voice must use a user-unlocked WebAudio context');
  assert.equal(startup.context,'running','AudioContext must be unlocked by the original Play click');
  assert.equal(startup.source,true,'decoded narration must start on the audio clock');
  assert.equal(startup.starts.filter(x=>x.kind==='AUDIO').length,0,'no prohibited HTMLAudio.play from RAF');
  await page.waitForTimeout(200);
  const continuous=await page.evaluate(()=>{
   const entry=VOICE_PREVIEW_SOURCES.get('mobile-voice:0'),source=entry?.source;
   syncAudioAt(T,true);syncAudioAt(T+.02,true);
   return {continuous:source===VOICE_PREVIEW_SOURCES.get('mobile-voice:0')?.source,playing};
  });
  assert.equal(continuous.continuous,true,'successive animation frames must not restart narration');
  // Add a new overlapping SFX (same PCM bytes) after playback began.
  // It must be scheduled through the clock without another restricted play().
  const sfx=await page.evaluate(()=>{
   const scene=StoryStudioBridge.get().episodes[0].scenes[0];
   scene.audioClips.push({id:'mobile-sfx',kind:'sfx',data:scene.audioClips[0].data,
    duration:2,at:0,rate:1,volume:1,mute:false,trimStart:0,trimEnd:0});
   StoryStudioBridge.persist();syncAudioAt(T,true);
   return {source:VOICE_PREVIEW_SOURCES.has('mobile-sfx:0'),
     context:PREVIEW_AUDIO_CTX.state,htmlPlays:window.__mediaStarts.filter(x=>x.kind==='AUDIO').length};
  });
  assert.equal(sfx.source,true,'iPad sound effects also use scheduled WebAudio');
  assert.equal(sfx.context,'running');
  assert.equal(sfx.htmlPlays,0,'do not call HTMLAudio.play when the user gesture has expired');
  await page.locator('#pp').click();
  await page.locator('#pp').click();
  await page.waitForFunction(()=>playing&&VOICE_PREVIEW_SOURCES.has('mobile-voice:0'),{timeout:15000});
  const restarted=await page.evaluate(()=>({playing,htmlPlays:window.__mediaStarts.filter(x=>x.kind==='AUDIO').length}));
  assert.equal(restarted.playing,true,'rapid user pause/restart must resume the buffered clock');
  assert.equal(restarted.htmlPlays,0);
  await page.locator('#pp').click();
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>StoryStudioBridge.previewAudioReport().voices===1,{timeout:15000});
  const reload=await page.evaluate(()=>{
   const scene=StoryStudioBridge.get().episodes[0].scenes[0];
   return {count:scene.audioClips.filter(c=>c.kind==='voice').length,data:scene.audioClips[0].data?.startsWith('data:audio/'),
    id:scene.audioClips[0].id,report:StoryStudioBridge.previewAudioReport()};
  });
  assert.equal(reload.count,1);assert.equal(reload.data,true,'reload must keep playable bytes');
  assert.equal(reload.report.playable,1);
  await page.evaluate(()=>{
   const clip=StoryStudioBridge.get().episodes[0].scenes[0].audioClips[0];
   clip.mute=true;StoryStudioBridge.persist();
  });
  const muted=await page.evaluate(()=>StoryStudioBridge.previewAudioReport());
  assert.equal(muted.playable,0);
  assert.ok(muted.issues.some(s=>s.includes('ปิดเสียง')));
  await ctx.close();

  const desktop=await browser.newPage();
  desktop.on('pageerror',e=>errors.push(e.message));
  await desktop.goto('file://'+path.resolve(__dirname,'../index.html'),{waitUntil:'domcontentloaded'});
  await desktop.evaluate(new Function(wav+';window.makeTone=makeTone;'));
  const desktopResult=await desktop.evaluate(async()=>{
   const sc=StoryStudioBridge.get().episodes[0].scenes[0];
   sc.duration=3;sc.audioClips=[{id:'desktop-voice',kind:'voice',
     data:window.makeTone(),duration:2,at:0,rate:1,volume:1,mute:false,trimStart:0,trimEnd:0}];
   const ctx=previewContext();await ctx.resume();
   // Force an in-progress decode: the scheduler must not silently continue and
   // skip the event. It should create an HTMLAudio fallback immediately.
   VOICE_PREVIEW_BUFFERS.delete(sc.audioClips[0].data);
   VOICE_PREVIEW_PENDING.set(sc.audioClips[0].data,new Promise(()=>{}));
   syncAudioAt(.12,true);
   return {directMode:PREVIEW_DIRECT_VOICE,htmlFallback:AUDIO_PLAYERS.has('desktop-voice:0'),
      webSource:VOICE_PREVIEW_SOURCES.has('desktop-voice:0')};
  });
  assert.equal(desktopResult.directMode,false,'desktop keeps stable decoded WebAudio');
  assert.equal(desktopResult.htmlFallback,true,'incomplete WebAudio decode falls back to HTML media');
  assert.equal(desktopResult.webSource,false);
  await desktop.close();
  assert.deepEqual(errors,[],'no uncaught page errors');
  console.log('PASS Safari-policy blocked HTMLAudio but iOS buffered voice/SFX play, restart, persist and desktop fallback');
 }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exit(1)});
