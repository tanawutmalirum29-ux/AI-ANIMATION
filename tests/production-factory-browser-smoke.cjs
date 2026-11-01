'use strict';
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true});
  page.on('dialog',d=>d.accept());
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('file://'+path.resolve(__dirname,'../index.html'),{waitUntil:'domcontentloaded'});
  await page.locator('#aiQuick').click();
  const panel=page.locator('#aiWorkspacePanel');
  await panel.waitFor({state:'visible'});
  assert.equal(await panel.getByRole('heading',{name:'AI Production · 6 ผู้ช่วย'}).count(),1);
  assert.equal(await panel.locator('.ai-factory-step').count(),6);
  await page.evaluate(()=>{
   const s=StoryStudioBridge.get().episodes[0].scenes[0];
   s.duration=12;
   s.voiceover='สะพานไม้ผุยุบตัวต่อหน้า กล่องเครื่องมือหลุดมือและตกลงน้ำ';
   s.imagePrompt='';
   s.image=null;s.video=null;s.art='';
   s.actors=[{char:'nil',x:18,y:90,toX:54,pose:'jump'},
    {char:'ta_in',x:12,y:90,pose:'stand'}];
   s.customAssets=[];s.props=[];s.notes='';s.interactions=[];
   s.subtitleCues=[];s.subtitle=[];
   s.audioClips=[{id:'already-dubbed',kind:'voice',
     data:'data:audio/wav;base64,AAAA',at:0,duration:5,rate:1,
     trimStart:0,trimEnd:0,autoDub:true}];
   window.__voiceCalls=[];
   StoryStudioBridge.narrate=async scope=>{window.__voiceCalls.push(scope);
    return {ok:true,made:0,failed:0}};
   StoryStudioBridge.persist();
  });
  await panel.getByRole('button',{name:'เริ่มผลิตทั้งโปรเจกต์ · 6 ผู้ช่วย'}).click();
  await page.waitForFunction(()=>{
   const tasks=StoryStudioBridge.get()?.project?.aiWorkspace?.tasks||[];
   return tasks.some(x=>x.role==='factory'&&['done','needs_attention','failed'].includes(x.status));
  },{timeout:30000});
  const result=await page.evaluate(()=>{
   const s=StoryStudioBridge.get().episodes[0].scenes[0];
   const job=StoryStudioBridge.get().project.aiWorkspace.tasks.filter(t=>t.role==='factory').at(-1);
   return {jobStatus:job.status,steps:job.steps.map(x=>[x.id,x.state]),
    stage:StoryStudioBridge.get().project.aiWorkspace.production?.stage,
    assets:(s.customAssets||[]).map(x=>x.autoDirectorTag),
    motion:(s.actors||[]).find(x=>x.char==='nil')?.motionKeys?.length,
    x:s.actors.map(x=>x.x),voices:s.audioClips.length,
    voiceCalls:window.__voiceCalls,
    duration:s.duration,voiceover:s.voiceover};
  });
  assert.equal(result.jobStatus,'done',JSON.stringify(result));
  assert.equal(result.assets.length,2,'bridge/toolbox vectors added');
  assert.ok(result.motion>=4,'animated jump authored with true keyframes');
  assert.ok(Math.abs(result.x[0]-result.x[1])>=11);
  assert.equal(result.voices,1,'no duplicate dub');
  assert.deepEqual(result.voiceCalls,[]);
  assert.ok(result.duration>=5,'does not clip audio');
  assert.ok(result.steps.every(x=>x[1]==='done'),JSON.stringify(result.steps));
  const before=result.assets.length;
  await panel.getByRole('button',{name:'เริ่มผลิตทั้งโปรเจกต์ · 6 ผู้ช่วย'}).click();
  await page.waitForFunction(()=>StoryStudioBridge.get()?.project?.aiWorkspace?.tasks?.filter(x=>x.role==='factory').length>=2&&
    StoryStudioBridge.get()?.project?.aiWorkspace?.tasks?.filter(x=>x.role==='factory').at(-1).status!=='running');
  const count=await page.evaluate(()=>StoryStudioBridge.get().episodes[0].scenes[0].customAssets.length);
  assert.equal(count,before,'one click retry is idempotent');
  assert.deepEqual(errors,[],'no runtime crashes');
  console.log('PASS: mobile one-click six-stage factory, safe SVG animation, voice reuse and retry');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
