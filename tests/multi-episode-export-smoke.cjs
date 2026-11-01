'use strict';
// Regression: batch export does not mutate authoring data, ZIP is structurally
// valid, chapter separators are rendered, and each audio cue ends at its chapter.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const errors=[];
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true});
  page.on('pageerror',e=>errors.push(e.stack||e.message));
  await page.goto('file://'+path.resolve(__dirname,'../index.html'),{waitUntil:'domcontentloaded'});
  await page.locator('#studioToolNav [data-tool="export"]').click();
  const report=await page.evaluate(async()=>{
   const first=newEp(1),second=newEp(2);
   first.title='เหนือทะเล';first.scenes=[newScene(),newScene()];
   first.scenes[0].duration=3;first.scenes[1].duration=4;
   second.title='บทสรุป';second.scenes[0].duration=5;
   first.scenes[0].audioClips=[{id:'voice-test',kind:'voice',data:'data:audio/wav;base64,AA==',duration:12,at:0,rate:1,volume:1,trimStart:0,trimEnd:0}];
   first.musicClips=[{id:'music-test',kind:'music',data:'data:audio/wav;base64,AA==',duration:2,at:0,rate:1,volume:1,loop:true,trimStart:0,trimEnd:0}];
   second.musicClips=[{id:'music-next',kind:'music',data:'data:audio/wav;base64,AA==',duration:2,at:0,rate:1,volume:1,loop:true,trimStart:0,trimEnd:0}];
   S.project.title='สามแสงก่อนรุ่งสาง';
   const thaiPrefix=exportFilePrefix();
   S.episodes=[first,second];selEp=0;sel=1;T=1.2;
   const original=S.episodes,originalJSON=JSON.stringify(S),combined=buildExportCompilation(original);
   const divider=combined.scenes.find(c=>c.__exportChapterSeparator);
   const chapterTime=7+EXPORT_SEPARATOR_SECONDS;
   const compiledEvents=(()=>{S.episodes=[...original,combined];selEp=2;const events=audioEvents();S.episodes=original;selEp=0;return events})();
   const noBleed=compiledEvents.filter(e=>e.c.id==='compile-0-0-0'||e.c.id==='compile-music-0-0').every(e=>e.limit<=7);
   const nextMusic=compiledEvents.filter(e=>e.c.id==='compile-music-1-0').every(e=>e.start>=chapterTime&&e.limit<=chapterTime+5);
   const canvas=document.createElement('canvas');canvas.width=360;canvas.height=640;
   const ctx=canvas.getContext('2d');drawExportChapterSeparator(ctx,divider.__exportChapterSeparator,1,360,640);
   const card=Array.from(ctx.getImageData(0,0,1,1).data);
   window.__batchCalls=[];
   window.dlBlob=(name,blob)=>{window.__batchDownloads??=[];window.__batchDownloads.push(name)};
   window.exportOneEpisode=async()=>{
    const current=ep(),id=selEp;
    window.__batchCalls.push({id,scenes:current.scenes.length,separator:current.scenes.filter(s=>!!s.__exportChapterSeparator).length});
    showExportResult(new Blob([new Uint8Array(1024).fill(id+1)],{type:'video/mp4'}),exportFilePrefix()+'-'+(id+1)+'.mp4');
    EXPORT_JOB_OUTCOME=true;
   };
   document.querySelector('#videoScope').value='separate';
   await startVideoExport();
   const zip=EXPORT_BATCH_ZIP?.blob;const z=zip?new Uint8Array(await zip.arrayBuffer()):null;
   const view=z?new DataView(z.buffer):null;
   let offset=0;const files=[];
   for(let i=0;i<2&&view;i++){
    const signature=view.getUint32(offset,true),size=view.getUint32(offset+18,true),nameLen=view.getUint16(offset+26,true);
    const fileName=new TextDecoder().decode(z.subarray(offset+30,offset+30+nameLen));
    files.push({signature,size,fileName,payload:z[offset+30+nameLen]});
    offset+=30+nameLen+size;
   }
   const ending=view?.getUint32(z.length-22,true),count=view?.getUint16(z.length-12,true);
   const separate={calls:window.__batchCalls.slice(),results:EXPORT_BATCH_FILES.length,files,ending,count,
    zipFilename:EXPORT_BATCH_ZIP?.name,thaiPrefix,
    zipButton:!!document.querySelector('#videoBatchResults .batch-download'),restored:S.episodes===original&&selEp===0&&sel===1,
    untouched:JSON.stringify(S)===originalJSON,downloads:window.__batchDownloads||[]};
   window.__batchCalls=[];
   document.querySelector('#videoScope').value='combined';
   await startVideoExport();
   const merged={calls:window.__batchCalls.slice(),download:LAST_VIDEO?.filename,
    restored:S.episodes===original&&selEp===0&&sel===1,untouched:JSON.stringify(S)===originalJSON,
    combinedLength:combined.scenes.reduce((n,s)=>n+s.duration,0),
    divider:divider.__exportChapterSeparator,dividerDuration:divider.duration,hasCard:card[3]===255,
    noBleed,nextMusic};
   return {separate,merged};
  });
  assert.equal(report.separate.calls.length,2);
  assert.deepEqual(report.separate.calls.map(c=>c.id),[0,1]);
  assert.equal(report.separate.results,2);
  assert.equal(report.separate.thaiPrefix,'สามแสงก่อนรุ่งสาง');
  assert.equal(report.separate.zipFilename,'สามแสงก่อนรุ่งสาง-ทุกตอน.zip');
  assert.equal(report.separate.count,2);
  assert.equal(report.separate.ending,0x06054b50);
  assert.ok(report.separate.files.every(f=>f.signature===0x04034b50&&f.size===1024));
  assert.equal(report.separate.files[0].payload,1);
  assert.equal(report.separate.files[1].payload,2);
  assert.deepEqual(report.separate.files.map(f=>f.fileName),[
   'สามแสงก่อนรุ่งสาง-1.mp4','สามแสงก่อนรุ่งสาง-2.mp4']);
  assert.equal(report.separate.zipButton,true);
  assert.equal(report.separate.restored,true);
  assert.equal(report.separate.untouched,true);
  assert.equal(report.merged.calls.length,1);
  assert.equal(report.merged.calls[0].scenes,4);
  assert.equal(report.merged.calls[0].separator,1);
  assert.equal(report.merged.download,'สามแสงก่อนรุ่งสาง-รวมทุกตอน.mp4');
  assert.equal(report.merged.divider.number,2);
  assert.equal(report.merged.divider.title,'บทสรุป');
  assert.equal(report.merged.dividerDuration,2.5);
  assert.equal(report.merged.combinedLength,14.5);
  assert.ok(report.merged.hasCard&&report.merged.noBleed&&report.merged.nextMusic);
  assert.ok(report.merged.restored&&report.merged.untouched);
  assert.deepEqual(errors,[]);
  console.log('PASS one-click export: ZIP files, chapter card, audio boundaries, no project mutation',JSON.stringify(report));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});