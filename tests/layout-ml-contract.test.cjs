'use strict';
const assert=require('node:assert/strict');
const ML=require('../studio-layout-ml.js');
const scene={id:'s1',actors:[
 {char:'a',x:42,y:80,pose:'stand'},
 {char:'b',x:46,y:81,pose:'stand'},
 {char:'c',x:85,y:79,pose:'walk'}
]};
const fields=ML.features({aspect:'9:16'},scene,0,1);
assert.deepEqual(Object.keys(fields),ML.FEATURES);
assert.equal(fields.gapX,.04);
assert.equal(fields.gapY,.01);
assert.equal(fields.portrait,1);
assert.equal(fields.count,.375);
assert.equal(ML.closestPair(scene).i,0);
assert.equal(ML.closestPair(scene).j,1);
const before=structuredClone(scene),after=structuredClone(scene);
after.actors[1].x=64;
const record=ML.correction(before,after,{aspect:'9:16'},'anonymous_story_001');
assert.equal(record.label,'separate');
assert.equal(record.group,'anonymous_story_001');
assert.equal(record.approved,true);
assert.equal(record.source,'human');
assert.equal(record.task,'layout-spacing');
assert.ok(!JSON.stringify(record).includes('voiceover'));
assert.deepEqual(Object.keys(record).sort(),
 ['approved','features','group','label','schema','source','task']);
assert.equal(ML.correction(before,before,{aspect:'9:16'},'anonymous_story_001'),null,
 'unchanged scenes are not labeled as corrections');
assert.equal(ML.correction(after,before,{aspect:'9:16'},'anonymous_story_001'),null,
 'moving two actors closer is not a positive correction');
const accepted=ML.makeExample({aspect:'16:9'},after,0,1,'keep','anonymous_story_001');
assert.equal(accepted.features.portrait,0);
assert.throws(()=>ML.makeExample({},scene,0,1,'guess','anonymous_story_001'));
assert.throws(()=>ML.makeExample({},scene,0,1,'keep','personal name'));
const candidate={task:'layout-spacing',schema:1,features:[...ML.FEATURES],
 weights:[-10,-2,1,0,0,-10,-10,0],bias:.5};
const res=ML.predict(candidate,fields);
assert.equal(res.suggestion,'review-separation');
assert.ok(res.probabilitySeparate>.7);
const locked={...fields,locked:1};
assert.equal(ML.predict(candidate,locked).suggestion,'no-automatic-change');
assert.throws(()=>ML.predict({...candidate,weights:[1]},fields));
console.log('PASS: layout ML uses numeric sanitized human feedback; read-only tiny inference; never guesses labels');
