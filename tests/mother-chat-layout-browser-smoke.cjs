'use strict';
/* Real Chromium layout regression on phone, portrait iPad and landscape.
   This intentionally exercises the real single-page studio, not only CSS regex. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const url='file://'+path.resolve(__dirname,'../index.html')+'?mode=ai';
const metrics=()=> {
 const pick=sel=>{
  const el=document.querySelector(sel),r=el?.getBoundingClientRect();
  return el?{display:getComputedStyle(el).display,
   width:r.width,height:r.height,top:r.top,bottom:r.bottom,
   scrollTop:el.scrollTop,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight}:null;
 };
 return {preview:pick('#pre'),hub:pick('#aiHub'),
  tool:pick('#studioWorkspace'),chat:pick('.mother-chat'),
  log:pick('.mother-chat-log'),composer:pick('.mother-composer'),
  panel:pick('#aiWorkspacePanel'),height:window.innerHeight,
  focused:document.body.classList.contains('mother-focus')};
};
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const [width,height] of [[390,844],[768,1024],[1280,800]]){
   const ctx=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
   const page=await ctx.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   page.on('dialog',dialog=>dialog.dismiss());
   await page.goto(url,{waitUntil:'load'});
   await page.waitForFunction(()=>window.StoryAIMode&&window.StoryAIWorkspace);
   await page.locator('#aiWorkspacePanel .ai-tabs')
    .getByRole('button',{name:'คุยกับ AI แม่'}).click();
   await page.waitForFunction(()=>document.body.classList.contains('mother-focus'));
   let m=await page.evaluate(metrics);
   assert.equal(m.focused,true,width+': entered mother focus');
   assert.equal(m.preview.display,'none',width+': hide oversized preview while chatting');
   assert.equal(m.hub.display,'none',width+': JSON import hero collapsed while chatting');
   assert.ok(m.tool.width>width*.9,width+': chat should use full screen width');
   assert.ok(m.chat.height>180,width+': chat has actual usable height');
   assert.ok(m.log.height>115,width+': messages area has room to scroll');
   assert.ok(m.composer.top>=m.log.bottom-4,width+': input must not overlap messages');
   assert.ok(m.composer.bottom<=height+4,width+': send controls fit inside viewport');

   // Populate real chat container with long replies, without any paid API calls.
   await page.evaluate(()=>{
    const log=document.querySelector('.mother-chat-log');
    for(let i=0;i<18;i++){
     const bubble=document.createElement('article');
     bubble.className='mother-bubble '+(i%2?'user':'mother');
     const text=document.createElement('p');
     text.textContent=('AI ลูกกำลังเรียนรู้จากบทเรียนที่ผ่านการตรวจแล้วและยังไม่ใช่โมเดลเขียนบทอิสระ ').repeat(6)+i;
     bubble.append(text);log.append(bubble);
    }
    log.scrollTop=log.scrollHeight;
   });
   m=await page.evaluate(metrics);
   assert.ok(m.log.scrollHeight>m.log.clientHeight+400,width+': long conversation scrolls internally');
   assert.ok(m.log.scrollTop>300,width+': can reach bottom of long replies');
   const last=await page.locator('.mother-chat-log .mother-bubble').last().evaluate(n=>({
    bottom:n.getBoundingClientRect().bottom,text:n.textContent}));
   assert.ok(last.bottom<=m.log.bottom+4,width+': final reply not covered by composer');
   assert.ok(Math.abs(m.log.scrollTop+m.log.clientHeight-m.log.scrollHeight)<4,
    width+': log reaches actual scroll end');
   assert.ok(m.composer.top>=m.log.bottom-4,width+': no composer overlay on long reply');

   await page.getByRole('button',{name:'ดูพรีวิว'}).click();
   m=await page.evaluate(metrics);
   assert.notEqual(m.preview.display,'none',width+': preview is user-toggleable');
   assert.ok(m.preview.height>75,width+': compact preview is rendered');
   assert.ok(m.composer.bottom<=height+4,width+': composer stays visible with preview');
   await page.getByRole('button',{name:'ซ่อนพรีวิว'}).click();
   m=await page.evaluate(metrics);
   assert.equal(m.preview.display,'none',width+': preview can collapse again');

   await page.locator('#aiWorkspacePanel .ai-tabs')
    .getByRole('button',{name:'6 ผู้ช่วย AI'}).click();
   m=await page.evaluate(metrics);
   assert.equal(m.focused,false,width+': leaving mother tab releases focus');
   assert.notEqual(m.preview.display,'none',width+': regular AI pages keep preview');
   assert.notEqual(m.hub.display,'none',width+': JSON tools reappear on other tabs');
   assert.deepEqual(errors,[],width+': no JavaScript runtime errors');
   console.log('PASS AI Mother viewport '+width+'x'+height);
   await ctx.close();
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
