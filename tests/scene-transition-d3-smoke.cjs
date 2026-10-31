// D3 smoke (v32): handle-mode strict length check + auto-fix; different-location warp-cut check
const {chromium}=require('playwright');const path=require('path');const assert=require('assert');
(async()=>{
 const root=process.env.ROOT||process.cwd();
 const b=await chromium.launch();const pg=await b.newPage();
 const errs=[];pg.on('pageerror',e=>errs.push(String(e)));
 await pg.goto('file://'+path.join(root,'index.html'));await pg.waitForTimeout(600);
 const r=await pg.evaluate(()=>{
  const E=ep(),ch=(S.characters[0]&&S.characters[0].id)||'c1';const o={};
  const mk=x=>Object.assign(newScene(),{location:'studio',duration:4},x);
  const hs=()=>smartAnalyze(S).filter(x=>x.autoFix&&x.autoFix.kind==='handle').map(x=>x.scene);
  // handle: ฉากใหม่ 4 วิ transition 2 วิ (> 30% = 1.2) -> เตือน; overlap ปกติไม่เตือน
  E.scenes=[mk({}),mk({transition:{type:'dissolve',duration:2,mode:'handle'}}),mk({transition:{type:'dissolve',duration:.8,mode:'handle'}})];
  o.warn=hs();
  E.scenes[1].transition.mode='overlap';o.noHandle=hs();
  E.scenes[1].transition.mode='handle';
  // ฉากก่อนสั้น: prev 1 วิ, transition .8 > 0.5
  E.scenes=[mk({duration:1}),mk({transition:{type:'dissolve',duration:.8,mode:'handle'}})];o.shortPrev=hs();
  E.scenes=[mk({}),mk({transition:{type:'cut',mode:'handle'}})];o.cutIgnored=hs();
  // auto-fix
  E.scenes=[mk({}),mk({transition:{type:'dissolve',duration:2,mode:'handle'}})];
  const n=smartAutoFixAll();o.fixedDur=ep().scenes[1].transition.duration;o.fixedMode=ep().scenes[1].transition.mode;o.after=hs();o.n=n;
  undo();o.undone=ep().scenes[1].transition.duration;
  // different location warp
  const act=(x,f='right',p='stand')=>[{char:ch,x,y:90,facing:f,pose:p}];
  const wp=()=>smartAnalyze(S).filter(x=>x.kind==='continuity'&&/ตัดตรง/.test(x.msg)&&x.autoFix&&x.autoFix.kind==='transition').map(x=>x.scene);
  ep().scenes=[mk({location:'studio',actors:act(30),characters:[ch]}),mk({location:'forest',actors:act(30),characters:[ch],transition:{type:'cut'}})];o.warp=wp();
  ep().scenes[1].actors=act(60);o.moved=wp();
  ep().scenes[1].actors=act(30,'left');o.turned=wp();
  ep().scenes[1].actors=act(30);ep().scenes[1].transition={type:'dissolve',duration:.5};o.hasTr=wp();
  ep().scenes[1].transition={type:'cut'};const n2=smartAutoFixAll();o.warpFixed=ep().scenes[1].transition.type;o.warpAfter=wp();
  ep().scenes=[mk({location:'studio',actors:act(30),characters:[ch]}),mk({location:'studio',actors:act(30),characters:[ch],transition:{type:'cut'}})];o.sameLoc=wp();
  return o});
 assert.deepStrictEqual(r.warn,[1]);assert.deepStrictEqual(r.noHandle,[]);assert.deepStrictEqual(r.shortPrev,[1]);assert.deepStrictEqual(r.cutIgnored,[]);
 assert.strictEqual(r.fixedDur,1.2);assert.strictEqual(r.fixedMode,'handle');assert.deepStrictEqual(r.after,[]);assert.strictEqual(r.undone,2);
 assert.deepStrictEqual(r.warp,[1]);assert.deepStrictEqual(r.moved,[]);assert.deepStrictEqual(r.turned,[]);assert.deepStrictEqual(r.hasTr,[]);
 assert.strictEqual(r.warpFixed,'dissolve');assert.deepStrictEqual(r.warpAfter,[]);assert.deepStrictEqual(r.sameLoc,[]);
 assert.deepStrictEqual(errs,[]);
 await b.close();console.log('PASS D3: handle-mode length check + auto-fix + undo; different-location warp-cut check',JSON.stringify({n:r.n}));
})().catch(e=>{console.error(e);process.exit(1)});
