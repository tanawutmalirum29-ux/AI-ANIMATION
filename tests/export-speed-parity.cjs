// A5 (v33): export speed + pixel parity vs BASELINE (brightness(1) filter fast-path)
const {chromium}=require('playwright');const path=require('path');const assert=require('assert');
const scenario=async(pg,root)=>{await pg.goto('file://'+path.join(root,'index.html'));await pg.waitForTimeout(600);
 return pg.evaluate(async()=>{
  const E=ep(),chars=['p1','p2'];chars.forEach(id=>{if(!S.characters.some(c=>c.id===id))S.characters.push({id,name:id,rig:{style:'human'}})});
  const A=x=>chars.map((c,i)=>({char:c,x:x+i*30,y:90,facing:'right',pose:'walk'}));
  const mk=o=>Object.assign(newScene(),{location:'forest',duration:3,atmosphere:'rain',characters:chars},o);
  const types=['dissolve','blur','zoom','fadeblack','push-left','wipe-left','cut'],out={frames:[],perf:{}};
  const W=640,H=360,c=document.createElement('canvas');c.width=W;c.height=H;const ctx=c.getContext('2d',{alpha:false});
  const hash=()=>{const d=ctx.getImageData(0,0,W,H).data,o=[];for(let i=0;i<d.length;i+=53)o.push(d[i]);return o};
  for(const ex of [1,.8]){for(const type of types){
   E.scenes=[mk({actors:A(20),lighting:{exposure:ex,glow:0,vignette:0,focusX:50,focusY:40,flicker:0}}),mk({actors:A(40),lighting:{exposure:ex,glow:0,vignette:0,focusX:50,focusY:40,flicker:0},transition:{type,duration:.6}})];
   resetTransitionCache();const info={w:W,h:H,captions:false,previous:new Map()},st=starts()[1];
   for(const t of [.5,st+.1,st+.3,st+.5,st+1.5]){await renderVideoFrame(ctx,t,info);out.frames.push({k:ex+':'+type+':'+t.toFixed(2),ex,d:hash()})}}}
  // perf @1280x720 in transition
  E.scenes=[mk({actors:A(20)}),mk({actors:A(40),transition:{type:'dissolve',duration:.6}})];
  const c2=document.createElement('canvas');c2.width=1280;c2.height=720;const x2=c2.getContext('2d',{alpha:false});const info={w:1280,h:720,captions:false,previous:new Map()},st=starts()[1];
  resetTransitionCache();for(let i=0;i<5;i++)await renderVideoFrame(x2,st+.05,info);
  const ts=[];for(let i=0;i<40;i++){const a=performance.now();await renderVideoFrame(x2,st+.05+i*.012,info);ts.push(performance.now()-a)}
  out.perf.trans=+(ts.reduce((a,b)=>a+b,0)/ts.length).toFixed(1);
  const ts2=[];for(let i=0;i<40;i++){const a=performance.now();await renderVideoFrame(x2,1+i*.01,info);ts2.push(performance.now()-a)}
  out.perf.scene=+(ts2.reduce((a,b)=>a+b,0)/ts2.length).toFixed(1);
  return out})};
(async()=>{
 const root=process.env.ROOT||process.cwd(),base=process.env.BASELINE||root;
 const b=await chromium.launch();const errs=[];
 const p1=await b.newPage(),p2=await b.newPage();p1.on('pageerror',e=>errs.push(String(e)));
 const A=await scenario(p1,root),B=await scenario(p2,base);
 assert.strictEqual(A.frames.length,70);
 const bad=[];let worst1=0;
 A.frames.forEach((f,i)=>{const g=B.frames[i];let m=0,n=0;for(let j=0;j<f.d.length;j++){const d=Math.abs(f.d[j]-g.d[j]);if(d>m)m=d;if(d>2)n++}
  if(f.ex===1)worst1=Math.max(worst1,m);
  // exposure!=1 ใช้ทางเดิมเป๊ะ; exposure=1: คลาด <=2/255 ทั้งภาพ ยกเว้นขอบ clip ของ wipe/iris (AA ต่างกัน) ต้องมีพิกเซลที่ต่าง >2 ไม่เกิน 1%
  const edge=/wipe|iris/.test(f.k),ok=f.ex!==1?m===0:(m<=2||(edge&&n/f.d.length<=.01));
  if(f.k!==g.k||!ok)bad.push(f.k+' maxdiff '+m+' frac '+(n/f.d.length).toFixed(4))});
 if(bad.length)console.log('DIFF',bad.length,bad.slice(0,8).join(' | '));
 assert.deepStrictEqual(bad,[],'export pixels differ from baseline beyond tolerance');console.log('worst diff at exposure=1 (levels/255):',worst1);
 console.log('perf (ROOT vs BASELINE) 720p ms/frame',JSON.stringify({new:A.perf,base:B.perf}));
 if(root!==base){assert(A.perf.trans<B.perf.trans*1.1+2,'transition frame not faster/equal');assert(A.perf.scene<B.perf.scene*1.1+2,'scene frame slower')}
 assert.deepStrictEqual(errs,[]);await b.close();
 console.log('PASS A5: export pixel parity (70 frames; exposure!=1 exact, exposure=1 within 2/255 (wipe/iris edge AA aside); 7 transition types) + perf not slower');
})().catch(e=>{console.error(e);process.exit(1)});
