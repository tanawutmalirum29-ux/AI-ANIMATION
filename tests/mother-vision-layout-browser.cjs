'use strict';
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const [width,height] of [[1440,900],[1024,768]]){
   const page=await browser.newPage({viewport:{width,height}});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   page.on('dialog',d=>d.dismiss());
   await page.goto('file://'+path.resolve(__dirname,'../index.html')+'?mode=full',
    {waitUntil:'domcontentloaded'});
   const geo=await page.evaluate(()=>{
    const r=id=>document.querySelector(id).getBoundingClientRect();
    const t=r('#tl'),p=r('#pre'),a=r('#studioWorkspace');
    return {tl:{right:t.right,bottom:t.bottom},
     ai:{left:a.left,right:a.right,bottom:a.bottom,width:a.width},
     preview:{right:p.right},areas:getComputedStyle(document.body).gridTemplateAreas};
   });
   assert.match(geo.areas,/"tl studio"/,'timeline sits under preview, AI fills bottom-right');
   assert.ok(geo.tl.right<=geo.ai.left+2,JSON.stringify(geo));
   assert.ok(geo.ai.width>=490,JSON.stringify(geo));
   assert.ok(Math.abs(geo.ai.bottom-geo.tl.bottom)<=3,JSON.stringify(geo));
   await page.getByRole('button',{name:'ผู้ช่วย AI',exact:true}).click();
   assert.equal(await page.getByRole('button',{name:'AI แม่ 2 ตัว ดูเฟรมจริงและปรับฉากนี้'}).count(),1);
   assert.equal(await page.getByRole('button',{name:'ทดสอบเสียง AI แม่จริง'}).count(),0,
    'voice-specific test is displayed after selecting mother engine');
   // Export-style frame capture must return real pixels, not a fabricated URL.
   const frame=await page.evaluate(async()=>StoryStudioBridge.capturePreviewFrame());
   assert.ok(frame.startsWith('data:image/jpeg;base64,'),frame.slice(0,60));
   assert.ok(frame.length>500,'frame is non-empty');
   assert.deepEqual(errors,[],'no runtime errors');
   await page.close();
  }
  console.log('PASS: landscape timeline/AI split, multimodal capture and scene controls');
 }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exit(1)});
