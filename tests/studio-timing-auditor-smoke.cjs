const assert=require('node:assert/strict');
const auditor=require('../studio-timing-auditor.js');
const narr=require('../narration-director.js'); // exports on globalThis; Node test also tests voice splitting
const voice=(duration,at=0)=>({kind:'voice',data:'data:audio/mpeg;base64,AA==',duration,at,rate:1,trimStart:0,trimEnd:0});
const sample={episodes:[{id:'ep1',title:'คืนหนึ่ง',targetSeconds:60,scenes:[
  {id:'s1',duration:22,voiceover:'เนื้อเรื่องเดิม',subtitleCues:[{id:'c1',text:'เนื้อเรื่องเดิม',start:0,end:22}],audioClips:[voice(6)]},
  {id:'s2',duration:4,voiceover:'บทต่อมา',subtitleCues:[],audioClips:[voice(9)]},
  {id:'s3',duration:19,voiceover:'ระหว่างทาง',actors:[{char:'hero',at:0,to:18}],audioClips:[voice(4)]},
  {id:'s4',duration:15,voiceover:'ยังไม่ได้พากย์',audioClips:[]}
 ]}]};
const report=auditor.audit(sample,{scope:'all',targetMinutes:1});
assert.equal(report.stats.edits,2);
const first=report.ops.find(x=>x.id==='s1');assert.ok(first.patch.duration<10);
assert.ok(first.patch.subtitleCues.at(-1).end<first.patch.duration);
const second=report.ops.find(x=>x.id==='s2');assert.ok(second.patch.duration>9);
assert.ok(!report.ops.some(x=>x.id==='s3'),'preserve scene with timed actors');
assert.ok(!report.ops.some(x=>x.id==='s4'),'no fake measured voice duration');
assert.equal(sample.episodes[0].scenes[0].duration,22,'pure audit cannot mutate source');
const voiceEnd=auditor.clipSeconds({duration:12,trimStart:2,trimEnd:2,rate:2});
assert.equal(voiceEnd,4);
const expanded={episodes:[{id:'ep2',title:'ตอนที่สอง',clues:[],scenes:[
 ...Array.from({length:6},(_,i)=>({id:'x'+i,duration:25,voiceover:'ตอน'+i,actors:[{char:'a'}],
 audioClips:[voice(25)],props:[{kind:'chair',x:30}]}))]}]};
const summary=auditor.audit(expanded,{scope:'all',targetMinutes:1});
const split=auditor.planEpisodeSplits(expanded,summary,{scope:'all',targetMinutes:1});
assert.ok(split.created>=1);assert.equal(split.ops[0].op,'replaceScenes');
const parts=[split.ops[0].scenes,...split.ops.filter(x=>x.op==='addEpisode').map(x=>x.episode.scenes)];
assert.deepEqual(parts.flat().map(x=>x.id),expanded.episodes[0].scenes.map(x=>x.id));
assert.ok(parts.flat().every(x=>x.actors&&x.props&&x.audioClips),'do not lose action/props/audio');
expanded.episodes[0].musicClips=[{data:'music'}];
assert.equal(auditor.planEpisodeSplits(expanded,summary,{scope:'all',targetMinutes:1}).created,0,'protect episode-level music');
assert.equal(auditor.planEpisodeSplits(expanded,summary,{scope:'all',targetMinutes:1}).warnings.length,1);
const partsOfNarr=globalThis.StoryNarrationDirector.splitNarration('คืนที่หนึ่งเธอเห็นแสงไฟลึกลับ。'.repeat(40),135);
assert.ok(partsOfNarr.length>3);
const original='คืนที่หนึ่งเธอเห็นแสงไฟลึกลับ。'.repeat(40);
assert.equal(partsOfNarr.join('').replace(/\s/g,''),original.replace(/\s/g,''));
assert.ok(partsOfNarr.every(x=>Array.from(x).length<=135));
console.log('PASS: imported JSON live voice audit, safe shorten/extend, protect actions and music, no lost narrated text');