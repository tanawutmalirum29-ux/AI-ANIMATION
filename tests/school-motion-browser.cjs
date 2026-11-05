'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {encodeMP4}=require('../cloud-export/transcode.cjs'),QA=require('../cloud-export/render-qa.cjs');
const root=path.resolve('.'),out=process.env.SCHOOL_OUTPUT_DIR||'/tmp/school-motion-evidence';fs.mkdirSync(out,{recursive:true});
const fixture=require('../examples/taweetha-zombie-siege.json');
const narrated=process.env.SCHOOL_NARRATED_PROJECT?JSON.parse(fs.readFileSync(process.env.SCHOOL_NARRATED_PROJECT,'utf8')):null;
const server=http.createServer((req,res)=>{const file=path.resolve(root,decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1)||'index.html');if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.json')?'application/json':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(fs.readFileSync(file));});
(async()=>{
 await new Promise(done=>server.listen(0,'127.0.0.1',done));const browser=await chromium.launch({args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/?workspace=editor');
  await page.evaluate(data=>{S=normalize(data);fix();selEp=0;sel=7;T=starts()[7]+3;render();switchStudioTool('motion');},fixture);
  const report=await page.evaluate(()=>{
   const results={moving:[],grips:[],contacts:[],retimed:[],sparse:false};
   for(const aspect of ['9:16','16:9']){
    S.project.aspect=aspect;const W=aspect==='9:16'?50.625:160;
    for(const s of ep().scenes){
     if(StoryMotion.audit(s).length)throw Error('Unresolved motion warnings '+s.id);
     for(const actor of s.actors){
      const at=t=>actorAtTime(actor,s,t,s.duration),a=at(s.duration-.8),b=at(s.duration-.05),ch=S.characters.find(c=>c.id===actor.char);
      if(!actor.intentionalHold&&actor.gait==='distance'){
       if(Math.hypot(a.x-b.x,a.y-b.y)<.1)throw Error('Stops before cut '+s.id+' '+actor.char);
       if(!['run','walk'].includes(b.pose))throw Error('Unexpected standing pose '+s.id);
       if(Math.abs(actorPlacement(ch,b,W).x-b.x*W/100)>.001)throw Error('Frame clamp stopped actor');
       results.moving.push(aspect+' '+s.id+' '+actor.char);
      }
      if(actor.handTarget){
       const t=1.4,frame=at(t),points=rigKeys(ch,frame,frame._phaseTime),target=frame.cinematicReach;
       const error=target?Math.hypot(points[4][0]-target.x,points[4][1]-target.y):Infinity;
       if(error>.12)throw Error('Hand misses contact '+aspect+' '+s.id+' '+actor.char+' by '+error);
       results.contacts.push({aspect,scene:s.id,actor:actor.char,error});
      }
     }
     for(const hold of s.interactionInitialHold||[]){
      const actor=s.actors.find(a=>a.char===hold.actor),ch=S.characters.find(c=>c.id===actor.char);
      for(const t of [0,1.3,s.duration-.05]){const a=actorAtTime(actor,s,t,s.duration),points=rigKeys(ch,a,a._phaseTime),wrist=points[hold.hand==='left'?7:4],svg=STUDIO_INTERACTION_HELD_SVG(ch,a,s,t);if(t<(s.props[hold.propIndex].appearAt||0))continue;const parsed=new DOMParser().parseFromString('<svg>'+svg+'</svg>','image/svg+xml'),prop=parsed.querySelector('[data-held-prop="'+hold.propIndex+'"]');if(!prop)throw Error('Missing held prop '+s.id);if(Math.hypot(+prop.getAttribute('data-grip-x')-wrist[0],+prop.getAttribute('data-grip-y')-wrist[1])>.02)throw Error('Grip drift '+s.id);}
      results.grips.push({aspect,scene:s.id,actor:actor.char,kind:s.props[hold.propIndex].kind});
     }
     const longer={...s,duration:s.duration*1.7};
     for(const actor of s.actors){const a=actorAtTime(actor,s,s.duration*.6,s.duration),b=actorAtTime(actor,longer,longer.duration*.6,longer.duration);for(const field of ['x','y','_phaseTime'])if(Math.abs(a[field]-b[field])>.0001)throw Error('Retiming mismatch '+s.id+' '+field);}
     const set=locSet(S,s.location);if(StorySchoolWorld.render(set,'back',W,s.duration*.6,s)!==StorySchoolWorld.render(set,'back',W,longer.duration*.6,longer))throw Error('Door retiming mismatch');
     if(StoryAssetCore.sceneMarkup(s,'back',W,s.duration*.6)!==StoryAssetCore.sceneMarkup(longer,'back',W,longer.duration*.6))throw Error('Asset retiming mismatch');
     results.retimed.push(aspect+' '+s.id);
    }
   }
   const source={char:'nont',pose:'run',endPose:'stand',x:10,y:88,toX:90,toY:88};const a=actorAtTime(source,{duration:5,actors:[source]},4,5);if(a._posePr!==0)throw Error('Run fades into stand too early');
   const keyed={...source,motionKeys:[{t:0,x:10,y:88},{t:2,x:50},{t:4,bodyYaw:40}]};if(actorAtTime(keyed,{duration:5},3,5).x!==50)throw Error('Sparse key resets x');results.sparse=true;
   S.project.aspect='9:16';return results;
  });
  fs.writeFileSync(path.join(out,'motion-report.json'),JSON.stringify(report,null,2));console.log('PASS',report.moving.length,'moving paths;',report.grips.length,'held props;',report.contacts.length,'hand contacts;',report.retimed.length,'retimed scenes');
  for(const [w,h]of [[320,740],[390,844],[768,1024],[1440,1000],[1920,1080]]){await page.setViewportSize({width:w,height:h});await page.evaluate(()=>{fit();StoryMotionStudio.open();});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'responsive at '+w);await page.screenshot({path:path.join(out,'ui-'+w+'.png')});}
  await page.setViewportSize({width:1440,height:1000});
  const old=JSON.parse(JSON.stringify(fixture));for(const s of old.episodes[0].scenes)delete s.choreography;old.episodes[0].scenes[0].audioClips=[{id:'keep',data:'data:audio/wav;base64,AA==',kind:'voice',duration:2,at:0}];
  await page.evaluate(data=>{S=normalize(data);fix();sel=0;selEp=0;T=0;render();StoryMotionStudio.open();},old);
  const before=await page.evaluate(()=>JSON.stringify(S));
  const compareUndo=async()=>{const after=await page.evaluate(()=>JSON.stringify(S));if(after!==before){fs.writeFileSync(path.join(out,'undo-before.json'),before);fs.writeFileSync(path.join(out,'undo-after.json'),after);throw Error('Undo mismatch; snapshots saved');}};
  await page.getByText('แก้งานซอมบี้โรงเรียนเดิม / เปิดบทปรับปรุง',{exact:true}).click();await page.getByRole('button',{name:'ตรวจแผนปรับภาพงานเดิม',exact:true}).click();
  const apply=page.getByRole('button',{name:'ใช้การปรับภาพที่ตรวจแล้ว',exact:true});await apply.waitFor({state:'visible'});assert.equal(await page.evaluate(()=>JSON.stringify(S)),before,'review must not mutate');await apply.click();
  assert.equal(await page.evaluate(()=>sc().audioClips[0].data),'data:audio/wav;base64,AA==');assert.equal(await page.evaluate(()=>sc().choreography.revision),3);
  await page.evaluate(()=>undo());await compareUndo();
  const episodes=await page.evaluate(()=>S.episodes.length);await page.getByRole('button',{name:'เพิ่มตอนบทปรับปรุง',exact:true}).click();assert.equal(await page.evaluate(()=>S.episodes.length),episodes+1);assert.ok(await page.evaluate(()=>sc().actors.every(a=>S.characters.some(c=>c.id===a.char))));await page.evaluate(()=>undo());await compareUndo();
  console.log('PASS repair preview, audio preservation, append, Undo and 320–1920px layouts');
  await page.evaluate(data=>{S=normalize(data);fix();selEp=0;sel=0;T=0;render();},fixture);
  for(let index=0;index<12;index++){
   const png=await page.evaluate(async index=>{const s=ep().scenes[index],canvas=document.createElement('canvas');canvas.width=360;canvas.height=640;await renderVideoFrame(canvas.getContext('2d'),starts()[index]+s.duration*.65,{w:360,h:640,previous:new Map(),captions:true});return canvas.toDataURL().split(',')[1];},index);
   fs.writeFileSync(path.join(out,'scene-'+String(index+1).padStart(2,'0')+'.png'),Buffer.from(png,'base64'));
  }
  if(process.env.SCHOOL_RENDER_VIDEO==='1'){
   // CI renders a deliberately silent visual proof. A supplied narrated fixture uses real speech.
   if(narrated)await page.evaluate(data=>{S=normalize(data);fix();selEp=0;sel=0;T=0;render();},narrated);
   else await page.evaluate(()=>{ep().scenes.forEach(s=>{s.voiceover='';});});
   const result=await page.evaluate(async()=>{
    openVideoExport();document.querySelector('#videoResolution').value='540';document.querySelector('#videoFPS').value='30';document.querySelector('#videoFormat').value='fastmp4';document.querySelector('#videoPipeline').value='turbo';const original=window.dlBlob;window.dlBlob=()=>{};
    try{await startVideoExport();}finally{window.dlBlob=original;}
    if(!LAST_VIDEO||!EXPORT_JOB_OUTCOME)throw Error(document.querySelector('#videoStatus').textContent);
    const bytes=new Uint8Array(await LAST_VIDEO.blob.arrayBuffer());let encoded='';for(let i=0;i<bytes.length;i+=16384)encoded+=String.fromCharCode(...bytes.subarray(i,i+16384));return {data:btoa(encoded),name:LAST_VIDEO.filename};
   });
   const source=path.join(out,'school.browser.'+result.name.split('.').pop()),video=path.join(out,narrated?'school-revision-3-narrated.mp4':'school-revision-3-silent.mp4');fs.writeFileSync(source,Buffer.from(result.data,'base64'));
   encodeMP4(source,video,{expectedFps:30,expectedDuration:62,expectedAudio:!!narrated,timeout:120000});const qa=QA.inspect(video,{expectedFps:30,expectedAspect:9/16,expectedDuration:62,expectedAudio:!!narrated,scenes:fixture.episodes[0].scenes});assert.deepEqual(qa.issues.filter(i=>i.severity==='error'),[]);fs.writeFileSync(video+'.qa.json',JSON.stringify(qa,null,2));console.log('PASS actual browser export',qa.width,qa.height,qa.fps,qa.duration);
  }
  assert.deepEqual(errors,[]);console.log('PASS school browser regression');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
