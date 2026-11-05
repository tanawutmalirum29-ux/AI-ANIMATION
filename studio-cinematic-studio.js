/* Opt-in adapter: old scenes retain their renderer, rig, voice and export path. */
(function(root){
'use strict';
const C=root.StoryCinematic,P=root.StoryCinematicPlanner;if(!C||!P||typeof commit!=='function')return;
const q=s=>document.querySelector(s),n=(tag,text,cls)=>{const el=document.createElement(tag);if(text)el.textContent=text;if(cls)el.className=cls;return el;};
const btn=(text,fn)=>{const b=n('button',text);b.type='button';b.onclick=fn;return b;};
const field=(text,input)=>{const l=n('label',text);l.append(input);return l;};
let draft=null,reference=null,controller=null,referenceUrl=null;
const panel=n('section',null,'cine-studio');panel.id='cinematicStudio';panel.style.display='none';q('#studioToolBody').append(panel);
const status=n('p',null,'cine-status');status.setAttribute('role','status');
const title=n('h2','กำกับฉาก Cinematic');
const select=n('select');select.id='cineTemplate';for(const [id,label] of Object.entries(P.NAMES)){const o=n('option',label);o.value=id;select.append(o);}
const prompt=n('textarea');prompt.id='cinePrompt';prompt.rows=4;prompt.placeholder='ใส่บทเพื่อส่งให้ AI ครู หรือคำสั่งเวลา เช่น\n0-3: กล้อง x=1400 y=900 zoom=1.2\n3-6: ตัวละคร x=1600 y=1150 ท่า=walk';
const narration=n('textarea');narration.id='cineNarration';narration.rows=2;narration.placeholder='เฉพาะบทพูดที่จะพากย์ ไม่รวมคำสั่งกล้อง';
const json=n('textarea');json.id='cineBlueprint';json.rows=12;json.spellcheck=false;json.setAttribute('aria-label','Scene Blueprint JSON');
const approved=n('input');approved.id='cineApproved';approved.type='checkbox';
const summary=n('div',null,'cine-summary'),issues=n('div',null,'cine-issues');
const act=n('div',null,'cine-actions');
const chooseChar=()=>S.characters.find(c=>c.rig?.style!=='creature')?.id||'cine-student';
function figure(a,reach){
 const ch=S.characters.find(c=>c.id===a.char)||{id:'cine-student',name:'นักเรียนตัวอย่าง',rig:{costume:'school',shirt:'#e9e8da',pants:'#37475c',hair:'#252b36',hairStyle:'short',skin:'#d9ad8c'}};
 const actor={pose:a.stationary&&['walk','run'].includes(a.pose)?'stand':a.pose,view:a.view,facing:a.facing,smartActing:false,cinematicReach:reach};
 if(a.heldKind==='flashlight')actor.override={shoulderR:-65,elbowR:-35};
 const keys=d6Keys(ch,actor,a.phase),body=d6Wardrobe(ch,actor,a.phase,true);
 return {svg:body,hand:keys[4],bounds:{x:Math.min(...keys.filter(Boolean).map(k=>k[0])),y:Math.min(...keys.filter(Boolean).map(k=>k[1])),width:24,height:50}};
}
function aspect(){const [a,b]=String(S.project.aspect||'9:16').split(':').map(Number);return a/b;}
function read(){const p=JSON.parse(json.value);C.assertPlan(p);for(const a of p.actors)if(a.char!=='cine-student'&&!S.characters.some(c=>c.id===a.char))throw Error('ไม่พบตัวละคร '+a.char);return p;}
function report(p){
 summary.replaceChildren();for(const shot of p.shots||[]){const item=n('div',null,'cine-shot');item.append(n('strong',`${shot.start}–${shot.end} วินาที`),n('span',shot.label||'ช็อต'));summary.append(item);}
 issues.replaceChildren();const findings=C.qa(p,aspect(),figure);for(const i of findings)issues.append(n('p',`${i.severity==='error'?'แก้ก่อนใช้':'ตรวจสอบ'} · ${i.time??0}s · ${i.element||i.path}: ${i.message}`));
 if(!findings.length)issues.append(n('p','ผ่านการตรวจโครงสร้างและตำแหน่งที่รองรับ · ยังต้องดูภาพจริง'));
 return findings;
}
function setDraft(p){draft=p;json.value=JSON.stringify(p,null,2);approved.checked=false;report(p);}
function guarded(fn){return async()=>{try{await fn();}catch(e){status.textContent=e.message;}};}
function download(name,value){dl(name,JSON.stringify(value,null,2),'application/json');}
function apply(){
 const p=read();if(!approved.checked)throw Error('ตรวจแผนและทำเครื่องหมายยืนยันก่อนเพิ่มฉาก');
 const errors=C.qa(p,aspect(),figure).filter(i=>i.severity==='error');if(errors.length)throw Error(errors[0].message);
 p.source={...p.source,reviewed:true};
 const text=narration.value.trim();
 commit(()=>{
  if(p.actors.some(a=>a.char==='cine-student')&&!S.characters.some(c=>c.id==='cine-student'))S.characters.push({id:'cine-student',name:'นักเรียนตัวอย่าง',promptBlock:'Original student, short dark hair, ivory school uniform, navy trousers.',rig:{style:'human',costume:'school',shirt:'#e9e8da',pants:'#37475c',hair:'#252b36',hairStyle:'short',skin:'#d9ad8c'}});
  const scene=newScene();scene.duration=p.duration;scene.cinematicPlan=p;scene.voiceover=text;scene.subtitle=text?[text]:[];scene.characters=p.actors.map(a=>a.char);scene.notes=p.title||'Cinematic';scene.transition={type:'cut',duration:0};scene.camera={type:'static',world:1,from:1,to:1};
  scene.cinematicReview=C.review(p,'accept','ผู้ใช้ตรวจ Scene Blueprint ก่อนเพิ่มฉาก');
  ep().scenes.push(scene);sel=ep().scenes.length-1;T=starts()[sel];playing=false;
 });
 root.switchStudioTool('cinematic');status.textContent='เพิ่มฉากท้ายตอนแล้ว · ข้อมูลเดิมยังอยู่ · ย้อนกลับได้ด้วย Undo';
}
act.append(btn('สร้างแผนตัวอย่าง',guarded(()=>{const p=P.template(select.value,chooseChar());if(prompt.value.trim()){p.source.prompt=prompt.value.trim();p.unknowns=[prompt.value.trim()];}setDraft(p);status.textContent='นี่คือแผนตัวอย่างที่เลือก ยังไม่ได้ตีความบทอิสระ กรุณาตรวจและปรับก่อนใช้';})),
 btn('อ่านคำสั่งเวลา',guarded(()=>{const result=P.compile(prompt.value,read());setDraft(result.plan);status.textContent=`ใช้คำสั่งได้ ${result.applied.length} บรรทัด · ยังตีความไม่ได้ ${result.unresolved.length} บรรทัด`;})),
 btn('ส่งออกโจทย์ให้ AI ครู',guarded(()=>download('cinematic-teacher-brief.json',P.brief(prompt.value,read())))));
const details=n('details');details.append(n('summary','แก้ไข / วาง Blueprint JSON จาก AI ครู'),json);
json.addEventListener('input',()=>{approved.checked=false;});
const reviewActions=n('div',null,'cine-actions');reviewActions.append(btn('ตรวจแผน',guarded(()=>{draft=read();report(draft);status.textContent='ตรวจแผนแล้ว ตรวจคำเตือนและดูช็อตก่อนเพิ่มฉาก';})),btn('บันทึก Blueprint',guarded(()=>download('cinematic-blueprint.json',read()))),btn('บันทึกผลตรวจให้ครู',guarded(()=>download('cinematic-review.json',C.review(read(),approved.checked?'accept':'revise',status.textContent)))));
const importFile=n('input');importFile.type='file';importFile.accept='.json,application/json';importFile.addEventListener('change',async()=>{try{const f=importFile.files[0];if(!f)return;if(f.size>1024*1024)throw Error('Blueprint ต้องไม่เกิน 1 MB');const p=JSON.parse(await f.text());C.assertPlan(p);setDraft(p);status.textContent='นำเข้าแผนแล้ว ยังไม่เปลี่ยนงานปัจจุบัน';}catch(e){status.textContent=e.message;}finally{importFile.value='';}});
const applyButton=btn('เพิ่มเป็นฉากใหม่',guarded(apply));applyButton.className='cine-primary';
function updateCurrent(){
 const scene=sc();if(!scene.cinematicPlan)throw Error('ฉากนี้ยังไม่มี Blueprint กรุณาเพิ่มฉากใหม่');
 const p=read();if(!approved.checked)throw Error('ตรวจแผนและทำเครื่องหมายยืนยันก่อนปรับฉาก');
 if(p.duration!==scene.duration&&scene.audioClips?.some(c=>c.data))throw Error('ฉากมีเสียงอยู่แล้ว กรุณาคงความยาวเดิมเพื่อไม่ตัดเสียง');
 const errors=C.qa(p,aspect(),figure).filter(i=>i.severity==='error');if(errors.length)throw Error(errors[0].message);
 p.source={...p.source,reviewed:true};
 commit(()=>{scene.cinematicPlan=p;scene.duration=p.duration;scene.cinematicReview=C.review(p,'accept','แก้ Blueprint เฉพาะฉาก โดยเก็บเสียงและคำบรรยายเดิม');});
 status.textContent='ปรับเฉพาะฉากปัจจุบันแล้ว · เก็บเสียงและคำบรรยายเดิม · Undo ได้';
}
const addRow=n('div',null,'cine-actions');addRow.append(applyButton,btn('ปรับฉากปัจจุบัน',guarded(updateCurrent)),btn('เปิดแผนของฉากนี้',guarded(()=>{if(!sc().cinematicPlan)throw Error('ฉากปัจจุบันยังไม่มี Blueprint');setDraft(JSON.parse(JSON.stringify(sc().cinematicPlan)));})),btn('พากย์ฉากปัจจุบัน',guarded(async()=>{if(!sc().voiceover?.trim())throw Error('กรุณาเพิ่มบทพากย์ในฉากก่อน');await root.StoryStudioBridge.narrate('scene');status.textContent='จบกระบวนการพากย์ ตรวจคลิปเสียงก่อนส่งออก';})),btn('ส่งออกวิดีโอ',()=>openVideoExport()));
const refSection=n('details');refSection.append(n('summary','วิเคราะห์วิดีโออ้างอิงในเครื่อง'));
const file=n('input');file.type='file';file.accept='video/*';file.setAttribute('aria-label','วิดีโออ้างอิง');
const referenceVideo=n('video');referenceVideo.controls=true;referenceVideo.playsInline=true;referenceVideo.style.cssText='width:100%;max-height:280px';
const shotSelect=n('select');shotSelect.setAttribute('aria-label','เลือกช็อตอ้างอิง');
const shotNotes=n('textarea');shotNotes.rows=3;shotNotes.placeholder='บันทึกสิ่งที่เห็นจริง เช่น กล้อง ตำแหน่งตัวละคร และสิ่งที่ยังไม่แน่ใจ';
shotSelect.onchange=()=>{const shot=reference?.shots[+shotSelect.value];if(shot){referenceVideo.currentTime=shot.start;shotNotes.value=shot.review?.notes||'';}};
const progress=n('progress');progress.max=1;progress.value=0;progress.setAttribute('aria-label','ความคืบหน้าวิเคราะห์วิดีโอ');
const refReport=n('pre');refReport.setAttribute('aria-live','polite');
file.addEventListener('change',async()=>{if(controller)controller.abort();const current=new AbortController();controller=current;const video=file.files[0];if(!video)return;if(referenceUrl)URL.revokeObjectURL(referenceUrl);referenceUrl=URL.createObjectURL(video);referenceVideo.src=referenceUrl;reference=null;shotSelect.replaceChildren();refReport.textContent='กำลังอ่านวิดีโอ';
 try{const result=await root.StoryVideoReference.analyze(video,{signal:current.signal,onProgress:p=>{if(controller===current){progress.value=p.completed/p.total;refReport.textContent=`ตรวจเฟรม ${p.completed}/${p.total}`;}}});if(controller!==current)return;reference=result;shotSelect.replaceChildren(...result.shots.map((s,i)=>{const o=n('option',`${s.id} · ${s.start.toFixed(1)}–${s.end.toFixed(1)}s`);o.value=String(i);return o;}));shotNotes.value='';refReport.textContent=result.shots.map(s=>`${s.id}: ${s.start.toFixed(2)}–${s.end.toFixed(2)}s · รอตรวจรายละเอียดภาพ`).join('\n');}
 catch(e){if(controller===current)refReport.textContent=e.name==='AbortError'?'ยกเลิกแล้ว':e.message;}
 finally{if(controller===current)controller=null;file.value='';}
});
refSection.append(n('p','ตรวจจุดเปลี่ยนภาพและเวลาเท่านั้น ยังไม่รู้ตัวละคร วัตถุ หรือเหตุการณ์อัตโนมัติ จำกัด 3 นาที / 100 MB'),file,referenceVideo,progress,refReport,shotSelect,field('บันทึกตรวจช็อตโดยผู้ใช้',shotNotes),btn('บันทึกข้อสังเกตช็อต',guarded(()=>{const shot=reference?.shots[+shotSelect.value];if(!shot)throw Error('เลือกช็อตก่อน');shot.review={source:'user-review',notes:shotNotes.value.trim(),at:new Date().toISOString()};refReport.textContent='บันทึกข้อสังเกตใน Shot Plan แล้ว';})),btn('ยกเลิก',()=>controller?.abort()),btn('บันทึก Shot Plan',guarded(()=>{if(!reference)throw Error('วิเคราะห์วิดีโอก่อน');download('video-reference-blueprint.json',reference);})));
panel.append(title,n('p','กำกับฉากด้วยพิกัด เวลา และกล้อง 2.5D ใช้ตัวละครและระบบส่งออกเดิม'),field('เลือกฉากตั้งต้น',select),field('บท / คำสั่งเวลา',prompt),act,summary,field('นำเข้า Blueprint',importFile),details,reviewActions,issues,field('บทพากย์สำหรับฉากใหม่',narration),field('ฉันตรวจเหตุการณ์ พิกัด และข้อที่ยังไม่แน่ใจแล้ว',approved),addRow,status,refSection,n('p','ระบบนี้เพิ่มกฎและข้อมูลตัวอย่าง ไม่ใช่การฝึกโมเดลใหม่ · บทอิสระที่ไม่ตรงรูปแบบคำสั่งยังต้องให้ AI ครูหรือผู้ใช้จัดแผน', 'cine-note'));
const nav=btn('กำกับ Cinematic',()=>root.switchStudioTool('cinematic'));nav.dataset.tool='cinematic';q('#studioToolNav').append(nav);
const origSwitch=root.switchStudioTool;root.switchStudioTool=function(id){const r=origSwitch.apply(this,arguments);if(id==='cinematic'){
 for(const el of q('#studioToolBody').children)el.style.display=el===panel?'':'none';
 q('#studioToolTitle').textContent='วางแผน → ตรวจ → เพิ่มฉาก → พากย์ / ส่งออก';
 for(const b of q('#studioToolNav').querySelectorAll('[data-tool]')){b.classList.toggle('on',b.dataset.tool===id);b.setAttribute('aria-current',b.dataset.tool===id?'page':'false');}
 if(!draft)setDraft(P.template('street',chooseChar()));
 }return r;};
function paintScene(scene,t,world){
 if(!scene.cinematicPlan)return;
 const p=scene.cinematicPlan;const errors=C.validate(p);world.style.transform='none';world.style.width='100%';world.style.filter='none';
 const set=world.querySelector('#set');set.style.transform='none';
 for(const id of ['art','rig','setf']){const el=world.querySelector('#'+id);el.innerHTML='';el.style.transform='none';el._h=null;if(id==='art')el.dataset.k='';}
 set.innerHTML=errors.length?`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900"><rect width="600" height="900" fill="#152238"/><text x="30" y="450" fill="white">Invalid cinematic blueprint</text></svg>`:C.render(p,t,aspect(),figure).svg;set._h=null;
 q('#ph').textContent='';
}
root.StoryCinematicStudio=Object.freeze({paintScene,figure,open:()=>{if(root.StoryAIMode?.isAi())root.StoryAIMode.set('full');root.switchStudioTool('cinematic');},getDraft:()=>draft,validate:()=>report(read())});
requestAnimationFrame(()=>draw());
})(window);
