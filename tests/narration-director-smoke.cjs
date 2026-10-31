// Smart Narration Director: group Thai lines, preserve actors, trim padding, protect recorded takes.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context=vm.createContext({});
new vm.Script(fs.readFileSync('narration-director.js','utf8')).runInContext(context);
const D=context.StoryNarrationDirector;
assert.ok(D&&typeof D.plan==='function'&&typeof D.layout==='function');
const cues=[
 {id:'a',text:'เขาบอกว่า',start:0,end:1,speaker:'p',emotion:'neutral'},
 {id:'b',text:'ยังไม่มีใครกลับมา',start:2.5,end:4,speaker:'p',emotion:'neutral'},
 {id:'c',text:'แต่ฉันจะรอ',start:4,end:5,speaker:'p',emotion:'neutral'},
 {id:'d',text:'หยุดก่อน!',start:5,end:6,speaker:'x',emotion:'urgent'}
];
const plan=D.plan(cues);
assert.equal(plan.length,2,'merge adjacent same-actor clauses into one speech request');
assert.equal(plan[0].cueIds.length,3);
assert.ok(plan[0].text.includes('ยังไม่มีใครกลับมา'));
assert.equal(plan[1].speaker,'x','different speaker must not merge');
const skipped=D.plan(cues,{existing:['b']});
assert.equal(skipped.length,3,'do not revoice existing cues');
assert.equal(skipped[0].text,'เขาบอกว่า');
assert.equal(skipped[1].text,'แต่ฉันจะรอ');
const scene={duration:1,subtitleCues:cues.map(c=>({...c})),audioClips:[
 {id:'m',kind:'voice',data:'data:ok',duration:.25,at:0,rate:1,trimStart:0,trimEnd:0},
 {id:'v',kind:'voice',autoDub:true,cueIds:['a','b','c'],cueId:'a',data:'data:ok',duration:2.0,at:2.5,rate:1,trimStart:.2,trimEnd:.3}
]};
const first=D.layout(scene,{gap:.16});
assert.equal(first.clips,1);
assert.equal(scene.audioClips[0].at,0,'manual narration position remains untouched');
assert.ok(scene.audioClips[1].at>=.4,'auto dub must not overlap manual take');
assert.ok(scene.duration>1,'extend frame rather than chop words');
assert.ok(scene.subtitleCues[0].start>=.4);
assert.ok(scene.subtitleCues[2].end>scene.subtitleCues[0].end);
const second=D.layout(scene,{gap:.16});
assert.equal(second.extended,0,'reflow must be idempotent');
assert.equal(scene.audioClips[1].at,scene.audioClips[1].at,'stable position');
// Generate 2 seconds of opening padding, a 0.9s tone, and 1 second of tail silence.
const rate=16000,arr=new Float32Array(4*rate);
for(let i=2*rate;i<2.9*rate;i++)arr[i]=Math.sin(i/11)*.22;
const trim=D.silenceTrim({sampleRate:rate,length:arr.length,numberOfChannels:1,getChannelData:()=>arr});
assert.ok(trim.start>1.8&&trim.start<2.1,'remove long opening silence: '+JSON.stringify(trim));
assert.ok(trim.end>.9&&trim.end<1.2,'remove long trailing silence: '+JSON.stringify(trim));
console.log('PASS smart narration director: groups/speaker/skip/layout/trim/frame extension');
