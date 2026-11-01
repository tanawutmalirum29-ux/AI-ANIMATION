'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const world=require('../studio-coastal-world.js'),qa=require('../studio-visual-qa.js');
assert.equal(world.TYPES.length,5);
const stage=(kind,fx={})=>({duration:9,worldEffects:fx});
const draw=(kind,fx={},t=5,layer='back')=>
 world.render({worldArt:kind},layer,165,t,stage(kind,fx));
const harbor=draw('coastal-harbor',{gateLeak:true});
assert.match(harbor,/data-world-art="coastal-harbor"/);
assert.match(harbor,/data-world-object="floodgate"/);
assert.equal((harbor.match(/data-world-object="market-stall"/g)||[]).length,3);
assert.match(harbor,/data-world-object="lighthouse-exterior"/);
assert.ok(harbor.length>5500,'market, gate and harbor must be detailed, not a generic house');
assert.notEqual(draw('coastal-harbor',{gateLeak:true},0),draw('coastal-harbor',{gateLeak:true},8),
 'visible leak must animate with scene time');
assert.notEqual(draw('coastal-harbor',{marketFlood:true},0),draw('coastal-harbor',{marketFlood:true},8),
 'flood level must rise when requested');
const cliff=draw('coastal-cliff',{bridgeFall:true,toolboxFall:true});
assert.match(cliff,/data-world-object="lighthouse-exterior"/);
assert.match(cliff,/data-world-object="falling-toolbox"/);
assert.notEqual(draw('coastal-cliff',{bridgeFall:true,toolboxFall:true},0),
 draw('coastal-cliff',{bridgeFall:true,toolboxFall:true},8));
const tower=draw('lighthouse-lantern',{beaconOn:true,reflectorTurn:true,beltBreak:true});
assert.match(tower,/data-world-object="fresnel-lens"/);
assert.match(tower,/data-world-object="reflector-mirror"/);
assert.notEqual(draw('lighthouse-lantern',{reflectorTurn:true},0),
 draw('lighthouse-lantern',{reflectorTurn:true},8));
const states=[.06,.15,.27,.38,.51,.59,.8].map(t=>
 draw('lighthouse-lantern',{beaconOn:true,threeFlashes:true},t*9));
assert.notEqual(states[0],states[1],'first flash');
assert.notEqual(states[1],states[2],'gap');
assert.notEqual(states[2],states[3],'second flash');
assert.notEqual(states[4],states[5],'third flash');
assert.match(draw('coastal-workshop'),/data-world-art="coastal-workshop"/);
assert.match(draw('coastal-hill'),/data-world-art="coastal-hill"/);
assert.equal(draw('not-a-real-world'),'', 'unknown art must fail closed');
for(const item of [harbor,cliff,tower]){
 assert.doesNotMatch(item,/<script|onerror=|javascript:/i,'generated vector must have no executable content');
 assert.doesNotMatch(item,/NaN|Infinity|undefined/);
}
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
const amplify=fs.readFileSync(path.resolve(__dirname,'../amplify.yml'),'utf8');
assert.match(html,/<script src="\.\/studio-coastal-world.js"><\/script>/);
assert.match(html,/StoryCoastalWorld\.render\(set,layer,W,local,scn\)/);
assert.match(amplify,/studio-coastal-world\.js/);
const sample=JSON.parse(fs.readFileSync(path.resolve(__dirname,
 '../examples/coastal-gate-ml-training-one-episode.json'),'utf8'));
assert.equal(sample.episodes.length,1);
assert.equal(sample.episodes[0].scenes.length,4);
assert.equal(sample.locations[0].set.worldArt,'coastal-harbor');
assert.ok(sample.episodes[0].scenes.every(s=>s.camera.world>2.5&&s.camera.type==='panorama'));
const gate=sample.episodes[0].scenes[1];
const report=qa.inspect(sample);
assert.ok(!report.issues.some(i=>i.event==='flooding'&&i.sceneId===gate.id),
 'real executable floodgate-leak world effect counts as evidence');
const missing=structuredClone(sample);
delete missing.episodes[0].scenes[1].worldEffects;
assert.equal(qa.eventEvidence(missing.episodes[0].scenes[1],'flooding','coastal-harbor'),false,
 'no action should be claimed without the effect');
assert.equal(qa.eventEvidence(gate,'flooding','coastal-cliff'),false,
 'wrong map type cannot claim same effect');

const revised=JSON.parse(fs.readFileSync(path.resolve(__dirname,
 '../examples/three-flashes-coastal-svg-v2.json'),'utf8'));
assert.equal(revised.episodes.length,3);
assert.equal(revised.episodes.flatMap(e=>e.scenes).length,18);
assert.equal(revised.locations.length,5);
assert.deepEqual(new Set(revised.locations.map(l=>l.set.worldArt)),new Set(world.TYPES));
assert.ok(revised.episodes.every(e=>e.scenes.every(sc=>
 sc.camera.type==='panorama'&&sc.camera.world===3.2)));
const srcScene=id=>revised.episodes.flatMap(e=>e.scenes).find(s=>s.id===id);
assert.equal(srcScene('s03').worldEffects.gateLeak,true);
assert.equal(srcScene('s08').worldEffects.toolboxFall,true);
assert.equal(srcScene('s11').worldEffects.crankTurn,true);
assert.equal(srcScene('s12').worldEffects.beltBreak,true);
assert.equal(srcScene('s13').worldEffects.beltRepair,true);
assert.equal(srcScene('s15').worldEffects.threeFlashes,true);
assert.equal(srcScene('s16').worldEffects.evacuation,true);
const worldOf=id=>revised.locations.find(l=>l.id===srcScene(id).location).set.worldArt;
for(const [id,event] of [['s03','flooding'],['s08','bridge-collapse'],
 ['s08','falling-item'],['s12','belt-break'],['s15','three-flashes']]){
 assert.ok(qa.eventEvidence(srcScene(id),event,worldOf(id)),
  'authored cinematic effect must be executable '+id+' '+event);
}
assert.match(draw('coastal-harbor',{evacuation:true}),/data-world-object="evacuating-villager"/);
assert.match(draw('coastal-workshop',{notebookOpen:true}),/data-world-object="open-notebook"/);
assert.match(draw('coastal-workshop',{signalDiagram:true}),/data-world-object="three-ray-diagram"/);
assert.match(draw('lighthouse-lantern',{crankTurn:true}),/data-world-object="hand-crank"/);
assert.notEqual(draw('coastal-harbor',{sequentialBlackout:true},0),
 draw('coastal-harbor',{sequentialBlackout:true},8));
assert.notEqual(draw('lighthouse-lantern',{crankTurn:true},0),
 draw('lighthouse-lantern',{crankTurn:true},8));
console.log('PASS: five wide SVG worlds, actual coastal landmarks, timed visual events and training JSON');
