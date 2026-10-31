// C4 smoke (v35): entry-turn ไม่ใช้กับท่า sleep/ตัวละครสัตว์ + checker เตือนแทน; C3 เก็บตก follow/panorama + match
const {chromium}=require('playwright');const path=require('path');const assert=require('assert');
(async()=>{
 const root=process.env.ROOT||process.cwd();
 const b=await chromium.launch();const pg=await b.newPage();
 const errs=[];pg.on('pageerror',e=>errs.push(String(e)));
 await pg.goto('file://'+path.join(root,'index.html'));await pg.waitForTimeout(600);
 const r=await pg.evaluate(()=>{
  const o={};S.characters=[charFromPreset(CHAR_PRESETS[0]),charFromPreset(CREATURE_PRESETS[0])];
  const hu=S.characters[0].id,cr=S.characters[1].id,E=ep();
  const mk=x=>Object.assign(newScene(),{location:'studio',duration:4},x);
  const pair=(ch,pose)=>{const A=mk({characters:[ch],actors:[{char:ch,x:40,y:90,facing:'left',pose}]}),B=mk({characters:[ch],transition:{type:'dissolve',duration:.8},actors:[{char:ch,x:40,y:90,facing:'right',pose}]});E.scenes=[A,B];return B};
  const trace=B=>[0,.1,.2,.3].map(t=>{const s=actorAtTime(B.actors[0],B,t,4);return[s.facing,s.bodyYaw===undefined?null:Math.round(s.bodyYaw)]});
  const warn=()=>smartAnalyze(S).filter(x=>x.kind==='continuity'&&/หันกลับด้าน/.test(x.msg)).map(x=>x.scene);
  let B=pair(hu,'stand');o.humanStand=trace(B);o.wHumanStand=warn();
  B=pair(hu,'sleep');o.humanSleep=trace(B);o.wHumanSleep=warn();
  B=pair(cr,'stand');o.creature=trace(B);o.wCreature=warn();
  B=pair(cr,'sleep');o.creatureSleep=trace(B);o.wCreatureSleep=warn();
  const owl=charFromPreset(CREATURE_PRESETS.find(p=>p[0]==='owl'));S.characters.push(owl);B=pair(owl.id,'sleep');o.owlSleep=trace(B);o.wOwlSleep=warn();
  // C3 เก็บตก: follow + match
  const base={type:'static',from:1,to:1,panX:0,panY:0,world:1,rotation:0,startX:0,endX:100};
  const fol=mk({camera:Object.assign({},base,{type:'follow'}),actors:[{char:hu,x:20,y:90,facing:'right',pose:'stand'}],characters:[hu]});
  const nxt=mk({camera:base,transition:{type:'cut',match:true,matchDur:1}});E.scenes=[fol,nxt];
  const endF=cameraPose(fol,4,4,4);o.followEndDx=endF.dx;o.followStart=cameraPoseAt(E,1,nxt,0,0,4).dx;o.followDone=cameraPoseAt(E,1,nxt,1,1,4).dx;
  // panorama กว้าง -> ฉากแคบ: ต้องไม่เลื่อนภาพหลุดจอ
  const pano=mk({camera:Object.assign({},base,{type:'panorama',world:2,startX:0,endX:100})});
  E.scenes=[pano,nxt];const pp=cameraPose(pano,4,4,4);o.panoTx=-pp.extent*pp.panoShift+pp.dx;o.panoStart=cameraPoseAt(E,1,nxt,0,0,4).dx;
  // panorama -> panorama ฉากกว้างเท่ากัน: เลื่อนต่อเนื่อง
  const pano2=mk({camera:Object.assign({},base,{type:'panorama',world:2,startX:0,endX:100}),transition:{type:'cut',match:true,matchDur:1}});
  E.scenes=[pano,pano2];const q=cameraPoseAt(E,1,pano2,0,0,4);o.pano2Start=q.dx;
  return o});
 // human stand: หมุน (bodyYaw มีค่า, facing เปลี่ยนกลางทาง)
 assert.strictEqual(r.humanStand[0][0],'left');assert.ok(r.humanStand[1][1]>0&&r.humanStand[1][1]<90);assert.strictEqual(r.humanStand[3][0],'right');assert.deepStrictEqual(r.wHumanStand,[]);
 // มนุษย์ท่า sleep / สัตว์ท่าปกติ / นก sleep: ยังหมุน (ภาพเปลี่ยนตามมุมจริง) และไม่เตือน
 for(const k of ['humanSleep','creature','owlSleep']){assert.strictEqual(r[k][0][0],'left',k);assert.ok(r[k][1][1]>0&&r[k][1][1]<90,k);assert.strictEqual(r[k][3][0],'right',k)}
 assert.deepStrictEqual(r.wHumanSleep,[]);assert.deepStrictEqual(r.wCreature,[]);assert.deepStrictEqual(r.wOwlSleep,[]);
 // สัตว์สี่เท้าท่า sleep: ภาพไม่ขึ้นกับมุม -> ไม่หมุน ทิศใหม่ทันที + checker เตือน
 for(const [f,y] of r.creatureSleep){assert.strictEqual(f,'right');assert.strictEqual(y,null)}
 assert.deepStrictEqual(r.wCreatureSleep,[1]);
 // follow: actor x=20 -> dx=clamp(30,-15,15)*.5=7.5
 assert.ok(Math.abs(r.followEndDx-7.5)<1e-9&&Math.abs(r.followStart-7.5)<1e-9&&Math.abs(r.followDone)<1e-9,JSON.stringify([r.followEndDx,r.followStart,r.followDone]));
 assert.ok(Math.abs(r.panoTx+100)<1e-6);assert.ok(r.panoStart>=-8-1e-9&&r.panoStart<=8,'pano clamp '+r.panoStart);
 assert.ok(Math.abs(r.pano2Start+100)<1e-6,'pano->pano '+r.pano2Start);
 assert.deepStrictEqual(errs,[]);
 await b.close();console.log('PASS C4: entry-turn skips quadruped sleep only (+checker warns); others still turn; C3: follow/panorama match, clamp');
})().catch(e=>{console.error(e);process.exit(1)});
