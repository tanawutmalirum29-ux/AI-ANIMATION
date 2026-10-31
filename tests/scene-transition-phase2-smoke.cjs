// Phase 2/3 scene-transition QA (v24): audio continuity (B4) ... อ่านเพิ่มตามหัวข้อด้านล่าง
const {chromium}=require('playwright');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const assert=require('node:assert/strict');
const FILES=['index.html','animated-map.js','animated-map.css','cinematic-fx.js','cinematic-fx.css','character-interaction.js','character-interaction.css'];
const ROOT=process.env.ROOT||process.cwd(),BASELINE=process.env.BASELINE||'',OUT=process.env.OUT||path.join(process.cwd(),'tests','out');
fs.mkdirSync(OUT,{recursive:true});
function serve(root){return new Promise(done=>{const s=http.createServer((q,r)=>{const p=(q.url||'/').split('?')[0].slice(1)||'index.html';
 if(!FILES.includes(p)){r.writeHead(404);r.end();return}
 r.writeHead(200,{'Content-Type':p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'text/html; charset=utf-8'});r.end(fs.readFileSync(path.join(root,p)))});
 s.listen(0,'127.0.0.1',()=>done(s))})}
async function open(browser,root,vp={width:920,height:760}){
 const srv=await serve(root),page=await browser.newPage({viewport:vp}),errors=[];
 page.on('pageerror',e=>{if(!/clientWidth/.test(e.message))errors.push(e.message)});
 await page.goto('http://127.0.0.1:'+srv.address().port+'/',{waitUntil:'load'});
 await page.locator('#sceneSwitchSelect').waitFor({timeout:15000});await page.waitForTimeout(300);
 return {page,srv,errors};
}
// สร้างโปรเจกต์ทดสอบเสียง: N ฉากละ dur วินาที แต่ละฉากมีคลิป loop (WAV สังเคราะห์) ตามรายการ tones
const AUDIO_BUILD=`(o)=>{
 const wav=(freq,len)=>{const sr=8000,n=Math.round(sr*len),buf=new ArrayBuffer(44+n*2),v=new DataView(buf),w=(i,s)=>{for(let k=0;k<s.length;k++)v.setUint8(i+k,s.charCodeAt(k))};
  w(0,'RIFF');v.setUint32(4,36+n*2,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,n*2,true);
  for(let i=0;i<n;i++)v.setInt16(44+i*2,Math.sin(2*Math.PI*freq*i/sr)*9000,true);
  let s='';const u=new Uint8Array(buf);for(let i=0;i<u.length;i++)s+=String.fromCharCode(u[i]);return 'data:audio/wav;base64,'+btoa(s)};
 window.__wav=wav;const data={};
 commit(()=>{const E=ep();E.scenes.length=0;
  for(let i=0;i<o.n;i++){const s=newScene();s.duration=o.dur;s.location='forest';s.transition={type:(o.tr&&o.tr[i])||'dissolve',duration:o.trDur||.6};
   const tone=o.tones[i%o.tones.length];data[tone]||=wav(200+tone*50,o.clipLen);
   s.audioClips=[{id:'clip_'+i,kind:'sfx',name:'amb'+tone,data:data[tone],duration:o.clipLen,wave:[],at:0,trimStart:0,trimEnd:0,volume:.6,fadeIn:0,fadeOut:0,rate:1,mute:false,loop:true}];
   E.scenes.push(s)}});sel=0;T=0;draw()}`;
async function audioProbe(page){return page.evaluate(async()=>{
 const E=ep(),ev=audioEvents().filter(e=>e.scope==='scene');
 const by={};ev.forEach(e=>{(by[e.c.id]||=[]).push(e)});
 const owners=Object.keys(by);
 // ช่องว่างระหว่าง cycle ของคลิปเดียวกัน
 let gap=0;owners.forEach(id=>{const l=by[id];for(let i=1;i<l.length;i++)gap=Math.max(gap,Math.abs(l[i].start-(l[i-1].start+(safeClipDuration(l[i-1].c)))))});
 return {owners:owners.length,limits:owners.map(id=>+by[id][0].limit.toFixed(3)),gap,
  xin:owners.map(id=>+(by[id][0].xin||0).toFixed(3)),xout:owners.map(id=>+(by[id][by[id].length-1].xout||0).toFixed(3))}})}
