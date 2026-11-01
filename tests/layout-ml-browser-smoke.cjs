// Browser-only regression: manual feedback is exported as numeric JSONL on an explicit click.
// It must NOT edit the story or silently send user data to GitHub.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('file://'+path.resolve(__dirname,'../index.html'),{waitUntil:'domcontentloaded'});
  await page.locator('#aiQuick').click();
  const panel=page.locator('#aiWorkspacePanel');
  await panel.waitFor({state:'visible'});
  const ml=panel.locator('details').filter({hasText:'ML Lab'});
  await ml.locator('summary').click();
  await page.evaluate(()=>{
   const scene=StoryStudioBridge.scene();
   scene.actors=[{char:'person-a',x:42,y:80,pose:'stand'},
    {char:'person-b',x:46,y:81,pose:'stand'}];
   scene.voiceover='ข้อความนี้ห้ามหลุดไปข้อมูลฝึก';StoryStudioBridge.persist();
  });
  const getFeedback=async label=>{
   const event=page.waitForEvent('download',{timeout:10000});
   await panel.getByRole('button',{name:label==='keep'?
    'ตำแหน่งคู่นี้ดีแล้ว · เก็บตัวอย่าง':'แก้ตำแหน่งล่าสุดแล้ว · เก็บตัวอย่าง'}).click();
   const download=await event;
   assert.match(download.suggestedFilename(),/layout-feedback-.*\.jsonl/);
   const data=fs.readFileSync(await download.path(),'utf8').trim();
   const parsed=JSON.parse(data);
   assert.ok(!data.includes('ข้อความนี้ห้ามหลุด'));
   assert.deepEqual(Object.keys(parsed).sort(),
    ['approved','features','group','label','schema','source','task']);
   return parsed;
  };
  const approved=await getFeedback('keep');
  assert.equal(approved.label,'keep');
  await page.evaluate(()=>commit(()=>{
   StoryStudioBridge.scene().actors[1].x=65;
  }));
  // commit() may rerender the panel, so re-open ML Lab.
  const again=panel.locator('details').filter({hasText:'ML Lab'});
  if(!(await again.evaluate(el=>el.open)))await again.locator('summary').click();
  const corrected=await getFeedback('separate');
  assert.equal(corrected.label,'separate');
  assert.equal(corrected.group,approved.group,'same story must share its train/holdout group ID');
  assert.equal(corrected.features.gapX,.04,'learning features are from before human correction');
  assert.equal((await page.evaluate(()=>StoryStudioBridge.scene().actors[1].x)),65,
   'ML feedback must not modify the editor');
  assert.deepEqual(errors,[]);
  console.log('PASS: mobile browser exports explicit approved numeric feedback; no user text; stable story group');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
