const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');

/* AI-only mode: the page shows only "ส่งให้ AI" + "นำงานกลับเข้า", a short ☰ menu leads to the
   AI workspace / Smart Director, and the full editor is still one menu tap away. */
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const url='file://'+path.resolve(__dirname,'../index.html');
 try{
  for(const [width,height] of [[1280,800],[390,844]]){
   const ctx=await browser.newContext({viewport:{width,height}});
   const page=await ctx.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   page.on('dialog',d=>d.dismiss());
   const visible=sel=>page.evaluate(s=>{const e=document.querySelector(s);if(!e)return false;const r=e.getBoundingClientRect();return getComputedStyle(e).display!=='none'&&r.width>0&&r.height>0},sel);
   const pageName=()=>page.evaluate(()=>document.documentElement.dataset.aiPage);
   /* JS click: a pointer click on the existing menu button does not open the menu at phone width, with or without AI-only mode */
   const openMenu=async()=>{await page.evaluate(()=>document.querySelector('header#top .menu-toggle').click())};

   /* automated browsers default to the full editor; ?mode=ai selects AI-only */
   await page.goto(url,{waitUntil:'load'});
   await page.waitForFunction(()=>window.StoryAIMode);
   assert.equal(await visible('#pre'),true,'automation defaults to full editor');
   await page.goto(url+'?mode=ai',{waitUntil:'load'});
   await page.waitForFunction(()=>window.StoryAIMode&&document.documentElement.classList.contains('ai-only'));

   assert.equal(await pageName(),'hub');
   assert.equal(await visible('#aiHub'),true);
   for(const hidden of ['#pre','#tl','#studioToolNav','#studioWorkspace'])assert.equal(await visible(hidden),false,hidden+' hidden in AI-only mode');
   assert.equal(await visible('#imp'),true,'paste box is inline');

   /* import a patch from "AI" */
   const sceneId=await page.evaluate(()=>S.episodes[0].scenes[0].id);
   await page.locator('#imp').fill(JSON.stringify({ops:[{op:'updateScene',id:sceneId,patch:{subtitle:['นำเข้าจาก AI']}}]}));
   await page.locator('#bImp').click();
   await page.waitForFunction(()=>S.episodes[0].scenes[0].subtitle.join('').includes('นำเข้าจาก AI'));
   await page.waitForFunction(()=>document.querySelector('.aih-status').textContent.includes('นำเข้างานจาก AI แล้ว'));
   assert.equal(await visible('#imp'),true,'paste box stays available after import');
   assert.equal(await page.locator('#imp').inputValue(),'');

   /* short menu: 3 AI pages + way back to the full editor */
   await openMenu();
   assert.equal(await page.locator('#menu .menu-action').count(),4);
   await page.locator('#menu .menu-action',{hasText:'AI สั่งงาน'}).click();
   assert.equal(await pageName(),'ai');
   assert.equal(await visible('#aiWorkspacePanel'),true);
   assert.equal(await visible('#studioToolNav'),false);
   await openMenu();
   await page.locator('#menu .menu-action',{hasText:'AI ตรวจงาน'}).click();
   assert.equal(await pageName(),'smart');
   assert.equal(await visible('#smartDialog'),true);
   await page.locator('#smartClose').click();
   assert.equal(await pageName(),'hub');

   /* full editor and back */
   await openMenu();
   await page.locator('#menu .menu-action',{hasText:'เปิดโหมดตัดต่อเต็ม'}).click();
   await page.waitForFunction(()=>!document.documentElement.classList.contains('ai-only'));
   for(const shown of ['#pre','#tl','#studioToolNav'])assert.equal(await visible(shown),true,shown+' visible in full editor');
   assert.equal(await visible('#aiHub'),false);
   assert.equal(await page.evaluate(()=>document.querySelector('#dlg').parentElement.tagName),'BODY','import dialog returned to body');
   await openMenu();
   await page.locator('#menu .menu-action',{hasText:'โหมดหน้าเรียบ'}).click();
   await page.waitForFunction(()=>document.documentElement.classList.contains('ai-only'));
   assert.equal(await pageName(),'hub');
   assert.equal(await visible('#imp'),true);

   assert.deepEqual(errors,[],'no page errors');
   console.log('PASS AI-only mode '+width+'x'+height);
   await ctx.close();
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