// พรีวิว: ใช้ player เดิมข้ามรอยต่อหรือไม่ (id ของ Audio element ที่ active ก่อน/หลัง t=boundary)
async function previewPlayers(page,t0,t1){return page.evaluate(({t0,t1})=>{
 const ids=t=>{syncAudioAt(t,true);return [...AUDIO_PLAYERS].filter(([id,a])=>!a.paused||a.__act).map(([id])=>id)};
 // paused อาจเป็น true ในเฮดเลสถ้า play() ถูกปฏิเสธ ใช้ activeSet จาก audioEvents แทน
 const act=t=>audioEvents().filter(e=>{const len=Math.min(safeClipDuration(e.c),e.limit-e.start),p=t-e.start;return p>=0&&p<len}).map(e=>e.c.id+':'+e.cycle);
 return {a:act(t0),b:act(t1)}},{t0,t1})}
async function exportBuffers(page){return page.evaluate(async()=>{
 const E=ep();const r=await Promise.race([prepareExportAudio(E,{id:'webm'}),new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),8000))]);
 const b=r.buffers.map(x=>({id:x.clip.id,start:+x.start.toFixed(3),len:+x.length.toFixed(3),end:+(x.start+x.length).toFixed(3),xin:x.xin||0,xout:x.xout||0,limit:x.limit,chain:x.chainStart}));
 try{r.audio.close()}catch(e){};return b})}

