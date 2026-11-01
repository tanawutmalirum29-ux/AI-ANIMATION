// Regression: Export is a focused, usable viewport on small screens and desktop.
// Run: node tests/export-focus-layout-smoke.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
 const root = process.cwd();
 const server = http.createServer((req, res) => {
  const file = decodeURIComponent((req.url || '/').split('?')[0]).slice(1) || 'index.html';
  const abs = path.resolve(root, file);
  if (!abs.startsWith(root + path.sep) || !/\.(html|js|css|json|png|svg|mp3)$/i.test(file) || !fs.existsSync(abs)) {
   res.writeHead(404); return res.end();
  }
  res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
  res.end(fs.readFileSync(abs));
 });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 const browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
 try {
  for (const [width, height] of [[375,667], [390,844], [768,1024], [1024,768], [1180,820], [1440,900]]) {
   const page = await browser.newPage({viewport:{width,height}, hasTouch:width<=1024, isMobile:width<=820});
   const errors=[];
   page.on('pageerror', e=>errors.push(String(e)));
   await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'load'});
   await page.locator('#studioToolNav [data-tool="export"]').click();
   await page.waitForFunction(()=>document.body.classList.contains('export-focus') && document.querySelector('#videoDialog').open);
   const state = await page.evaluate(()=>{
    const node=s=>document.querySelector(s), rect=s=>node(s).getBoundingClientRect();
    return {
     timelineHidden:getComputedStyle(node('#tl')).display==='none',
     navHidden:getComputedStyle(node('#studioToolNav')).display==='none',
     motionHidden:getComputedStyle(node('#motionBar')).display==='none',
     exportVisible:!!(rect('#videoDialog').width && rect('#videoDialog').height),
     back:rect('#videoBack').toJSON(),
     workspace:rect('#studioWorkspace').toJSON(),
     body:rect('body').toJSON(),
     toolBody:{clientHeight:node('#studioToolBody').clientHeight,scrollHeight:node('#studioToolBody').scrollHeight},
     videoStartPresent:!!node('#videoStart'),startButton:rect('#videoStart').toJSON(),
     scope:rect('#videoScope').toJSON(),formTop:rect('#videoDialog').top,
     selectedScope:node('#videoScope').value,stage:rect('#stage').toJSON(),
     isFlex:getComputedStyle(node('body')).display==='flex'
    };
   });
   assert.ok(state.timelineHidden && state.navHidden && state.motionHidden,'export must hide editing clutter');
   assert.ok(state.exportVisible && state.videoStartPresent,'export controls remain mounted');
   assert.ok(state.startButton.top>=-1&&state.startButton.bottom<=height+2,'primary export button visible without scrolling on every device');
   assert.ok(state.startButton.top-state.formTop<200,'export action is adjacent to top of export form, not below video playback result');
   assert.equal(state.selectedScope,'current','legacy single-episode export remains the default');
   assert.ok(state.scope.top>=-1&&state.scope.bottom<=height+2,'mode selector is visible without scrolling');
   assert.ok(state.back.width>60 && state.back.height>=30,'visible way back to editing');
   assert.ok(state.back.top>=-1 && state.back.bottom<=height+2,'back button must be in viewport');
   assert.ok(state.toolBody.clientHeight>120,'export form must have useful viewport height');
   if(width<=1100){
    assert.ok(state.isFlex,'small screens use focused vertical workspace');
    assert.ok(state.workspace.top < height-120,'export panel starts in visible viewport');
    assert.ok(state.workspace.bottom <= height+3,'export panel does not exceed viewport');
    assert.ok(state.stage.height>=60,'video preview remains visible');
   }
   await page.evaluate(()=>{document.querySelector('#studioToolBody').scrollTop=500});
   await page.waitForTimeout(70);
   const afterScroll=await page.evaluate(()=>({back:document.querySelector('#videoBack').getBoundingClientRect().toJSON(),scroll:document.querySelector('#studioToolBody').scrollTop}));
   assert.ok(afterScroll.back.top>=-1 && afterScroll.back.bottom<=height+2,'return control stays visible while scrolling');
   const pinned=await page.locator('#videoStart').boundingBox();
   assert.ok(pinned&&pinned.y>=-1&&pinned.y+pinned.height<=height+2,'sticky export button remains reachable while scrolling');
   if(state.toolBody.scrollHeight > state.toolBody.clientHeight+20)assert.ok(afterScroll.scroll>0,'export form scrolls independently');
   await page.locator('#videoBack').click();
   assert.ok(!(await page.evaluate(()=>document.body.classList.contains('export-focus'))),'return clears focused mode');
   assert.ok(await page.locator('#studioToolNav').isVisible(),'editing navigation returns');
   assert.ok(await page.locator('#tl').isVisible(),'timeline returns');
   assert.deepEqual(errors,[],'export focus must not cause uncaught errors');
   console.log('PASS export focus',width+'x'+height,JSON.stringify({workspaceTop:Math.round(state.workspace.top),formHeight:state.toolBody.clientHeight,scrollHeight:state.toolBody.scrollHeight}));
   await page.close();
  }
 } finally {
  await browser.close();await new Promise(resolve=>server.close(resolve));
 }
})().catch(e=>{console.error(e);process.exitCode=1});
