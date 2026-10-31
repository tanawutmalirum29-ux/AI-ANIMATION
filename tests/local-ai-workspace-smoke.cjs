const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:768,height:1024},acceptDownloads:true});
  page.on('dialog',dialog=>dialog.accept());
  const failures=[];page.on('pageerror',e=>failures.push(e.message));
  await page.goto('file://'+path.resolve(__dirname,'../index.html'),{waitUntil:'domcontentloaded'});
  await page.locator('#aiQuick').click();
  await page.locator('#aiWorkspacePanel').waitFor({state:'visible'});
  assert.equal(await page.getByRole('heading',{name:'AI Production · 2 ผู้ช่วย'}).count(),1);
  const panel=page.locator('#aiWorkspacePanel');
  assert.equal(await panel.getByRole('heading',{name:/AI-1 · แบ่งบท/}).count(),1);
  assert.equal(await panel.getByRole('heading',{name:/AI-2 · พากย์เสียง/}).count(),1);
  assert.equal(await panel.getByRole('heading',{name:/AI-2 · ผู้ช่วยจัดเสียงเหตุการณ์/}).count(),0);
  assert.deepEqual(await page.evaluate(()=>StoryAIWorkspaceCore.roles.map(r=>r.id)),['structure','voice']);
  const original=await page.evaluate(()=>{
    const scene=StoryStudioBridge.get().episodes[0].scenes[0];
    scene.voiceover='บทพากย์เดิมของฉากแรก';
    StoryStudioBridge.persist();
    return scene.voiceover;
  });
  const beforeEpisodeCount=await page.evaluate(()=>StoryStudioBridge.get().episodes.length);
  const story=('ค่ำคืนหนึ่งแสงดาวเต็มท้องฟ้า เด็กหญิงเดินผ่านห้องสมุดและพบจดหมายลึกลับ。'+
   'เธอเก็บจดหมายแล้วเดินต่อไปยังประตูที่ไม่เคยมีอยู่ก่อน！\n\n').repeat(18);
  await panel.locator('textarea[aria-label="วางบทสำหรับแบ่งตอน"]').fill(story);
  await panel.locator('input[aria-label="นาทีต่อตอน"]').fill('1');
  await panel.getByRole('button',{name:'จัดบทเป็นตอนอัตโนมัติ'}).click();
  await page.waitForFunction(()=>StoryStudioBridge.get().project.aiWorkspace.tasks?.some(t=>t.role==='structure'&&t.status==='done'));
  const result=await page.evaluate((beforeEpisodeCount)=>{
   const state=StoryStudioBridge.get();
   const fresh=state.episodes.slice(beforeEpisodeCount);
   const flattened=fresh.flatMap(e=>e.scenes.map(s=>s.voiceover)).join('');
   return {
    count:fresh.length,previous:state.episodes[0].scenes[0].voiceover,
    flattened,targets:fresh.map(e=>e.targetSeconds),
    cues:fresh.flatMap(e=>e.scenes.flatMap(s=>s.subtitleCues)),
    ids:fresh.flatMap(e=>e.scenes.map(s=>s.id))
   };
  },beforeEpisodeCount);
  assert.ok(result.count>=2,'script must split into multiple episodes');
  assert.equal(result.previous,original,'original episode must remain unchanged');
  assert.equal(result.flattened.replace(/\s/g,''),story.replace(/\s/g,''),'no script content may be lost');
  assert.ok(result.targets.every(x=>x===60));
  assert.equal(new Set(result.ids).size,result.ids.length);
  assert.ok(result.cues.every(c=>Array.from(c.text).length<=28));
  await page.evaluate(()=>{
   window.__voiceCalls=[];
   StoryStudioBridge.narrate=async scope=>{window.__voiceCalls.push(scope);return {ok:true,made:2,failed:0}};
  });
  await panel.getByRole('button',{name:'เริ่มพากย์เสียง'}).click();
  await page.waitForFunction(()=>StoryStudioBridge.get().project.aiWorkspace.tasks.some(t=>t.role==='voice'&&t.status==='done'));
  assert.deepEqual(await page.evaluate(()=>window.__voiceCalls),['episode']);
  assert.equal(await page.evaluate(()=>StoryStudioBridge.get().episodes[0].scenes[0].voiceover),original);
  await panel.locator('.ai-tabs button').filter({hasText:'ประวัติ'}).click();
  assert.equal(await panel.locator('.ai-task').count(),2);
  await panel.locator('.ai-tabs button').filter({hasText:'ข้อมูลเรื่อง'}).click();
  const bible=panel.locator('.ai-field textarea').first();
  await bible.fill('เรื่องที่ผู้ใช้แต่งเอง');await bible.blur();
  assert.equal(await page.evaluate(()=>StoryStudioBridge.get().project.aiWorkspace.bible.premise),'เรื่องที่ผู้ใช้แต่งเอง');
  await panel.locator('.ai-tabs button').filter({hasText:'โปรเจกต์'}).click();
  await panel.getByRole('button',{name:'บันทึกเวอร์ชันในเครื่อง'}).click();
  await panel.locator('#aiProjectLibrary .ai-snapshot').first().waitFor();
  assert.deepEqual(failures,[]);
  console.log('PASS: exactly two AI assistants, duration-based script episode splits, original preservation, TTS, backups');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
