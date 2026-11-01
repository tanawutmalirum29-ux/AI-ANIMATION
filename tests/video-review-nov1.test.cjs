'use strict';
// Regression from the 2026-11-01 compiled 720x1280 MP4 review.
// JSON preflight only: it predicts renderer behaviour, it does not inspect pixels.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const qa=require('../studio-visual-qa.js');

const scene=(id,extra={})=>({id,voiceover:'',imagePrompt:'',actors:[],props:[],
 customAssets:[],graphicCards:[],sfx:[],duration:8,...extra});
const cue=text=>({subtitleCues:[{id:'c',text,start:1,end:4}]});
const portrait={aspect:'9:16',subMax:28};

// Exactly the six captions seen breaking in the export, with the tail the video showed.
const seen=[
 ['ไซเรนเงียบมาสิบสองปี','ปี'],
 ['ไซเรนดับ ให้เปิดสามแสง','แสง'],
 ['ต้องไปถึงหอไฟก่อนน้ำมา','น้ำมา'],
 ['กล่องเครื่องมือจมหาย','หาย'],
 ['ตลาดว่างเปล่าก่อนน้ำถึง','น้ำถึง'],
 ['แสงเก่ายังมีความหมาย','หมาย']
];
for(const [text,tail] of seen){
 const r=qa.inspect({project:portrait,episodes:[{title:'x',scenes:[scene('s',cue(text))]}]});
 const hit=r.issues.find(i=>i.kind==='caption-wrap');
 assert.ok(hit,'must predict wrap for: '+text);
 assert.equal(hit.detail.lines.at(-1),tail,'predicted tail must match the export for: '+text);
 assert.ok(hit.detail.clusters<=hit.detail.limit&&hit.detail.codePoints>hit.detail.limit,
  'cause is combining marks counted as width: '+text);
}

// Captions that really fit, or that are long but balanced, are not flagged.
for(const text of ['หนึ่ง สอง สามวาบ','สามแสง = ขึ้นที่สูง','เหลือเพียงแสงบนหอไฟ']){
 const r=qa.inspect({project:portrait,episodes:[{title:'x',scenes:[scene('s',cue(text))]}]});
 assert.equal(r.byKind.captionWrap,0,'no false alarm for: '+text);
}
// Landscape has a 30 limit, so the same text is fine there.
assert.equal(qa.inspect({project:{aspect:'16:9',subMax:28},
 episodes:[{title:'x',scenes:[scene('s',cue(seen[0][0]))]}]}).byKind.captionWrap,0);
// The older subtitle[] lines are checked with the same limit.
assert.equal(qa.inspect({project:portrait,episodes:[{title:'x',
 scenes:[scene('s',{subtitle:[seen[3][0]]})]}]}).byKind.captionWrap,1);

// Chapter card prints its own kicker, so a title that starts with it is flagged.
const ch=t=>qa.inspect({project:portrait,episodes:[{title:t,scenes:[scene('s')]}]});
assert.equal(ch('ตอนที่ 2 — แสงที่หันผิดทาง').byKind.chapterTitleDuplicate,1);
assert.equal(ch('ตอนที่ ๓ สามแสง').byKind.chapterTitleDuplicate,1);
assert.equal(ch('แสงที่หันผิดทาง').byKind.chapterTitleDuplicate,0);
assert.equal(qa.inspect({project:portrait,episodes:[{title:'ตอนที่ 1 — a',scenes:[scene('s')]}]},
 {scope:'scene',sceneId:'s'}).byKind.chapterTitleDuplicate,0,'scene scope skips chapter checks');

// Portrait actor spacing seen in the export: 18 and 20 overlapped, 25 and 27 stayed readable.
const pair=gap=>qa.inspect({project:portrait,episodes:[{title:'x',scenes:[scene('s',
 {actors:[{char:'a',x:40,y:90},{char:'b',x:40+gap,y:90}]})]}]}).byKind.actorOverlap;
for(const gap of [12,18,20,23])assert.equal(pair(gap),1,'gap '+gap+' should be flagged');
for(const gap of [25,27,35])assert.equal(pair(gap),0,'gap '+gap+' should pass');
assert.equal(qa.inspect({project:{aspect:'16:9'},episodes:[{title:'x',scenes:[scene('s',
 {actors:[{char:'a',x:40,y:90},{char:'b',x:52,y:90}]})]}]}).byKind.actorOverlap,0,
 'landscape keeps the old 10 unit threshold');

