const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:768,height:1024},acceptDownloads:true});
  page.on('dialog',dialog=>dialog.accept());
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('file://'+path.resolve(__dirname,'../index.html'),{waitUntil:'domcontentloaded'});
  await page.locator('#aiQuick').click();
  const panel=page.locator('#aiWorkspacePanel');
  await panel.waitFor({state:'visible'});
  assert.equal(await panel.getByRole('heading',{name:'AI Production · 6 ผู้ช่วย'}).count(),1);
  assert.equal(await panel.getByRole('heading',{name:/AI-5 · ตรวจจังหวะฉาก/}).count(),1);
  assert.equal(await panel.getByRole('heading',{name:/AI-4 · พากย์เสียง/}).count(),1);
  assert.equal(await panel.getByRole('heading',{name:'AI-1 / AI-2 / AI-3 / AI-6 · งานภาพและ QA'}).count(),1);
  assert.deepEqual(await page.evaluate(()=>StoryAIWorkspaceCore.roles.map(x=>x.id)),['composition','assets','motion','voice','structure','qa']);
  assert.equal(await panel.locator('textarea[aria-label="วางบทสำหรับแบ่งตอน"]').count(),0);
  const initial=await page.evaluate(()=>{
   const scene=StoryStudioBridge.get().episodes[0].scenes[0];
   scene.duration=21;scene.voiceover='ต้นฉบับจาก AI ภายนอก';
   scene.actors=[];scene.video=null;scene.sfx=[];scene.graphicCards=[];scene.notes='';
   scene.subtitleCues=[{id:'voice-cue-1',text:'ต้นฉบับจาก AI ภายนอก',start:0,end:20}];
   scene.audioClips=[{id:'demo-voice-1',kind:'voice',autoDub:true,at:0,duration:6,
    rate:1,trimStart:0,trimEnd:0,data:'data:audio/mpeg;base64,AA=='}];
   StoryStudioBridge.persist();return {text:scene.voiceover,duration:scene.duration};
  });
  await panel.getByRole('button',{name:'ตรวจปัญหา (ยังไม่แก้)'}).click();
  await panel.getByText(/ผลตรวจจาก JSON ที่กำลังเปิด/).waitFor();
  assert.equal(await page.evaluate(()=>StoryStudioBridge.get().episodes[0].scenes[0].duration),21);
  await panel.getByRole('button',{name:'ตรวจและปรับโปรเจกต์'}).click();
  await page.waitForFunction(()=>StoryStudioBridge.get().project.aiWorkspace.tasks?.some(t=>t.role==='structure'&&t.status==='done'));
  const outcome=await page.evaluate(()=>{
   const s=StoryStudioBridge.get().episodes[0].scenes[0];
   return {duration:s.duration,voiceover:s.voiceover,cues:s.subtitleCues,clips:s.audioClips.length};
  });
  assert.equal(outcome.voiceover,initial.text);
  assert.ok(outcome.duration>=6.3&&outcome.duration<7,'short post-voice tail without truncating the 6s voice');
  assert.equal(outcome.clips,1);
  assert.ok(outcome.cues[0].end<outcome.duration);
  await page.evaluate(()=>{
   window.__calls=[];
   StoryStudioBridge.narrate=async scope=>{window.__calls.push(scope);return {ok:true,made:1,failed:0}};
  });
  await panel.getByRole('button',{name:'พากย์และจัดเวลาหลังพากย์'}).click();
  await page.waitForFunction(()=>StoryStudioBridge.get().project.aiWorkspace.tasks?.some(t=>t.role==='voice'&&t.status==='done'));
  assert.deepEqual(await page.evaluate(()=>window.__calls),['episode']);
  await panel.locator('.ai-tabs button').filter({hasText:'ประวัติ'}).click();
  assert.equal(await panel.locator('.ai-task').count(),2);
  await panel.locator('.ai-tabs button').filter({hasText:'โปรเจกต์'}).click();
  await panel.getByRole('button',{name:'บันทึกเวอร์ชันในเครื่อง'}).click();
  await panel.locator('#aiProjectLibrary .ai-snapshot').first().waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: six specialist pipeline, imported JSON audit, measured speech trim, persisted clips and unchanged authored script');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});