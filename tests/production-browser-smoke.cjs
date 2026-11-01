'use strict';
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true});
  const errors=[];page.on('pageerror',x=>errors.push(x.message));
  page.on('dialog',x=>x.accept());
  await page.goto('file://'+path.resolve(__dirname,'../index.html'),{waitUntil:'domcontentloaded'});
  await page.locator('#aiQuick').click();
  assert.equal(await page.getByRole('heading',{name:'AI Production · 6 ผู้ช่วย'}).count(),1);
  const setup=await page.evaluate(()=>{
   const s=StoryStudioBridge.get().episodes[0].scenes[0];
   s.duration=9;s.voiceover='หนึ่งวาบ สองวาบ สามวาบ ลำแสงสัญญาณส่องผ่านฝน';
   s.subtitle=['หนึ่งวาบ สองวาบ สามวาบ'];
   s.subtitleCues=[];s.customAssets=[];s.actors=[];s.props=[];s.image=null;s.video=null;
   StoryStudioBridge.persist();
   window.__dubCalls=0;
   StoryStudioBridge.narrate=async scope=>{
    window.__dubCalls++;
    if(scope!=='all')throw Error('Expected all');
    const scene=StoryStudioBridge.get().episodes[0].scenes[0];
    scene.audioClips=[{id:'test-voice',kind:'voice',at:0,duration:3,
      rate:1,data:'data:audio/wav;base64,AAAA',autoDub:true,cueId:'narration-'+scene.id+'-part1'}];
    StoryStudioBridge.persist();
    return {ok:true,made:1,failed:0};
   };
   return {id:s.id,voice:s.voiceover};
  });
  const run=async()=>{
   await page.getByRole('button',{name:'เริ่มผลิตด้วย 6 ผู้ช่วย · ปุ่มเดียว'}).click();
   await page.waitForFunction(()=>{
    const tasks=StoryStudioBridge.get().project.aiWorkspace?.tasks||[];
    return tasks.some(t=>t.role==='production'&&['done','failed'].includes(t.status));
   },{timeout:90000});
   return page.evaluate(()=>{
    const st=StoryStudioBridge.get(),s=st.episodes[0].scenes[0];
    const job=st.project.aiWorkspace.tasks.filter(t=>t.role==='production').at(-1);
    return {status:job.status,steps:job.steps.map(x=>({id:x.id,status:x.status})),
      assets:s.customAssets?.map(x=>x.eventKind),voice:s.voiceover,
      audio:s.audioClips?.length,dubCalls:window.__dubCalls,
      output:job.response,seconds:s.duration};
   });
  };
  const first=await run();
  assert.equal(first.status,'done',JSON.stringify(first));
  assert.deepEqual(first.steps.map(x=>x.id),['composition','assets','motion','voice','timing','qa']);
  assert.equal(first.steps.length,6);
  assert.ok(first.assets.includes('beacon'),'light signal must exist in stage output');
  assert.equal(first.voice,setup.voice,'original narration unchanged');
  assert.equal(first.audio,1,'recorded voice preserved');
  assert.equal(first.dubCalls,1);
  assert.ok(!first.steps.some(x=>x.status==='failed'),JSON.stringify(first.steps));
  const second=await run();
  assert.equal(second.status,'done');
  assert.equal(second.assets.filter(x=>x==='beacon').length,1,'idempotent asset generation');
  assert.equal(second.dubCalls,1,'second run must not synthesize voice that already exists');
  assert.deepEqual(errors,[],'no uncaught page JS errors');
  console.log('PASS: six-stage one button, voice before timing, persistent tasks, re-run safe, mobile viewport');
 }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exit(1)});
