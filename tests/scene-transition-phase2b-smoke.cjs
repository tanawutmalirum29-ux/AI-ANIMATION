// Phase 2b/3 smoke: A6 easing (transition.ease) — พรีวิว/ส่งออกใช้ฟังก์ชันเดียวกัน
const {chromium}=require('playwright');const path=require('path');const assert=require('assert');
(async()=>{
 const root=process.env.ROOT||process.cwd();
 const b=await chromium.launch();const pg=await b.newPage();
 const errs=[];pg.on('pageerror',e=>errs.push(String(e)));
 await pg.goto('file://'+path.join(root,'index.html'));await pg.waitForTimeout(600);
 const r=await pg.evaluate(()=>{
  const sc={transition:{type:'dissolve',duration:1}};const o={};
  for(const m of ['','linear','ease-in','ease-out','ease-in-out']){sc.transition.ease=m||undefined;o[m||'default']=[0,.25,.5,.75,1].map(q=>+easeTransition(q,sc).toFixed(4))}
  return o});
 assert.deepStrictEqual(r.default,[0,.1563,.5,.8438,1]);       // smoothstep เดิม ไม่เปลี่ยน
 assert.deepStrictEqual(r.linear,[0,.25,.5,.75,1]);
 assert(r['ease-in'][1]<.25&&r['ease-out'][1]>.25);
 for(const k in r){assert.strictEqual(r[k][0],0);assert.strictEqual(r[k][4],1)}

 // ---- C2: continuity checker + auto-fix ----
 const c2=await pg.evaluate(()=>{
  const E=ep(),base=newScene();
  const mk=(o)=>Object.assign(newScene(),{location:'studio',duration:4},o);
  const ch=(S.characters[0]&&S.characters[0].id)||'c1';
  const s1=mk({actors:[{char:ch,x:30,y:90,facing:'right',pose:'stand'}],characters:[ch],
   props:[{kind:'lamp',x:50,y:85,scale:1,front:false}],interactionInitialHold:[{propIndex:0,actor:ch,hand:'right'}]});
  const s2=mk({actors:[{char:ch,x:32,y:90,facing:'left',pose:'stand'}],characters:[ch],transition:{type:'cut'}});
  E.scenes=[s1,s2];selEp=selEp||0;sel=1;
  const before=smartAnalyze(S).filter(x=>x.kind==='continuity'&&x.autoFix).map(x=>x.autoFix.kind).sort();
  const n=smartAutoFixAll();
  const after=smartAnalyze(S).filter(x=>x.kind==='continuity'&&x.autoFix).length;
  const a=ep().scenes[1].actors[0];
  const held=ep().scenes[1].interactionInitialHold||[];
  undo();const undone=ep().scenes[1].actors[0].facing;
  return{before,n,after,facing:a.facing,held:held.length,undone}});
 assert.deepStrictEqual(c2.before,['facing','prop']);
 assert.strictEqual(c2.after,0);assert.strictEqual(c2.facing,'right');assert.strictEqual(c2.held,1);
 assert.strictEqual(c2.undone,'left');


 // ---- C1: turn through front at scene entry ----
 const c1=await pg.evaluate(()=>{
  const E=ep(),ch=(S.characters[0]&&S.characters[0].id)||'c1';
  const mk=o=>Object.assign(newScene(),{location:'studio',duration:4},o);
  const s1=mk({actors:[{char:ch,x:30,y:90,facing:'right',pose:'stand'}],characters:[ch]});
  const s2=mk({actors:[{char:ch,x:30,y:90,facing:'left',pose:'stand'}],characters:[ch],transition:{type:'dissolve',duration:.6}});
  E.scenes=[s1,s2];
  const at=l=>{const r=actorAtTime(E.scenes[1].actors[0],E.scenes[1],l,4);return{f:r.facing,y:r.bodyYaw,h:r.headYaw}};
  const o={t0:at(0),t1:at(.1),t2:at(.22),t3:at(.4),t4:at(1.5),cuts:null};
  E.scenes[1].transition={type:'dissolve',duration:.6,turn:false};o.off=at(0);
  E.scenes[1].transition={type:'cut'};o.cut=at(0);
  E.scenes[1].transition={type:'dissolve',duration:.6,mode:'preroll'};o.pre=at(0);
  E.scenes[1].transition={type:'dissolve',duration:.6};E.scenes[1].actors[0].route=[{x:30,y:90},{x:60,y:90,duration:1}];o.route=at(0);
  o.warn=smartAnalyze(S).filter(x=>x.autoFix&&x.autoFix.kind==='facing').length;
  return o});
 assert.strictEqual(c1.t0.f,'right');assert.strictEqual(c1.t0.y,90);          // เริ่มด้วยทิศเดิม
 assert(c1.t1.y<90&&c1.t1.f==='right');                                         // กำลังหมุนเข้าหาด้านหน้า
 assert(c1.t2.y<5||c1.t2.f==='left');                                            // ผ่านกลาง/เข้าทิศใหม่
 assert.strictEqual(c1.t3.f,'left');assert(c1.t3.y>0&&c1.t3.y<=90);
 assert.strictEqual(c1.t4.f,'left');assert.notStrictEqual(c1.t4.y,0);assert.strictEqual(c1.warn,0);
 assert.strictEqual(c1.off.f,'left');assert.strictEqual(c1.cut.f,'left');assert.strictEqual(c1.pre.f,'left');

 // ---- D2: Sound Desk UI (audioLead/audioTail + audioLink) ----
 await pg.evaluate(()=>{const E=ep();E.scenes=E.scenes.slice(0,2);E.scenes[0].audioClips=[{id:'u1',name:'sfx1',kind:'sfx',at:0,duration:3,trimStart:0,trimEnd:0,volume:1,rate:1,fadeIn:0,fadeOut:0}];delete E.audioLink;AUDIO_DESK_SCENE=0;AUDIO_DESK_TAB='scene';renderAudioDesk()});
 const labels=await pg.evaluate(()=>[...document.querySelectorAll('#audioDeskBody label')].map(l=>l.textContent.slice(0,8)));
 assert(labels.some(x=>x.startsWith('J-cut')),'J-cut field missing');assert(labels.some(x=>x.startsWith('L-cut')),'L-cut field missing');
 await pg.evaluate(()=>{const set=(pre,v)=>{const l=[...document.querySelectorAll('#audioDeskBody label')].find(x=>x.textContent.startsWith(pre));const i=l.querySelector('input');i.value=v;i.dispatchEvent(new Event('change'))};set('J-cut','0.5');});
 await pg.waitForTimeout(80);
 await pg.evaluate(()=>{const set=(pre,v)=>{const l=[...document.querySelectorAll('#audioDeskBody label')].find(x=>x.textContent.startsWith(pre));const i=l.querySelector('input');i.value=v;i.dispatchEvent(new Event('change'))};set('L-cut','1.5');});
 await pg.waitForTimeout(80);
 const d2=await pg.evaluate(()=>{const c=ep().scenes[0].audioClips[0];const box=document.querySelector('.audio-link-box');const cb=box.querySelectorAll('input[type=checkbox]');cb[0].checked=false;cb[0].dispatchEvent(new Event('change'));const a=JSON.stringify(ep().audioLink);const cb2=document.querySelector('.audio-link-box').querySelectorAll('input[type=checkbox]');cb2[0].checked=true;cb2[0].dispatchEvent(new Event('change'));return{lead:c.audioLead,tail:c.audioTail,off:a,back:ep().audioLink===undefined,n:cb.length}});
 assert.strictEqual(d2.lead,.5);assert.strictEqual(d2.tail,1.5);assert.strictEqual(d2.off,'{"link":false,"xfade":true}');assert.strictEqual(d2.back,true);assert.strictEqual(d2.n,2);

 // ---- D3: weather/light/fx change on a hard cut ----
 const d3=await pg.evaluate(()=>{
  const E=ep(),ch=(S.characters[0]&&S.characters[0].id)||'c1';
  const mk=o=>Object.assign(newScene(),{location:'studio',duration:4},o);
  const s1=mk({atmosphere:'rain'}),s2=mk({atmosphere:'none',transition:{type:'cut'}}),s3=mk({atmosphere:'none',transition:{type:'cut'}});
  E.scenes=[s1,s2,s3];
  const f=()=>smartAnalyze(S).filter(x=>x.autoFix&&x.autoFix.kind==='transition').map(x=>x.scene);
  const before=f();smartAutoFixAll();const after=f(),tr=ep().scenes[1].transition.type;
  return{before,after,tr}});
 assert.deepStrictEqual(d3.before,[1]);assert.deepStrictEqual(d3.after,[]);assert.strictEqual(d3.tr,'dissolve');

 // ---- A1: ฉากเดิมมีชีวิตระหว่าง transition ----
 const a1=await pg.evaluate(()=>{
  if(!S.characters.some(c=>c.id==='a1c'))S.characters.push({id:'a1c',name:'A',rig:{style:'human'}});const E=ep(),ch='a1c';
  const mk=o=>Object.assign(newScene(),{location:'studio',duration:3},o);
  const s1=mk({actors:[{char:ch,x:30,y:90,facing:'right',pose:'stand'}],characters:[ch]});
  const s2=mk({actors:[{char:ch,x:70,y:90,facing:'right',pose:'stand'}],characters:[ch],transition:{type:'dissolve',duration:.6}});
  E.scenes=[s1,s2];selEp=selEp||0;resetTransitionCache();
  const o={};
  o.enabled=[liveEnabled(s2,1),liveEnabled(Object.assign({},s2,{transition:{type:'cut'}}),1),liveEnabled(Object.assign({},s2,{transition:{type:'push-left'}}),1),liveEnabled(Object.assign({},s2,{transition:{type:'push-left',live:true}}),1),liveEnabled(Object.assign({},s2,{transition:{type:'dissolve',live:false}}),1)];
  o.K=liveK(s2);
  playing=false;T=starts()[1]+.01;draw();
  const rig=el=>{const r=el.querySelector('#rig');return r?r.innerHTML:''};
  const f0=liveFrame(1,0),f3=liveFrame(1,3);
  o.differs=rig(f0)!==rig(f3);o.hasRig=rig(f0).length>100;
  T=starts()[1]+.4;draw();const cur=$('#transitionPrevious').firstElementChild;o.usesK2=cur===prevLive[1];
  T=starts()[1]+.05;draw();o.usesBase=$('#transitionPrevious').firstElementChild===prevSnapshotData.svg;
  E.scenes[1].transition.live=false;resetTransitionCache();T=starts()[1]+.4;draw();o.offUsesBase=$('#transitionPrevious').firstElementChild===prevSnapshotData.svg;
  T=0;draw();
  return o});
 assert.deepStrictEqual(a1.enabled,[true,false,false,true,false]);assert.strictEqual(a1.K,3);
 assert(a1.hasRig,'rig missing');assert(a1.differs,'live frame identical to frozen frame');
 assert(a1.usesK2);assert(a1.usesBase);assert(a1.offUsesBase);

 // ---- A1: perf (preview) + export parity ----
 const a1p=await pg.evaluate(async()=>{
  const E=ep(),ch='a1c';
  const mk=o=>Object.assign(newScene(),{location:'studio',duration:3},o);
  const acts=x=>[{char:ch,x,y:90,facing:'right',pose:'stand'}];
  E.scenes=[mk({actors:acts(30),characters:[ch]}),mk({actors:acts(70),characters:[ch],transition:{type:'dissolve',duration:.6}})];
  const run=live=>{
   E.scenes[1].transition.live=live;resetTransitionCache();playing=true;const st=starts()[1],ts=[];
   for(let T0=st-.9;T0<=st+.9;T0+=1/60){T=T0;const a=performance.now();prefetchTransition();draw();ts.push(performance.now()-a)}
   playing=false;ts.sort((a,b)=>a-b);return{avg:+(ts.reduce((a,b)=>a+b,0)/ts.length).toFixed(2),max:+ts[ts.length-1].toFixed(1),n:ts.length}};
  const on=run(true),off=run(false);
  // export
  const c=document.createElement('canvas');c.width=320;c.height=180;const ctx=c.getContext('2d');
  const frame=async(live,t)=>{E.scenes[1].transition.live=live;resetTransitionCache();const info={w:320,h:180,captions:false,previous:new Map()};await renderVideoFrame(ctx,t,info);return{d:Array.from(ctx.getImageData(0,0,320,180).data),keys:info.previous.size}};
  const st=starts()[1],A=await frame(true,st+.4),B=await frame(false,st+.4),A2=await frame(true,st+.4);
  let diff=0;for(let i=0;i<A.d.length;i++)if(A.d[i]!==B.d[i])diff++;let same=0;for(let i=0;i<A.d.length;i++)if(A.d[i]!==A2.d[i])same++;
  // อยู่นอก transition ต้องเหมือนกันทุกพิกเซล
  const lateA=await frame(true,st+1.5),lateB=await frame(false,st+1.5);let late=0;for(let i=0;i<lateA.d.length;i++)if(lateA.d[i]!==lateB.d[i])late++;
  // cache keys: ทั้ง transition ใช้ไม่เกิน K+1 เฟรมต่อฉาก
  E.scenes[1].transition.live=true;resetTransitionCache();const info={w:320,h:180,captions:false,previous:new Map()};
  for(let t=st;t<st+.6;t+=1/30)await renderVideoFrame(ctx,t,info);
  T=0;draw();return{on,off,diff,deterministic:same,late,keys:info.previous.size}});
 console.log('A1perf',JSON.stringify(a1p));
 assert(a1p.diff>0,'live export identical to frozen');assert.strictEqual(a1p.deterministic,0);assert.strictEqual(a1p.late,0);
 assert(a1p.keys<=4,'too many cached frames: '+a1p.keys);assert(a1p.on.max<24,'live max frame '+a1p.on.max);assert(a1p.on.avg<a1p.off.avg*1.6+1,'live avg too high');
 // ---- D1: round-trip ฟิลด์ transition ผ่าน JSON + fix() ----
 const rt=await pg.evaluate(()=>{
  const E=ep();const s=E.scenes[1];s.transition={type:'dissolve',duration:.7,ease:'ease-out',mode:'preroll'};
  s.audioClips=[{id:'a1',name:'x',at:0,audioLead:.3,audioTail:.4}];E.audioLink={link:false,xfade:false};
  const copy=JSON.parse(JSON.stringify(S));S=copy;fix();
  const s2=ep().scenes[1];return{tr:s2.transition,lead:s2.audioClips&&s2.audioClips[0]&&s2.audioClips[0].audioLead,tail:s2.audioClips&&s2.audioClips[0]&&s2.audioClips[0].audioTail,link:ep().audioLink}});
 assert.strictEqual(rt.tr.ease,'ease-out');assert.strictEqual(rt.tr.mode,'preroll');assert.strictEqual(rt.tr.duration,.7);
 assert.strictEqual(rt.lead,.3);assert.strictEqual(rt.tail,.4);assert.deepStrictEqual(rt.link,{link:false,xfade:false});
 assert.deepStrictEqual(errs,[]);
 await b.close();console.log('PASS phase2b: A6 easing + C1 entry turn + C2 continuity checker/auto-fix + D2 sound-desk UI + D3 cut-QA + A1 live prior + D1 round-trip');
})().catch(e=>{console.error(e);process.exit(1)});
