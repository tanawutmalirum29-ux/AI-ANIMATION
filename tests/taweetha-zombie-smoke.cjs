'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const assets = require('../studio-production-assets.js');
const core = require('../studio-asset-core.js');
const planner = require('../studio-production-planner.js');
const {validate} = require('../training-lab/validate-story.cjs');
const doc = JSON.parse(fs.readFileSync(path.join(__dirname,'../examples/taweetha-zombie-siege.json'),'utf8'));
const report = validate(doc);
assert.equal(report.ok,true,JSON.stringify(report.errors));
assert.equal(doc.episodes.length,1);
const scenes = doc.episodes[0].scenes;
assert.equal(scenes.length,12);
assert.equal(scenes.reduce((sum,s)=>sum+s.duration,0),62);
assert.equal(doc.project.aspect,'9:16');
assert.equal(doc.voiceProfiles.length,4);
assert.ok(scenes.every(s=>s.voiceDirection?.voiceProfileId));
assert.ok(scenes.every(s=>s.productionEvents.every(k=>assets.templates[k])));
assert.ok(scenes.every(s=>s.customAssets.length<=40));
for(const s of scenes){
 for(const item of s.customAssets){assert.doesNotThrow(()=>core.asset(item.asset));assert.ok(item.x>=0&&item.x<=100);}
 assert.equal(planner.plan({episodes:[{scenes:[s]}]},'assets',assets).ops.length,0,'no duplicate automatic assets in '+s.id);
}
assert.ok(scenes.find(s=>s.id==='tpz-s06').customAssets.find(a=>a.eventKind==='school-barricade').motionKeys.length>=3);
assert.ok(scenes.find(s=>s.id==='tpz-s07').customAssets.find(a=>a.eventKind==='school-window').motionKeys.some(k=>k.opacity===0));
const blank={episodes:[{scenes:[{id:'new-school',duration:5,voiceover:'',productionEvents:['school-barricade','school-alarm'],productionPlacements:{'school-barricade':{x:25,y:80,scale:.4}},customAssets:[]}]}]};
const planned=planner.plan(blank,'assets',assets);
assert.equal(planned.ops.length,1);
assert.equal(planned.ops[0].patch.customAssets.length,2);
assert.equal(planned.ops[0].patch.customAssets[0].x,25);
assert.equal(planned.ops[0].patch.customAssets[0].scale,.4);
assert.doesNotThrow(()=>core.asset(planned.ops[0].patch.customAssets[0].asset));
blank.episodes[0].scenes[0].customAssets=planned.ops[0].patch.customAssets;
assert.equal(planner.plan(blank,'assets',assets).ops.length,0);
console.log('PASS: Taweethapisek zombie sample — 12 scenes, 62s, 4 voices, SVG event templates, no duplicate props');
