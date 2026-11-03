'use strict';
const {chromium}=require('playwright');
const path=require('path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const html='file://'+path.resolve(__dirname,'../index.html');
 const endpoint='https://test-oauth.lambda-url.ap-southeast-2.on.aws/';
 try{
  for(const role of ['member','admin']){
   const ctx=await browser.newContext({viewport:{width:390,height:844}});
   await ctx.addInitScript(()=>{
    sessionStorage.setItem('storyStudio.githubPKCE.v1',JSON.stringify({
     state:'test_state_123',verifier:'A'.repeat(43),created:Date.now()}));
   });
   const page=await ctx.newPage();
   await page.route('**/runtime-config.js',r=>r.fulfill({status:200,
     contentType:'application/javascript',
     body:'window.STORY_STUDIO_CONFIG={apiUrl:'+JSON.stringify(endpoint)+'};'}));
   await page.route(endpoint,async r=>{
    const data=r.request().postDataJSON(),act=data.action;
    let code=200,reply={ok:true};
    if(act==='auth.config')reply={mode:'github',clientId:'Ov23testclientID',
      redirectUri:'https://main.d1wc6w01kiwpnk.amplifyapp.com/'};
    else if(act==='auth.github.exchange'){
     assert.equal(data.codeVerifier,'A'.repeat(43));
     reply={token:'test-'+role,expiresAt:Math.floor(Date.now()/1000)+3500,
       user:{id:role==='admin'?225819900:11111,role,login:role}};
    }else if(act==='verify')reply={ok:true,user:{id:role==='admin'?225819900:11111,role,login:role}};
    else if(act==='member.ai.run'){
     assert.equal(role,'member');
     assert.equal(data.provider,'gemini');
     assert.equal(data.role,'composition');
     assert.equal(data.apiKey,'test_private_key_1234');
     reply={reply:'AI-1 ตรวจตำแหน่งฉากเสร็จแล้ว'};
    }else if(act==='teacher.status'){
     if(role==='member'){code=403;reply={error:'เฉพาะแอดมิน'}}
     else reply={feedbackReady:true,providers:[]};
    }else{code=400;reply={error:'unsupported test request'}}
    await r.fulfill({status:code,contentType:'application/json',
     headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type'},
     body:JSON.stringify(reply)});
   });
   const code=role==='member'?'membercode12345':'admincode12345';
   await page.goto(html+'?code='+code+'&state=test_state_123',{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.StoryStudioAccess?.isReady?.(),{timeout:20000});
   assert.equal(await page.evaluate(()=>StoryStudioAccess.user().role),role);
   assert.equal(await page.evaluate(()=>location.search.includes('code=')),false,
     'OAuth one-time code stripped from address');
   if(role==='member'){
    assert.equal(await page.locator('#storyMemberPortal').isVisible(),true);
    assert.equal(await page.locator('#storyMemberPortal .member-role').count(),6);
    assert.equal(await page.locator('#stageWrap').evaluate(x=>getComputedStyle(x).visibility),'hidden');
    const denied=await page.evaluate(async()=>{
     try{await StoryStudioAccess.request({action:'teacher.status'});return false}
     catch(e){return e.status===403}
    });
    assert.equal(denied,true,'member teacher action denied by AWS');
    await page.locator('#storyMemberPortal input[type=password]').fill('test_private_key_1234');
    await page.locator('#storyMemberPortal textarea').fill('ช่วยตรวจตำแหน่ง');
    await page.locator('#storyMemberPortal button.member-primary').click();
    await page.getByText('AI-1 ตรวจตำแหน่งฉากเสร็จแล้ว').waitFor();
    assert.equal(await page.evaluate(()=>localStorage.getItem('storyMember.tasks.11111')?.includes('test_private_key_1234')),false);
   }else{
    assert.equal(await page.locator('#storyMemberPortal').count(),0);
    assert.equal(await page.locator('#stageWrap').evaluate(x=>getComputedStyle(x).visibility),'visible');
   }
   await ctx.close();
  }
  console.log('PASS GitHub callback, ID-based member/admin separation, member task and BYOK');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
