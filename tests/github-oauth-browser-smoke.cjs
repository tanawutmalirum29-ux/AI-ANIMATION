'use strict';
const {chromium}=require('playwright');
const path=require('path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const html='file://'+path.resolve(__dirname,'../index.html');
 const endpoint='https://test-oauth.lambda-url.ap-southeast-2.on.aws/';
 try{
  for(const role of ['member','admin','guest']){
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
      redirectUri:'https://main.d1wc6w01kiwpnk.amplifyapp.com/',guestEnabled:true};
    else if(act==='auth.github.exchange'){
     assert.equal(data.codeVerifier,'A'.repeat(43));
     reply={token:'test-'+role,expiresAt:Math.floor(Date.now()/1000)+3500,
       user:{id:role==='admin'?225819900:11111,role,login:role}};
    }else if(act==='auth.guest.start'){
     assert.equal(role,'guest');
     reply={token:'guest.mock.signed',expiresAt:Math.floor(Date.now()/1000)+3500,
       user:{id:'guest-123',role:'guest',login:'ผู้เยี่ยมชม'},temporary:true};
    }else if(act==='verify'){
     reply={ok:true,user:{id:role==='admin'?225819900:
       role==='member'?11111:'guest-123',role,login:role}};
    }else if(act==='member.ai.catalog'){
     assert.notEqual(role,'admin');
     reply={release:'member-six-v1',moduleCount:6,trainedModelCount:1,
       externalAPIAllowed:false,quotasEnabled:false,
       trainedModels:[{id:'thai-editor',version:'cpu-starter',status:'experimental'}],
       modules:['composition','assets','motion','voice','structure','qa'].map(id=>({
        id,ready:id==='qa'||id==='voice',capability:'CPU ที่ฝึกแล้วเฉพาะบทภาษาไทย'}))};
    }else if(act==='member.ai.run'){
     assert.notEqual(role,'admin');
     assert.equal(data.role,'qa');
     assert.equal(data.release,'member-six-v1');
     for(const forbidden of ['provider','apiKey','model','connectionId','baseUrl']){
      assert.equal(Object.hasOwn(data,forbidden),false);
     }
     reply={reply:'CPU ตรวจบทภาษาไทยแล้ว · ยังไม่แก้ JSON',
       source:'trained-local-CPU-only',externalAPIUsed:false};
    }else if(act==='teacher.status'){
     if(role!=='admin'){code=403;reply={error:'เฉพาะแอดมิน'}}
     else reply={feedbackReady:true,providers:[]};
    }else{code=400;reply={error:'unsupported test request'};}
    await r.fulfill({status:code,contentType:'application/json',
     headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type'},
     body:JSON.stringify(reply)});
   });
   if(role==='guest'){
    await page.goto(html,{waitUntil:'domcontentloaded'});
    await page.getByText('เข้าใช้ชั่วคราวโดยไม่ต้องมี GitHub').click();
   }else{
    const code=role==='member'?'membercode12345':'admincode12345';
    await page.goto(html+'?code='+code+'&state=test_state_123',{waitUntil:'domcontentloaded'});
    assert.equal(await page.evaluate(()=>location.search.includes('code=')),false,
      'OAuth one-time code stripped from address');
   }
   await page.waitForFunction(()=>window.StoryStudioAccess?.isReady?.(),{timeout:20000});
   assert.equal(await page.evaluate(()=>StoryStudioAccess.user().role),role);
   await page.getByRole('button',{name:'เปิดพื้นที่ตัดต่อ',exact:true}).click();
   if(role!=='admin'){
    // Ordinary accounts must retain the full video editor and preview; the
    // trained CPU child is a docked tool rather than a full-page takeover.
    assert.equal(await page.locator('#stageWrap').isVisible(),true);
    assert.equal(await page.locator('#tl').isVisible(),true);
    await page.getByRole('button',{name:'ผู้ช่วย AI',exact:true}).click();
    await page.locator('#storyMemberPortal').waitFor({state:'visible'});
    assert.equal(await page.locator('#storyMemberPortal .member-role').count(),6);
     assert.equal(await page.locator('#storyMemberPortal .member-production-step').count(),12,'all twelve positions visible to ordinary accounts');
     assert.equal(await page.getByRole('button',{name:'เริ่มประมวลผล 12 ขั้น · ครั้งเดียว'}).count(),1);
    const denied=await page.evaluate(async()=>{
     try{await StoryStudioAccess.request({action:'teacher.status'});return false}
     catch(e){return e.status===403}
    });
    assert.equal(denied,true,'non-admin AI Mother action denied by AWS');
    assert.equal(await page.locator('#storyMemberPortal input[type=password]').count(),0);
    await page.locator('#storyMemberPortal textarea').fill('งสนนี้เราต้องทำให้สำเร็จ');
    await page.locator('#storyMemberPortal button.member-primary').click();
    await page.getByText('CPU ตรวจบทภาษาไทยแล้ว · ยังไม่แก้ JSON').waitFor();
    const key=role==='member'?'storyMember.cpu.v1.11111':'storyMember.cpu.v1.guest-123';
    const stored=await page.evaluate(k=>localStorage.getItem(k),key);
    if(role==='guest')assert.equal(stored,null);
    else assert.ok(stored&&stored.includes('CPU ตรวจบทภาษาไทยแล้ว'));
   }else{
    assert.equal(await page.locator('#storyMemberPortal').count(),0);
    assert.equal(await page.locator('#stageWrap').evaluate(x=>getComputedStyle(x).visibility),'visible');
   }
   await ctx.close();
  }
  console.log('PASS GitHub owner/member & guest identity, 6 CPU slots, no external keys/quotas');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
