const {chromium}=require('playwright'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const server=http.createServer((req,res)=>{
  const name=(req.url||'/').split('?')[0].replace(/^\/+/,'')||'index.html';
  if(name.includes('..')){res.writeHead(403);return res.end()}
  const file=path.resolve(__dirname,'..',name);
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end()}
  const ct=name.endsWith('.js')?'application/javascript':name.endsWith('.json')?'application/json':name.endsWith('.css')?'text/css':'text/html';
  res.writeHead(200,{'Content-Type':ct});res.end(fs.readFileSync(file))
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:768,height:1024}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'domcontentloaded'});
  await page.locator('#aiQuick').click();
  await page.locator('#aiWorkspacePanel .ai-tabs button').filter({hasText:'คลังรูป / GitHub'}).click();
  await page.locator('.ai-art-card').first().waitFor({timeout:15000});
  assert.equal(await page.locator('.ai-art-card').count(),4);
  await page.locator('.ai-art-card').first().getByRole('button',{name:'ใช้ในฉาก'}).click();
  assert.equal(await page.evaluate(()=>StoryStudioBridge.get().episodes[0].scenes[0].customAssets.length),1);
  assert.ok(await page.evaluate(()=>{
   const sc=StoryStudioBridge.get().episodes[0].scenes[0];
   return StoryAssetCore.sceneMarkup(sc,'back',160).includes('<g transform=');
  }));
  await page.getByRole('button',{name:'ออกแบบ / ส่ง PR'}).click();
  await page.locator('textarea[aria-label="JSON รูปวาด"]').fill(JSON.stringify({
   name:'ทดสอบโคมไฟใหม่',category:'decor',shapes:[{type:'rect',x:10,y:20,w:60,h:30,fill:'#ffffff'}]
  }));
  await page.getByRole('button',{name:'เพิ่มในฉากทันที'}).click();
  assert.equal(await page.evaluate(()=>StoryStudioBridge.get().episodes[0].scenes[0].customAssets.length),2);
  assert.deepEqual(errors,[]);
  console.log('PASS: preset gallery, safe vector preview, place in scene and custom artwork editor');
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);process.exit(1)});
