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
  assert.equal(await page.getByRole('heading',{name:'Audio AI Workspace'}).count(),1);
  const panel=page.locator('#aiWorkspacePanel');
  assert.equal(await panel.getByRole('heading',{name:/AI-1 · ผู้ช่วยพากย์เสียง/}).count(),1);
  assert.equal(await panel.getByRole('heading',{name:/AI-2 · ผู้ช่วยจัดเสียงเหตุการณ์/}).count(),1);
  assert.equal(await panel.getByText('นักเขียนบท',{exact:true}).count(),0);
  assert.equal(await panel.locator('[aria-label="เลือกโมเดลในเครื่อง"]').count(),0,'no GPU model selection');
  const initial=await page.evaluate(()=>{
   const scene=StoryStudioBridge.get().episodes[0].scenes[0];
   scene.duration=12;scene.location='forest';
   scene.voiceover='ผู้บรรยายเดินผ่านป่าก่อนเปิดประตู';
   scene.notes='กลางป่ามีคนเดินเข้าและเปิดประตู';
   scene.subtitle=['เปิดประตู'];scene.subtitleCues=[{id:'door-cue',text:'เปิดประตู',start:7,end:9}];
   StoryStudioBridge.persist();
   return scene.voiceover;
  });
  await panel.getByRole('button',{name:'จัดเสียงตามเหตุการณ์'}).click();
  await page.waitForFunction(()=>StoryStudioBridge.get().project.aiWorkspace.tasks?.some(t=>t.role==='sound'&&t.status==='done'));
  let details=await page.evaluate(()=>{
   const s=StoryStudioBridge.get().episodes[0].scenes[0];
   return {script:s.voiceover,notes:s.notes,
    sounds:s.audioClips.filter(c=>c.aiAutoSound).map(c=>({preset:c.presetId,at:c.at,vol:c.volume,hasAudio:!!c.data}))};
  });
  assert.equal(details.script,initial);
  assert.equal(details.notes,'กลางป่ามีคนเดินเข้าและเปิดประตู');
  assert.ok(details.sounds.some(c=>c.preset==='forest'));
  assert.ok(details.sounds.some(c=>c.preset==='door'&&c.at===7));
  assert.ok(details.sounds.every(c=>c.vol<=.5&&c.hasAudio));
  await panel.getByRole('button',{name:'จัดเสียงตามเหตุการณ์'}).click();
  await page.waitForFunction(()=>StoryStudioBridge.get().project.aiWorkspace.tasks.filter(t=>t.role==='sound'&&t.status==='done').length===2);
  assert.equal(await page.evaluate(()=>StoryStudioBridge.get().episodes[0].scenes[0].audioClips.filter(c=>c.aiAutoSound).length),details.sounds.length,'second run replaces only auto sounds, no duplicates');
  await page.evaluate(()=>{
   window.__voiceCalls=[];
   StoryStudioBridge.narrate=async scope=>{window.__voiceCalls.push(scope);return {ok:true,made:1,failed:0}};
  });
  await panel.getByRole('button',{name:'พากย์จากบทเดิม'}).click();
  await page.waitForFunction(()=>StoryStudioBridge.get().project.aiWorkspace.tasks.some(t=>t.role==='voice'&&t.status==='done'));
  assert.deepEqual(await page.evaluate(()=>window.__voiceCalls),['episode']);
  assert.equal(await page.evaluate(()=>StoryStudioBridge.get().episodes[0].scenes[0].voiceover),initial);
  await panel.locator('.ai-tabs button').filter({hasText:'ประวัติ'}).click();
  assert.equal(await panel.locator('.ai-task').count(),3);
  await panel.locator('.ai-tabs button').filter({hasText:'ข้อมูลเรื่อง'}).click();
  const bible=panel.locator('.ai-field textarea').first();
  await bible.fill('เรื่องที่ผู้ใช้แต่งเอง');await bible.blur();
  assert.equal(await page.evaluate(()=>StoryStudioBridge.get().project.aiWorkspace.bible.premise),'เรื่องที่ผู้ใช้แต่งเอง');
  await panel.locator('.ai-tabs button').filter({hasText:'โปรเจกต์'}).click();
  await panel.getByRole('button',{name:'บันทึกเวอร์ชันในเครื่อง'}).click();
  await panel.locator('#aiProjectLibrary .ai-snapshot').first().waitFor();
  assert.deepEqual(failures,[]);
  console.log('PASS: two audio-only assistants, free event SFX, original script preservation, TTS invocation, backups');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
