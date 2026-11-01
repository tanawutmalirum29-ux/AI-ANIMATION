'use strict';
// Turbo is an opt-in pipeline; legacy output must remain unchanged.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('file://'+path.resolve(__dirname,'../index.html'),{waitUntil:'domcontentloaded'});
  await page.locator('#studioToolNav [data-tool="export"]').click();
  const report=await page.evaluate(async()=>{
   const pipeline=document.querySelector('#videoPipeline');
   const initial={value:pipeline.value,hasTurbo:Array.from(pipeline.options).some(o=>o.value==='turbo'),
    scope:document.querySelector('#videoScope').value,
    format:document.querySelector('#videoFormat').value};
   const samples=[
    {filename:'ep-1.mp4',blob:new Blob([new Uint8Array([1,2,3,4,5,6,7,8])],{type:'video/mp4'})},
    {filename:'ep-2.mp4',blob:new Blob([new Uint8Array(65536).map((_,i)=>(i*17+i/16)|0)],{type:'video/mp4'})}
   ];
   pipeline.value='standard';updateExportPipelineHint();
   const standard=new Uint8Array(await makeExportZip(samples).then(b=>b.arrayBuffer()));
   pipeline.value='turbo';updateExportPipelineHint();
   const turbo=new Uint8Array(await makeExportZip(samples).then(b=>b.arrayBuffer()));
   const zipIdentical=standard.length===turbo.length&&standard.every((v,i)=>v===turbo[i]);
   const hint=document.querySelector('#videoPipelineHint').textContent;
   const formatAfter=document.querySelector('#videoFormat').value;
   const scopeAfter=document.querySelector('#videoScope').value;
   const svg='<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>';
   const info={turbo:true,frameCacheHits:0};
   const first=await exportFrameImage(svg,info);
   const second=await exportFrameImage(svg,info);
   const different=await exportFrameImage(svg.replace('red','blue'),info);
   const reuse={same:first===second,distinct:second!==different,hits:info.frameCacheHits,
    width:first.width,height:first.height};
   const noCache={turbo:false};const a=await exportFrameImage(svg,noCache),c=await exportFrameImage(svg,noCache);
   const legacyNoCache=a!==c&&!noCache.frameCache;
   const userChoiceStillTurbo=exportPipelineTurbo();
   pipeline.value='standard';updateExportPipelineHint();
   const reverted=exportPipelineTurbo()===false;
   return {initial,zipIdentical,zipSize:turbo.length,reuse,legacyNoCache,hint,
    userChoiceStillTurbo,formatAfter,scopeAfter,reverted};
  });
  assert.equal(report.initial.value,'standard');
  assert.equal(report.initial.hasTurbo,true);
  assert.equal(report.initial.scope,'current');
  assert.equal(report.zipIdentical,true,'Turbo ZIP bytes/CRC match baseline byte-for-byte');
  assert.ok(report.zipSize>65000);
  assert.equal(report.reuse.same,true,'same SVG is decoded only once');
  assert.equal(report.reuse.distinct,true,'changed animation SVG must be decoded anew');
  assert.equal(report.reuse.hits,1);
  assert.equal(report.reuse.width,32);
  assert.equal(report.reuse.height,32);
  assert.equal(report.legacyNoCache,true,'standard mode keeps original no-cache path');
  assert.match(report.hint,/Turbo/);
  assert.equal(report.userChoiceStillTurbo,true);
  assert.equal(report.formatAfter,report.initial.format,'Turbo never silently changes output codec');
  assert.equal(report.scopeAfter,'current','Turbo never changes episode selection');
  assert.equal(report.reverted,true);
  assert.deepEqual(errors,[],'no uncaught browser errors');
  console.log('PASS selectable Turbo export: identical ZIP, bounded SVG cache, unchanged legacy, codec/scope preserved',report);
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