// Never mutates authored data.
const src={project:portrait,episodes:[{title:'ตอนที่ 1 — a',scenes:[scene('s',cue(seen[0][0]))]}]};
const before=JSON.stringify(src);qa.inspect(src);
assert.equal(before,JSON.stringify(src));

// Evidence record stays evaluation-only.
const ev=JSON.parse(fs.readFileSync(path.resolve(__dirname,
 '../training-lab/evaluations/three-flashes-nov1-video-review.json'),'utf8'));
assert.equal(ev.status,'evaluation-only');
assert.equal(ev.training.approvedTrainingLabels,0);
assert.equal(ev.training.modelWeightsUpdated,false);
assert.equal(ev.findings.filter(f=>f.detectableFromJson).length,3);
assert.ok(ev.findings.every(f=>f.rendererFixApplied!==true),'record must match what was actually changed');


// New 2026-11-02 export feedback: a random prop/actor motion cannot satisfy
// the narrated event; the *matching* asset must have executable animation.
const eventScene=(id,voiceover,extra={})=>scene(id,{voiceover,...extra});
const eventReport=s=>qa.inspect({project:portrait,episodes:[{title:'x',scenes:[s]}]});
const unrelated=eventScene('unrelated','สะพานขาดและพังลงในน้ำ',{
 props:[{kind:'toolbox',motionKeys:[{t:0,x:0},{t:2,x:20}]}]});
assert.ok(eventReport(unrelated).issues.some(i=>i.event==='bridge-collapse'),
 'an animated toolbox cannot verify a bridge collapse');
assert.ok(eventReport(eventScene('static','สะพานพังลงน้ำ',{
 props:[{kind:'bridge',id:'old'}]})).issues.some(i=>i.event==='bridge-collapse'),
 'a static bridge cannot prove a collapse animation');
assert.equal(eventReport(eventScene('moving','สะพานพังลงน้ำ',{
 props:[{kind:'bridge',motionKeys:[{t:0,y:50},{t:2,y:90}]}]})).byKind.unverifiedEvents,0);
assert.ok(eventReport(eventScene('generic-walk','หนึ่งวาบ สองวาบ สามวาบ',{
 actors:[{char:'a',x:50,y:88,motionKeys:[{t:0,x:50},{t:5,x:60}]}]
})).issues.some(i=>i.event==='three-flashes'),
 'a walk does not count as three visible light pulses');
assert.equal(eventReport(eventScene('lit','หนึ่งวาบ สองวาบ สามวาบ',{
 customAssets:[{eventKind:'beacon',motionKeys:[{t:0,opacity:0},{t:1,opacity:1},{t:2,opacity:0}]}]
})).byKind.unverifiedEvents,0);

// Check exported voice time and caption time only when real clip data/cues
// exist. This is timing metadata QA, not speech-to-text.
const voice={kind:'voice',data:'data:audio/mpeg;base64,AAAA',at:0,duration:5};
const late=eventReport(scene('late',{
 audioClips:[voice],subtitleCues:[{text:'เสียงมาแล้ว',start:2.2,end:4.9}]
}));
assert.equal(late.byKind.captionVoiceMisalignment,1);
assert.ok(late.issues.some(i=>i.kind==='caption-voice-misalignment'&&
 i.detail.lateStart>2));
const aligned=eventReport(scene('aligned',{
 audioClips:[voice],subtitleCues:[{text:'พากย์ทั้งฉาก',start:.1,end:5}]
}));
assert.equal(aligned.byKind.captionVoiceMisalignment,0);
assert.equal(eventReport(scene('no-voice',{
 subtitleCues:[{text:'พากย์ทั้งฉาก',start:2,end:3}]
})).byKind.captionVoiceMisalignment,0,
 'do not guess audio timing when no clip exists');
assert.equal(eventReport(scene('no-timed-captions',{
 audioClips:[voice],subtitle:['ข้อความไม่มีช่วงเวลา']
})).byKind.captionVoiceMisalignment,0,
 'do not invent caption alignment from untimed text');

const aiCore=require('../studio-ai-core.js');
const trainingState={project:{title:'Video quality',aiWorkspace:{}},episodes:[{id:'e1',title:'ทดลอง',scenes:[scene('s')]}]};
assert.match(aiCore.systemPrompt('motion',trainingState),/Story-to-Action/);
assert.match(aiCore.systemPrompt('structure',trainingState),/subtitleCues/);
assert.match(aiCore.systemPrompt('qa',trainingState),/event-specific/);

console.log('PASS: video review rules (caption wrap, chapter title, portrait actor gap)');
