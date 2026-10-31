// Browser contract for a password-unlocked studio and automatic authorized dubbing.
// Uses a simulated Lambda Function URL; never contacts AWS or a real AI provider.
const {chromium}=require('playwright');
const path=require('path');
const assert=require('assert');
(async()=>{
 const browser=await chromium.launch({headless:true});
 const url='file://'+path.resolve(__dirname,'../index.html');
 const endpoint='https://test-story.lambda-url.ap-southeast-2.on.aws/';
 const pass='studio_test_password_very_long';
 let calls=[];
 try{
  const page=await browser.newPage();
  await page.route('**/runtime-config.js',async r=>r.fulfill({status:200,contentType:'application/javascript',
   body:'window.STORY_STUDIO_CONFIG={apiUrl:'+JSON.stringify(endpoint)+'};'}));
  await page.route(endpoint,async r=>{
   const request=r.request(),json=request.postDataJSON(),headers=request.headers();
   calls.push({action:json.action,headers});
   if(json.action==='login'){
    const ok=json.password===pass;
    return r.fulfill({status:ok?200:401,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type'},
     body:JSON.stringify(ok?{token:'fake_signed_session',expiresAt:Math.floor(Date.now()/1000)+3600}:{error:'รหัสผ่านไม่ถูกต้อง'})});
   }
   if(headers.authorization!=='Bearer fake_signed_session')
    return r.fulfill({status:401,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:'{"error":"Unauthorized"}'});
   return r.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},
    body:JSON.stringify(json.action==='verify'?{ok:true}:{audio:'RkFLRV9NUDM='})});
  });
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.locator('#siteAccessGate').waitFor({state:'visible',timeout:20000});
  assert.equal(await page.evaluate(()=>window.StoryStudioAccess.enabled),true);
  await page.locator('#siteAccessPassword').fill('wrong');
  await page.getByRole('button',{name:'เข้าสู่สตูดิโอ'}).click();
  await page.getByText('รหัสผ่านไม่ถูกต้อง').waitFor();
  await page.locator('#siteAccessPassword').fill(pass);
  await page.getByRole('button',{name:'เข้าสู่สตูดิโอ'}).click();
  await page.locator('#siteAccessGate').waitFor({state:'hidden'});
  const answer=await page.evaluate(()=>window.StoryStudioAccess.request({text:'สวัสดี',voice:'th-TH-NiwatNeural'}));
  assert.equal(answer.audio,'RkFLRV9NUDM=');
  assert(calls.some(c=>c.action==='synthesize'&&c.headers.authorization==='Bearer fake_signed_session'));
  assert(!calls.some(c=>c.action==='synthesize'&&c.headers['x-dub-key']));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.StoryStudioAccess.isReady());
  assert.equal(await page.locator('#siteAccessGate').isHidden(),true);
  await page.evaluate(()=>window.StoryStudioAccess.logout());
  await page.locator('#siteAccessGate').waitFor({state:'visible'});
  console.log('PASS: first login, incorrect password, no manual API key, session resume, logout');
  await page.close();
  const legacy=await browser.newPage();
  await legacy.goto(url,{waitUntil:'domcontentloaded'});
  assert.equal(await legacy.evaluate(()=>window.StoryStudioAccess.enabled),false);
  assert.equal(await legacy.locator('#siteAccessGate').count(),0);
  console.log('PASS: legacy studio works when no hosted API is configured');
  await legacy.close();
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
