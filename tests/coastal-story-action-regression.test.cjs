'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const world=require('../studio-coastal-world.js');
const audio=require('../studio-sound-assistant.js');
const sample=JSON.parse(fs.readFileSync(path.resolve(__dirname,
 '../examples/coastal-gate-ml-training-one-episode.json'),'utf8'));
const sc=sample.episodes[0].scenes;
const render=(scene,sec=1,layer='back')=>world.render(
 sample.locations[0].set,layer,162,sec,{duration:6,...scene});
const tokens=(s,name)=>s.includes('data-world-object="'+name+'"');
assert.deepEqual(sc.map(s=>s.id),['train-s01','train-s02','train-s03','train-s04']);
assert.ok(sc.every(s=>s.camera.type==='panorama'&&s.camera.world>=3));
assert.ok(sc[1].camera.from>sc[0].camera.from,'gate closeup must be closer than establishing shot');
assert.ok(sc[2].camera.endX>sc[1].camera.endX,'warning tracks towards the market');
assert.ok(sc[3].camera.endX>=95,'conclusion must reveal far high ground');
assert.ok(sc[3].camera.startX>=92,'safe hill finale starts after tall gate clears the crop');
assert.ok(sc[0].camera.startX>=85&&sc[0].camera.endX>=70,'establishing shot stays on the market and its visible water gauge');


const opener=render(sc[0],.1),openerLate=render(sc[0],5.5);
assert.ok(tokens(opener,'floodgate'));
assert.ok(tokens(opener,'water-level-gauge'));
assert.ok(tokens(opener,'market-tide-gauge'),'market-side tide gauge is visible in opening composition');
assert.ok(tokens(opener,'market-roofline'),'bounded low roofline, not a giant wall');
assert.ok(tokens(opener,'upstream-water'));
assert.ok(tokens(opener,'populated-market'));
assert.doesNotMatch(opener,/#f8d994/i,'harbor must not emit a giant lighthouse beam unless the story requests it');
assert.equal((opener.match(/data-world-object="market-stall"/g)||[]).length,3);
assert.notEqual(opener,openerLate,'waterline/gauge must rise with time');

const leak=render(sc[1],5);
assert.ok(tokens(leak,'gate-leak-jet'));
assert.ok(tokens(leak,'water-level-gauge'));
assert.match(leak,/#[0-9a-f]{6}/i,'SVG output should contain actual colors not placeholders');

const warningEarly=render(sc[2],.1),warningLate=render(sc[2],5.5);
assert.ok(tokens(warningEarly,'merchant-response'),'a warning must get an on-screen response');
assert.ok(tokens(warningEarly,'moving-crates'),'seller must visibly move goods');
assert.ok(tokens(warningLate,'evacuating-villager'));
assert.match(render(sc[2],.35),/data-story-phase="acknowledge"/);
assert.match(render(sc[2],2.5),/data-story-phase="lift"/);
assert.match(render(sc[2],5),/data-story-phase="carry"/);
assert.ok(tokens(leak,'sluice-discharge-channel'),'water gate must connect to a visible waterway');
assert.ok(tokens(leak,'sluice-buttresses'),'flood-control gate must have actual concrete support structure');
assert.ok(!/data-world-object="market-person"[^>]*>[^]*?data-world-object="evacuation-crate"/.test(render(sc[2],.01).split('data-world-object="merchant-acknowledgment"')[0]),'crowd must not all have pre-carried boxes before the warning');
assert.notEqual(warningEarly,warningLate,'merchants/crates must actually move along scene timeline');

const ending=render(sc[3],5.5);
assert.ok(tokens(ending,'market-street-flood'),'flood must be in lower street');
assert.ok(tokens(ending,'safe-hill'),'survivors must be visible above market');
assert.ok(!tokens(ending,'populated-market'),'market must actually empty after warning');
assert.ok(!tokens(ending,'merchant-response'),'merchant cannot be warning again after escape');
// Explicit author overrides inferred effects (no silent changes to saved story).
const inferred=world.coastalSceneEffects({voiceover:'ตลาดว่างแล้ว ทุกคนหนีขึ้นที่สูงได้ทัน'});
assert.equal(inferred.marketEmpty,true);
assert.equal(inferred.safeHill,true);
assert.equal(world.coastalSceneEffects({voiceover:'ตลาดว่างแล้ว',
 worldEffects:{marketEmpty:false}}).marketEmpty,false);
assert.equal(world.coastalSceneEffects({voiceover:'เธอวิ่งไปเตือนร้านค้าริมทาง'}).marketWarning,true);
assert.equal(world.coastalSceneEffects({voiceover:'ค่ำคืนนี้ฝนตกหนัก'}).marketWarning,undefined);
for(const out of [opener,openerLate,leak,warningEarly,warningLate,ending]){
 assert.doesNotMatch(out,/<script|onerror=|javascript:|NaN|Infinity|undefined/i);
 assert.match(out,/^<g data-world-art="coastal-harbor"/);
}
const plan=audio.plan(sample,[
 {id:'rain-heavy'},{id:'rain-soft'},{id:'stream'},{id:'sea'},{id:'market'}
],'all');
assert.equal(plan.length,4);
assert.ok(plan.every(x=>x.sounds.some(y=>y.presetId==='rain-heavy'&&y.loop===true)),
 'storm should be selected from owned local sound catalog for all four scenes');
console.log('PASS: waterline, detailed sluice, responsive merchants/crates, bounded flood, safe hill and local storm audio plan');
