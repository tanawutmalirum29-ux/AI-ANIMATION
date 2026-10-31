// D1 smoke (v30): round-trip transition.live/turn/ease + sanitizer + edge cases
// (switch episode while playing, muted audio, first scene of episode, scene with s.image)
const {chromium}=require('playwright');const path=require('path');const assert=require('assert');
(async()=>{
 const root=process.env.ROOT||process.cwd();
 const b=await chromium.launch();const pg=await b.newPage();
 const errs=[];pg.on('pageerror',e=>errs.push(String(e)));
 await pg.goto('file://'+path.join(root,'index.html'));await pg.waitForTimeout(600);

 // ---- 1) round-trip live/turn/ease ผ่าน JSON + fix() ----
 const rt=await pg.evaluate(()=>{
  const E=ep();const mk=o=>Object.assign(newScene(),{location:'studio',duration:3},o);
  E.scenes=[mk({}),mk({transition:{type:'dissolve',duration:.5,live:true,ease:'ease-in-out'}}),mk({transition:{type:'push-left',duration:.4,live:false,turn:false}}),mk({transition:{type:'fade',duration:.4}})];
  const copy=JSON.parse(JSON.stringify(strip?strip(S):S));S=copy;fix();
  return ep().scenes.map(s=>s.transition)});
 assert.strictEqual(rt[1].live,true);assert.strictEqual(rt[1].ease,'ease-in-out');
 assert.strictEqual(rt[2].live,false);assert.strictEqual(rt[2].turn,false);
 assert.strictEqual(rt[3].live,undefined);assert.strictEqual(rt[3].turn,undefined);

 // ---- 2) sanitizer: ค่าผิดรูปแบบกลับเป็นค่าเริ่มต้น ไม่ทำให้พัง ----
 const sn=await pg.evaluate(()=>{
  const E=ep();const mk=o=>Object.assign(newScene(),{location:'studio',duration:3},o);
  E.scenes=[mk({}),mk({transition:{type:'dissolve',duration:.5,live:null,ease:'bounce',turn:'yes',mode:'zzz'}}),mk({transition:{type:'dissolve',duration:.5,live:'false',turn:'false'}}),mk({transition:'dissolve'})];
  E.audioLink={link:'no',xfade:true};E.scenes[0].audioClips=[{id:'x',name:'x',at:0,audioLead:'0.4',audioTail:-1},{id:'y',name:'y',at:0,audioLead:NaN,audioTail:99}];
  fix();
  const t=ep().scenes.map(s=>JSON.stringify(s.transition));const c=ep().scenes[0].audioClips;
  return{t,link:ep().audioLink,c:c.map(x=>[x.audioLead,x.audioTail])}});
 assert.strictEqual(sn.t[1],'{"type":"dissolve","duration":0.5}');
 assert.strictEqual(sn.t[2],'{"type":"dissolve","duration":0.5,"live":false,"turn":false}');
 assert.strictEqual(JSON.parse(sn.t[3]).type,'dissolve');
 assert.deepStrictEqual(sn.link,{xfade:true});
 assert.deepStrictEqual(sn.c,[[0.4,null],[null,30]].map(r=>r.map(v=>v===null?undefined:v)).map(r=>r));

 // ---- 3) AI patch (updateScene) ที่ใส่ null/ค่าเพี้ยน ----
 const ai=await pg.evaluate(()=>{
  const E=ep();const mk=o=>Object.assign(newScene(),{location:'studio',duration:3},o);
  E.scenes=[mk({}),mk({transition:{type:'dissolve',duration:.5,live:true}})];const id=E.scenes[1].id;
  const r1=applyOps([{op:'updateScene',id,patch:{transition:{live:null,ease:'wobble'}}}]);
  const t1=JSON.stringify(ep().scenes[1].transition);
  const r2=applyOps([{op:'updateScene',id,patch:{transition:{live:false,turn:false,ease:'linear'}}}]);
  return{ok:[r1.ok,r2.ok],t1,t2:JSON.stringify(ep().scenes[1].transition),issues:r1.issues.length}});
 assert.deepStrictEqual(ai.ok,[true,true]);assert.strictEqual(ai.t1,'{"type":"dissolve","duration":0.5}');
 assert.strictEqual(ai.t2,'{"type":"dissolve","duration":0.5,"live":false,"turn":false,"ease":"linear"}');

 // ---- 4) edge: ฉากแรกของตอน (index 0) ไม่มี prior / live ไม่ทำงาน ----
 const first=await pg.evaluate(()=>{
  const E=ep();const mk=o=>Object.assign(newScene(),{location:'studio',duration:3},o);
  E.scenes=[mk({transition:{type:'dissolve',duration:.5,live:true}}),mk({transition:{type:'dissolve',duration:.5}})];
  resetTransitionCache();playing=false;T=.1;draw();
  return{enabled:liveEnabled(E.scenes[0],0),prevShown:$('#transitionPrevious').style.display,cache:prevSnapshotIndex}});
 assert.strictEqual(first.enabled,false);assert.notStrictEqual(first.prevShown,'block');

 // ---- 5) edge: สลับตอนขณะเล่นกลางทรานซิชัน ----
 const sw=await pg.evaluate(()=>{
  const mk=o=>Object.assign(newScene(),{location:'studio',duration:3},o);
  S.episodes[0].scenes=[mk({}),mk({transition:{type:'dissolve',duration:.6,live:true}})];
  if(S.episodes.length<2){S.episodes.push(newEp(2));}
  S.episodes[1].scenes=[mk({location:'forest'}),mk({location:'forest',transition:{type:'fade',duration:.6}})];
  selEp=0;sel=1;resetTransitionCache();T=starts()[1]+.3;playing=true;last=performance.now();draw();prefetchTransition();
  const before=prevLive.length;
  selEp=1;sel=0;T=0;render();         // เหมือนเลือกตอนใหม่จากเมนู ขณะกำลังเล่น
  const afterCache={snap:prevSnapshotIndex,live:prevLive.length,disp:$('#transitionPrevious').style.display};
  T=starts()[1]+.3;draw();prefetchTransition();
  const e1={idx:prevSnapshotIndex,hasPrev:!!prevSnapshotData&&prevSnapshotData.scene===ep().scenes[0]};
  selEp=0;sel=1;T=starts()[1]+.3;render();draw();
  const back={idx:prevSnapshotIndex,okScene:!prevSnapshotData||prevSnapshotData.scene===ep().scenes[0]};
  playing=false;T=0;draw();
  return{before,afterCache,e1,back}});
 assert.strictEqual(sw.afterCache.snap,-1);assert.strictEqual(sw.afterCache.live,0);assert.notStrictEqual(sw.afterCache.disp,'block');
 assert(sw.e1.hasPrev,'prior frame must come from the new episode');assert(sw.back.okScene);

 // ---- 6) edge: ปิดเสียง (clip.mute) + audioLead/Tail ไม่ทำให้ transition/ความยาว overlap เพี้ยน ----
 const mu=await pg.evaluate(()=>{
  selEp=0;const E=ep();const mk=o=>Object.assign(newScene(),{location:'studio',duration:4},o);
  E.scenes=[mk({audioClips:[{id:'m1',name:'m',kind:'sfx',at:0,duration:3,volume:1,rate:1,fadeIn:0,fadeOut:0,mute:true,audioLead:.2,audioTail:.3}]}),mk({transition:{type:'dissolve',duration:.6,live:true}})];
  let err=null,g=null,o=null;try{g=clipGain(E.scenes[0].audioClips[0],1);o=sceneHeadOverlap(E,1);resetTransitionCache();playing=false;T=starts()[1]+.3;draw();prefetchTransition();draw()}catch(x){err=String(x)}
  return{err,g,o}});
 assert.strictEqual(mu.err,null);assert.strictEqual(mu.g,0);assert(mu.o>0);

 // ---- 7) edge: ฉากเดิมใช้ s.image (ภาพนิ่ง) กับ live ----
 const img=await pg.evaluate(async()=>{
  const c=document.createElement('canvas');c.width=64;c.height=36;const x=c.getContext('2d');x.fillStyle='#c33';x.fillRect(0,0,64,36);const data=c.toDataURL('image/png');
  const E=ep(),ch='a1c';if(!S.characters.some(q=>q.id===ch))S.characters.push({id:ch,name:'A',rig:{style:'human'}});
  const mk=o=>Object.assign(newScene(),{location:'studio',duration:3},o);
  E.scenes=[mk({image:data,actors:[{char:ch,x:30,y:90,facing:'right',pose:'stand'}],characters:[ch]}),mk({actors:[{char:ch,x:70,y:90,facing:'right',pose:'stand'}],characters:[ch],transition:{type:'dissolve',duration:.6,live:true}})];
  resetTransitionCache();playing=false;T=starts()[1]+.35;let err=null;
  try{draw();prefetchTransition();draw()}catch(e){err=String(e)}
  const cv=document.createElement('canvas');cv.width=320;cv.height=180;const ctx=cv.getContext('2d');
  const info={w:320,h:180,captions:false,previous:new Map()};
  try{await renderVideoFrame(ctx,starts()[1]+.35,info)}catch(e){err=err||String(e)}
  const d=ctx.getImageData(0,0,320,180).data;let nz=0;for(let i=0;i<d.length;i+=4)if(d[i]||d[i+1]||d[i+2])nz++;
  T=0;draw();return{err,nz,k:prevLive.length}});
 assert.strictEqual(img.err,null);assert(img.nz>1000,'export frame blank with s.image');

 assert.deepStrictEqual(errs,[]);
 await b.close();console.log('PASS D1: live/turn/ease round-trip + sanitizer + AI patch + first scene + episode switch while playing + muted audio + s.image',JSON.stringify({sw:sw.afterCache,mu,img}));
})().catch(e=>{console.error(e);process.exit(1)});
