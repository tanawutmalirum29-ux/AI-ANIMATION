const {chromium}=require('playwright');
const {Script}=require('node:vm');
const fs=require('node:fs'),http=require('node:http');
const assert=require('node:assert/strict');
const paths=['index.html','animated-map.js','animated-map.css','cinematic-fx.js','cinematic-fx.css','character-interaction.js','character-interaction.css'];
const html=fs.readFileSync('index.html','utf8');
[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).forEach(x=>new Script(x));
new Script(fs.readFileSync('character-interaction.js','utf8'));
assert.match(html,/character-interaction\.js/);
const server=http.createServer((req,res)=>{let p=(req.url||'/').split('?')[0].slice(1)||'index.html';if(!paths.includes(p)){res.writeHead(404);res.end('missing');return}
res.writeHead(200,{'Content-Type':p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'text/html; charset=utf-8'});res.end(fs.readFileSync(p))});
(async()=>{
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 let errors=[];try{
  const page=await browser.newPage({viewport:{width:920,height:760}});
  page.on('pageerror',e=>errors.push(e.stack||e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'load'});
  await page.locator('#sceneSwitchSelect').waitFor({timeout:15000});
  await page.evaluate(()=>{
   commit(()=>{
    S.characters.push({id:'test-char',name:'นักเดินทาง',rig:{style:'human'}});
    const s=sc();s.duration=4;s.location='field';s.actors=[{char:'test-char',x:45,y:88,pose:'stand',facing:'right'}];
    s.characters=['test-char'];
    s.props=[{kind:'lamp',x:53,y:86,scale:1,front:false}];
   });
  });
  await page.locator('#studioToolNav button[data-tool="interaction"]').click();
  await page.locator('#interactionEditor h3').waitFor();
  const labels=await page.locator('#interactionEditor').innerText();
  assert.match(labels,/เปลี่ยนฉาก/);assert.match(labels,/หยิบ/);
  await page.locator('#interactionEditor label').filter({hasText:'เวลาในฉาก'}).locator('input').fill('1');
  await page.locator('#interactionEditor button').filter({hasText:'เพิ่มการโต้ตอบ'}).click();
  const afterPickup=await page.evaluate(()=>{
   const s=sc();T=starts()[sel]+2;draw();
   const rig=document.getElementById('rig').innerHTML;
   const svg=svgFrameFromWorld(document.getElementById('world'),s,640,360);
   return {events:s.interactions.length,rigHeld:rig.includes('data-held-prop="0"'),exportHeld:svg.includes('data-held-prop="0"'),setHasLamp:document.getElementById('set').innerHTML.includes('data-held-prop')};
  });
  assert.equal(afterPickup.events,1);assert.equal(afterPickup.rigHeld,true);assert.equal(afterPickup.exportHeld,true);
  await page.locator('#interactionEditor label').filter({hasText:'สถานที่ของฉากใหม่'}).locator('select').selectOption('forest');
  await page.locator('#interactionEditor button').filter({hasText:'สร้างฉากถัดไปแบบต่อเนื่อง'}).click();
  const following=await page.evaluate(()=>{
   const e=ep(),s=sc(),st=starts();T=st[sel]+.5;draw();
   return {sel,sceneCount:e.scenes.length,location:s.location,actors:s.actors.length,holds:s.interactionInitialHold.length,
    ownIndex:Math.floor(T),start:st[sel],firstChar:s.actors[0]?.char,rigHeld:document.getElementById('rig').innerHTML.includes('data-held-prop')};
  });
  assert.equal(following.sel,1);assert.equal(following.sceneCount,2);assert.equal(following.location,'forest');
  assert.equal(following.firstChar,'test-char');assert.equal(following.holds,1);assert.equal(following.rigHeld,true);
  await page.locator('#sceneSwitchSelect').selectOption('0');
  const switchBack=await page.evaluate(()=>({sel,time:T,location:sc().location,sceneCount:ep().scenes.length}));
  assert.equal(switchBack.sel,0);assert.equal(switchBack.time,0);assert.equal(switchBack.location,'field');
  await page.locator('#sceneSwitchSelect').selectOption('1');
  assert.equal(await page.evaluate(()=>sel),1);
  await page.reload({waitUntil:'load'});
  await page.locator('#sceneSwitchSelect').waitFor();
  assert.equal(await page.locator('#sceneSwitchSelect option').count(),2);
  assert.equal(await page.evaluate(()=>ep().scenes[1].interactionInitialHold.length),1);
  await page.locator('#studioToolNav button[data-tool="map"]').click();
  await page.locator('#animatedMapEditor h3').waitFor();
  await page.locator('#studioToolNav button[data-tool="cinema"]').click();
  await page.locator('#cinematicFxEditor h3').waitFor();
  await page.locator('#studioToolNav button[data-tool="interaction"]').click();
  assert.equal(await page.locator('#interactionEditor').isVisible(),true);
  const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  mobile.on('pageerror',e=>errors.push(e.message));
  await mobile.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'load'});
  await mobile.locator('#sceneSwitchSelect').waitFor();
  assert.equal(await mobile.locator('#sceneSwitchSelect').isVisible(),true);
  assert.deepEqual(errors,[],'Browser errors');
  console.log('PASS: scene switcher, new scene continuity, pickup grip/export SVG, carried item, persistence, map/cinema regression, mobile');
  console.log(JSON.stringify({afterPickup,following,switchBack}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await new Promise(done=>server.close(done))});
