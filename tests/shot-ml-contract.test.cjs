'use strict';
const assert=require('node:assert/strict'),Shot=require('../studio-shot-ml.js');
const project={aspect:'9:16'},location={set:{worldArt:'coastal-harbor'}};
const scene={id:'s1',duration:6,actors:[{char:'pim',x:42,y:87,pose:'run'}],
 worldEffects:{marketFlood:true,safeHill:true},
 camera:{type:'panorama',world:3.2,startX:5,endX:5,from:1,to:1}};
const feature=Shot.featureVector(project,scene,location);
assert.deepEqual(Object.keys(feature),Shot.FEATURES);
assert.equal(feature.portrait,1);
assert.ok(feature.targetOffset>.5);
assert.ok(Object.values(feature).every(x=>typeof x==='number'&&x>=0&&x<=1));
const label=Shot.makeExample(project,scene,location,'reframe','anon_story_005');
assert.equal(label.source,'human');assert.equal(label.approved,true);
assert.equal(label.task,'shot-framing');assert.equal(label.label,'reframe');
assert.deepEqual(Object.keys(label).sort(),['approved','features','group','label','schema','source','task']);
assert.ok(!JSON.stringify(label).includes('voiceover'));
assert.throws(()=>Shot.makeExample(project,scene,location,'good','anon_story_005'));
assert.throws(()=>Shot.makeExample(project,scene,location,'keep','ผู้ใช้ชื่อจริง'));
assert.throws(()=>Shot.makeExample(project,scene,{set:{worldArt:'coastal-cliff'}},'keep','anon_story_005'));
const model={schema:1,task:'shot-framing',features:[...Shot.FEATURES],
 weights:[0,0,0,0,5,2,0,0,0,0],bias:-1.3,active:true,status:'approved',
 training:{mode:'approved',examples:70,holdoutExamples:25,
  baseline:{accuracy:.75,macroF1:.71},model:{accuracy:.85,macroF1:.80}}};
assert.ok(Shot.modelUsable(model));
assert.ok(!Shot.modelUsable({...model,status:'demo-only'}));
assert.ok(!Shot.modelUsable({...model,active:false}));
assert.ok(!Shot.modelUsable({...model,training:{...model.training,mode:'demo'}}));
assert.ok(!Shot.modelUsable({...model,training:{...model.training,model:{accuracy:.5,macroF1:.4}}}));
const before=JSON.stringify(scene);
const suggestion=Shot.recommend(model,project,scene,location);
assert.equal(suggestion.applicable,true,JSON.stringify(suggestion));
assert.ok(suggestion.best<=suggestion.current-.08);
assert.ok(suggestion.camera.startX>60);
assert.equal(JSON.stringify(scene),before,'model cannot alter authored scene without a user click');
assert.throws(()=>Shot.recommend({...model,active:false},project,scene,location));
assert.throws(()=>Shot.recommend(model,project,{...scene,productionManualLock:true},location));
assert.throws(()=>Shot.recommend(model,project,{...scene,camera:{...scene.camera,subjectLock:true}},location));
console.log('PASS: human-labeled numeric camera features, safe approved-only model and read-only ML shot candidate');
