// C3 smoke (v34): camera match cut — กล้องไหลต่อจากเฟรมสุดท้ายของฉากก่อน; D3 ไม่เตือนวาร์ปเมื่อ match
const {chromium}=require('playwright');const path=require('path');const assert=require('assert');
(async()=>{
 const root=process.env.ROOT||process.cwd();
 const b=await chromium.launch();const pg=await b.newPage();
 const errs=[];pg.on('pageerror',e=>errs.push(String(e)));
 await pg.goto('file://'+path.join(root,'index.html'));await pg.waitForTimeout(600);
 const r=await pg.evaluate(()=>{
  const E=ep(),ch=(S.characters[0]&&S.characters[0].id)||'c1',o={};
  const mk=x=>Object.assign(newScene(),{location:'studio',duration:4},x);
  const zin={type:'zoom-in',from:1,to:1.4,panX:0,panY:0,world:1,rotation:0,startX:0,endX:100};
  const stat={type:'static',from:1,to:1,panX:0,panY:0,world:1,rotation:0,startX:0,endX:100};
  const A=mk({camera:zin}),B=mk({camera:stat,transition:{type:'cut',match:true,matchDur:1}});
  E.scenes=[A,B];
  const z=(loc)=>cameraPoseAt(E,1,E.scenes[1],loc,loc,4).zoom;
  o.endA=cameraPose(A,4,4,4).zoom;o.z0=z(0);o.zMid=z(.5);o.z1=z(1);o.z2=z(2);
  B.transition.match=false;o.noMatch0=z(0);
  B.transition={type:'dissolve',duration:.5,match:true};o.dissolve0=z(0);
  // sanitize
  const t1={type:'cut',match:'true',matchDur:'0.8'},t2={type:'cut',match:'yes',matchDur:-3},t3={type:'cut',matchDur:99};
  sanitizeTransition(t1);sanitizeTransition(t2);sanitizeTransition(t3);o.t1=t1;o.t2=t2;o.t3=t3;
  // DOM: draw at start of scene B reflects prev end zoom
  B.transition={type:'cut',match:true,matchDur:1};T=starts()[1];draw();
  o.domScale0=parseFloat(/scale\(([\d.]+)\)/.exec($('#world').style.transform)[1]);
  T=starts()[1]+2;draw();o.domScale2=parseFloat(/scale\(([\d.]+)\)/.exec($('#world').style.transform)[1]);
  // D3 warp detector: ต่างสถานที่ + ตัดตรง + ตัวละครเดิม => เตือน; match => ไม่เตือน
  const act=(x)=>[{char:ch,x,y:90,facing:'right',pose:'stand'}];
  const wp=()=>smartAnalyze(S).filter(x=>x.kind==='continuity'&&/ตัดตรง/.test(x.msg)&&x.autoFix&&x.autoFix.kind==='transition').map(x=>x.scene);
  ep().scenes=[mk({location:'studio',actors:act(30),characters:[ch]}),mk({location:'forest',actors:act(30),characters:[ch],transition:{type:'cut'}})];o.warp=wp();
  ep().scenes[1].transition={type:'cut',match:true};o.warpMatch=wp();
  // first scene / cross: no prev => unchanged
  ep().scenes=[mk({camera:zin,transition:{type:'cut',match:true}})];o.first=cameraPoseAt(ep(),0,ep().scenes[0],0,0,4).zoom;
  return o});
 assert.ok(Math.abs(r.endA-1.4)<1e-9);
 assert.ok(Math.abs(r.z0-1.4)<1e-9,'start of B = end of A: '+r.z0);
 assert.ok(r.zMid<1.4&&r.zMid>1,'blends mid: '+r.zMid);
 assert.ok(Math.abs(r.z1-1)<1e-9&&Math.abs(r.z2-1)<1e-9);
 assert.strictEqual(r.noMatch0,1);assert.strictEqual(r.dissolve0,1);
 assert.deepStrictEqual(r.t1,{type:'cut',match:true,matchDur:.8});assert.deepStrictEqual(r.t2,{type:'cut'});assert.deepStrictEqual(r.t3,{type:'cut',matchDur:5});
 assert.ok(Math.abs(r.domScale0-1.4)<1e-3,'DOM start '+r.domScale0);assert.ok(Math.abs(r.domScale2-1)<1e-3);
 assert.deepStrictEqual(r.warp,[1]);assert.deepStrictEqual(r.warpMatch,[]);assert.strictEqual(r.first,1);
 assert.deepStrictEqual(errs,[]);
 await b.close();console.log('PASS C3: camera match cut blend + sanitize + D3 skip');
})().catch(e=>{console.error(e);process.exit(1)});
