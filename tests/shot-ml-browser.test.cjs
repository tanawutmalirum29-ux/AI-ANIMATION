'use strict';
// Browser acceptance: the user sees and explicitly approves shot labels.
// The studio exports only normalized numbers, never narration or video data.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),
 fs=require('node:fs'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('file://'+path.resolve(__dirname,'../index.html'),{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>{
   const state=StoryStudioBridge.get(),scene=StoryStudioBridge.scene();
   state.project.aspect='9:16';
   state.locations=[{id:'harbor-qa',set:{worldArt:'coastal-harbor'}}];
   scene.location='harbor-qa';scene.duration=6;
   scene.camera={type:'panorama',world:3.2,startX:5,endX:5,from:1,to:1};
   scene.worldEffects={marketFlood:true,safeHill:true};
   scene.voiceover='ข้อความบทส่วนตัวต้องไม่อยู่ในไฟล์ฝึก';
   StoryStudioBridge.persist();
  });
  await page.locator('#aiQuick').click();
  const panel=page.locator('#aiWorkspacePanel');
  await panel.waitFor({state:'visible'});
  const ml=panel.locator('details').filter({hasText:'Shot ML · สอน AI เลือกมุมกล้อง'});
  await ml.locator('summary').click();
  await ml.getByRole('button',{name:'มุมกล้องไม่ตรงบท · เก็บตัวอย่าง'}).click();
  await ml.getByRole('button',{name:'มุมกล้องไม่ตรงบท · เก็บตัวอย่าง'}).click();
  // Duplicate tapping must NOT double the training count.
  assert.equal(await ml.getByRole('button',{name:/ดาวน์โหลดตัวอย่าง/}).textContent(),'ดาวน์โหลดตัวอย่าง (1)');
  const downloadWait=page.waitForEvent('download',{timeout:10000});
  await ml.getByRole('button',{name:'ดาวน์โหลดตัวอย่าง (1)'}).click();
  const dl=await downloadWait;
  assert.match(dl.suggestedFilename(),/shot-framing-human-.*\.jsonl/);
  const raw=fs.readFileSync(await dl.path(),'utf8');
  const rows=raw.trim().split('\n').map(JSON.parse);
  assert.equal(rows.length,1);
  assert.equal(rows[0].task,'shot-framing');
  assert.equal(rows[0].label,'reframe');
  assert.equal(rows[0].approved,true);
  assert.equal(rows[0].source,'human');
  assert.ok(!raw.includes('ข้อความบทส่วนตัว'));
  assert.deepEqual(Object.keys(rows[0].features),[...await page.evaluate(()=>StoryShotML.FEATURES)]);
  assert.ok(!await ml.getByRole('button',{name:'ให้ ML เสนอและยืนยันมุมกล้อง'}).isEnabled(),
   'unapproved demo weights must never change the project');
  assert.deepEqual(errors,[]);
  console.log('PASS: iPhone Shot ML human labels exported as sanitized one-row JSONL, dedup and no auto edit');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
