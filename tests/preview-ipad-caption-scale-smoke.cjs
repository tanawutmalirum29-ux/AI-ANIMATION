'use strict';
// Regression from user iPad portrait screenshot: 9:16 preview was 129-165px
// wide because iPad was treated as a phone with a fixed 230px height cap.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:820,height:1180},deviceScaleFactor:2});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('file://'+path.resolve(__dirname,'../index.html'),{waitUntil:'domcontentloaded'});
  const inspect=async(width,height)=>{
   await page.setViewportSize({width,height});
   return await page.evaluate(()=>{
    const st=StoryStudioBridge.get();
    st.project.aspect='9:16';
    st.episodes[0].scenes[0].subtitleCues=[];
    st.episodes[0].scenes[0].subtitle=['คืนนี้ฝนตกหนัก','ตลาดยังเปิดไฟอยู่'];
    S=st;sel=0;T=0;fit();draw();
    const el=document.getElementById('stage'),sub=document.getElementById('sub'),
      wrap=document.getElementById('stageWrap');
    const box=el.getBoundingClientRect(),css=getComputedStyle(sub);
    return {
      width:box.width,height:box.height,
      subText:sub.textContent,subFont:parseFloat(css.fontSize),
      subWidth:sub.getBoundingClientRect().width,
      subBoxHeight:sub.getBoundingClientRect().height,
      stageWrapWidth:wrap.getBoundingClientRect().width,
      viewportWidth:innerWidth,viewportHeight:innerHeight,
      captionOverflows:sub.scrollHeight>sub.clientHeight+2,
      horizontalOverflow:document.documentElement.scrollWidth>innerWidth+2,
      inCinema:!!document.getElementById('previewTheater')&&!document.getElementById('previewTheater').hidden
    };
   });
  };
  const iPad=await inspect(820,1180);
  assert.ok(iPad.height>=490,'820px portrait iPad should have a large stage: '+JSON.stringify(iPad));
  assert.ok(iPad.width>=275,'stage should be wide enough to inspect captions');
  assert.ok(Math.abs(iPad.width/iPad.height-9/16)<.006,'maintain output ratio');
  assert.ok(iPad.subText.includes('ตลาดยังเปิดไฟ'),'captions visible');
  assert.ok(iPad.subFont>10&&iPad.subFont<23,'output-relative typography');
  assert.ok(!iPad.captionOverflows,'caption must not be clipped');
  assert.ok(!iPad.horizontalOverflow,'no viewport overflow');
  const widePad=await inspect(1024,1366);
  assert.ok(widePad.height>=500,'1024px portrait iPad should not use old 290px cap');
  assert.ok(widePad.subFont>15&&widePad.subFont<23);
  const phone=await inspect(390,844);
  assert.ok(phone.height>200&&phone.height<350,'phone stage fits while keeping editor');
  assert.ok(Math.abs(phone.width/phone.height-9/16)<.006);
  assert.ok(!phone.captionOverflows);
  assert.ok(!phone.horizontalOverflow);
  const tiny=await inspect(320,620);
  assert.ok(tiny.height<=220,'short phone must preserve tool tabs');
  assert.ok(!tiny.horizontalOverflow);
  const expectedFont=sh=>Math.max(4,Math.min(30,sh*.033));
  for(const r of [iPad,widePad,phone,tiny])
   assert.ok(Math.abs(r.subFont-expectedFont(r.height))<.2,
    'caption must scale with export geometry, not hard-coded CSS pixels: '+JSON.stringify(r));
  assert.deepEqual(errors,[],'JS console must stay clean');
  console.log('PASS: iPad 820/1024 portrait, phone 390/320 preview proportions, readable captions and no overflow');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
