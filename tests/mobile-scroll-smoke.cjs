// Mobile root scrolling QA: the preview stays accessible without trapping a swipe back to the header.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
(async()=>{
 const server=http.createServer((req,res)=>{
  const p=decodeURIComponent((req.url||'/').split('?')[0]);
  const file=p==='/'?'index.html':p.slice(1);
  if(!['index.html','animated-map.js','animated-map.css','cinematic-fx.js','cinematic-fx.css','character-interaction.js','character-interaction.css'].includes(file)){res.writeHead(404);return res.end()}
  res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');
  res.end(fs.readFileSync(path.join(process.cwd(),file)));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const [width,height] of [[390,844],[768,1024]]){
   const ctx=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true});
   const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
   await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'load'});
   await page.locator('#studioToolBody').waitFor();
   const dims=await page.evaluate(()=>{
    const tl=getComputedStyle(document.querySelector('#tl'));
    const pre=getComputedStyle(document.querySelector('#pre'));
    return {tlOverflow:tl.overflowY,sticky:pre.position,scrollMax:document.scrollingElement.scrollHeight-innerHeight};
   });
   assert.equal(dims.tlOverflow,'visible',width+'px: nested timeline must not trap vertical swipes');
   assert.equal(dims.sticky,'sticky',width+'px: keep preview available while editing');
   assert.ok(dims.scrollMax>200,'editor has enough scrollable content');
   await page.evaluate(()=>window.scrollTo(0,document.scrollingElement.scrollHeight));
   await page.waitForFunction(()=>window.scrollY>180);
   await page.locator('#previewScrollTop').waitFor({state:'visible'});
   await page.locator('#previewScrollTop').click();
   await page.waitForFunction(()=>window.scrollY<5,{timeout:9000});
   assert.ok(await page.locator('#top .ttl').isVisible(),'project header should be reachable again');
   await page.evaluate(()=>window.scrollTo(0,Math.min(500,document.scrollingElement.scrollHeight)));
   await page.waitForFunction(()=>window.scrollY>150);
   await page.locator('#tl').hover();
   await page.mouse.wheel(0,-1200);
   await page.waitForFunction(()=>window.scrollY<5,{timeout:9000});
   assert.deepEqual(errors,[],'no page JavaScript errors');
   console.log('PASS mobile root scrolling:',width+'x'+height,dims);
   await ctx.close();
  }
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
})().catch(e=>{console.error(e);process.exitCode=1});
