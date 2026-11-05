const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const [width,height] of [[320,740],[390,844],[768,1024],[1024,768],[1440,900],[1920,1080]]){
   const page=await browser.newPage({viewport:{width,height}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto('file://'+path.resolve('index.html'));
   await page.locator('#studioHome').waitFor({state:'visible'});
   assert.equal(await page.getByRole('button',{name:'ไปพื้นที่ผู้ดูแลระบบ',exact:true}).count(),0);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'home fits '+width);
   await page.getByRole('button',{name:'เริ่มจัดฉาก',exact:true}).click();
   await page.locator('#stageWrap').waitFor({state:'visible'});
   assert.equal(await page.locator('#studioToolNav [data-tool]:visible').count(),3);
   if(width>820){
    assert.ok(await page.locator('.ux-groups').evaluate(n=>n.clientWidth>350),'desktop groups have working room');
    assert.ok(await page.locator('#studioToolBody').evaluate(n=>n.clientHeight>170),'desktop editor has working room');
   }
   await page.getByRole('button',{name:'2 · เสียง',exact:true}).click();
   await page.locator('#dubPanel').waitFor({state:'visible'});
   await page.locator('#studioToolNav [data-tool=audio]').click();
   await page.locator('#audioDesk').waitFor({state:'visible'});
   await page.getByRole('button',{name:'3 · ตรวจและส่งออก',exact:true}).click();
   await page.locator('#studioToolNav [data-tool=export]').click();
   await page.locator('#videoDialog').waitFor({state:'visible'});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'editor fits '+width);
   await page.locator('#studioHomeButton').click();
   await page.locator('#studioHome').waitFor({state:'visible'});
   // Role transitions: UI follows verified access state; never a client role picker.
   await page.evaluate(()=>{window.StoryStudioAccess={isAdmin:()=>true,user:()=>({role:'admin'})};dispatchEvent(new Event('story-studio-access-change'))});
   await page.getByRole('button',{name:'ไปพื้นที่ผู้ดูแลระบบ',exact:true}).click();
   await page.getByRole('button',{name:'ตั้งค่า AI ครู',exact:true}).click();
   await page.locator('#aiWorkspacePanel').waitFor({state:'visible'});
   await page.locator('#studioHomeButton').click();
   await page.evaluate(()=>{window.StoryStudioAccess={isAdmin:()=>false,user:()=>({role:'member'})};dispatchEvent(new Event('story-studio-access-change'))});
   assert.equal(await page.getByRole('button',{name:'ไปพื้นที่ผู้ดูแลระบบ',exact:true}).count(),0);
   assert.deepEqual(errors,[]);
   if(width===390||width===1440)await page.screenshot({path:'/workspace/scratch/navigation-'+width+'.png',fullPage:true});
   console.log('PASS navigation, roles, no overflow',width+'x'+height);
   await page.close();
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
