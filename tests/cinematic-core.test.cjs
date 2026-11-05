'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../studio-cinematic-core'),P=require('../studio-cinematic-planner'),R=require('../studio-video-reference');
const clone=x=>JSON.parse(JSON.stringify(x));
test('all five examples validate and interpolate deterministically in either direction',()=>{
 for(const name of Object.keys(P.NAMES)){const p=P.template(name);assert.deepEqual(C.validate(p),[]);const before=C.evaluate(p,6);C.evaluate(p,10);assert.deepEqual(C.evaluate(p,6),before);assert.ok(!C.render(p,4,9/16).svg.includes('NaN'));}
});
test('malformed plans and unsupported assets are rejected without coercion or substitution',()=>{
 for(const change of [p=>p.actors={},p=>p.objects={},p=>p.interactions={},p=>p.camera.keys=[],p=>p.actors[0].keys=[null],p=>p.camera.keys[0].zoom='2',p=>p.objects[0].kind='lighthouse',p=>p.camera.mode='orbit',p=>p.actors[0].keys[1].t=0,p=>p.objects[0].id=p.actors[0].id]){const p=P.template('street');change(p);assert.ok(C.validate(p).length);}
});
test('camera encloses its rotated viewport inside world, including extreme aspect and shake',()=>{
 const p=P.template('run');p.camera.shake=8;p.camera.keys.forEach(k=>{k.roll=25;k.zoom=.5});
 for(const aspect of [9/16,1,16/9,21/9])for(let t=0;t<12;t+=.13){const c=C.cameraAt(p,t,aspect),r=c.roll*Math.PI/180,rx=(Math.abs(Math.cos(r))*c.width+Math.abs(Math.sin(r))*c.height)/2/c.zoom,ry=(Math.abs(Math.sin(r))*c.width+Math.abs(Math.cos(r))*c.height)/2/c.zoom;assert.ok(c.x-rx>=-.001&&c.x+rx<=p.world.width+.001);assert.ok(c.y-ry>=-.001&&c.y+ry<=p.world.height+.001);}
});
test('depth parallax is derived from world positions, independent of output resolution',()=>{
 const p=P.template('street'),c=C.cameraAt(p,2,9/16),d={...c,x:c.x+100};const near={x:1200,y:1000,z:0},far={...near,z:3};const n=C.project(near,d).x-C.project(near,c).x,f=C.project(far,d).x-C.project(far,c).x;assert.ok(Math.abs(n)>Math.abs(f)*3.9);
});
test('distance-based gait stops when a path stops and matches the inherited rig cycle',()=>{
 const p=P.template('run'),a=p.actors[0];a.keys=[{...a.keys[0],t:0,x:700},{...a.keys[0],t:2,x:890},{...a.keys[0],t:4,x:890}];assert.ok(Math.abs(C.actorState(a,2).phase-1/2.1)<1e-8);assert.equal(C.actorState(a,3).stationary,true);assert.equal(C.actorState(a,2).phase,C.actorState(a,3).phase);
});
test('pickup/place ownership follows time and duplicate holding is invalid',()=>{
 const p=P.template('book');assert.equal(C.evaluate(p,3.99).objects.find(o=>o.id==='book').held,null);let frame=C.evaluate(p,5),o=frame.objects.find(o=>o.id==='book');assert.equal(o.held,'lead');assert.equal(o.x,frame.actors[0].hand.x);assert.equal(o.y,frame.actors[0].hand.y);o=C.evaluate(p,10).objects.find(o=>o.id==='book');assert.equal(o.held,null);assert.equal(o.x,1060);assert.equal(o.y,1003);
 p.interactions.unshift({...p.interactions[0],t:1});assert.ok(C.validate(p).some(i=>i.message.includes('ถืออยู่แล้ว')));
});
test('two-bone IK preserves lengths and clamps unreachable targets',()=>{
 const pts=[null,null,[0,0],[7,0],[13,0]],out=C.rigIK(pts,{x:7,y:5,weight:1});assert.ok(Math.abs(Math.hypot(...out[3])-7)<.0001);assert.ok(Math.abs(Math.hypot(out[4][0]-out[3][0],out[4][1]-out[3][1])-6)<.0001);assert.ok(Math.hypot(out[4][0]-7,out[4][1]-5)<.001);assert.ok(C.rigIK(pts,{x:100,y:0,weight:1})[4][0]<13);assert.deepEqual(pts[4],[13,0]);
});
test('unsupported prose is preserved as uncertain, explicit directives create exact camera keys',()=>{
 const p=P.template('school'),r=P.compile('ให้กล้องหมุนรอบนักเรียนครึ่งวงกลม\n0-3: กล้อง x=1400 y=800 zoom=1.4',p);assert.equal(r.unresolved.length,1);assert.equal(r.applied.length,1);assert.equal(C.at(r.plan.camera.keys,3).x,1400);assert.equal(r.plan.source.reviewed,false);assert.deepEqual(p,P.template('school'));
});
test('reference cuts have candidate scores and no invented semantic observations',()=>{
 assert.equal(R.difference(new Uint8Array([0,0]),null),0);assert.equal(R.difference(new Uint8Array([0,0]),new Uint8Array([255,255])),1);
 const p=R.blueprint([{time:0,delta:0},{time:1,delta:.8},{time:1.5,delta:.9},{time:3,delta:.1}],4);assert.equal(p.shots.length,2);assert.equal(p.shots[0].end,p.shots[1].start);assert.equal(p.shots[1].end,4);assert.equal(p.shots[0].characters,null);assert.equal(p.semanticModel,false);
});
test('review examples are data, not model training and do not mutate the scene',()=>{
 const p=P.template('book'),r=C.review(p,'accept','contact checked');assert.equal(r.trained,false);r.plan.title='changed';assert.notEqual(p.title,r.plan.title);
});
test('legacy producers and timing auditor preserve authored cinematic geometry and duration',()=>{
 const planner=require('../studio-production-planner'),timing=require('../studio-timing-auditor');
 const p=P.template('book'),scene={id:'protected',duration:12,cinematicPlan:p,actors:[{char:'a',x:50,y:90,pose:'run'},{char:'b',x:51,y:90,pose:'walk'}],audioClips:[{id:'voice',kind:'voice',data:'data:audio/wav;base64,dGVzdA==',at:0,duration:2,rate:1}],voiceover:'test'};
 const state={project:{aspect:'9:16'},episodes:[{id:'ep',scenes:[scene]}]};
 for(const stage of ['composition','motion'])assert.deepEqual(planner.plan(state,stage).ops,[]);
 const report=timing.audit(state);assert.equal(report.ops.filter(o=>o.id==='protected').length,0);assert.equal(report.scenes?.[0]?.kind||report.results?.[0]?.kind,'review');assert.equal(scene.duration,12);
});
