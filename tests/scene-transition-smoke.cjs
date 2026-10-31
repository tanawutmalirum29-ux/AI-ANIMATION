// Scene transition QA: weather continuity, light crossfade, preview/export parity, perf, backward compat.
const {chromium}=require('playwright');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const assert=require('node:assert/strict');
const FILES=['index.html','animated-map.js','animated-map.css','cinematic-fx.js','cinematic-fx.css','character-interaction.js','character-interaction.css'];
const ROOT=process.env.ROOT||process.cwd(),OUT=process.env.OUT||path.join(process.cwd(),'tests','out');
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
// builds N scenes with 3 actors, given atmosphere/transition sequence
const BUILD=`(opts)=>{commit(()=>{S.characters.push({id:'c1',name:'A',rig:{style:'human'}},{id:'c2',name:'B',rig:{style:'human'}},{id:'c3',name:'C',rig:{style:'human'}});
 const E=ep();E.scenes.length=0;
 for(let i=0;i<opts.n;i++){const s=newScene();s.duration=opts.dur||3;s.location=opts.locs?opts.locs[i%opts.locs.length]:'forest';
  s.atmosphere=(opts.atmo&&opts.atmo[i%opts.atmo.length])||'none';s.characters=['c1','c2','c3'];
  s.actors=[{char:'c1',x:30,y:88,pose:'stand',facing:'right'},{char:'c2',x:50,y:88,pose:'stand',facing:'left'},{char:'c3',x:70,y:88,pose:'stand',facing:'right'}];
  s.transition={type:(opts.tr&&opts.tr[i%opts.tr.length])||'cut',duration:opts.trDur||.55};
  if(opts.noLight)s.light='none';
  if(opts.light&&opts.light[i%opts.light.length])s.lighting=opts.light[i%opts.light.length];
  E.scenes.push(s)}});sel=0;T=0;draw()}`;
const diffImg=`(a,b)=>{let s=0;for(let i=0;i<a.length;i+=4)s+=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);return s}`;

