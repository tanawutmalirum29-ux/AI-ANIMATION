/* Story Studio six-specialist production planner.
 * Deterministic, offline-capable experts with explicit handoffs (NOT neural AI).
 * All plans are immutable, additive and validated by StudioAPI before applying.
 * SVG assets are bounded shape data, never arbitrary executable SVG/HTML.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.StoryProductionPlanner=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const clone=x=>JSON.parse(JSON.stringify(x));
 const clamp=(v,lo,hi,def)=>Math.min(hi,Math.max(lo,Number.isFinite(+v)?+v:def));
 const round=v=>Math.round(v*100)/100;
 const colour=(c,stroke)=>({fill:c,stroke:stroke||'none',strokeWidth:1,opacity:1});
 const rect=(x,y,w,h,c,rx=0)=>({type:'rect',x,y,w,h,rx,...colour(c)});
 const circle=(cx,cy,r,c)=>({type:'circle',cx,cy,r,...colour(c)});
 const ellipse=(cx,cy,rx,ry,c)=>({type:'ellipse',cx,cy,rx,ry,...colour(c)});
 const line=(x1,y1,x2,y2,c,w=2)=>({type:'line',x1,y1,x2,y2,...colour('none',c),strokeWidth:w});
 const polygon=(points,c)=>({type:'polygon',points,...colour(c)});
 const spec=Object.freeze([
  {tag:'bridge',test:/สะพาน[^。.!\\n]{0,35}(?:ยุบ|พัง|ถล่ม|ขาด)|(?:bridge|walkway)[^.\\n]{0,40}collaps/i,build:bridge},
  {tag:'toolbox',test:/(?:กล่องเครื่องมือ|toolbox)[^。.!\\n]{0,40}(?:หลุด|ตก|หาย|จม)|(?:dropped|falling) toolbox/i,build:toolbox},
  {tag:'reflector',test:/(?:แผ่นสะท้อน|กระจกสะท้อน)[^。.!\\n]{0,35}(?:หัน|หมุน|เคลื่อน|ขยับ)|(?:reflector|mirror)[^.\\n]{0,35}(?:rotat|turn)/i,build:reflector},
  {tag:'belt',test:/(?:สายพาน)[^。.!\\n]{0,35}(?:ขาด|หลุด|เปลี่ยน)|(?:belt|strap)[^.\\n]{0,35}(?:snap|break)/i,build:belt},
  {tag:'beacon',test:/(?:หนึ่งวาบ[^。.!\\n]{0,40}สองวาบ|สามวาบ|แสง[^。.!\\n]{0,20}สามครั้ง|three flashes)/i,build:beacon},
  {tag:'flood',test:/น้ำ[^。.!\\n]{0,30}(?:ทะลัก|ท่วม|เอ่อ|ลอดเข้)|(?:flood|surge)[^.\\n]{0,35}(?:street|village|market)/i,build:flood}
 ]);
 const key=(t,p)=>({t:round(t),...p});
 function baseAsset(tag,shapes,name,category='prop'){
  return {version:1,id:'director-'+tag+'-v1',name,description:'Generated vector storyboard prop; editable in asset library',category,shapes};
 }
 function placement(tag,shapes,name,layer,x,y,scale,keys,category){
  return {autoDirectorTag:'studio-auto-'+tag+'-v1',
   asset:baseAsset(tag,shapes,name,category),x,y,scale,front:layer==='front',motionKeys:keys};
 }
 function bridge(d){
  return placement('bridge',[
   rect(3,49,94,14,'#755040',2),rect(0,42,100,5,'#a27952'),
   rect(5,65,7,30,'#4e3327'),rect(87,65,7,30,'#4e3327'),
   line(4,43,4,22,'#b99a70',3),line(96,43,96,22,'#b99a70',3),
   line(4,25,96,25,'#b99a70',3),line(34,49,34,63,'#442b24',2),
   line(67,49,67,63,'#442b24',2)
  ],'สะพานไม้', 'back',50,75,1.8,[
   key(0,{rotate:0,y:75,opacity:1}),
   key(d*.42,{rotate:0,y:75,opacity:1}),
   key(d*.78,{rotate:22,y:91,opacity:1}),
   key(d,{rotate:29,y:100,opacity:.8})
  ],'architecture');
 }
 function toolbox(d){
  return placement('toolbox',[
   rect(15,37,70,43,'#a65739',5),rect(13,35,74,8,'#da9256',2),
   rect(37,25,26,13,'#2c3940',2),rect(41,29,18,8,'#a65739'),
   rect(42,48,16,12,'#e6c874',2),line(16,65,84,65,'#49312d',2)
  ],'กล่องเครื่องมือ', 'front',58,65,.58,[
   key(0,{x:58,y:65,rotate:0,opacity:1}),
   key(d*.32,{x:58,y:65,rotate:0,opacity:1}),
   key(d*.85,{x:62,y:99,rotate:35,opacity:1}),
   key(d,{x:64,y:100,rotate:44,opacity:0})
  ]);
 }
 function reflector(d){
  return placement('reflector',[
   circle(50,48,39,'#5a686d'),circle(50,48,34,'#e6c779'),
   ellipse(50,48,29,25,'#f6e6b0'),rect(45,70,10,29,'#63727b'),
   polygon([[28,35],[51,28],[76,47],[54,60]],'#fff6cf')
  ],'แผ่นสะท้อนแสง', 'back',57,75,.86,[
   key(0,{rotate:-30,opacity:1}),key(d*.26,{rotate:-30,opacity:1}),
   key(d*.82,{rotate:75,opacity:1}),key(d,{rotate:85,opacity:1})
  ]);
 }
 function belt(d){
  return placement('belt',[
   ellipse(50,50,31,25,'#78503e'),ellipse(50,50,23,17,'#374047'),
   rect(19,47,12,6,'#d6a968',1),line(73,53,85,69,'#b58a66',4)
  ],'สายพานเครื่องกล', 'front',59,79,.58,[
   key(0,{rotate:0,opacity:1}),key(d*.47,{rotate:18,opacity:1}),
   key(d*.53,{rotate:25,opacity:.7}),key(d*.65,{rotate:43,opacity:0}),
   key(d,{opacity:0})
  ]);
 }
 function beacon(d){
  const shapes=[circle(50,50,32,'#e1a43c'),circle(50,50,25,'#ffec9e'),
   circle(50,50,13,'#ffffff'),line(5,48,95,48,'#ffdb79',4),
   line(50,5,50,95,'#ffdb79',4),line(17,17,83,83,'#ffdb79',3),
   line(17,83,83,17,'#ffdb79',3)];
  // Exactly three perceptible on/off cycles (no global lighting change).
  const phases=[0,.12,.18,.26,.34,.39,.47,.55,.60,.68,.76,1];
  const strengths=[0,0,1,1,0,0,1,1,0,0,1,0];
  return placement('beacon',shapes,'แสงสัญญาณสามวาบ','front',68,38,1.05,
   phases.map((t,i)=>key(d*t,{opacity:strengths[i]})),'fx');
 }
 function flood(d){
  return placement('flood',[
   rect(0,56,100,44,'#32617c'),ellipse(26,59,38,6,'#578da5'),
   ellipse(82,66,37,5,'#7fb4c9'),
   line(4,73,95,73,'#b2d5e3',2)
  ],'น้ำไหลบ่าระดับสูง','front',50,102,3.1,[
   key(0,{y:103,opacity:.7}),key(d*.45,{y:91,opacity:.8}),
   key(d,{y:76,opacity:.92})
  ],'nature');
 }
 function locked(scene){
  return scene?.autoDirectorLocked===true||scene?.manualLock===true||
   /\[(?:LOCK_LAYOUT|LOCK_VISUAL|MANUAL_ONLY)\]/i.test(String(scene?.notes||''));
 }
 function works(state,callback){
  const ops=[],notes=[],skipped=[];
  (state?.episodes||[]).forEach((ep,ei)=>(ep.scenes||[]).forEach((scene,si)=>{
   if(locked(scene)){skipped.push({episode:ei+1,sceneId:scene.id,reason:'locked-by-author'});return;}
   const outcome=callback(scene,ei,si,state);
   if(!outcome)return;
   if(outcome.patch&&Object.keys(outcome.patch).length)ops.push({op:'updateScene',id:scene.id,patch:outcome.patch});
   if(outcome.note)notes.push({episode:ei+1,sceneId:scene.id,detail:outcome.note});
   if(outcome.skipped)skipped.push({episode:ei+1,sceneId:scene.id,reason:outcome.skipped});
  }));
  return {ops,notes,skipped};
 }
 function composition(state){
  return works(state,scene=>{
   const original=Array.isArray(scene.actors)?scene.actors:[],actors=clone(original);
   if(actors.length<2||scene.interactions?.length)return null;
   let edits=0;
   for(let j=1;j<actors.length;j++){
    const a=actors[j],x=Number(a.x),y=Number(a.y);
    if(!Number.isFinite(x)||!Number.isFinite(y)||a.at||a.route?.length||a.layoutLocked)continue;
    const collision=actors.slice(0,j).some(b=>Number.isFinite(+b.x)&&Number.isFinite(+b.y)&&Math.abs(+b.x-x)<11&&Math.abs(+b.y-y)<7);
    if(!collision)continue;
    const candidates=[x+17,x-17,x+26,x-26].filter(v=>v>=8&&v<=92);
    const target=candidates.find(v=>actors.slice(0,j).every(b=>!Number.isFinite(+b.x)||Math.abs(+b.x-v)>=12));
    if(target===undefined)continue;
    a.x=round(target);
    if(Number.isFinite(+a.toX)&&a.toX!==undefined)
     a.toX=round(clamp(+a.toX+target-x,4,96,+a.toX));
    edits++;
   }
   return edits?{patch:{actors},note:'แยกตำแหน่งตัวละครที่ซ้อนกัน '+edits+' คู่'}:null;
  });
 }
 function vectorAssets(state,assetCore){
  return works(state,scene=>{
   const text=String(scene.voiceover||'')+' '+String(scene.imagePrompt||'');
   const existing=Array.isArray(scene.customAssets)?scene.customAssets:[],customAssets=clone(existing);
   if(scene.video||scene.image)return {skipped:'มีภาพ/วิดีโอเฉพาะฉากอยู่แล้ว ต้องตรวจภาพด้วยคน'};
   const created=[];
   for(const item of spec){
    if(!item.test.test(text))continue;
    if(customAssets.some(a=>a?.autoDirectorTag==='studio-auto-'+item.tag+'-v1'))continue;
    if(customAssets.length>=40)break;
    const a=item.build(Math.max(.5,Number(scene.duration)||5));
    try{
     if(!assetCore?.asset)throw Error('vector-asset-validator-unavailable');
     a.asset=assetCore.asset(a.asset);
    }catch(e){return {skipped:'เครื่องสร้าง SVG ไม่พร้อม: '+String(e.message||e)}}
    customAssets.push(a);created.push(item.tag);
   }
   return created.length?{patch:{customAssets},note:'สร้างรูปทรง SVG ที่แก้ไขได้: '+created.join(', ')}:null;
  });
 }
 function animation(state){
  return works(state,scene=>{
   const actors=clone(Array.isArray(scene.actors)?scene.actors:[]);
   let edits=0;
   const d=clamp(scene.duration,.5,180,6);
   for(const a of actors){
    if(a?.pose!=='jump'||(Array.isArray(a.motionKeys)&&a.motionKeys.length)||
       (Array.isArray(a.route)&&a.route.length)||a.motionLocked)continue;
    const x=clamp(a.x,0,100,50),y=clamp(a.y,0,100,90);
    const toX=clamp(a.toX,0,100,x+9);
    const toY=clamp(a.toY,0,100,y);
    a.motionKeys=[key(0,{x,y,pose:'stand'}),
      key(d*.24,{x:round(x+(toX-x)*.18),y:round(y-4),pose:'jump'}),
      key(d*.48,{x:round(x+(toX-x)*.55),y:round(clamp(y-15,0,100,y)),pose:'jump'}),
      key(d*.78,{x:toX,y:toY,pose:'stand'}),
      key(d,{x:toX,y:toY,pose:'stand'})];
    edits++;
   }
   return edits?{patch:{actors},note:'สร้างคีย์เฟรมกระโดดจริง '+edits+' ตัวละคร'}:null;
  });
 }
 function applyVirtual(state,ops){
  const result=clone(state);
  for(const op of ops||[]){
   if(op.op!=='updateScene')throw Error('Unsupported visual operation');
   const s=(result.episodes||[]).flatMap(e=>e.scenes||[]).find(x=>x.id===op.id);
   if(!s)throw Error('Scene disappeared: '+op.id);
   Object.assign(s,clone(op.patch));
  }
  return result;
 }
 function plan(state,assetCore){
  if(!state||!Array.isArray(state.episodes))throw Error('Missing imported episodes');
  const layout=composition(state);
  const staged=applyVirtual(state,layout.ops);
  const svg=vectorAssets(staged,assetCore);
  const stagedSvg=applyVirtual(staged,svg.ops);
  const motion=animation(stagedSvg);
  const final=applyVirtual(stagedSvg,motion.ops);
  return {layout,svg,motion,final,stats:{
   scenes:state.episodes.reduce((n,e)=>n+(e.scenes||[]).length,0),
   layout:layout.ops.length,svg:svg.ops.length,motion:motion.ops.length
  }};
 }
 function quality(state,visualQA,assetCore){
  const visual=visualQA?.inspect?visualQA.inspect(state):{issues:[],inspected:0};
  const issues=visual.issues.slice(),invalid=[];
  for(const ep of state?.episodes||[])for(const scene of ep.scenes||[]){
   for(const item of scene.customAssets||[]){
    if(!item?.autoDirectorTag)continue;
    try{assetCore.asset(item.asset)}catch(e){
     invalid.push({sceneId:scene.id,reason:String(e.message||e)});
    }
   }
  }
  const missingAudio=(state?.episodes||[]).flatMap(e=>e.scenes||[])
   .filter(s=>String(s.voiceover||'').trim()&&!(s.audioClips||[])
    .some(c=>c?.kind==='voice'&&c.data&&!c.mute)).map(s=>s.id);
  return {inspected:visual.inspected,issues,invalid,missingAudio,
   complete:!issues.length&&!invalid.length&&!missingAudio.length,
   limits:'Rule-based JSON checks only; rendered-video QA and model training are not performed'};
 }
 return Object.freeze({plan,composition,vectorAssets,animation,applyVirtual,quality,spec});
});
