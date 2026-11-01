/* Story Studio: static preflight for events that narration/imagePrompt alone cannot render.
 * This inspects authored JSON, NOT an exported video. Warnings are suggestions,
 * never proof that an animation is absent; do not silently alter the story. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.StoryVisualQA=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const EVENTS=Object.freeze([
  {id:'bridge-collapse',title:'สะพานยุบ/พัง',
   test:/สะพาน[^。.!\n]{0,35}(?:ยุบ|พัง|ถล่ม|ขาด)|(?:bridge|walkway)[^.\n]{0,40}collaps/i,
   hint:'ต้องมีสะพานเป็นวัตถุในฉาก พร้อม keyframe การพัง/ยุบ; imagePrompt อย่างเดียวไม่ทำให้สะพานขยับ'},
  {id:'falling-item',title:'สิ่งของหล่น/สูญหาย',
   test:/(?:กล่องเครื่องมือ|ประแจ|เครื่องมือ|toolbox)[^。.!\n]{0,40}(?:หลุด|ตก|หาย|จม)|(?:dropped|falling) toolbox/i,
   hint:'ต้องสร้างวัตถุที่จับถือ/หล่นจริงและระบุจังหวะการเคลื่อนไหวหรือหายไป'},
  {id:'light-switch',title:'ไฟติด/ดับระหว่างฉาก',
   test:/(?:ไฟ|โคม|ประภาคาร)[^。.!\n]{0,28}(?:ดับพรึบ|ดับลง|ติดขึ้น|สว่างขึ้น)|(?:light|beacon)[^.\n]{0,35}(?:switches on|turns off)/i,
   hint:'ใช้เอฟเฟกต์แสง/แอนิเมชันที่ผูกกับเวลา ไม่ใช่แสงคงที่ในภาพพื้นหลัง'},
  {id:'reflector-motion',title:'แผ่นสะท้อน/เครื่องกลหมุน',
   test:/(?:แผ่นสะท้อน|กระจกสะท้อน|เฟือง)[^。.!\n]{0,35}(?:หัน|หมุน|เคลื่อน|ขยับ)|(?:reflector|mirror)[^.\n]{0,35}(?:rotat|turn)/i,
   hint:'ต้องมีวัตถุเครื่องกล/เฟืองที่เคลื่อนจริงและ keyframe การหมุนหรือเปลี่ยนทิศ'},
  {id:'belt-break',title:'สายพานขาด/เปลี่ยน',
   test:/สายพาน[^。.!\n]{0,35}(?:ขาด|หลุด|เปลี่ยน|คล้อง)|(?:belt|strap)[^.\n]{0,35}(?:snap|break)/i,
   hint:'ต้องแสดงสายพานก่อน–หลังและการขาด/ติดตั้งด้วยพร็อพหรือวิดีโอจริง'},
  {id:'three-flashes',title:'สัญญาณแสงสามวาบ',
   test:/(?:หนึ่งวาบ[^。.!\n]{0,40}สองวาบ|สามวาบ|แสง[^。.!\n]{0,20}สามครั้ง|three flashes)/i,
   hint:'ต้องใช้คีย์เฟรมแสงติด–ดับ 3 จังหวะ (ไม่ใช่แค่ท่ายืนชี้หรือคำบรรยาย)'},
  {id:'flooding',title:'น้ำท่วมหรือไหลบ่า',
   test:/น้ำ[^。.!\n]{0,30}(?:ทะลัก|ท่วม|เอ่อ|ลอดเข้)|(?:flood|surge)[^.\n]{0,35}(?:street|village|market)/i,
   hint:'ต้องมีชั้นภาพ/เอฟเฟกต์น้ำที่เปลี่ยนระดับหรือเคลื่อนไหวตามเวลา'}
 ]);
 const isObject=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
 const anyMotion=list=>Array.isArray(list)&&list.some(a=>isObject(a)&&(
  (Array.isArray(a.motionKeys)&&a.motionKeys.length>=2)||
  (Array.isArray(a.keyframes)&&a.keyframes.length>=2)||
  (Array.isArray(a.route)&&a.route.length>=2)||
  (typeof a.to==='number'&&a.to>0)||
  (typeof a.end==='number'&&a.end>0)
 ));
 function coverage(scene){
  const propList=Array.isArray(scene.props)?scene.props:[],
   assets=Array.isArray(scene.customAssets)?scene.customAssets:[],
   graphics=Array.isArray(scene.graphicCards)?scene.graphicCards:[],
   actors=Array.isArray(scene.actors)?scene.actors:[],
   fx=isObject(scene.cinematicFx)?scene.cinematicFx:null;
  const visualMedia=!!(scene.video?.data||typeof scene.video==='string'&&scene.video||
   scene.image?.data||typeof scene.image==='string'&&scene.image);
  const namedProps=propList.length+assets.length;
  const timeDriven=anyMotion(propList)||anyMotion(assets)||anyMotion(graphics)||
   anyMotion(actors)||!!(fx&&(
      (Array.isArray(fx.keyframes)&&fx.keyframes.length>=2)||
      (Array.isArray(fx.keys)&&fx.keys.length>=2)||
      Number.isFinite(fx.duration)&&fx.duration>0));
  return {visualMedia:!!visualMedia,namedProps,timeDriven,actorCount:actors.length};
 }
 function inspect(state,options={}){
  const episodes=Array.isArray(state?.episodes)?state.episodes:[],issues=[],scenes=[];
  const scope=options.scope||'all',episodeIndex=Math.max(0,Number(options.episodeIndex)||0),
   sceneId=options.sceneId;
  const aspect=String(state?.project?.aspect||'16:9').split(':').map(Number);
  // Portrait rigs use a greater share of screen width; 14% separation can
  // still visibly overlap arms/torso even if old 10% threshold passed.
  const actorGap=aspect[0]>0&&aspect[1]>0&&aspect[0]<aspect[1]?18:10;
  episodes.forEach((ep,ei)=>{
   if(scope!=='all'&&ei!==episodeIndex)return;
   (ep.scenes||[]).forEach((scene,si)=>{
    if(scope==='scene'&&sceneId&&scene.id!==sceneId)return;
    const data=coverage(scene),narration=String(scene.voiceover||''),
     prompt=String(scene.imagePrompt||'');
    // Look for actions in the authored voiceover; imagePrompt may help identify
    // event intent, but never counts as an executable animation timeline.
    const text=narration+' '+prompt,sceneIssues=[];
    for(const event of EVENTS){
     if(!event.test.test(text))continue;
     const lacksAction=event.id==='falling-item'||event.id==='bridge-collapse'?
       data.namedProps===0&&!data.visualMedia:
       event.id==='three-flashes'?
       !data.timeDriven&&!data.visualMedia:
       data.namedProps===0&&!data.timeDriven&&!data.visualMedia;
     if(lacksAction)sceneIssues.push({kind:'unverified-event',event:event.id,title:event.title,
       episode:ei+1,scene:si+1,sceneId:scene.id,
       message:event.hint,source:'authored-script',confidence:'needs-visual-review'});
    }
    // Export review 2026-11-01: actors overlap visibly even when both have
    // a motion route. Their starting anchors can be cramped before the motion
    // separates them; motion alone is NOT proof the silhouette is readable.
    // Never move actors or reject intentional embraces automatically.
    const actors=Array.isArray(scene.actors)?scene.actors:[];
    for(let a=0;a<actors.length;a++)for(let b=a+1;b<actors.length;b++){
     const u=actors[a],v=actors[b];
     if(!Number.isFinite(Number(u?.x))||!Number.isFinite(Number(v?.x))||
      !Number.isFinite(Number(u?.y))||!Number.isFinite(Number(v?.y)))continue;
     if(Math.abs(Number(u.x)-Number(v.x))<actorGap&&Math.abs(Number(u.y)-Number(v.y))<8&&
      !u.depth&&!v.depth){
      const moving=anyMotion([u,v]);
      sceneIssues.push({kind:'actor-overlap',event:'actor-overlap',title:'ตัวละครอาจซ้อนทับกัน',
       episode:ei+1,scene:si+1,sceneId:scene.id,
       message:(moving?'ตัวละครเริ่มชิดกัน แม้มี motion/keyframe ก็อาจบังกันช่วงต้นฉาก; ':
        'ระยะ X ของตัวละครใกล้กันมาก; ')+
        'ตรวจภาพจริง มือ/ลำตัวทะลุกัน และการกอดที่ตั้งใจ ก่อนแก้ตำแหน่งหรือ depth',
       source:'actor-position',confidence:'needs-visual-review'});
     }
    }
    // Production-owned SVG drafts can obscure nearby actors in portrait
    // exports (oversized toolbox/reflector seen in sampled MP4 frames).
    // Position is an approximation, not a pixel-level collision test.
    // Flag for review ONLY; never resize or relocate user/manual assets.
    for(const draft of Array.isArray(scene.customAssets)?scene.customAssets:[]){
     if(draft?.producer!=='studio-production-v1'||draft.productionManualLock===true||
       !Number.isFinite(Number(draft.x))||!Number.isFinite(Number(draft.y))||
       !Number.isFinite(Number(draft.scale))||Number(draft.scale)<.7)continue;
     const nearby=actors.some(actor=>Number.isFinite(Number(actor?.x))&&
       Number.isFinite(Number(actor?.y))&&
       Math.abs(Number(draft.x)-Number(actor.x))<(actorGap+8)&&
       Math.abs(Number(draft.y)-Number(actor.y))<30);
     if(nearby)sceneIssues.push({kind:'draft-asset-clearance',event:'draft-asset-clearance',
      title:'วัตถุร่าง SVG อาจบังตัวละคร',episode:ei+1,scene:si+1,sceneId:scene.id,
      message:'ตรวจขนาด/เลเยอร์/ตำแหน่งของ '+String(draft.eventKind||'วัตถุ')+
       ' กับตัวละครจากเฟรมส่งออกจริง; อย่าแก้ฉากอัตโนมัติจากระยะโดยประมาณ',
      source:'generated-asset-position',confidence:'needs-visual-review'});
    }
    scenes.push({episode:ei+1,scene:si+1,sceneId:scene.id,coverage:data,issues:sceneIssues.length});
    issues.push(...sceneIssues);
   });
  });
  return {inspected:scenes.length,issues,scenes,byKind:{
   unverifiedEvents:issues.filter(i=>i.kind==='unverified-event').length,
   actorOverlap:issues.filter(i=>i.kind==='actor-overlap').length,
   draftAssetClearance:issues.filter(i=>i.kind==='draft-asset-clearance').length
  },limits:'Static JSON preflight; sampled/exported frames must still be reviewed. No automatic visual changes.'};
 }
 return Object.freeze({inspect,coverage,EVENTS});
});