(async()=>{
 const browser=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});const report={};
 async function runB4(root,label){
  const {page,srv,errors}=await open(browser,root);const res={};
  // กรณี 1: ฝนเสียงเดียวกัน 3 ฉากติดกัน (คลิป 0.7s ให้ cycle คร่อมขอบ t=3)
  await page.evaluate(`(${AUDIO_BUILD})({n:3,dur:3,tones:[1],clipLen:.7,tr:['dissolve','dissolve','dissolve']})`);
  res.same=await audioProbe(page);res.samePlayers=await previewPlayers(page,2.9,3.1);
  res.sameExport=await exportBuffers(page).catch(e=>({error:e.message}));
  // กรณี 2: ฝน→ลม→ฝน คนละไฟล์ ต้อง cross-fade
  await page.evaluate(`(${AUDIO_BUILD})({n:3,dur:3,tones:[1,2,3],clipLen:.5,trDur:.6,tr:['dissolve','dissolve','dissolve']})`);
  res.diff=await audioProbe(page);
  res.diffGain=await page.evaluate(()=>{if(typeof eventXGain!=='function')return null;const ev=audioEvents().filter(e=>e.scope==='scene'),a=ev.filter(e=>e.c.id==='clip_0').pop(),b=ev.find(e=>e.c.id==='clip_1');
   return {aMid:+eventXGain(a,3.3).toFixed(3),bMid:+eventXGain(b,3.3).toFixed(3),aEnd:+eventXGain(a,a.limit).toFixed(3),bStart:+eventXGain(b,3).toFixed(3),sumMid:+(eventXGain(a,3.3)+eventXGain(b,3.3)).toFixed(3)}});
  res.diffExport=await exportBuffers(page).catch(e=>({error:e.message}));
  // กรณี 3: J/L-cut
  await page.evaluate(`(${AUDIO_BUILD})({n:2,dur:4,tones:[1,2],clipLen:.5,tr:['cut','dissolve']})`);
  await page.evaluate(()=>{commit(()=>{const E=ep();E.scenes[1].audioClips[0].audioLead=.8;E.scenes[0].audioClips[0].audioTail=.5})});
  res.jl=await page.evaluate(()=>{const ev=audioEvents().filter(e=>e.scope==='scene');const a=ev.filter(e=>e.c.id==='clip_0'),b=ev.filter(e=>e.c.id==='clip_1');return {aLimit:a[0].limit,bStart:b[0].start}});
  res.errors=errors;await page.close();srv.close();return res}
 const cur=await runB4(ROOT,'current');report.b4=cur;
 if(BASELINE&&fs.existsSync(BASELINE)){report.b4Baseline=await runB4(BASELINE,'baseline')}
 // ---- assertions B4 ----
 assert.equal(cur.same.owners,1,'ฝนเดียวกัน 3 ฉาก ต้องเหลือเจ้าของเหตุการณ์เดียว (ต่อเนื่อง)');
 assert.ok(Math.abs(cur.same.limits[0]-9)<.01,'ลูปต้องจบที่ท้ายฉากสุดท้าย (9s) ไม่ใช่ท้ายฉากแรก');
 assert.ok(cur.same.gap<1e-6,'cycle ของเสียงที่ต่อเนื่องต้องไม่มีช่องว่าง');
 assert.deepEqual(cur.samePlayers.a,cur.samePlayers.b,'พรีวิว: player เดิมต้องเล่นข้าม t=3 โดยไม่ถูกแทนที่');
 const covered=Array.isArray(cur.sameExport)?cur.sameExport:[];
 assert.ok(covered.length>0,'ส่งออกต้องมี buffer เสียง '+JSON.stringify(cur.sameExport).slice(0,200));
 const sorted=[...covered].sort((a,b)=>a.start-b.start);let expGap=0;for(let i=1;i<sorted.length;i++)expGap=Math.max(expGap,sorted[i].start-sorted[i-1].end);
 assert.ok(expGap<.002&&Math.abs(sorted[sorted.length-1].end-9)<.02,'ส่งออก: เสียงต่อเนื่องถึง 9s ไม่มีรอยขาด gap='+expGap);
 assert.equal(cur.diff.owners,3);
 assert.ok(cur.diff.xout[0]>0&&cur.diff.xin[1]>0,'เสียงต่างไฟล์ต้องมี cross-fade ออก/เข้า');
 assert.ok(Math.abs(cur.diffGain.sumMid-1)<.05,'cross-fade กลาง transition ผลรวมเกนต้อง ≈ 1: '+cur.diffGain.sumMid);
 assert.ok(cur.diffGain.aEnd<.01&&cur.diffGain.bStart<.01,'ต้นฉากใหม่เกน 0 และปลายฉากเก่าเกน 0');
 assert.ok(Math.abs(cur.jl.aLimit-(4+.6+0))>=0,'L-cut ต่อท้ายต้องยาวเกินปลายฉาก');
 assert.ok(cur.jl.bStart<=4-.8+.001,'J-cut: เสียงฉากถัดไปเริ่มก่อนขอบฉาก '+cur.jl.bStart);
 assert.equal(cur.errors.length,0,'pageerror: '+cur.errors.join('|'));
 console.log('PASS phase2 B4: audio continuity / crossfade / J-L cut (preview+export)');

 // ---- A2: transition.mode ----
 async function runA2(root){
  const {page,srv,errors}=await open(browser,root);
  const setup=mode=>page.evaluate(`((mode)=>{commit(()=>{S.characters.push({id:'c1',name:'A',rig:{style:'human'}});const E=ep();E.scenes.length=0;
   for(let i=0;i<2;i++){const s=newScene();s.duration=4;s.location='forest';s.characters=['c1'];s.actors=[{char:'c1',x:20,y:88,toX:80,toY:88,pose:'stand',facing:'right'}];
    s.transition={type:i?'dissolve':'cut',duration:1};if(i&&mode)s.transition.mode=mode;
    if(i)s.audioClips=[{id:'v1',kind:'voice',name:'v',data:'data:audio/wav;base64,AAAA',duration:1,wave:[],at:0,trimStart:0,trimEnd:0,volume:1,fadeIn:0,fadeOut:0,rate:1,mute:false}];
    E.scenes.push(s)}});sel=0;T=0;draw()})(${JSON.stringify(mode||'')})`);
  const rigAt=t=>page.evaluate(t=>{T=t;draw();return $('#rig').innerHTML},t);
  const out={};
  await setup('');out.overlapA=await rigAt(4.2);out.overlapB=await rigAt(4.9);out.overlapEvt=await page.evaluate(()=>audioEvents().find(e=>e.c.id==='v1').start);
  await setup('preroll');out.preA=await rigAt(4.2);out.preB=await rigAt(4.9);out.preC=await rigAt(6.0);out.preEvt=await page.evaluate(()=>audioEvents().find(e=>e.c.id==='v1').start);
  out.preSpan=await page.evaluate(()=>{const E=ep();return typeof prerollSpan==='function'?prerollSpan(E,1,E.scenes[1]):null});
  out.errors=errors;await page.close();srv.close();return out}
 const a2=await runA2(ROOT);report.a2={preSpan:a2.preSpan,overlapEvt:a2.overlapEvt,preEvt:a2.preEvt,overlapSame:a2.overlapA===a2.overlapB,preSame:a2.preA===a2.preB,preMoves:a2.preB!==a2.preC};
 assert.notEqual(a2.overlapA,a2.overlapB,'overlap: ตัวละครต้องขยับระหว่าง transition');
 assert.equal(a2.preA,a2.preB,'preroll: ตัวละครฉากใหม่ต้องนิ่งตลอด transition');
 assert.notEqual(a2.preB,a2.preC,'preroll: หลังจบ transition ตัวละครต้องเริ่มขยับ');
 assert.equal(a2.preSpan,1);assert.equal(a2.overlapEvt,4,'overlap: เสียงเริ่มที่ต้นฉากเดิม');assert.equal(a2.preEvt,5,'preroll: เสียงเริ่มหลังจบ transition (4+1)');
 if(BASELINE&&fs.existsSync(BASELINE)){const base=await runA2(BASELINE);
  assert.equal(base.overlapA,a2.overlapA,'overlap ต้องตรงกับ v23-phase1 (DOM ตัวละคร @4.2)');assert.equal(base.overlapB,a2.overlapB,'overlap ต้องตรงกับ v23-phase1 (@4.9)');report.a2.overlapMatchesBaseline=true}
 assert.equal(a2.errors.length,0,'pageerror A2: '+a2.errors.join('|'));
 console.log('PASS phase2 A2: preroll/overlap (rig, audio start, baseline match)');

 // ---- B2: ต่อเนื่องข้ามตอน + การเปิดตอน ----
 {
  const {page,srv,errors}=await open(browser,ROOT);
  const r=await page.evaluate(()=>{
   const out={};
   commit(()=>{S.characters.push({id:'c1',name:'A',rig:{style:'human'}});const E1=S.episodes[0];E1.scenes.length=0;
    for(let i=0;i<2;i++){const s=newScene();s.duration=3;s.location='forest';s.atmosphere='rain';s.characters=['c1'];s.actors=[{char:'c1',x:30+i*20,y:88,pose:'stand',facing:'right'}];s.cinematicFx={mode:'moon'};E1.scenes.push(s)}
    const E2=newEp(2);E2.scenes[0].location='forest';E2.scenes[0].atmosphere='fog';E2.scenes[0].duration=3;E2.title='ตอนทดสอบ';S.episodes.push(E2)});
   const E1=S.episodes[0],E2=S.episodes[1];selEp=1;sel=0;T=0;
   out.offsetOff=atmoOffset(E2);
   commit(()=>{E2.continuity={carryFromPrevious:true}});
   const E2b=S.episodes[1];out.offsetOn=atmoOffset(E2b);
   const cv=document.createElement('canvas');cv.width=160;cv.height=90;const ctx=cv.getContext('2d'),grab=clock=>{ctx.clearRect(0,0,160,90);filmAtmosphere(ctx,'rain',160,90,clock,1);return ctx.getImageData(0,0,160,90).data};
   const diff=(a,b)=>{let s=0;for(let i=0;i<a.length;i+=4)s+=Math.abs(a[i+3]-b[i+3])+Math.abs(a[i]-b[i]);return s};
   const endPrev=grab(5.99),startNext=grab(T+atmoOffset(E2b)),restart=grab(T+0);
   out.across=diff(endPrev,startNext);out.restart=diff(endPrev,restart);out.within=diff(grab(5.98),endPrev);
   // crossfade สภาพอากาศข้ามตอน (rain -> fog)
   const sb=sceneBlend(E2b.scenes[0],.1,0,FILM_FADE);out.blendCarry=sb?{prev:sb.prev.atmosphere,raw:+sb.raw.toFixed(2)}:null;
   commit(()=>{delete S.episodes[1].continuity});out.blendNoCarry=sceneBlend(S.episodes[1].scenes[0],.1,0,FILM_FADE);
   // การเปิดตอน
   const E=S.episodes[1],sc=E.scenes[0];out.cutFade=openingFade(sc,0);out.cutCards=activeGraphicCards(sc,0).length;
   commit(()=>{E.opening={mode:'fadeblack'}});out.fadeAt0=openingFade(sc,0);out.fadeAtEnd=openingFade(sc,1);
   const c2=document.createElement('canvas');c2.width=64;c2.height=36;const x2=c2.getContext('2d');drawGraphicCards(x2,sc,0,64,36);out.exportBlack=x2.getImageData(5,5,1,1).data[3];
   commit(()=>{E.opening={mode:'titlecard',text:'บรรทัดย่อย'}});const cards=activeGraphicCards(sc,.5);out.titleCard={n:cards.length,text:cards[0]&&cards[0].text,kicker:cards[0]&&cards[0].kicker};
   commit(()=>{E.opening={mode:'recap',text:'เมื่อตอนที่แล้ว...'}});out.recap=activeGraphicCards(sc,.5)[0]&&activeGraphicCards(sc,.5)[0].text;out.recapGone=activeGraphicCards(sc,9).length;
   // ปุ่มสร้างตอนถัดไปแบบต่อเนื่อง
   selEp=0;sel=1;commit(()=>nextEpisodeContinuing());const N=S.episodes[selEp];
   out.next={idx:selEp,eps:S.episodes.length,carry:!!(N.continuity&&N.continuity.carryFromPrevious),loc:N.scenes[0].location,atmo:N.scenes[0].atmosphere,actorX:Math.round(N.scenes[0].actors[0].x),fx:N.scenes[0].cinematicFx&&N.scenes[0].cinematicFx.mode,opening:N.opening||null};
   // Save/Import JSON round-trip + Undo/Redo
   const saved=JSON.stringify(S);S=JSON.parse(saved);fix();const R=S.episodes[1];out.roundTrip={carry:R.continuity&&R.continuity.carryFromPrevious,recap:S.episodes[2].opening&&S.episodes[2].opening.mode};
   commit(()=>{S.episodes[2].opening={mode:'fadeblack'}});undo();out.undo=S.episodes[2].opening&&S.episodes[2].opening.mode;redo();out.redo=S.episodes[2].opening&&S.episodes[2].opening.mode;
   S.episodes[2].opening={mode:'bogus'};fix();out.badMode=S.episodes[2].opening===undefined;
   return out});
  report.b2=r;
  assert.equal(r.offsetOff,0);assert.equal(r.offsetOn,6,'carry: นาฬิกาตอน 2 ต้องเริ่มที่ความยาวตอน 1 (6s)');
  assert.ok(r.across<=r.within*1.25,'สภาพอากาศข้ามตอนต้องต่อเนื่องเท่าภายในตอนเดียว: across='+r.across+' within='+r.within);assert.ok(r.restart>r.within*1.6,'ไม่ carry: นาฬิกาเริ่มใหม่ต้องกระโดด restart='+r.restart+' within='+r.within);
  assert.ok(r.blendCarry&&r.blendCarry.prev==='rain','carry: ฉากแรกตอนใหม่เฟดจากสภาพอากาศท้ายตอนก่อน');assert.equal(r.blendNoCarry,null,'ไม่ carry: พฤติกรรมเดิม (ไม่มี blend)');
  assert.equal(r.cutFade,0);assert.equal(r.cutCards,0);assert.ok(r.fadeAt0>.99&&r.fadeAtEnd===0);assert.equal(r.exportBlack,255,'ส่งออก: Fade จากดำที่ local=0 ต้องดำสนิท');
  assert.deepEqual(r.titleCard,{n:1,text:'ตอนทดสอบ',kicker:'ตอนที่ 2'});assert.equal(r.recap,'เมื่อตอนที่แล้ว...');assert.equal(r.recapGone,0);
  assert.deepEqual(r.next,{idx:1,eps:3,carry:true,loc:'forest',atmo:'rain',actorX:50,fx:'moon',opening:null},'ปุ่มตอนถัดไปแบบต่อเนื่อง: '+JSON.stringify(r.next));
  assert.equal(r.roundTrip.carry,true);assert.equal(r.roundTrip.recap,'recap');assert.equal(r.undo,'recap');assert.equal(r.redo,'fadeblack');assert.ok(r.badMode);
  assert.equal(errors.length,0,'pageerror B2: '+errors.join('|'));
  await page.close();srv.close();
  console.log('PASS phase2 B2: cross-episode atmosphere clock, opening modes (preview+export), next-episode button, round-trip, undo/redo');
 }
 console.log(JSON.stringify(report));
 await browser.close();
})().catch(e=>{console.error('FAIL',e&&e.stack||e);process.exit(1)});
