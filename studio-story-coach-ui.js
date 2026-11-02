/* Narrative Continuity Editor — explicit review before applying/reusing text.
 * The child checks context and retrieves examples; the teacher LLM suggests edits.
 * No automatic creative edits, secret storage, hidden training or background agent.
 */
(function(root){
'use strict';
let mountEl=null,bridge=null,provider='openrouter',state=null,examples=[],busy=false,
 status='',error=false,loading=false,saved=false,foundationInfo=null;
const core=()=>root.StoryContinuityCoach;
const dom=root.document;
function e(name,attrs={},...parts){
 const el=dom.createElement(name);
 for(const [key,value] of Object.entries(attrs)){
  if(value==null)continue;
  if(key==='className')el.className=value;
  else if(key==='textContent')el.textContent=value;
  else if(key==='onclick')el.addEventListener('click',value);
  else if(key==='onchange')el.addEventListener('change',value);
  else if(key==='oninput')el.addEventListener('input',value);
  else if(key==='disabled')el.disabled=!!value;
  else if(key==='value')el.value=value;
  else if(key==='selected')el.selected=!!value;
  else el.setAttribute(key,String(value));
 }
 for(const part of parts)if(part!=null)el.append(part.nodeType?part:dom.createTextNode(String(part)));
 return el;
}
function btn(label,cb,cls='',disabled=false){
 return e('button',{type:'button',className:cls,onclick:cb,disabled},label);
}
function say(message,isError=false){status=String(message||'');error=isError;
 const n=mountEl?.querySelector('.story-coach-notice');
 if(n){n.textContent=status;n.dataset.error=String(isError)}}
function auth(){
 return !!(root.StoryStudioAccess?.enabled&&root.StoryStudioAccess?.isReady?.());
}
async function request(action,params={}){
 if(!auth())throw Error('กรุณาเข้าสู่ระบบ Studio เพื่อใช้ AI แม่และความจำ AWS');
 return root.StoryStudioAccess.request({action,...params});
}
function projectId(){return root.StoryAIWorkspaceCore.ensure(bridge.get().project?.aiWorkspace||{}).projectId}
function scene(){
 const id=bridge.scene?.()?.id;
 return core()?.selected(bridge.get(),id);
}
function promptReview(bundle){
 return 'Review CURRENT Thai narration for causal continuity, missing transitions and clarity. '+
  'Check PREVIOUS and NEXT scene. Identify specific evidence before concluding something contradicts. '+
  'Preserve purposeful stutters, urgent repetition, uncertainty, suspense and flashback timeline; do not over-edit. '+
  'You may propose a minimal bridge or improved Thai narration when appropriate, without adding canon, names or invented facts. '+
  'Return JSON with reply in Thai and ops:[{op:"updateScene",id:"'+bundle.sceneId+
  '",patch:{voiceover:"edited Thai text"}}] ONLY if a change is useful; otherwise ops:[]. '+
  'No fabricated audiovisual observations or invented events. If the original is sound use ops:[]; explain Thai evidence. This is owner-review only.';
}
function ownerSnapshot(){
 return JSON.stringify(bridge.get().episodes.flatMap(ep=>ep.scenes||[]).find(x=>x.id===state?.bundle?.sceneId)||null);
}
function ensureFresh(){
 if(!state)throw Error('กรุณาวิเคราะห์ฉากก่อน');
 const current=scene();
 if(!current||current.sceneId!==state.bundle.sceneId||
    ownerSnapshot()!==state.snapshot)throw Error('ข้อมูลฉากเปลี่ยนหลังวิเคราะห์ กรุณาวิเคราะห์ใหม่');
}
function setChoice(value){if(state){state.issue=value;saved=false}}
function setRevision(value){if(state){state.revised=value.slice(0,1200);saved=false}}
function setOwnerReason(value){if(state){state.ownerReason=value.slice(0,700);saved=false}}
async function loadExamples(){
 if(loading)return;
 loading=true;
 try{
  const result=await request('student.storyLessons',{limit:60});
  if(!Array.isArray(result.lessons))throw Error('รูปแบบข้อมูล AWS ไม่ถูกต้อง');
  examples=result.lessons;
  say('อ่านตัวอย่างการแก้เนื้อหาจาก AWS แล้ว '+examples.length+' รายการ (ยังไม่ใช่น้ำหนักโมเดล)');
 }catch(e){say('โหลดบทเรียนเดิมไม่ได้: '+String(e.message||e),true)}
 finally{loading=false;render()}
}
async function analyze(){
 if(busy)return;
 const bundle=scene();
 if(!bundle?.current?.voiceover){say('เลือกฉากที่มีบทพากย์ก่อน',true);return}
 busy=true;render();
 try{
  const original=bundle.current.voiceover;
  state={bundle,snapshot:JSON.stringify(bridge.get().episodes.flatMap(ep=>ep.scenes||[])
    .find(x=>x.id===bundle.sceneId)||null),
   original,revised:original,reason:'',issue:'continuity',ownerReason:'',
   teacher:'ยังไม่ได้เรียก AI แม่',model:'',teacherReady:false};
  saved=false;
  foundationInfo=null;
  try{
   const trained=await root.StoryNarrativeFoundation?.load?.();
   if(trained){
    foundationInfo={
     advisory:root.StoryNarrativeFoundation.classify(trained.model,{
      original:bundle.current.voiceover,
      previous:bundle.previous?.voiceover||'',next:bundle.next?.voiceover||''}),
     report:trained.report,count:trained.data.rows.length,
     samples:root.StoryNarrativeFoundation.nearest(trained.data,bundle,3)
    };
   }
  }catch(loadError){
   foundationInfo={error:String(loadError.message||loadError)};
  }
  say('AI ลูกตรวจบริบทแล้ว · '+
   (foundationInfo?.advisory?'โมเดลทดลอง: '+foundationInfo.advisory.title:
    'ยังไม่โหลดโมเดล CPU · ใช้ข้อสังเกตตามกฎพื้นฐาน')+
    ' · ยังไม่ได้เปลี่ยนบท');
 }catch(e){say('ตรวจความต่อเนื่องไม่สำเร็จ: '+e.message,true)}
 finally{busy=false;render()}
}
async function teacherReview(){
 if(busy)return;
 if(!state){say('กดวิเคราะห์ฉากก่อน',true);return}
 try{ensureFresh()}catch(e){say(e.message,true);return}
 busy=true;render();
 try{
  // Get fresh examples first; if storage is unavailable, still allow review.
  try{
   const data=await request('student.storyLessons',{limit:60});
   if(Array.isArray(data.lessons))examples=data.lessons;
  }catch(_){}
  await root.StoryAutoTeach?.loadMemory?.();
  const teacherMemory=root.StoryAutoTeach?.examples?.(state.bundle,1)||[];
  const related=core().examples(state.bundle,examples,2);
  const trained=root.StoryNarrativeFoundation?.summary?.();
  const foundationSamples=foundationInfo?.samples||[];
  const result=await request('teacher.chat',{
   provider,message:promptReview(state.bundle),
   context:core().prompt(state.bundle,related,foundationSamples,
    foundationInfo?.advisory||null,teacherMemory),history:[]});
  if(typeof result.reply!=='string'&&!Array.isArray(result.ops))
   throw Error('AI แม่ไม่ส่งคำตอบที่เข้าใจได้');
  ensureFresh();
  state.teacher=String(result.reply||'AI แม่ไม่ได้ให้เหตุผล').slice(0,3800);
  state.model=String(result.model||'');
  state.teacherReady=true;
  const proposal=(Array.isArray(result.ops)?result.ops:[]).find(op=>
   op?.op==='updateScene'&&op.id===state.bundle.sceneId&&
   typeof op.patch?.voiceover==='string'&&op.patch.voiceover.trim().length>=4);
  if(proposal){
   state.revised=proposal.patch.voiceover.slice(0,1200);
   if(state.revised===state.original)state.issue='keep';
   saved=false;
  }else{state.revised=state.original;state.issue='keep'}
  say('AI แม่ส่งผลตรวจแล้ว · '+(proposal?'มีบทแก้ให้พิจารณา':'เสนอให้คงบทเดิมหรือข้อมูลไม่เพียงพอ')+
   ' · ยังไม่ได้เปลี่ยนโปรเจกต์');
 }catch(e){say('AI แม่ตรวจบทไม่สำเร็จ: '+String(e.message||e),true)}
 finally{busy=false;render()}
}
async function saveLesson(){
 if(busy)return;
 try{ensureFresh()}catch(e){say(e.message,true);return}
 const lesson={issue:state.issue,original:state.original,revised:state.revised,
  previous:state.bundle.previous?.voiceover||'',next:state.bundle.next?.voiceover||'',
  episodeId:state.bundle.episodeId,sceneId:state.bundle.sceneId,
  teacherReason:state.teacherReady?state.teacher:'',
  ownerReason:state.ownerReason,reviewedByOwner:true};
 if(!core().validLesson(lesson)){say('บทก่อนและหลังแก้ต้องมี 4–1200 ตัวอักษร',true);return}
 if(!root.confirm('ยืนยันว่าอ่านและอนุมัติบทเรียนนี้แล้ว? ระบบจะเก็บตัวอย่างบน AWS ไม่ได้ฝึกน้ำหนัก AI โดยอัตโนมัติ'))return;
 busy=true;render();
 try{
  const reply=await request('student.storyLesson',{projectId:projectId(),lesson});
  if(!reply?.saved)throw Error('AWS ไม่ยืนยันว่าบันทึกบทเรียน');
  saved=true;
  say('บันทึกตัวอย่างที่คุณตรวจแล้วบน AWS สำเร็จ · เป็นความจำสำหรับเทียบเคียง ยังไม่ใช่การฝึกน้ำหนัก');
 }catch(e){say('บันทึกบทเรียนไม่สำเร็จ: '+String(e.message||e),true)}
 finally{busy=false;render()}
}
function saveRecovery(){
 const blob=new Blob([JSON.stringify(bridge.get(),null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob);
 const a=e('a',{href:url,download:'story-before-coherence-'+Date.now()+'.json'});
 dom.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);
}
async function applyRevision(){
 if(busy)return;
 try{ensureFresh()}catch(e){say(e.message,true);return}
 if(!state.revised.trim()||state.revised===state.original){
  say('บทแก้เหมือนต้นฉบับ ไม่มีการเปลี่ยนฉาก');return}
 if(!root.StudioAPI?.apply){say('StudioAPI ไม่พร้อม',true);return}
 const current=bridge.get().episodes.flatMap(ep=>ep.scenes||[]).find(x=>x.id===state.bundle.sceneId);
 const voiceClips=(current.audioClips||[]).filter(x=>x?.kind==='voice'&&x.data&&!x.mute);
 const patch={voiceover:state.revised,subtitle:[],subtitleCues:[]};
 if(voiceClips.length)patch.audioClips=current.audioClips.map(c=>
  c.kind==='voice'&&c.data?{...c,mute:true,staleNarration:true}:c);
 const ops=[{op:'updateScene',id:state.bundle.sceneId,patch}];
 const dry=root.StudioAPI.apply(ops,{dryRun:true});
 if(!dry?.ok){say('บทแก้ไม่ผ่าน JSON QA: '+JSON.stringify((dry.errors||dry.issues||[]).slice(0,2)),true);return}
 if(!root.confirm('ใช้บทที่แก้ในฉาก '+state.bundle.sceneId+'? จะดาวน์โหลด JSON สำรองก่อน และต้องจัดซับ/พากย์ใหม่'+(voiceClips.length?' (เสียงเก่าจะถูกปิด)':'')))return;
 busy=true;render();
 try{
  ensureFresh();saveRecovery();
  const applied=root.StudioAPI.apply(ops);
  if(!applied?.applied)throw Error('ระบบไม่ยืนยันว่าปรับบทแล้ว');
  bridge.persist();say('แก้บทฉากแล้ว · ซับและเสียงเก่าต้องสร้างใหม่ · บันทึกบทเรียน AWS แยกต่างหาก');
  state=null;saved=false;
 }catch(e){say('ใช้บทแก้ไม่สำเร็จ: '+String(e.message||e),true)}
 finally{busy=false;render()}
}
function narrativeCard(title,item){
 return e('div',{className:'story-coach-scene'},
  e('strong',{},title),
  e('small',{},item?('ฉาก '+String(item.id||'-')+
   (item.location?' · สถานที่ '+item.location:'')):'ไม่มีฉากนี้ในตอนปัจจุบัน'),
  e('p',{},item?.voiceover||'ไม่มีบทพากย์'));
}
function render(){
 if(!mountEl)return;
 const a=state,ctx=a?.bundle,rootEl=e('div',{className:'teacher-content story-coach'},
  e('strong',{},'AI ตรวจความต่อเนื่องและช่วยเรียบเรียงบท'),
  e('p',{className:'teacher-muted'},
   'ตรวจบทก่อนหน้า–ฉากนี้–ฉากถัดไป แล้วให้ AI แม่เสนอแก้เฉพาะจุด บทใหม่จะไม่ถูกใช้จนกว่าคุณอนุมัติ'),
  e('div',{className:'teacher-row'},
   btn('1. AI ลูกตรวจบริบท',analyze,'teacher-primary',busy),
   btn('2. AI แม่เสนอแก้',teacherReview,'',busy||!a),
   btn('โหลดตัวอย่างสอนเดิม',loadExamples,'',busy||loading)),
  e('p',{className:'story-coach-notice','data-error':String(error),role:'status'},status||
   'เลือกฉากแล้วกด AI ลูกตรวจบริบท'),
  e('p',{className:'teacher-muted'},
   'ตัวอย่างที่โหลดจาก AWS '+examples.length+' รายการ · การตรวจด้วย AI แม่จะใช้โควตา API'));
 if(ctx){
  rootEl.append(narrativeCard('ฉากก่อนหน้า',ctx.previous),
   narrativeCard('ฉากปัจจุบัน',ctx.current),
   narrativeCard('ฉากถัดไป',ctx.next));
  const signals=core().signals(ctx);
  if(foundationInfo?.advisory){
   const advice=foundationInfo.advisory,report=foundationInfo.report||{};
   rootEl.append(e('div',{className:'story-coach-foundation'},
    e('strong',{},'AI ลูก · โมเดลภาษาไทย CPU (ทดลอง)'),
    e('p',{},'สิ่งที่น่าสงสัย: '+advice.title+
     (advice.lowEvidence?' · หลักฐานยังไม่ชัด ควรตรวจเอง':' · เป็นเพียงคำแนะนำ')),
    e('p',{},'ข้อมูลตั้งต้น '+foundationInfo.count+' ตัวอย่างที่ AI จัดทำ · ไม่ใช่บทที่คุณอนุมัติ'),
    e('small',{},'ทดสอบข้ามเรื่อง '+report.correct+'/'+report.testRows+
     ' ('+(100*Number(report.accuracy||0)).toFixed(1)+'%)'+
     ' · เป็นชุดข้อมูลสังเคราะห์ ไม่ใช่คะแนนความแม่นยำในงานจริง'),
    e('small',{},'โมเดลนี้จำแนกประเภทปัญหาเท่านั้น ไม่สามารถเขียนบทใหม่ด้วยตนเอง')));
   if(foundationInfo.samples?.length){
    const details=e('details',{className:'story-coach-foundation-examples'},
     e('summary',{},'ดูตัวอย่างภาษาไทยที่ใช้เป็นพื้นฐาน ('+foundationInfo.samples.length+' รายการใกล้เคียง)'));
    for(const item of foundationInfo.samples.slice(0,3))details.append(e('div',{className:'story-coach-example'},
     e('strong',{},item.issue+' · ตัวอย่างสังเคราะห์'),
     e('p',{},'บทเดิม: '+item.before),
     e('p',{},'แนวแก้: '+item.after),
     e('small',{},'เหตุผล: '+item.reason)));
    rootEl.append(details);
   }
  }else if(foundationInfo?.error)
   rootEl.append(e('p',{className:'teacher-warning'},'ยังโหลดชุดข้อมูลฝึกไม่ได้: '+foundationInfo.error));
  if(signals.length)rootEl.append(e('div',{className:'story-coach-signals'},
   e('strong',{},'ข้อสังเกตจาก AI ลูก (ยังไม่ใช่ข้อสรุป)'),
   ...signals.map(msg=>e('p',{},msg))));
  rootEl.append(e('div',{className:'story-coach-review'},
   e('strong',{},'ข้อวิเคราะห์จาก AI แม่'),
   e('p',{},a.teacher),
   e('small',{},a.model?'โมเดล '+a.model:'ต้องเชื่อม API ก่อนเรียก AI แม่')));
  rootEl.append(e('label',{className:'teacher-field'},
   e('span',{},'บทที่เสนอหลังแก้ — สามารถเขียนปรับเองได้'),
   e('textarea',{id:'storyCoachRevision',rows:5,maxLength:1200,
    oninput:ev=>setRevision(ev.target.value)},a.revised)),
   e('label',{className:'teacher-field'},e('span',{},'ประเภทปัญหา'),
    e('select',{id:'storyCoachIssue',onchange:ev=>setChoice(ev.target.value)},
     ...[['continuity','ประโยค/เหตุการณ์ไม่ต่อเนื่อง'],['clarity','ความหมายไม่ชัด'],
     ['expand','เติมคำเชื่อมหรือรายละเอียด'],['pacing','ปรับจังหวะบท'],
     ['keep','ควรเก็บบทเดิม']].map(([value,label])=>e('option',{
      value,selected:a.issue===value},label)))),
   e('label',{className:'teacher-field'},e('span',{},'ทำไมจึงเลือกบทแบบนี้ (สำหรับสอน AI ลูก)'),
    e('textarea',{rows:2,maxLength:700,placeholder:'เหตุผลที่ผู้เขียนเห็นว่าถูกต้อง',
     oninput:ev=>setOwnerReason(ev.target.value)},a.ownerReason)),
   e('div',{className:'teacher-row'},
    btn(saved?'บันทึกบน AWS แล้ว':'3. อนุมัติและเก็บเป็นบทเรียน',saveLesson,'teacher-primary',busy||saved),
    btn('4. ใช้บทที่แก้ในฉาก',applyRevision,'',busy||a.revised===a.original)));
 }
 if(examples.length){
  const section=e('details',{className:'story-coach-history'},e('summary',{},
   'ดูตัวอย่างการสอนที่ผ่านมา ('+examples.length+' รายการที่โหลด)'));
  for(const item of examples.slice(0,12))section.append(e('article',{className:'story-coach-example'},
   e('strong',{},item.issue+' · '+(item.sceneId||'-')),
   e('p',{},String(item.original||'').slice(0,240)),
   e('small',{},'→ '+String(item.revised||'').slice(0,240)),
   e('p',{},String(item.ownerReason||item.teacherReason||'').slice(0,250))));
  rootEl.append(section);
 }
 mountEl.replaceChildren(rootEl);
}
function mount(el,source,choice){
 mountEl=el;bridge=source;provider=choice||'openrouter';
 render();
}
root.StoryStoryCoachUI=Object.freeze({mount,render});
})(window);
