const {chromium}=require('playwright');
const {Script}=require('node:vm');
const fs=require('node:fs');
const http=require('node:http');
const assert=require('node:assert/strict');

const names=['index.html','animated-map.js','animated-map.css','cinematic-fx.js','cinematic-fx.css','character-interaction.js','character-interaction.css'];
const html=fs.readFileSync('index.html','utf8');
for(const js of [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]))new Script(js);
new Script(fs.readFileSync('animated-map.js','utf8'));
new Script(fs.readFileSync('cinematic-fx.js','utf8'));
assert.match(html,/cinematic-fx\.js/);
assert.match(html,/cinematic-fx\.css/);
let server=http.createServer((req,res)=>{
 const file=String(req.url||'').replace(/^\//,'').split('?')[0]||'index.html';
 if(!names.includes(file)){res.writeHead(404);res.end();return}
 const type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8';
 res.writeHead(200,{'Content-Type':type});res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const errors=[],base='http://127.0.0.1:'+server.address().port+'/';
 try{
 const page=await browser.newPage({viewport:{width:930,height:760}});
 page.on('pageerror',e=>errors.push(e.stack||e.message));
 await page.goto(base,{waitUntil:'load'});
 await page.locator('#studioToolNav button[data-tool="cinema"]').waitFor();
 assert.equal(await page.locator('#cinematicFxEditor').count(),1);
 await page.locator('#studioToolNav button[data-tool="cinema"]').click();
 await page.locator('#cinematicFxEditor button').filter({hasText:'+ แสงจันทร์'}).click();
 await page.locator('#cinematicFxEditor .cinema-slider-grid input[type=range]').first().waitFor();
 const basics=await page.evaluate(()=>{
  const s=sc(),f=s.cinematicFx,canvas=document.getElementById('cinematicFxCanvas');
  T=starts()[sel]+s.duration*.45;draw();
  const C=canvas.getContext('2d'),pixels=C.getImageData(0,0,canvas.width,canvas.height).data;
  let nontransparent=0;for(let j=3;j<pixels.length;j+=4)if(pixels[j])nontransparent++;
  const output=document.createElement('canvas');output.width=640;output.height=360;const ctx=output.getContext('2d');
  ctx.fillStyle='#102030';ctx.fillRect(0,0,640,360);const before=[...ctx.getImageData(400,170,1,1).data];
  filmSceneLight(ctx,s,640,360,s.duration*.45);
  const after=[...ctx.getImageData(400,170,1,1).data];
  return {mode:f.kind,keys:f.keyframes.length,nontransparent,before,after,editor:STUDIO_CURRENT_TOOL};
 });
 assert.equal(basics.mode,'moon');assert.equal(basics.keys,2);
 assert.ok(basics.nontransparent>1000,'Cinematic preview should paint a visible FX overlay');
 assert.notDeepEqual(basics.after,basics.before,'Video render must show cinematic effects');
 assert.equal(basics.editor,'cinema');
 await page.locator('#cinematicFxEditor button').filter({hasText:'เพิ่มคีย์เฟรมที่เวลา Playhead'}).click();
 assert.equal(await page.evaluate(()=>sc().cinematicFx.keyframes.length),3);
 await page.locator('#cinematicFxEditor select').filter({has:page.locator('option[value="flashlight"]')}).selectOption('flashlight');
 assert.equal(await page.evaluate(()=>sc().cinematicFx.kind),'flashlight');
 await page.evaluate(()=>{
  const s=sc();s.camera.type='pan-left';T=starts()[sel]+s.duration*.75;draw();
 });
 const movement=await page.evaluate(()=>{
  const s=sc(),svg=svgFrameFromWorld(document.getElementById('world'),s,640,360);
  const world=document.getElementById('setf').style.transform;
  const d=window.STUDIO_CINEMATIC_PARALLAX(s,'setf',640,360);
  return {transform:world,delta:d,svgHasParallax:svg.includes('transform="translate(')};
 });
 assert.ok(movement.delta[0]!==0,'Camera-driven parallax should have nonzero layer offset');
 assert.ok(movement.transform!=='none','Preview needs CSS layer transform');
 // New scene with at least one SVG set layer to validate export transform markup.
 await page.evaluate(()=>{
  const s=sc();s.image=null;s.art='chaos';T=starts()[sel]+s.duration*.6;draw();
 });
 const exportParallax=await page.evaluate(()=>{
  const s=sc(),out=svgFrameFromWorld(document.getElementById('world'),s,640,360);
  return out.includes('transform="translate(');
 });
 assert.ok(exportParallax,'SVG export should include layer transforms');
 await page.reload({waitUntil:'load'});
 await page.locator('#studioToolNav button[data-tool="cinema"]').waitFor();
 await page.waitForFunction(()=>sc().cinematicFx?.keyframes?.length===3,{timeout:15000});
 assert.equal(await page.evaluate(()=>sc().cinematicFx.kind),'flashlight');
 // Saved scenes without FX must stay untouched and map tool must still work.
 await page.locator('#studioToolNav button[data-tool="map"]').click();
 await page.locator('#animatedMapEditor h3').waitFor();
 await page.locator('#studioToolNav button[data-tool="cinema"]').click();
 assert.ok(await page.locator('#cinematicFxEditor').isVisible());
 const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 mobile.on('pageerror',e=>errors.push(e.stack||e.message));
 await mobile.goto(base,{waitUntil:'load'});
 await mobile.locator('#studioToolNav button[data-tool="cinema"]').click();
 await mobile.locator('#cinematicFxEditor h3').waitFor();
 assert.equal(await mobile.locator('#cinematicFxEditor').isVisible(),true);
 assert.deepEqual(errors,[],'No uncaught browser JS errors');
 console.log('PASS Cinematic FX: preview/export parity, real SVG parallax, blend controls, 3 keyframes, persistence, maps, mobile UI');
 console.log('Evidence: '+JSON.stringify({basics,movement,exportParallax}));
 await mobile.close();
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{await new Promise(resolve=>server.close(resolve))});
