const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Script } = require('node:vm');
(async()=>{
 const html=fs.readFileSync('index.html','utf8');
 const inline=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(x=>x[1]);
 inline.forEach(js=>new Script(js));
 new Script(fs.readFileSync('animated-map.js','utf8'));
 assert.match(html, /animated-map\.js/);
 assert.match(html, /animated-map\.css/);
 const server=http.createServer((req,res)=>{
  const resource=(req.url||'/').split('?')[0];
  const routes={'/':'index.html','/index.html':'index.html','/animated-map.js':'animated-map.js','/animated-map.css':'animated-map.css'};
  const file=routes[resource];if(!file){res.writeHead(404);res.end('Not found');return}
  const data=fs.readFileSync(path.join(process.cwd(),file));res.writeHead(200,{'Content-Type':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8'});res.end(data);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=server.address().port;
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const errors=[],context=await browser.newContext({viewport:{width:920,height:780}});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));
 try{
  await page.goto('http://127.0.0.1:'+port+'/',{waitUntil:'load',timeout:30000});
  await page.locator('#studioToolNav button[data-tool="map"]').waitFor({timeout:20000});
  await page.locator('#studioToolNav button[data-tool="map"]').click();
  await page.locator('#animatedMapEditor button').filter({hasText:'+ ทุ่งนา'}).first().click();
  await page.locator('#animatedMapEditor h4').waitFor();
  const state=await page.evaluate(()=>{
   const s=sc(),m=s.animatedMap;
   const c=document.getElementById('animatedMapCanvas'),ctx=c.getContext('2d');
   T=starts()[sel]+Math.min(3,s.duration*.5);draw();
   let px=ctx.getImageData(Math.floor(c.width*.5),Math.floor(c.height*.5),1,1).data[3];
   const render=document.createElement('canvas');render.width=640;render.height=360;
   const exp=render.getContext('2d');drawGraphicCards(exp,s,Math.min(3,s.duration*.5),640,360);
   let exportAlpha=exp.getImageData(320,180,1,1).data[3];
   return {enabled:m.enabled,points:m.points.length,px,exportAlpha,sceneLength:s.duration,mapEnd:m.end};
  });
  assert.equal(state.enabled,true);assert.equal(state.points,5);
  assert.ok(state.px>0,'Preview map not painted');
  assert.ok(state.exportAlpha>0,'Export canvas map not painted');
  await page.locator('#animatedMapEditor button').filter({hasText:'+ เพิ่มจุดทางผ่าน'}).click();
  assert.equal(await page.locator('.animated-map-waypoint').count(),6);
  await page.locator('#animatedMapEditor select').filter({has:page.locator('option[value="inset"]')}).selectOption('inset');
  assert.equal(await page.evaluate(()=>sc().animatedMap.mode),'inset');
  await page.reload({waitUntil:'load'});
  await page.locator('#studioToolNav button[data-tool="map"]').waitFor();
  await page.waitForFunction(()=>sc().animatedMap?.points?.length===6,{timeout:12000});
  assert.equal(await page.evaluate(()=>sc().animatedMap.mode),'inset','Persistence failed');
  assert.deepEqual(errors,[],'Browser JavaScript errors');
  console.log('PASS: map panel, creation, animation, Canvas export, waypoint editor, inset, persistence');
  console.log('Preview test state:',JSON.stringify(state));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
})().catch(e=>{console.error(e);process.exitCode=1});
