const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');

/* AI mode must keep a real video preview + full JSON import + command desk visible
 * in the same application shell on desktop and phones. */
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const url='file://'+path.resolve(__dirname,'../index.html');
 try{
  for(const [width,height] of [[1280,800],[390,844]]){
   const context=await browser.newContext({viewport:{width,height}});
   const page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   page.on('dialog',d=>d.dismiss());
   const visible=sel=>page.evaluate(s=>{const e=document.querySelector(s);
    if(!e)return false;const r=e.getBoundingClientRect(),cs=getComputedStyle(e);
    return cs.display!=='none'&&cs.visibility!=='hidden'&&r.width>0&&r.height>0},sel);
   const openMenu=()=>page.evaluate(()=>document.querySelector('header#top .menu-toggle').click());
   await page.goto(url+'?mode=ai',{waitUntil:'load'});
   await page.waitForFunction(()=>window.StoryAIMode&&document.documentElement.classList.contains('ai-only'));
   assert.equal(await page.evaluate(()=>document.documentElement.dataset.aiPage),'workspace');
   for(const shown of ['#pre','#stageWrap','#ctl','#studioWorkspace','#aiHub','#aiWorkspacePanel','#aiCommandText'])
    assert.equal(await visible(shown),true,shown+' visible together');
   for(const hidden of ['#tl','#studioToolNav','#ins','#lib'])
    assert.equal(await visible(hidden),false,hidden+' hidden in AI workspace');
   // Teacher Studio is available within the same live-preview workspace.
   await page.locator('#aiWorkspacePanel .ai-tabs').getByRole('button',{name:'AI ครู / API'}).click();
   assert.equal(await visible('.teacher-head'),true,'Teacher tab mounted');
   assert.equal(await visible('.teacher-log'),true,'Teacher chat visible');
   assert.equal(await visible('.teacher-auto-teach'),true,'two-step automatic teacher visible');
   assert.equal(await page.getByRole('button',{name:'1. AI ลูกตรวจทั้ง JSON'}).count(),1);
   assert.equal(await page.getByRole('button',{name:'2. AI แม่สอนและบันทึก AWS'}).count(),1);
   assert.equal(await page.locator('.teacher-commands button').count(),6,'one-tap AI commands');
   await page.locator('.teacher-tabs').getByRole('button',{name:'เชื่อม API'}).click();
   assert.equal(await visible('#teacherQuickUrl'),true,'quick API link field visible');
   assert.equal(await visible('#teacherQuickKey'),true,'API key field visible');
   await page.locator('#teacherQuickUrl').fill('https://openrouter.ai/api/v1');
   await page.waitForFunction(()=>document.querySelector('#teacherUrlHint').textContent.includes('OpenRouter'));
   assert.equal(await page.locator('#teacherQuickKey').getAttribute('type'),'password');
   await page.locator('.teacher-tabs').getByRole('button',{name:'ต่อเติมบท'}).click();
   assert.equal(await visible('.story-coach'),true,'continuity coach tab visible');
   assert.equal(await page.evaluate(()=>typeof StoryNarrativeFoundation?.train==='function'||
    typeof StoryNarrativeFoundation?.fit==='function'),true,'CPU narrative model loaded');
   assert.equal(await page.getByRole('button',{name:'1. AI ลูกตรวจบริบท'}).count(),1);
   await page.locator('.teacher-tabs').getByRole('button',{name:'สอน AI ลูก'}).click();
   assert.equal(await visible('.teacher-memory-training'),true,'student CPU training available');
   assert.equal(await page.getByRole('button',{name:'AI ลูกวิเคราะห์ → AI แม่ตรวจ'}).count(),1);
   await page.locator('.teacher-tabs').getByRole('button',{name:'ประวัติ'}).click();
   assert.equal(await visible('.teacher-history'),true,'training feedback panel visible');
   assert.equal(await visible('#studentMemorySearch'),true,'lesson search visible');
   assert.equal(await visible('#studentMemoryLabel'),true,'label filter visible');
   assert.equal(await visible('.teacher-model-history'),true,'model history visible');
   await page.locator('#studentMemorySearch').fill('ไม่ ไม่');
   assert.equal(await page.locator('#studentMemorySearch').inputValue(),'ไม่ ไม่');
   await page.locator('#studentMemoryLabel').selectOption('keep');
   assert.equal(await page.locator('#studentMemoryLabel').inputValue(),'keep');
   await page.locator('#aiWorkspacePanel .ai-tabs').getByRole('button',{name:'11 ขั้นการผลิต'}).click();
   assert.equal(await visible('#imp'),false,'paste editor starts collapsed');
   await page.locator('#aiHub').getByRole('button',{name:'วาง JSON / ตรวจสอบ'}).click();
   assert.equal(await visible('#imp'),true,'paste editor opens inline without leaving preview');

   const sceneId=await page.evaluate(()=>StoryStudioBridge.get().episodes[0].scenes[0].id);
   await page.locator('#imp').fill(JSON.stringify({ops:[{op:'updateScene',id:sceneId,patch:{subtitle:['นำเข้าจาก AI']}}]}));
   await page.locator('#bImp').click();
   await page.waitForFunction(()=>StoryStudioBridge.get().episodes[0].scenes[0].subtitle.join('').includes('นำเข้าจาก AI'));
   await page.waitForFunction(()=>document.querySelector('.aih-status').textContent.includes('นำเข้า JSON แล้ว'));
   assert.equal(await visible('#pre'),true,'live video preview remains visible after import');
   assert.equal(await visible('#aiWorkspacePanel'),true,'AI controls remain visible after import');
   await page.locator('#aiCommandText').fill('ตรวจ QA ทั้งโปรเจกต์');
   await page.locator('.ai-command-desk').getByRole('button',{name:'สั่งงาน',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('#aiWorkspaceStatus').textContent.includes('ตรวจจาก JSON จริง'));
   const recorded=await page.evaluate(()=>StoryStudioBridge.get().project.aiWorkspace.history?.some(h=>/ตรวจ QA/.test(h.text)));
   assert.equal(recorded,true,'supported commands recorded in project history');
   await page.locator('#aiCommandText').fill('วาดภาพจากจินตนาการ');
   await page.locator('.ai-command-desk').getByRole('button',{name:'สั่งงาน',exact:true}).click();
   assert.match(await page.locator('#aiWorkspaceStatus').textContent(),/ยังไม่มี LLM/);


   // Story-only editor uses the same application, without any visual JSON requirement.
   await page.locator('#aiWorkspacePanel .ai-tabs').getByRole('button',{name:'เนื้อเรื่องล้วน'}).click();
   assert.equal(await visible('.story-only-workspace'),true,'text-only workspace visible');
   await page.locator('#storyOnlyPaste').fill(JSON.stringify({
    type:'story-only',title:'ทดสอบบทล้วน',chapters:[{title:'ตอนแรก',
     text:'ฝนเริ่มตกกลางตลาด\n\nคนขายของรีบยกกล่องขึ้นที่สูง'}]}));
   await page.getByRole('button',{name:'นำเข้าข้อความ JSON'}).click();
   await page.waitForFunction(()=>StoryStudioBridge.get().project.mode==='story-only');
   const story=await page.evaluate(()=>StoryStudioBridge.get());
   assert.equal(story.characters.length,0);
   assert.equal(story.episodes[0].scenes.length,2);
   assert.equal(story.episodes[0].scenes[0].imagePrompt,'');
   assert.equal(await visible('#storyOnlyVoiceover'),true,'story text editable');
   await page.locator('#storyOnlyVoiceover').fill('ฝนตกในตลาดอย่างหนัก');
   await page.getByRole('button',{name:'บันทึกบทฉาก'}).click();
   await page.waitForFunction(()=>StoryStudioBridge.get().episodes[0].scenes[0].voiceover==='ฝนตกในตลาดอย่างหนัก');
   assert.equal(await visible('#pre'),true,'video preview remains unaffected');
   await page.locator('#aiWorkspacePanel .ai-tabs').getByRole('button',{name:'AI ครู / API'}).click();
   await page.locator('.teacher-tabs').getByRole('button',{name:'คุย / สั่งงาน'}).click();
   assert.equal(await visible('.teacher-auto-teach'),true,'teacher remains available with text-only project');
   await openMenu();
   await page.locator('#menu .menu-action',{hasText:'เปิดสตูดิโอตัดต่อเต็ม'}).click();
   await page.waitForFunction(()=>!document.documentElement.classList.contains('ai-only'));
   for(const shown of ['#pre','#tl','#studioToolNav'])assert.equal(await visible(shown),true,shown+' visible after leaving AI');
   assert.equal(await visible('#aiHub'),false);
   assert.equal(await page.evaluate(()=>document.querySelector('#dlg').parentElement.tagName),'BODY');
   await openMenu();
   await page.locator('#menu .menu-action',{hasText:'เปิดสตูดิโอ AI พร้อมพรีวิว'}).click();
   await page.waitForFunction(()=>document.documentElement.classList.contains('ai-only'));
   assert.equal(await visible('#pre'),true);
   assert.equal(await visible('#aiWorkspacePanel'),true);
   assert.deepEqual(errors,[],'no runtime page errors');
   console.log('PASS unified AI production workspace '+width+'x'+height);
   await context.close();
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
