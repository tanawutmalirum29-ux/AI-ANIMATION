// พากย์อัตโนมัติ: ทดสอบปุ่ม/ตรรกะด้วย Lambda จำลอง (ไม่เรียก Edge TTS จริง)
const {chromium}=require('playwright');
const {Script}=require('node:vm');
const fs=require('node:fs'),http=require('node:http');
const assert=require('node:assert/strict');
const paths=['index.html','animated-map.js','animated-map.css','cinematic-fx.js','cinematic-fx.css','character-interaction.js','character-interaction.css','narration-director.js'];
const html=fs.readFileSync('index.html','utf8');
[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).forEach(x=>new Script(x));
function wavBase64(sec=.8,rate=16000){const n=Math.floor(sec*rate),b=Buffer.alloc(44+n*2);
 b.write('RIFF',0);b.writeUInt32LE(36+n*2,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);
 for(let i=0;i<n;i++)b.writeInt16LE(Math.round(Math.sin(i/12)*9000),44+i*2);return b.toString('base64')}
const server=http.createServer((req,res)=>{let p=(req.url||'/').split('?')[0].slice(1)||'index.html';if(!paths.includes(p)){res.writeHead(404);res.end('missing');return}
res.writeHead(200,{'Content-Type':p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'text/html; charset=utf-8'});res.end(fs.readFileSync(p))});
(async()=>{
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const errors=[],calls=[];let mode='ok';
 try{
  const page=await browser.newPage({viewport:{width:1100,height:800}});
  page.on('pageerror',e=>errors.push(e.stack||e.message));
  await page.route('https://dub.test/**',async route=>{
   const req=route.request(),cors={'access-control-allow-origin':'*','access-control-allow-headers':'content-type,x-dub-key','access-control-allow-methods':'POST'};
   if(req.method()==='OPTIONS'){await route.fulfill({status:204,headers:cors});return}
   calls.push({key:req.headers()['x-dub-key'],body:JSON.parse(req.postData()||'{}')});
   if(mode==='fail')await route.fulfill({status:502,headers:{...cors,'content-type':'application/json'},body:JSON.stringify({error:'down'})});
   else await route.fulfill({status:200,headers:{...cors,'content-type':'application/json'},body:JSON.stringify({audio:wavBase64()})});
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'load'});
  await page.locator('#sceneSwitchSelect').waitFor({timeout:15000});
  const r=await page.evaluate(async({wav})=>{
   const out={};
   autoDubSave('https://dub.test/','secret1');
   AUTODUB_SMART=false; // legacy per-cue mode stays compatible
   commit(()=>{const s=sc();s.duration=8;s.subtitle=['สวัสดีครับ วันนี้อากาศดีมาก','เราไปกันเถอะนะ'];s.subtitleCues=[];s.audioClips=[]});
   out.panel=!!autoDubPanel().querySelector('input[type=password]');
   const pastBefore=past.length;
   AUTODUB_SCOPE='scene';AUTODUB_SKIP=true;
   await autoDubRun();
   const s1=sc(),voices=s1.audioClips.filter(c=>c.kind==='voice'&&c.data);
   out.cues=s1.subtitleCues.length;out.voices=voices.length;
   out.cueLinked=voices.every(c=>c.cueId&&Math.abs(c.at-(s1.subtitleCues.find(q=>q.id===c.cueId)?.start||0))<.01);
   out.pastGrowth=past.length-pastBefore;
   await autoDubRun();            // รอบสอง: ข้ามบรรทัดที่มีเสียงแล้ว
   out.afterSecond=sc().audioClips.filter(c=>c.kind==='voice').length;
   return out},{wav:wavBase64()});
  assert.ok(r.panel,'panel renders');
  assert.ok(r.cues>=1,'cues created');
  assert.equal(r.voices,r.cues,'one voice clip per cue');
  assert.ok(r.cueLinked,'clip placed at cue start');
  assert.equal(r.pastGrowth,1,'single undo step');
  assert.equal(r.afterSecond,r.voices,'second run skips existing');
  assert.equal(calls.length,r.cues,'one request per cue');
  assert.ok(calls.every(c=>c.key==='secret1'&&/^th-TH-(Premwadee|Niwat)Neural$/.test(c.body.voice)&&c.body.text.length>0),'request shape');
  // undo ครั้งเดียวต้องลบเสียงทั้งหมด
  const undone=await page.evaluate(()=>{const f=[typeof undo==='function'?undo:null].find(Boolean);if(!f)return null;f();return sc().audioClips.filter(c=>c.kind==='voice').length});
  if(undone!==null)assert.equal(undone,0,'undo removes auto dub');
  // ล้มเหลว: ไม่มีคลิป ไม่ค้างสถานะ
  mode='fail';
  const f=await page.evaluate(async()=>{commit(()=>{sc().audioClips=[]});await autoDubRun();return{voices:sc().audioClips.filter(c=>c.kind==='voice').length,running:AUTODUB_RUNNING,status:document.body.innerText.includes('ล้มเหลว')||STUDIO_DUB_STATUS.includes('ล้มเหลว')}});
  assert.equal(f.voices,0);assert.equal(f.running,false);assert.ok(f.status,'failure reported');
  // Smart mode: one TTS request for connected narration instead of one request per caption.
  mode='ok';
  const smart=await page.evaluate(async()=>{
   AUTODUB_SMART=true;AUTODUB_SCOPE='scene';AUTODUB_SKIP=true;
   commit(()=>{const s=sc();s.duration=.45;s.subtitle=['หนึ่ง สอง','สาม สี่'];s.subtitleCues=[
    {id:'smartA',text:'เรื่องยังไม่จบ',start:0,end:.22,speaker:'',emotion:'neutral'},
    {id:'smartB',text:'เราต้องไปต่อ',start:.22,end:.45,speaker:'',emotion:'neutral'}];s.audioClips=[]});
   const jobs=autoDubJobs('scene',true),count=jobs.length;
   await autoDubRun();
   const s=sc(),voice=s.audioClips.find(c=>c.autoDub);
   return {count,ids:voice?.cueIds||[],duration:s.duration,clipDuration:voice?.duration||0,
    rate:voice?.rate,plannedAt:voice?.at,span:safeClipDuration(voice),
    secondCue:s.subtitleCues[1]?.start,firstEnd:s.subtitleCues[0]?.end,
    running:AUTODUB_RUNNING,requestedRate:jobs[0]?.text};
  });
  assert.equal(smart.count,1,'smart director merges one speaker into one TTS request');
  assert.equal(smart.ids.length,2,'both caption lines belong to merged voice');
  assert.ok(smart.duration>=smart.span,'scene duration must not cut the generated speech');
  assert.ok(smart.secondCue>=smart.firstEnd-.01,'subtitle frames follow speech');
  assert.equal(smart.running,false);
  assert.equal(calls.at(-1).body.rate,'+6%','TTS pacing is supplied to Lambda');
  // New AI narrator: read authored voiceover even when no subtitle cues exist.
  // It must not invent dialogue or rewrite the script/captions.
  const narrator=await page.evaluate(async()=>{
   AUTODUB_SMART=true;AUTODUB_SCOPE='scene';AUTODUB_SKIP=true;
   commit(()=>{const s=sc();s.duration=4;s.voiceover='ในคืนที่ฝนตก เขาเดินเข้าสู่บ้านหลังเก่า';
    s.subtitle=[];s.subtitleCues=[];s.audioClips=[]});
   const before=sc().voiceover,originalCues=sc().subtitleCues.length;
   const first=await StoryStudioBridge.narrate('scene');
   const afterFirst=sc().audioClips.filter(c=>c.kind==='voice'&&c.autoDub);
   const second=await StoryStudioBridge.narrate('scene');
   return {first,second,clips:afterFirst.length,cueId:afterFirst[0]?.cueId,
    before,after:sc().voiceover,cues:sc().subtitleCues.length,originalCues};
  });
  assert.equal(narrator.first.made,1);
  assert.equal(narrator.second.made,0,'duplicate narrator clips skipped');
  assert.equal(narrator.clips,1);
  assert.ok(narrator.cueId.startsWith('narration-'));
  assert.equal(narrator.before,narrator.after,'author voiceover unchanged');
  assert.equal(narrator.cues,narrator.originalCues,'no extra subtitles');
  // Regression from the user's three exported videos: complete automatic
  // narration must shorten unused seconds after the last spoken word.
  const pacing=await page.evaluate(async()=>{
   AUTODUB_SMART=true;AUTODUB_SCOPE='scene';AUTODUB_SKIP=true;
   commit(()=>{
    const s=sc();s.duration=10;s.voiceover='คืนนี้ฝนตกหนักมาก';
    s.subtitle=[];s.subtitleCues=[{id:'original-cue',text:'คืนนี้ฝนตก',start:5.4,end:8.4}];
    s.audioClips=[];s.actors=[];s.camera={type:'static',from:1,to:1};
   });
   const original=sc().voiceover;
   const run=await autoDubRun();
   const s=sc(),clip=s.audioClips.find(c=>c.autoDub);
   const audit=StoryTimingAuditor.audit(S,{scope:'all',rateOf:effectiveClipRate});
   const suggestion=StoryTimingAuditor.planAutoDubTightening(S,[s],{
    rateOf:effectiveClipRate,splitNarration:StoryNarrationDirector.splitNarration
   });
   return {duration:s.duration,voicedEnd:clip?.at+safeClipDuration(clip),
    captionEnd:s.subtitleCues[0]?.end,original,after:s.voiceover,run,
    auditScene:audit.scenes.find(x=>x.sceneId===s.id),safeOps:suggestion.ops.length,
    skipped:suggestion.skipped};
  });
  assert.ok(pacing.duration<5,'remove long silent 10-second JSON tail: '+JSON.stringify(pacing));
  assert.ok(pacing.duration>=pacing.voicedEnd+.1,'narration audio is not cut off');
  assert.ok(pacing.captionEnd<pacing.duration,'original subtitles are kept inside scene');
  assert.equal(pacing.original,pacing.after,'never rewrite externally authored story');
  assert.deepEqual(errors,[],'no page errors');
  console.log('PASS auto dub:',JSON.stringify({...r,requests:calls.length,undone,fail:f,smart}));
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);process.exit(1)});
