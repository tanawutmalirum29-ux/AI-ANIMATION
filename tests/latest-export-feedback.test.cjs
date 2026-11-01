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

const newest=JSON.parse(fs.readFileSync(path.resolve(__dirname,
 '../training-lab/evaluations/three-flashes-nov1-latest-user-exports.json'),'utf8'));
assert.equal(newest.label,'evaluation-only','visual/audio feedback is not an approved model training label');
assert.equal(newest.clips.length,3);
assert.ok(newest.clips.every(c=>c.audio.codec==='aac'&&c.video.fps===24));
assert.ok(newest.clips.every(c=>c.longQuietRegionsOver4s===0));
assert.ok(newest.clips.every(c=>Math.max(...c.quietDurationsSeconds)<1.3));
assert.equal(newest.clips[1].seconds,newest.clips[2].seconds);
assert.deepEqual(newest.clips[1].quietDurationsSeconds,newest.clips[2].quietDurationsSeconds);
assert.equal(newest.comparisons.episode2VersionAudioPCMSHA256Equal,true);
assert.equal(newest.comparisons.episode2VersionsConsideredIndependentStories,false,
 'duplicate encodes are not independent evidence for statistical training');
assert.equal(newest.trainingAssessment.approvedTrainingLabels,0);
assert.equal(newest.trainingAssessment.weightUpdateFromTheseMP4s,false);


// Export follow-up: all three episodes, 720x1280/24fps, audio present,
// with short measured audio quiet regions. This is evaluation, not ML labels.
const followup=JSON.parse(fs.readFileSync(path.resolve(__dirname,
 '../training-lab/evaluations/three-flashes-nov1-exports-v4.json'),'utf8'));
assert.equal(followup.status,'evaluation-only');
assert.deepEqual(followup.episodes.map(x=>x.episode),[1,2,3]);
assert.ok(followup.episodes.every(x=>x.frame.width===720&&x.frame.height===1280&&
 x.frame.fps===24&&x.audio.codec==='aac'));
assert.ok(followup.episodes.every(x=>x.longQuietOver4Seconds===0&&
 Math.max(...x.quietRegionsSeconds)<1.3));
assert.equal(followup.training.approvedHumanExamples,0);
assert.equal(followup.training.trainedWeightUpdates,0);
assert.equal(followup.training.modelPromoted,false);
assert.equal(followup.engineering.requiresReExport,true);


const compilation=JSON.parse(fs.readFileSync(path.resolve(__dirname,
 '../training-lab/evaluations/three-flashes-nov1-compiled-export.json'),'utf8'));
assert.equal(compilation.status,'evaluation-only');
assert.equal(compilation.media.audioCodec,'aac');
assert.ok(compilation.media.durationSeconds>115&&compilation.media.durationSeconds<120);
assert.equal(compilation.separator.betweenEpisodesCount,2);
assert.equal(compilation.separator.authoredDurationSeconds,2.5,
 'chapter cards are intentional and should not be removed as dead air');
assert.equal(compilation.audio.boundaryLowLevelIntervals.length,2);
assert.ok(compilation.audio.boundaryLowLevelIntervals.every(x=>x.lengthSeconds>3.5&&x.lengthSeconds<3.8));
assert.equal(compilation.training.approvedSamplesAdded,0);
assert.equal(compilation.training.modelWeightsUpdated,false);
assert.equal(compilation.training.modelPromoted,false);

console.log('PASS: measured latest 3 exported videos and six factory animation types no longer create voice-tail silence');
