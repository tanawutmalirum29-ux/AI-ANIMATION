// พากย์อัตโนมัติ: ทดสอบปุ่ม/ตรรกะด้วย Lambda จำลอง (ไม่เรียก Edge TTS จริง)
const {chromium}=require('playwright');
const {Script}=require('node:vm');
const fs=require('node:fs'),http=require('node:http');
const assert=require('node:assert/strict');
const paths=['index.html','animated-map.js','animated-map.css','cinematic-fx.js','cinematic-fx.css','character-interaction.js','character-interaction.css'];
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
  assert.deepEqual(errors,[],'no page errors');
  console.log('PASS auto dub:',JSON.stringify({...r,requests:calls.length,undone,fail:f}));
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);process.exit(1)});
