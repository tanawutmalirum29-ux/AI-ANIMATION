// Mobile workspace QA: tool tabs stay directly under the preview while ONLY the tool panel scrolls.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

(async()=>{
 const root=process.cwd();
 const server=http.createServer((req,res)=>{
  const raw=decodeURIComponent((req.url||'/').split('?')[0]);
  const file=raw==='/'?'index.html':raw.slice(1);
  const abs=path.resolve(root,file);
  if(!abs.startsWith(root+path.sep)||!/\.(?:html|js|css|json|svg|png|webp|mp3)$/i.test(file)||!fs.existsSync(abs)||!fs.statSync(abs).isFile()){
   res.writeHead(404);return res.end();
  }
  const ext=path.extname(file);
  const mime={'.js':'application/javascript','.css':'text/css','.html':'text/html; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.mp3':'audio/mpeg'};
  res.setHeader('Content-Type',mime[ext]||'application/octet-stream');
  res.end(fs.readFileSync(abs));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const [width,height] of [[390,844],[375,600],[768,1024],[1024,768]]){
   const ctx=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true});
   const page=await ctx.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(String(e)));
   await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'load'});
   await page.locator('#studioToolNav button[data-tool="scene"]').waitFor();
   const compact=width<=820||(height>width&&width<=1100);
   await page.waitForFunction(expected=>document.querySelector('#studioToolNav').parentElement.id===(expected?'':'studioWorkspace')||
    (expected&&document.querySelector('#studioToolNav').parentElement===document.body),compact);
   if(compact){
    const initial=await page.evaluate(()=>{
     const nav=document.querySelector('#studioToolNav'),pre=document.querySelector('#pre'),body=document.querySelector('#studioToolBody');
     return {navParent:nav.parentElement.tagName,nav:nav.getBoundingClientRect().toJSON(),pre:pre.getBoundingClientRect().toJSON(),
      body:body.getBoundingClientRect().toJSON(),overflow:getComputedStyle(body).overflowY};
    });
    assert.equal(initial.navParent,'BODY','nav is a direct fixed-stack child, not a child of scrollable tools');
    assert.ok(Math.abs(initial.nav.top-initial.pre.bottom)<4,'nav directly follows the preview');
    assert.ok(initial.nav.bottom<=height+1,'nav remains on screen');
    assert.equal(initial.overflow,'auto','only the editor content should scroll vertically');
    await page.locator('#studioToolNav button[data-tool="characters"]').click();
    assert.equal(await page.locator('#studioToolNav button[data-tool="characters"]').getAttribute('aria-current'),'page');
    const sample=await page.evaluate(()=>{
     const nav=document.querySelector('#studioToolNav'),panel=document.querySelector('#studioToolBody');
     const initialTop=nav.getBoundingClientRect().top;
     const filler=document.createElement('div');filler.style.height='1600px';filler.dataset.testFiller='1';panel.append(filler);
     panel.scrollTop=panel.scrollHeight;
     return {initialTop,afterTop:nav.getBoundingClientRect().top,scrollTop:panel.scrollTop,
      navBottom:nav.getBoundingClientRect().bottom,rootScroll:document.scrollingElement.scrollTop};
    });
    assert.ok(sample.scrollTop>100,'tool content really scrolls');
    assert.ok(Math.abs(sample.afterTop-sample.initialTop)<2,'tool nav never moves while editing panel scrolls');
    assert.ok(sample.navBottom<=height+1,'tool nav remains visible after scroll');
    assert.equal(sample.rootScroll,0,'scrolling tools must not scroll the entire page');
    await page.locator('#studioToolNav button[data-tool="scene"]').click();
    assert.equal(await page.locator('#studioToolNav button[data-tool="scene"]').getAttribute('aria-current'),'page');
    assert.ok(await page.locator('#stage').isVisible(),'preview remains on screen');
   }else{
    assert.equal(await page.locator('#studioToolNav').evaluate(el=>el.parentElement.id),'studioWorkspace','desktop keeps the vertical tool sidebar');
   }
   assert.deepEqual(errors,[],width+'x'+height+' should not throw page JavaScript errors');
   console.log('PASS persistent mobile navigation:',width+'x'+height,compact?'compact':'desktop');
   await ctx.close();
  }
 }finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
 }
})().catch(e=>{console.error(e);process.exitCode=1});
