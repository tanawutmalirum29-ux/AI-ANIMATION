/* Six-workstream producer. Read-only visual planning can overlap voice synthesis.
 * No neural model or hidden background job is implied. Stages are explicit,
 * recoverable, validated and honest about unsupported visual/story actions. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.StoryProductionOrchestrator=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const STEPS=Object.freeze([
  {id:'composition',label:'01 · องค์ประกอบ'},
  {id:'vector',label:'02 · SVG'},
  {id:'animation',label:'03 · แอนิเมชัน'},
  {id:'voice',label:'04 · พากย์'},
  {id:'timing',label:'05 · จัดเวลา'},
  {id:'qa',label:'06 · ตรวจ QA'}
 ]);
 const clone=x=>JSON.parse(JSON.stringify(x));
 async function run(ctx){
  if(!ctx?.planner?.plan||!ctx.assetCore?.asset||!ctx.bridge?.get)
   throw Error('โมดูลวางฉาก, SVG หรือ StudioBridge ไม่พร้อม');
  const step=(id,state,detail='')=>ctx.onStep?.(id,state,detail);
  const info=message=>ctx.onStatus?.(message);
  const issues=[];
  const state=clone(ctx.bridge.get());
  const baseline=ctx.planner.quality(state,ctx.visualQA,ctx.assetCore);
  for(const id of ['composition','vector','animation','voice'])step(id,'running');
  info('กำลังเตรียมองค์ประกอบ SVG แอนิเมชัน และเสียงพากย์จาก JSON เดียวกัน');
  // Parallel *planning* is safe: no two agents write to the same scene.
  // The only mutating task here is TTS; visual ops are committed afterward.
  const [planned,narrated]=await Promise.allSettled([
   Promise.resolve().then(()=>ctx.planner.plan(state,ctx.assetCore)),
   Promise.resolve().then(()=>baseline.missingAudio.length?
    ctx.bridge.narrate('all'):{ok:true,made:0,failed:0,skipped:true})
  ]);
  let plan=planned.status==='fulfilled'?planned.value:null;
  const voice=narrated.status==='fulfilled'?narrated.value:null;
  if(!plan)issues.push('วางภาพ/SVG ล้มเหลว: '+String(planned.reason?.message||planned.reason));
  if(!voice?.ok)issues.push('เสียงพากย์ไม่สำเร็จ: '+String(voice?.error||narrated.reason?.message||'ไม่พบการเชื่อมต่อ TTS'));
  if(voice?.failed)issues.push('เสียงพากย์ล้มเหลว '+voice.failed+' คลิป');
  step('voice',voice?.ok&&!voice.failed?'done':'needs_attention',
   voice?.skipped?'เสียงเดิมครบ ไม่สร้างซ้ำ':'สร้างเสียง '+(voice?.made||0)+' คลิป · ล้มเหลว '+(voice?.failed||0));
  // Finish audio-aware timing before writing scene-relative visual keyframes.
  // A 12-second jump must never be left with keys past a shortened 5s scene.
  step('timing','running');
  info('กำลังจัดเวลาให้ตรงกับเสียงจริง ก่อนสร้างคีย์เฟรมภาพ');
  let timing=null;
  const pre=ctx.planner.quality(ctx.bridge.get(),ctx.visualQA,ctx.assetCore);
  if(!pre.missingAudio.length&&voice?.ok&&!voice.failed){
   try{
    timing=await ctx.applyTiming();
    step('timing','done','ปรับ '+timing.changes+' จุด · เพิ่มตอน '+(timing.split?.created||0));
   }catch(err){
    issues.push('จัดเวลา: '+String(err.message||err));
    step('timing','failed',String(err.message||err));
   }
  }else{
   issues.push('เสียงไม่ครบ ไม่ตัดเวลาฉากเพื่อป้องกันเนื้อหาหาย');
   step('timing','needs_attention','เสียงพากย์ต้องครบก่อน');
  }
  // Rebuild visual plan against the now-final scene durations. The first
  // pure plan overlapped TTS but was never committed, preventing races.
  if(plan){
   plan=ctx.planner.plan(clone(ctx.bridge.get()),ctx.assetCore);
   const parts=[['composition',plan.layout],['vector',plan.svg],['animation',plan.motion]];
   const ops=parts.flatMap(([,p])=>p.ops);
   if(ops.length){
    info('กำลังตรวจคำสั่งภาพ/SVG '+ops.length+' จุด และสำรองข้อมูลก่อนแก้');
    if(!ctx.editor?.apply)throw Error('StudioAPI ไม่พร้อม');
    const dry=ctx.editor.apply(ops,{dryRun:true});
    if(!dry.ok)throw Error('คำสั่งภาพไม่ผ่านตรวจ: '+JSON.stringify((dry.errors||[]).slice(0,3))+
      ' '+JSON.stringify((dry.issues||[]).filter(i=>i.level==='error').slice(0,3)));
    await ctx.backup();
    const applied=ctx.editor.apply(ops);
    if(!applied.applied)throw Error('บันทึกแผนภาพไม่สำเร็จ');
   }
   for(const [id,p]of parts)
    step(id,p.skipped?.length&&!p.ops.length?'needs_attention':'done',
     'ปรับ '+p.ops.length+' ฉาก'+(p.skipped?.length?' · ข้าม '+p.skipped.length:''));
  }else for(const id of ['composition','vector','animation'])step(id,'failed','วางแผนไม่สำเร็จ');
  step('qa','running');
  const qa=ctx.planner.quality(ctx.bridge.get(),ctx.visualQA,ctx.assetCore);
  if(qa.issues.length)issues.push('องค์ประกอบ/เหตุการณ์ต้องตรวจ '+qa.issues.length+' จุด');
  if(qa.invalid.length)issues.push('SVG ไม่ผ่าน '+qa.invalid.length+' รายการ');
  if(qa.missingAudio.length)issues.push('ไม่มีเสียงพากย์ '+qa.missingAudio.length+' ฉาก');
  const report={scenes:plan?.stats.scenes||qa.inspected,
   layout:plan?.stats.layout||0,svg:plan?.stats.svg||0,
   motion:plan?.stats.motion||0,voice:voice?.made||0,
   timing:timing?.changes||0,issues:qa.issues.slice(0,30),
   invalidAssets:qa.invalid.slice(0,20),
   missingAudio:qa.missingAudio.slice(0,30),warnings:issues};
  const ok=!!plan&&!!timing&&!issues.length;
  step('qa',ok?'done':'needs_attention',
   ok?'ผ่าน QA เชิงข้อมูล · ยังต้องตรวจวิดีโอส่งออกจริง':issues.slice(0,3).join(' · '));
  info(ok?'QA เชิงข้อมูลผ่าน':'ระบบทำส่วนที่ปลอดภัยแล้ว มีจุดต้องตรวจเพิ่มเติม');
  return {ok,report,summary:
   'ตรวจ '+report.scenes+' ฉาก · จัดองค์ประกอบ '+report.layout+
   ' · SVG ใหม่ '+report.svg+' · แอนิเมชัน '+report.motion+
   ' · พากย์ใหม่ '+report.voice+' คลิป · จัดเวลา '+report.timing+' จุด'+
   (issues.length?'\nค้างตรวจ: '+issues.join(' · '):
   '\nผ่าน QA เชิงข้อมูล แต่ยังไม่ได้ตรวจวิดีโอส่งออกจริง')};
 }
 return Object.freeze({STEPS,run});
});
