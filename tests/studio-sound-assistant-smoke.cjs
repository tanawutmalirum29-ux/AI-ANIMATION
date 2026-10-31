const assert=require('node:assert/strict');
const planner=require('../studio-sound-assistant.js');
const catalog=['forest','door','step','hit','rain-soft','m-mystery'].map(id=>({id}));
const state={locations:[{id:'forest',name:'ป่าลึก',promptBlock:'forest'}],episodes:[{scenes:[
 {id:'s1',duration:12,location:'forest',notes:'เดินเข้าไปในป่าลึก แล้วเปิดประตู',voiceover:'เดินเข้าไปในป่าลึก แล้วเปิดประตู',
  subtitle:['เปิดประตู'],subtitleCues:[{id:'c1',text:'เปิดประตู',start:7,end:9}]},
 {id:'s2',duration:8,location:'house',notes:'บรรยากาศลึกลับ มีฝนพรำ',voiceover:'ฝนพรำ',subtitle:[],subtitleCues:[]},
 {id:'s3',duration:5,location:'empty',notes:'',voiceover:'บทพูดเฉย ๆ',subtitle:[]}
]}]};
const p=planner.plan(state,catalog,'episode');
assert.equal(p.length,3);
assert.equal(p[0].sounds.find(x=>x.presetId==='forest').at,0);
assert.equal(p[0].sounds.find(x=>x.presetId==='door').at,7);
assert.equal(p[1].sounds.find(x=>x.presetId==='rain-soft').volume,.18);
assert.deepEqual(p[2].sounds,[],'silent scenes should not get invented ambience');
assert.equal(planner.plan(state,catalog,'scene',1)[0].sceneId,'s2');
assert.ok(p.flatMap(x=>x.sounds).every(x=>catalog.some(a=>a.id===x.presetId)),'only catalog presets');
const before=JSON.stringify(state);planner.plan(state,catalog,'all');assert.equal(JSON.stringify(state),before,'planning never edits scripts');
console.log('PASS: 2-audio event planner respects caption timing, controlled sound catalog and unchanged author scripts');