async function perfRun(browser,root){
 const {page,srv,errors}=await open(browser,root);
 await page.evaluate(`(${BUILD})({n:8,atmo:['rain','rain','fog','storm'],tr:['dissolve','fadeblack','cut','push-left'],locs:['forest','field','forest']})`);
 await page.evaluate(`window.__lt=[];window.__ltAt=[];try{new PerformanceObserver(l=>l.getEntries().forEach(e=>{window.__lt.push(e.duration);window.__ltAt.push(e.startTime)})).observe({entryTypes:['longtask']})}catch(e){}`);
 await page.evaluate(`(()=>{const st=starts();for(let t=0;t<total();t+=.5){T=t;draw()}T=0;draw()})()`);/* warm-up pass (JIT, first SVG builds) */
 await page.evaluate(`window.__lt.length=0;window.__ltAt.length=0`);
 const perf=await page.evaluate(`new Promise(res=>{const st=starts(),d0=draw,rec=[],cross=[];let lastI=-1;
  draw=function(){const a=performance.now();const r=d0.apply(this,arguments);rec.push({t:T,ms:performance.now()-a});const ci=st.reduce((n,b,k)=>T>=b?k:n,0);if(lastI>=0&&ci!==lastI)cross.push(a);lastI=ci;return r};
  sel=0;T=st[2]-.9;playing=true;ctl();const endT=st[5]+.9;
  const tick=()=>{if(T>=endT||!playing){playing=false;draw=d0;
    const near=r=>st.some((b,i)=>i>0&&Math.abs(r.t-b)<.6),edge=rec.filter(near).map(r=>r.ms),mid=rec.filter(r=>!near(r)).map(r=>r.ms);
    const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
    res({frames:rec.length,midAvg:+avg(mid).toFixed(1),midMax:+Math.max(0,...mid).toFixed(1),edgeAvg:+avg(edge).toFixed(1),edgeMax:+Math.max(0,...edge).toFixed(1),over24:rec.filter(r=>r.ms>24).length,slow:rec.filter(r=>r.ms>24).map(r=>{const k=st.findIndex((b,i)=>i>0&&Math.abs(r.t-b)<1.2);return{ms:+r.ms.toFixed(0),rel:k>0?+(r.t-st[k]).toFixed(2):'mid',k}}),longTasks:window.__lt.length,longTaskMax:Math.max(0,...window.__lt),longTasksNearBoundary:window.__ltAt.filter(a=>cross.some(c=>a>c-150&&a<c+900)).length});return}
    setTimeout(tick,100)};tick()})`);
 await page.close();srv.close();return{perf,errors}
}
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const report={};
 try{
  if(process.env.PERF_ONLY){console.log('PERF',process.env.ROOT,JSON.stringify((await perfRun(browser,ROOT)).perf));return}
  const {page,srv,errors}=await open(browser,ROOT);
  // ---- 1. continuity: weather-only layer, across a hard cut vs within a scene
  await page.evaluate(`(${BUILD})({n:3,atmo:['rain'],tr:['cut']})`);
  report.continuity=await page.evaluate(`(async()=>{const diff=${diffImg};const out={};const st=starts();
   for(const type of ['rain','storm','snow','fog','wind','dust','fireflies','stars']){
    ep().scenes.forEach(s=>s.atmosphere=type);
    const cv=document.createElement('canvas');cv.width=640;cv.height=360;const ctx=cv.getContext('2d',{willReadFrequently:true});
    const grab=t=>{T=t;ctx.clearRect(0,0,640,360);paintSceneAtmosphere(ctx,ep().scenes[Math.max(0,ep().scenes.findIndex((s,i)=>t<st[i]+s.duration))],0,0,640,360);return ctx.getImageData(0,0,640,360).data};
    const sceneAt=t=>{const i=ep().scenes.findIndex((s,k)=>t<st[k]+s.duration);return[i,t-st[i]]};
    const g=t=>{T=t;const[i,l]=sceneAt(t);ctx.clearRect(0,0,640,360);paintSceneAtmosphere(ctx,ep().scenes[i],l,i,640,360);return ctx.getImageData(0,0,640,360).data};
    const dt=.04,b=st[1];
    const across=diff(g(b-dt),g(b+.0001)),w1=diff(g(b+1),g(b+1+dt)),w2=diff(g(b-1.5),g(b-1.5+dt)),w3=diff(g(b+2),g(b+2+dt));
    out[type]={across,within:Math.max(w1,w2,w3),ratio:+(across/Math.max(1,Math.max(w1,w2,w3))).toFixed(2)}}
   return out})()`);
  for(const [k,v] of Object.entries(report.continuity)){assert.ok(v.within>0,k+' draws nothing');assert.ok(v.across<=1.6*v.within+5000,k+' jumps at cut: '+JSON.stringify(v))}
  // ---- 2. weather crossfade rain -> none -> rain (hard cuts), no pop
  report.crossfade=await page.evaluate(`(async()=>{const E=ep(),st=starts();E.scenes.forEach((s,i)=>{s.atmosphere=i===1?'none':'rain';s.transition={type:'cut',duration:.55}});
   const cv=document.createElement('canvas');cv.width=320;cv.height=180;const ctx=cv.getContext('2d',{willReadFrequently:true});
   const level=t=>{T=t;const i=E.scenes.findIndex((s,k)=>t<st[k]+s.duration);ctx.clearRect(0,0,320,180);paintSceneAtmosphere(ctx,E.scenes[i],t-st[i],i,320,180);const d=ctx.getImageData(0,0,320,180).data;let a=0;for(let p=3;p<d.length;p+=4)a+=d[p];return a};
   const steady=level(st[0]+1.5);let maxStep=0,prev=level(st[0]+2.7),n=0;const series=[];
   for(let t=st[0]+2.7;t<st[2]+.6;t+=.02){const v=level(t);series.push(+(v/steady).toFixed(3));maxStep=Math.max(maxStep,Math.abs(v-prev)/steady);prev=v}
   return{steady,maxStepRel:+maxStep.toFixed(3),min:Math.min(...series),samples:series.length}})()`);
  assert.ok(report.crossfade.maxStepRel<.25,'weather pops at cut: '+JSON.stringify(report.crossfade));
  assert.ok(report.crossfade.min<.1,'weather did fade through none');
  // ---- 3. lighting crossfade over dissolve
  report.light=await page.evaluate(`(()=>{const E=ep(),st=starts();E.scenes.forEach((s,i)=>{s.atmosphere='none';s.transition={type:'dissolve',duration:.5};s.lighting=i===1?{glow:1,vignette:.8,exposure:1,focusX:50,focusY:40,flicker:0}:{glow:0,vignette:0,exposure:1,flicker:0}});
   const vals=[0,.1,.2,.3,.4,.5,.6].map(l=>lightAt(E.scenes[1],l,1).glow);return vals})()`);
  assert.ok(report.light[0]<.01&&report.light.at(-1)>.99,'glow should start at previous scene value and reach target: '+report.light);
  assert.ok(report.light.every((v,i,a)=>i===0||v>=a[i-1]),'glow monotonic');
  // ---- 4. cache invalidation after edits / undo
  report.cache=await page.evaluate(`(()=>{const E=ep();E.scenes.forEach(s=>s.transition={type:'dissolve',duration:.5});const st=starts();T=st[1]+.1;draw();const a=prevSnapshotIndex;
   commit(()=>{ep().scenes[0].actors[0].x=10});const b=prevSnapshotIndex;return{afterDraw:a,afterEdit:b}})()`);
  assert.equal(report.cache.afterDraw,1);assert.equal(report.cache.afterEdit,-1,'snapshot must be dropped after edits');
  assert.equal(errors.length,0,errors.join('\n'));
  await page.close();srv.close();

  // ---- 5. parity preview vs export per transition type
  {const {page,srv,errors}=await open(browser,ROOT,{width:1100,height:800});
   await page.evaluate(`(${BUILD})({n:2,locs:['forest','field'],tr:['cut','dissolve'],atmo:['none']})`);
   await page.addStyleTag({content:'#sub,#ui,#ph,#storyGraphics,#motionOverlay{display:none!important}#stage{width:640px!important;height:360px!important}#stageWrap{overflow:visible!important}'});
   const types=await page.evaluate(`['fade','dissolve','fadeblack','flash','wipe-left','wipe-right','wipe-up','wipe-down','iris','slide','push-left','push-right','zoom','blur']`);
   const stageBox=await page.locator('#stage').boundingBox();report.stage={w:Math.round(stageBox.width),h:Math.round(stageBox.height)};
   const results={};
   for(const type of types){results[type]=[];
    for(const q of [.25,.5,.75]){
     const loc=q*.8;await page.evaluate(`(()=>{const s=ep().scenes[1];s.transition={type:'${type}',duration:.8};T=starts()[1]+${loc};resetTransitionCache();draw();draw()})()`);
     const shot=(await page.locator('#stage').screenshot()).toString('base64');
     const d=await page.evaluate(async b64=>{const diffMean=(a,b)=>{let s=0;for(let i=0;i<a.length;i+=4)s+=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);return s/(a.length/4*3*255)};
      const W=160,H=90,mk=()=>{const c=document.createElement('canvas');c.width=W;c.height=H;return c};
      const im=new Image();await new Promise(r=>{im.onload=r;im.src='data:image/png;base64,'+b64});
      const a=mk(),ac=a.getContext('2d',{willReadFrequently:true});ac.drawImage(im,0,0,W,H);
      const ex=mk(),big=document.createElement('canvas');big.width=640;big.height=360;const bc=big.getContext('2d');
      await renderVideoFrame(bc,T,{w:640,h:360,previous:new Map(),captions:false});
      const ec=ex.getContext('2d',{willReadFrequently:true});ec.drawImage(big,0,0,W,H);
      return diffMean(ac.getImageData(0,0,W,H).data,ec.getImageData(0,0,W,H).data)},shot);
     results[type].push(+d.toFixed(4))}}
   report.parity=results;
   const worst=Math.max(...Object.values(results).flat());report.parityWorst=worst;
   fs.writeFileSync(path.join(OUT,'parity.json'),JSON.stringify(results,null,1));
   assert.ok(worst<.1,'preview/export mismatch: '+JSON.stringify(results));
   assert.equal(errors.length,0,errors.join('\n'));await page.close();srv.close()}

  // ---- 6. performance during real playback across scene boundaries
  {const r=await perfRun(browser,ROOT);report.perf=r.perf;
   assert.ok(report.perf.edgeMax<40,'boundary frame too slow: '+JSON.stringify(report.perf));
   assert.ok(report.perf.over24<=2,'too many slow frames: '+JSON.stringify(report.perf));
   assert.equal(report.perf.longTasksNearBoundary,0,'long task around scene change: '+JSON.stringify(report.perf));
   assert.equal(r.errors.length,0,r.errors.join('\n'))}

  // ---- 7. backward compatibility: frames outside transitions of a legacy project (no atmosphere/lighting/light) are identical to v21
  if(process.env.BASELINE){
   const hashes=async root=>{const {page,srv,errors}=await open(browser,root);
    await page.evaluate(`(${BUILD})({n:3,locs:['forest','field'],tr:['cut','dissolve','fadeblack'],atmo:['none'],noLight:true})`);
    const h=await page.evaluate(`(async()=>{const cv=document.createElement('canvas');cv.width=320;cv.height=180;const ctx=cv.getContext('2d',{willReadFrequently:true});const info={w:320,h:180,previous:new Map(),captions:false};const out=[];
     for(const t of [0.5,2.9,3.8,5.9,6.8,8.5]){await renderVideoFrame(ctx,t,info);const d=ctx.getImageData(0,0,320,180).data;let s=0;for(let i=0;i<d.length;i++)s=(s*31+d[i])>>>0;out.push(s)}return out})()`);
    await page.close();srv.close();return{h,errors}};
   const a=await hashes(process.env.BASELINE),b=await hashes(ROOT);
   report.compat={same:JSON.stringify(a.h)===JSON.stringify(b.h)};
   assert.deepEqual(b.h,a.h,'export of legacy project changed vs baseline');
  }

  // ---- 9. edge cases (D1)
  {const {page,srv,errors}=await open(browser,ROOT,{width:390,height:800});
   report.edge=await page.evaluate(`(async()=>{const out={};
    const mk=(n,dur,tr)=>{commit(()=>{const E=ep();E.scenes.length=0;for(let i=0;i<n;i++){const s=newScene();s.duration=dur;s.location=i%2?'field':'forest';s.atmosphere=i%2?'fog':'rain';s.transition={type:tr,duration:.55};E.scenes.push(s)}});sel=0};
    const cv=document.createElement('canvas');cv.width=320;cv.height=180;const ctx=cv.getContext('2d');const info=()=>({w:320,h:180,previous:new Map(),captions:false});
    mk(3,.3,'dissolve');const st=starts();for(const t of [0,.1,.29,.31,.5,.7,.9]){await renderVideoFrame(ctx,Math.min(t,total()-.001),info())}out.shortScene='ok';
    mk(4,2,'push-left');for(let k=0;k<200;k++){T=Math.random()*total();draw()}out.scrub='ok';
    mk(4,2,'dissolve');T=starts()[2]+.2;draw();commit(()=>{ep().scenes.splice(1,1)});draw();out.deleteDuring={snapshot:prevSnapshotIndex,scenes:ep().scenes.length};
    mk(3,2,'dissolve');T=starts()[1]+.1;draw();out.mobile={w:document.getElementById('stage').clientWidth,cv:document.getElementById('weatherCv').width>0};
    return out})()`);
   assert.equal(report.edge.deleteDuring.snapshot,-1,'cache must be cleared after deleting a scene');
   assert.ok(report.edge.mobile.cv,'weather canvas sized on mobile');
   await page.emulateMedia({reducedMotion:'reduce'});
   report.edge.reduced=await page.evaluate(`(()=>{const E=ep();E.scenes[0].atmosphere='rain';sel=0;T=.5;draw();return{canvasDisplay:document.getElementById('weatherCv').style.display,cssClass:document.getElementById('weather').className}})()`);
   assert.equal(report.edge.reduced.canvasDisplay,'none');assert.equal(report.edge.reduced.cssClass,'rain');
   assert.equal(errors.length,0,errors.join('\n'));await page.close();srv.close()}

  // ---- 8. contact sheet around a rain->rain dissolve with light change
  {const {page,srv}=await open(browser,ROOT);
   await page.evaluate(`(${BUILD})({n:2,locs:['forest','field'],atmo:['rain'],tr:['cut','dissolve'],trDur:.5,light:[{glow:0,vignette:0,exposure:1,flicker:0},{glow:.9,vignette:.7,exposure:1,flicker:0}]})`);
   const dataUrl=await page.evaluate(`(async()=>{const st=starts(),b=st[1],cols=4,ts=[];for(let t=-.5;t<=.5001;t+=.1)ts.push(b+t);
    const W=320,H=180,sheet=document.createElement('canvas');sheet.width=W*cols;sheet.height=H*Math.ceil(ts.length/cols);const sc=sheet.getContext('2d');
    const cv=document.createElement('canvas');cv.width=W;cv.height=H;const ctx=cv.getContext('2d');const info={w:W,h:H,previous:new Map(),captions:false};
    for(let n=0;n<ts.length;n++){await renderVideoFrame(ctx,Math.min(ts[n],total()-.001),info);const x=(n%cols)*W,y=Math.floor(n/cols)*H;sc.drawImage(cv,x,y);sc.fillStyle='#fff';sc.font='14px sans-serif';sc.fillText('t='+(ts[n]-b).toFixed(1),x+6,y+16)}
    return sheet.toDataURL('image/png')})()`);
   fs.writeFileSync(path.join(OUT,'contact-sheet.png'),Buffer.from(dataUrl.split(',')[1],'base64'));await page.close();srv.close()}
  console.log('PASS scene-transition: continuity, weather crossfade, light blend, cache, parity, perf'+(process.env.BASELINE?', backward compat':''));
  console.log(JSON.stringify({continuity:report.continuity,crossfade:report.crossfade,light:report.light,cache:report.cache,parityWorst:report.parityWorst,perf:report.perf,edge:report.edge,compat:report.compat}));
 }catch(e){console.log(JSON.stringify(report));throw e}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
