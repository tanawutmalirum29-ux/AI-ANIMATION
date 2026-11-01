'use strict';
// Measured evaluation fixture: user-supplied JSON + three MP4 exports.
// This test does NOT train model weights or claim measured transcript accuracy.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const auditor=require('../studio-timing-auditor.js');
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,
 '../training-lab/evaluations/three-flashes-export-audit.json'),'utf8'));
const voice=(duration,id,automatic=true)=>({
 kind:'voice',data:'data:audio/wav;base64,AAAA',duration,at:0,rate:1,
 trimStart:0,trimEnd:0,autoDub:automatic,
 cueId:'narration-'+id+'-part1',name:automatic?'auto-e1-s1-narration.mp3':'manual.wav'
});
function measuredState(){
 return {episodes:fixture.episodes.map((ep,i)=>({
  id:ep.id,
  targetSeconds:60,
  scenes:ep.sceneDurationsInferredFromIntervals.map((duration,si)=>{
   const id=ep.id+'-s'+(si+1);
   // The JSON had camera movement in every scene, but there were no
   // explicitly timed events protecting a long post-narration hold.
   return {id,duration,voiceover:'บทต้นฉบับ '+id,
    camera:{type:'pan-right'},actors:[],notes:'',
    subtitleCues:[{id:'cue'+id,text:'ตัวอย่างซับจาก JSON',start:4.4,end:8.4}],
    audioClips:[voice(ep.audioActiveUpperBoundPerScene[si],id)]};
  })
 }))};
}
const original=measuredState(),before=JSON.stringify(original);
const report=auditor.audit(original,{scope:'all',targetMinutes:1});
assert.equal(report.stats.inspected,18,'all three videos contain six scene-length intervals');
assert.equal(report.stats.withVoice,18);
assert.equal(report.stats.edits,18,'all recurring ~2.6s silent tails should be candidates for tightening');
assert.ok(report.issues.every(item=>item.kind==='shorten'));
assert.ok(report.stats.shortened>25,'avoid repeating large observed dead-air tails');
assert.ok(report.episodes.every(e=>e.projected<e.old),'do not pad short stories to 60 seconds');
for(const op of report.ops){
 const s=original.episodes.flatMap(x=>x.scenes).find(x=>x.id===op.id);
 const audible=s.audioClips[0].duration;
 assert.ok(op.patch.duration>=audible+.3,'preserve audio through its full end: '+s.id);
 assert.ok(op.patch.duration<=audible+1.01,'leave <~1s natural visual tail: '+s.id);
 assert.ok(op.patch.subtitleCues[0].end<=op.patch.duration-.04,'caption stays inside frame');
}
assert.equal(JSON.stringify(original),before,'audit must be read-only');
const target=original.episodes.flatMap(e=>e.scenes);
const plan=auditor.planAutoDubTightening(original,target,{splitNarration:t=>[t]});
assert.equal(plan.ops.length,18,'all complete auto narrated scenes can be safely tightened');
assert.ok(plan.shortenedSeconds>25);
const partial=structuredClone(original);
partial.episodes[0].scenes[0].voiceover='part one part two';
const partialScene=partial.episodes[0].scenes[0];
assert.equal(auditor.planAutoDubTightening(partial,[partialScene],{splitNarration:()=>['part one','part two']}).ops.length,0,
 'do not shorten a scene when one of several TTS parts is missing');
const manual=structuredClone(original);
manual.episodes[0].scenes[0].audioClips[0].autoDub=false;
manual.episodes[0].scenes[0].audioClips[0].name='my-recording.wav';
assert.equal(auditor.planAutoDubTightening(manual,[manual.episodes[0].scenes[0]],{splitNarration:t=>[t]}).ops.length,0,
 'never auto-shorten a user-recorded take');
const hold=structuredClone(original);
hold.episodes[0].scenes[0].notes='[HOLD] the screen must stay lit';
assert.equal(auditor.planAutoDubTightening(hold,[hold.episodes[0].scenes[0]],{splitNarration:t=>[t]}).ops.length,0,
 'do not trim intentional cinematic holds');
const timed=structuredClone(original);
timed.episodes[0].scenes[0].actors=[{char:'nil',at:0,to:7}];
assert.equal(auditor.planAutoDubTightening(timed,[timed.episodes[0].scenes[0]],{splitNarration:t=>[t]}).ops.length,0,
 'do not trim explicitly timed actor actions');
const effects=structuredClone(original);
effects.episodes[0].scenes[0].audioClips.push({
 kind:'sfx',data:'data:audio/wav;base64,AAAA',duration:7,at:0,rate:1
});
assert.equal(auditor.planAutoDubTightening(effects,[effects.episodes[0].scenes[0]],{splitNarration:t=>[t]}).ops.length,0,
 'do not trim later timed sound effects');
console.log('PASS: measured Three Flashes exports: 18 candidate silence tails, no clip truncation, manual/incomplete/hold/event protection');
