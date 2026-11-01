'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const start=html.indexOf('function sceneWeatherType(scene){');
const end=html.indexOf('function paintSceneAtmosphere',start);
assert.ok(start>=0&&end>start,'indoor/exterior weather policy exists');
const fn=new Function('S',html.slice(start,end)+';return sceneWeatherType;');
const state={locations:[
 {id:'harbor',name:'ท่าเรือและตลาดอ่าวคราม',promptBlock:'Small Thai coastal harbor at stormy night'},
 {id:'workshop',name:'ห้องซ่อมของพ่อ',promptBlock:'Modest coastal repair workshop, dusty window streaked with rain'},
 {id:'tower',name:'ห้องโคมไฟบนยอดประภาคาร',promptBlock:'Interior of coastal lighthouse lantern room, storm through windows'},
 {id:'path',name:'ทางหินขึ้นประภาคาร',promptBlock:'Wet narrow cliffside stone path and safety railing'},
 {id:'metro',name:'สถานีรถไฟเปิดโล่ง',promptBlock:'Outdoor railway platform'}
]};
const weather=fn(state);
assert.equal(weather({location:'harbor',atmosphere:'storm'}),'storm');
assert.equal(weather({location:'path',atmosphere:'rain'}),'rain');
assert.equal(weather({location:'workshop',atmosphere:'storm'}),'none','rain cannot pass through a roof');
assert.equal(weather({location:'tower',atmosphere:'storm'}),'none','lighthouse lantern room is inside');
assert.equal(weather({location:'workshop',atmosphere:'snow'}),'none');
assert.equal(weather({location:'workshop',atmosphere:'fog'}),'fog','fog may still be present indoors');
assert.equal(weather({location:'workshop',atmosphere:'storm',weatherExposure:'outdoor'}),'storm',
 'allow exposed/broken-roof scene if author explicitly requests it');
assert.equal(weather({location:'harbor',atmosphere:'rain',weatherExposure:'indoor'}),'none',
 'explicit indoor override has priority');
assert.match(html,/const cur=sceneWeatherType\(scene\)/,
 'export atmosphere must apply the indoor policy');
assert.match(html,/const atmo=sceneWeatherType\(s\)/,
 'live preview must apply the same indoor policy');
console.log('PASS: stop rain/snow inside the workshop and lighthouse, preview/export match, author override supported');
