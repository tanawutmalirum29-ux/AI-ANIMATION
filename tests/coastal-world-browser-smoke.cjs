'use strict';
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const pg=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];pg.on('pageerror',e=>errors.push(e.message));
  const sample=JSON.parse(fs.readFileSync(path.resolve(__dirname,
   '../examples/coastal-gate-ml-training-one-episode.json'),'utf8'));
  await pg.goto('file://'+path.resolve(__dirname,'../index.html'),{waitUntil:'domcontentloaded'});
  const out=await pg.evaluate(data=>{
   const state=StoryStudioBridge.get(),scene=state.episodes[0].scenes[0];
   state.project.aspect=data.project.aspect;
   state.locations=data.locations;
   state.characters=data.characters;
   Object.assign(scene,data.episodes[0].scenes[1]);
   sel=0;T=0;
   draw();
   const first=$('#set').innerHTML;
   const width=$('#world').style.width;
   const exportText=svgFrameFromWorld($('#world'),scene,540,960);
   const camera0=$('#world').style.transform;
   T=scene.duration*.75;draw();
   const after=$('#set').innerHTML,cameraLater=$('#world').style.transform;
   scene.location='training-harbor';
   scene.worldEffects={marketFlood:true};
   T=scene.duration*.8;draw();
   const market=$('#set').innerHTML;
   return {first,after,width,exportText,camera0,cameraLater,market};
  },sample);
  assert.equal(out.width,'320%');
  assert.match(out.first,/data-world-object="floodgate"/);
  assert.match(out.first,/data-world-object="market-stall"/);
  assert.notEqual(out.first,out.after,'gate leak changes as time advances');
  assert.notEqual(out.camera0,out.cameraLater,'camera actually pans on wide world');
  assert.match(out.exportText,/data-world-art="coastal-harbor"/,
   'shared export must use same custom SVG world');
  assert.match(out.market,/data-world-object="market-stall"/);
  assert.deepEqual(errors,[]);
  console.log('PASS: iPad/mobile preview and export include floodgate/market SVG; camera pans 320% world');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
