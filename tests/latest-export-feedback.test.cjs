'use strict';
// Measured 2026-11-01 exported MP4 feedback. Do not call this model training.
// Video files are user attachments, not committed to the code repository.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const fixture=JSON.parse(fs.readFileSync(path.resolve(__dirname,
 '../training-lab/evaluations/three-flashes-v3-factory-export.json'),'utf8'));
const timing=require('../studio-timing-auditor.js');
const assets=require('../studio-production-assets.js');

assert.equal(fixture.episodes.length,3);
assert.ok(fixture.episodes.every(ep=>ep.streams.includes('aac')),
 'the latest exports have real encoded AAC tracks; do not label them audio-less');
assert.equal(fixture.episodes[0].deltaSeconds,0);
assert.ok(fixture.episodes[1].deltaSeconds>11);
assert.ok(fixture.episodes[2].deltaSeconds>16);
assert.equal(fixture.episodes[1].longQuietRegionsOver4s,3);
assert.equal(fixture.episodes[2].longQuietRegionsOver4s,4);
assert.ok(fixture.episodes.slice(1).every(ep=>
 ep.quietRegionsSeconds.filter(d=>d>4).length===ep.longQuietRegionsOver4s));

const cases=['bridge','toolbox','reflector','belt','beacon','flood'];
for(const kind of cases){
 const item=assets.item({duration:10},kind);
 const initial={id:'factory-'+kind,duration:10,customAssets:[item],actors:[],
   voiceover:'บทที่พากย์ครบแล้ว',audioClips:[{kind:'voice',data:'data:audio/wav;base64,AAAA',
    duration:4.2,at:0,rate:1,autoDub:true}]};
 const state={episodes:[{id:'latest',scenes:[initial]}]};
 assert.equal(timing.hasTimedEvents(initial),false,
  kind+': generated vector is not a manually timed narrative hold');
 const plan=timing.audit(state,{scope:'all'});
 assert.equal(plan.ops.length,1,kind+' should not force a 10 second silent scene');
 const patch=plan.ops[0].patch;
 assert.ok(patch.duration>=4.5&&patch.duration<5.3,
  kind+': retain spoken audio plus a short visual tail');
 const keys=patch.customAssets[0].motionKeys;
 assert.equal(keys.length,item.motionKeys.length,kind+': preserve all event keyframes');
 assert.ok(keys.every(k=>k.t>=0&&k.t<=patch.duration+.001),
  kind+': no keyframe is outside the shortened timeline');
 assert.equal(keys.at(-1).t,patch.duration);
 assert.equal(JSON.stringify(state.episodes[0].scenes[0]),JSON.stringify(initial),
  'audit never modifies source story before approval');
}
console.log('PASS: measured latest 3 exported videos and six factory animation types no longer create voice-tail silence');
