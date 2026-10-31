// D2 smoke (v31): episode-wide atmosphere/light/fx buttons
const {chromium}=require('playwright');const path=require('path');const assert=require('assert');
(async()=>{
 const root=process.env.ROOT||process.cwd();
 const b=await chromium.launch();const pg=await b.newPage();
 const errs=[];pg.on('pageerror',e=>errs.push(String(e)));
 await pg.goto('file://'+path.join(root,'index.html'));await pg.waitForTimeout(600);
 const r=await pg.evaluate(()=>{
  const E=ep();const mk=o=>Object.assign(newScene(),{location:'studio',duration:3},o);
  E.scenes=[mk({atmosphere:'rain',light:'night',lighting:{exposure:.8,glow:.3,vignette:.2,focusX:40,focusY:30,flicker:0},cinematicFx:{mode:'moon'}}),mk({atmosphere:'none'}),mk({atmosphere:'rain'}),mk({atmosphere:'snow',light:'',cinematicFx:{mode:'x'}})];
  sel=0;render();
  const o={};
  o.atmo=applyEpisodeWide(E,E.scenes[0],'atmosphere');o.atmoVals=E.scenes.map(s=>s.atmosphere);
  o.atmoAgain=applyEpisodeWide(E,E.scenes[0],'atmosphere');
  o.light=applyEpisodeWide(E,E.scenes[0],'light');o.lightVals=E.scenes.map(s=>[s.light,s.lighting&&s.lighting.exposure]);
  o.lightIndep=E.scenes[1].lighting!==E.scenes[0].lighting;
  o.fx=applyEpisodeWide(E,E.scenes[0],'fx');o.fxVals=E.scenes.map(s=>s.cinematicFx&&s.cinematicFx.mode);o.fxIndep=E.scenes[1].cinematicFx!==E.scenes[0].cinematicFx;
  E.scenes[0].cinematicFx=null;o.fxClear=applyEpisodeWide(E,E.scenes[0],'fx');o.fxClearVals=E.scenes.map(s=>!!s.cinematicFx);
  o.bad=[applyEpisodeWide(null,null,'x'),applyEpisodeWide(E,E.scenes[0],'zzz')];
  return o});
 assert.strictEqual(r.atmo,2);assert.deepStrictEqual(r.atmoVals,['rain','rain','rain','rain']);assert.strictEqual(r.atmoAgain,0);
 assert.strictEqual(r.light,3);assert.deepStrictEqual(r.lightVals,[['night',.8],['night',.8],['night',.8],['night',.8]]);assert(r.lightIndep);
 assert.strictEqual(r.fx,3);assert.deepStrictEqual(r.fxVals,['moon','moon','moon','moon']);assert(r.fxIndep);
 assert.strictEqual(r.fxClear,3);assert.deepStrictEqual(r.fxClearVals,[false,false,false,false]);assert.deepStrictEqual(r.bad,[0,0]);
 // UI: buttons exist, click applies, undo restores
 const ui=await pg.evaluate(async()=>{
  const E=ep();const mk=o=>Object.assign(newScene(),{location:'studio',duration:3},o);
  E.scenes=[mk({atmosphere:'fog'}),mk({atmosphere:'none'})];sel=0;render();
  const box=document.querySelector('.episode-wide');if(!box)return{box:false};
  const btns=[...box.querySelectorAll('button')];btns[0].click();
  const after=ep().scenes[1].atmosphere;undo();const undone=ep().scenes[1].atmosphere;
  return{box:true,n:btns.length,after,undone}});
 assert.strictEqual(ui.box,true);assert.strictEqual(ui.n,3);assert.strictEqual(ui.after,'fog');assert.strictEqual(ui.undone,'none');
 // D3 integration: cut warning disappears after applying atmosphere episode-wide
 const d3=await pg.evaluate(()=>{
  const E=ep();const mk=o=>Object.assign(newScene(),{location:'studio',duration:4},o);
  E.scenes=[mk({atmosphere:'rain'}),mk({atmosphere:'none',transition:{type:'cut'}})];
  const f=()=>smartAnalyze(S).filter(x=>x.autoFix&&x.autoFix.kind==='transition').length;
  const a=f();applyEpisodeWide(E,E.scenes[0],'atmosphere');return{a,b:f()}});
 assert.strictEqual(d3.a,1);assert.strictEqual(d3.b,0);
 assert.deepStrictEqual(errs,[]);
 await b.close();console.log('PASS D2: episode-wide atmosphere/light/fx buttons + undo + D3 cut-warning integration');
})().catch(e=>{console.error(e);process.exit(1)});
