'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');const QA=require('../cloud-export/render-qa.cjs');
const output=process.env.CINEMATIC_OUTPUT_DIR||path.join(os.tmpdir(),'story-cinematic-qa');fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('file://'+path.resolve('index.html')+'?workspace=editor');
  await page.getByRole('button',{name:'กำกับภาพ',exact:true}).click();
  await page.locator('#cinematicStudio').waitFor({state:'visible'});
  await page.selectOption('#cineTemplate','book');await page.getByRole('button',{name:'สร้างแผนตัวอย่าง',exact:true}).click();
  const initial=await page.evaluate(()=>ep().scenes.length);
  await page.getByRole('button',{name:'เพิ่มเป็นฉากใหม่',exact:true}).click();assert.equal(await page.evaluate(()=>ep().scenes.length),initial,'review is required');
  await page.check('#cineApproved');await page.getByRole('button',{name:'เพิ่มเป็นฉากใหม่',exact:true}).click();assert.equal(await page.evaluate(()=>ep().scenes.length),initial+1);
  await page.evaluate(()=>undo());assert.equal(await page.evaluate(()=>ep().scenes.length),initial,'append is undoable');
  for(const [w,h] of [[320,740],[390,844],[768,1024],[1440,1000]]){await page.setViewportSize({width:w,height:h});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow at '+w);}
  await page.setViewportSize({width:1440,height:1000});
  for(const name of ['street','book','run','forest','school']){
   const fixture=JSON.parse(fs.readFileSync('examples/cinematic/'+name+'.json'));
   await page.evaluate(fixture=>{S=normalize(fixture);fix();selEp=0;sel=0;T=0;render();},fixture);
   const report=await page.evaluate(async()=>{
    const plan=sc().cinematicPlan,C=StoryCinematic;
    const bad=C.qa(plan,9/16,StoryCinematicStudio.figure).filter(i=>i.severity==='error');
    const frames=[];for(const t of [0,3.99,4,6,9.99,10,11.9]){
     const canvas=document.createElement('canvas');canvas.width=360;canvas.height=640;
     await renderVideoFrame(canvas.getContext('2d'),t,{w:360,h:640,previous:new Map(),captions:true});frames.push({t,png:canvas.toDataURL().split(',')[1]});
    }
    T=6;draw();const first=document.querySelector('#set').innerHTML;T=9;draw();T=6;draw();const replay=first===document.querySelector('#set').innerHTML;
    const box=document.querySelector('#stage').getBoundingClientRect();const before=C.evaluate(plan,6,9/16,StoryCinematicStudio.figure);
    if(plan.source.template==='book'){
     for(const t of [4,6,9.999]){const f=C.evaluate(plan,t,9/16,StoryCinematicStudio.figure),o=f.objects.find(o=>o.id==='book');if(Math.hypot(o.x-f.actors[0].hand.x,o.y-f.actors[0].hand.y)>.001)throw Error('held prop drift');}
     const left=C.evaluate(plan,9.999,9/16,StoryCinematicStudio.figure).objects.find(o=>o.id==='book'),right=C.evaluate(plan,10,9/16,StoryCinematicStudio.figure).objects.find(o=>o.id==='book');if(Math.hypot(left.x-right.x,left.y-right.y)>1)throw Error('prop pops at release');
    }
    return {bad,replay,frames,aspect:box.width/box.height,sourceUnchanged:JSON.stringify(plan)===JSON.stringify(sc().cinematicPlan)};
   });
   assert.deepEqual(report.bad,[],name+' plan QA');assert.ok(report.replay&&report.sourceUnchanged);assert.ok(Math.abs(report.aspect-9/16)<.01);
   for(const f of report.frames)fs.writeFileSync(path.join(output,name+'-'+f.t+'.png'),Buffer.from(f.png,'base64'));
   // Real existing browser encoder at 30fps. A test tone checks the audio path, not TTS.
   const result=await page.evaluate(async()=>{
    const rate=16000,duration=sc().duration,len=rate*duration,b=new ArrayBuffer(44+len*2),v=new DataView(b),str=(at,s)=>{for(let i=0;i<s.length;i++)v.setUint8(at+i,s.charCodeAt(i));};
    str(0,'RIFF');v.setUint32(4,36+len*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,len*2,true);
    for(let i=0;i<len;i++)v.setInt16(44+i*2,Math.sin(i/rate*440*Math.PI*2)*2500,true);
    const bytes=new Uint8Array(b);let data='';for(let i=0;i<bytes.length;i+=16384)data+=String.fromCharCode(...bytes.subarray(i,i+16384));
    sc().audioClips=[{id:'cine-audio-test',kind:'voice',name:'QA tone (not speech)',data:'data:audio/wav;base64,'+btoa(data),duration,at:0,volume:1,rate:1,trimStart:0,trimEnd:0,fadeIn:0,fadeOut:0}];sc().voiceover='เสียงทดสอบ ไม่ใช่เสียงพากย์';sc().subtitle=['ทดสอบฉาก Cinematic'];save();
    openVideoExport();document.querySelector('#videoResolution').value='540';document.querySelector('#videoFPS').value='30';document.querySelector('#videoFormat').value='fastmp4';document.querySelector('#videoPipeline').value='turbo';const original=window.dlBlob;window.dlBlob=()=>{};
    try{await startVideoExport();}finally{window.dlBlob=original;}
    if(!LAST_VIDEO||!EXPORT_JOB_OUTCOME)throw Error(document.querySelector('#videoStatus').textContent);
    const out=new Uint8Array(await LAST_VIDEO.blob.arrayBuffer());let encoded='';for(let i=0;i<out.length;i+=16384)encoded+=String.fromCharCode(...out.subarray(i,i+16384));return {bytes:btoa(encoded),name:LAST_VIDEO.filename};
   });
   const file=path.join(output,name+'.mp4'),source=path.join(output,name+'.browser.'+result.name.split('.').pop());fs.writeFileSync(source,Buffer.from(result.bytes,'base64'));
   execFileSync('ffmpeg',['-v','error','-y','-i',source,'-map','0:v:0','-map','0:a:0','-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-r','30','-c:a','aac','-af','apad','-shortest','-movflags','+faststart',file],{timeout:120000});
   const qa=QA.inspect(file,{expectedAudio:true,expectedFps:30,expectedAspect:9/16,scenes:fixture.episodes[0].scenes});fs.writeFileSync(file+'.qa.json',JSON.stringify(qa,null,2));assert.deepEqual(qa.issues.filter(i=>i.severity==='error'),[],name+' output QA');assert.ok(Math.abs(qa.duration-12)<.3);console.log('PASS rendered',name,qa.width+'x'+qa.height,qa.fps+'fps',qa.duration+'s',qa.audio.maxVolumeDB+'dB');
  }
  // Analysis of a real decoded clip and cancellation. No semantic data fabricated.
  await page.evaluate(()=>StoryCinematicStudio.open());
  await page.locator('input[aria-label="วิดีโออ้างอิง"]').setInputFiles(path.join(output,'run.mp4'));
  await page.waitForFunction(()=>document.querySelector('#cinematicStudio pre')?.textContent.includes('รอตรวจรายละเอียดภาพ'),{timeout:30000});
  const semantic=await page.evaluate(async()=>{const res=StoryVideoReference.blueprint([{time:0,delta:0},{time:1,delta:.8}],3);return res.shots.every(s=>s.actions===null&&s.camera===null);});assert.ok(semantic);
  assert.deepEqual(errors,[]);console.log('PASS reviewed apply/undo, responsive UI, attachment continuity, replay, reference analysis');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
