'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const M=require('../studio-motion-runtime.js'),R=require('../studio-school-repair.js');
const template=require('../examples/taweetha-zombie-siege.json'),copy=v=>JSON.parse(JSON.stringify(v));
test('running remains a run until its arrival blend, with legacy opt-in',()=>{
 assert.equal(M.poseProgress({pose:'run',endPose:'stand'},.8,5),0);
 assert.ok(M.poseProgress({pose:'run',endPose:'stand'},.99,5)>.5);
 assert.equal(M.poseProgress({pose:'run',endPose:'stand',poseBlend:'throughout'},.5,5),.5);
});
test('sparse keys retain position and overrides; facing changes at the intended key',()=>{
 const a={x:10,y:80,pose:'run',motionKeys:[{t:0,x:10,easing:'linear',override:{elbowR:-20}},{t:2,x:40,pose:'run'},{t:4,bodyYaw:30},{t:5,facing:'left'}]};
 assert.equal(M.sample(a.motionKeys,3,a).x,40);assert.equal(M.sample(a.motionKeys,4.5,a).y,80);
 assert.equal(M.sample(a.motionKeys,4.5,a).override.elbowR,-20);assert.equal(M.sample(a.motionKeys,5,a).facing,'left');
 assert.equal(M.sample(a.motionKeys,1,a).x,25);
});
test('fit-scene maps duration while distance gait is deterministic and stops with travel',()=>{
 const a={x:0,y:80,gait:'distance',motionKeys:[{t:0,x:0,y:80,easing:'linear'},{t:5,x:100,y:80}]};
 assert.deepEqual(M.clock({duration:10,choreography:{mode:'fit-scene',duration:5}},6),{time:3,duration:5,scale:2});
 assert.equal(M.distance(a,2.5,90),45);const f=M.gait(a,{pose:'run'},2.5,90);assert.ok(f._phaseTime>0);assert.equal(f._moving,true);
 assert.equal(M.gait(a,{pose:'run'},5.2,90)._moving,false);assert.deepEqual(M.gait(a,{pose:'run'},2.5,90),f);
});
test('early stop audit is actionable, explicit repair is pure, intentional stops survive',()=>{
 const a={char:'nont',x:0,y:85,pose:'run',endPose:'stand',motionKeys:[{t:0,x:0,y:85,pose:'run',easing:'linear'},{t:2,x:50,y:85,pose:'stand'},{t:5,x:50,y:85,pose:'stand'}]};const s={duration:6,actors:[a]};
 assert.equal(M.audit(s)[0].code,'motion-early-stop');const repaired=M.continueToCut(a,s);assert.equal(repaired.motionKeys.at(-1).t,6);assert.equal(repaired.motionKeys.at(-1).pose,'run');assert.equal(repaired.endPose,undefined);assert.equal(a.motionKeys[1].t,2);assert.deepEqual(M.audit({...s,actors:[repaired]}),[]);assert.deepEqual(M.audit({...s,actors:[{...a,intentionalHold:true}]}),[]);
});
test('repair preserves reaction delay; pose changes blend only near their cue',()=>{
 const a={pose:'stand',poseTransitions:true,motionKeys:[{t:0,x:20,y:80,pose:'stand'},{t:2,x:20,y:80,pose:'run'},{t:4,x:70,y:80,pose:'stand'}]};
 const b=M.continueToCut(a,{duration:6});assert.deepEqual(b.motionKeys.map(k=>k.t),[0,2,6]);
 assert.equal(M.keyPose(a,{pose:'stand'},1).endPose,undefined);assert.equal(M.keyPose(a,{pose:'stand'},1.92).endPose,'run');
});
test('voice timing adjustment uses the authored clock once and preserves timed legacy scenes',()=>{
 const auditor=require('../studio-timing-auditor.js'),s=copy(template.episodes[0].scenes[7]);s.duration=20;s.audioClips=[{kind:'voice',data:'data:audio/wav;base64,AA==',duration:4,at:0,rate:1}];
 assert.equal(auditor.hasTimedEvents(s),false);const legacy={...s};delete legacy.choreography;assert.equal(auditor.hasTimedEvents(legacy),true);
 const report=auditor.audit({episodes:[{id:'test',scenes:[s]}]},{scope:'all'}),op=report.ops.find(o=>o.id===s.id);assert.ok(op.patch.duration<20);assert.equal(op.patch.actors,undefined);assert.equal(op.patch.customAssets,undefined);assert.equal(s.choreography.duration,6);
});
test('school visual upgrade preserves audio, text, timing, art and unknown user objects',()=>{
 const state=copy(template),s=state.episodes[0].scenes[7];delete s.choreography;
 s.duration=8.7;s.voiceover='บทเดิม';s.subtitleCues=[{text:'คำบรรยายเดิม',start:0,end:8}];s.audioClips=[{id:'voice-original',data:'data:audio/mpeg;base64,abc',duration:8.3,at:.2}];
 s.actors.push({char:'visitor',x:20,y:80});s.props.push({kind:'book'});s.customAssets.push({producer:'user',eventKind:'school-custom',asset:{id:'my-art'}});
 const before=copy(state),review=R.plan(state,template);assert.equal(review.changes.length,1);assert.deepEqual(state,before);R.apply(state,review);
 for(const key of ['duration','voiceover','subtitleCues','audioClips'])assert.deepEqual(s[key],before.episodes[0].scenes[7][key]);assert.deepEqual(state.characters,before.characters);assert.deepEqual(state.voiceProfiles,before.voiceProfiles);
 assert.ok(s.props.some(p=>p.kind==='book'));assert.ok(s.actors.some(a=>a.char==='visitor'));assert.ok(s.customAssets.some(a=>a.asset.id==='my-art'));assert.equal(s.choreography.duration,6);
 assert.deepEqual(state.locations.slice(0,before.locations.length),before.locations);assert.equal(R.plan(state,template).changes.length,0);
});
test('repair rejects stale reviews atomically and skips locked or custom interaction scenes',()=>{
 const state=copy(template);for(const s of state.episodes[0].scenes)delete s.choreography;
 state.episodes[0].scenes[0].locked=true;state.episodes[0].scenes[1].interactions=[{type:'pickup',at:2}];
 const review=R.plan(state,template);assert.equal(review.skipped.length,2);state.episodes[0].scenes[4].voiceover='edited after review';const before=copy(state);assert.throws(()=>R.apply(state,review),/เปลี่ยน/);assert.deepEqual(state,before);
});
test('append remaps references, preserves current work and cannot collide',()=>{
 const state=copy(template),before=copy(state);const index=R.append(state,template,'new');assert.equal(index,1);assert.deepEqual(state.episodes[0],before.episodes[0]);assert.deepEqual(state.project,before.project);
 const s=state.episodes[1].scenes[7];assert.equal(s.actors[0].char,'new-teacher');assert.equal(s.interactionInitialHold[0].actor,'new-teacher');assert.ok(state.locations.some(l=>l.id===s.location));assert.ok(state.voiceProfiles.some(v=>v.id===s.voiceDirection.voiceProfileId));assert.throws(()=>R.append(state,template,'new'),/ซ้ำ/);
});
test('revision 4 upgrades an appended revision 3 episode without losing its voices or IDs',()=>{
 const state=copy(template);R.append(state,template,'school-example');const episode=state.episodes[1];
 for(const s of episode.scenes)s.choreography.revision=3;
 episode.scenes[0].audioClips=[{id:'keep',kind:'voice',data:'original',duration:3}];const before=copy(state);
 const review=R.plan(state,template);assert.equal(review.changes.length,12);R.apply(state,review);
 assert.deepEqual(state.episodes[0],before.episodes[0]);assert.deepEqual(state.characters,before.characters);assert.deepEqual(state.voiceProfiles,before.voiceProfiles);
 assert.deepEqual(episode.scenes[0].audioClips,before.episodes[1].scenes[0].audioClips);
 for(const scene of episode.scenes){assert.equal(scene.choreography.revision,4);assert.ok(scene.location.startsWith('school-example-tpz-v4-'));assert.ok(scene.actors.every(a=>a.char.startsWith('school-example-')));assert.ok(scene.interactionInitialHold.every(h=>scene.actors.some(a=>a.char===h.actor)));}
 assert.equal(R.plan(state,template).changes.length,0);
});
test('school surfaces match treads, preserve physical door proportions and leave flying actors alone',()=>{
 const W=require('../studio-school-world.js'),set={worldArt:'school-stairs'};
 assert.equal(W.surfaceAt(set,50,1),81);assert.equal(W.surfaceAt(set,50,3),79.8);assert.equal(W.surfaceAt(set,50,49),52.2);
 assert.equal(W.layout({worldArt:'school-room'},50).door.h,W.layout({worldArt:'school-room'},160).door.h);
 assert.equal(W.layout({worldArt:'school-room'},50).door.w,W.layout({worldArt:'school-room'},160).door.w);
 const place={x:2,k:.5,fc:1},feet=[{x:-1,y:0,foot:10},{x:1,y:-3,foot:13}],a={ground:{mode:'surface'},pose:'stand'};
 const result=W.groundPlacement(set,50,a,place,feet);assert.ok(result.contacts.every(c=>c.clearance>=0));assert.equal(Math.min(...result.contacts.map(c=>c.clearance)),0);
 assert.equal(W.groundPlacement(set,50,{...a,pose:'jump'},place,feet),null);assert.equal(W.groundPlacement(set,50,{pose:'stand'},place,feet),null);
});
test('blocking preserves standing positions at the classroom, landing and roof cuts',()=>{
 const scenes=template.episodes[0].scenes;
 for(const [left,right]of [[4,5],[8,9],[10,11]]){
  for(const actor of scenes[left].actors){const next=scenes[right].actors.find(a=>a.char===actor.char);assert.ok(next,'character remains in the next shot');const end=M.sample(M.keysOf(actor),scenes[left].choreography.duration,actor),start=M.sample(M.keysOf(next),0,next);assert.ok(Math.abs(end.x-start.x)<.01,actor.char+' must not teleport across cut '+left);}
 }
});
test('revised story audits cleanly and held lights expose time-varying state',()=>{
 for(const scene of template.episodes[0].scenes)assert.deepEqual(M.audit(scene),[],scene.id);
 const prop=template.episodes[0].scenes[7].props.find(p=>p.kind==='flashlight');assert.notEqual(M.light(prop,0).angle,M.light(prop,3).angle);assert.equal(M.light({...prop,light:{enabled:false}},0).intensity,0);
});
