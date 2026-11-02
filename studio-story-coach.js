/* Story Continuity Coach — deterministic preflight + few-shot reviewed memory.
 * No large language model is bundled; teacher API provides optional creative edits.
 * Approved owner corrections are examples, not neural weights.
 */
(function(root,factory){
'use strict';
const mod=factory();
if(typeof module==='object'&&module.exports)module.exports=mod;
if(root)root.StoryContinuityCoach=mod;
})(typeof globalThis!=='undefined'?globalThis:null,function(){
'use strict';
const ISSUES=Object.freeze(['continuity','clarity','expand','pacing','keep']);
const EDITORIAL_CHECKLIST=Object.freeze([
 'ระบุข้อเท็จจริงที่ปรากฏในฉากก่อนหน้า ฉากปัจจุบัน และฉากถัดไปก่อนสรุป',
 'รักษาลำดับเหตุและผล เวลา สถานที่ มุมมองของผู้เล่า และสิ่งที่ตัวละครยังไม่รู้',
 'แยกความทรงจำ ความฝัน ข้อสงสัย และการคาดเดาออกจากเหตุการณ์จริง',
 'อย่าเฉลยปริศนา ระบุตัวผู้กระทำ เพิ่มตัวละคร หรือสร้างเหตุการณ์ที่ไม่มีหลักฐาน',
 'ตรวจคำซ้ำตามเจตนา: ความกลัว ความลังเล คำสั่งเร่งด่วน เสียงเลียนธรรมชาติ และจังหวะวรรณศิลป์อาจต้องเก็บไว้',
 'ปรับบทพากย์ให้เข้าใจง่าย กระชับ แต่ไม่ตัดภาพ เสียง อารมณ์ หรือรายละเอียดที่ทำหน้าที่สำคัญ',
 'ถ้าจะต่อเติม ให้ใช้เฉพาะรายละเอียดที่มีหลักฐานในบริบท; ข้อเสนอเชิงสร้างสรรค์ใหม่ต้องแยกต่างหาก',
 'หากบทเดิมเหมาะสมแล้ว หรือหลักฐานไม่พอ ให้คงต้นฉบับและอธิบายเหตุผล'
]);
const trim=(v,n)=>String(v==null?'':v).trim().slice(0,n);
function selected(project,sceneId){
 const episodes=Array.isArray(project?.episodes)?project.episodes:[];
 for(let ei=0;ei<episodes.length;ei++){
  const ep=episodes[ei],scenes=Array.isArray(ep?.scenes)?ep.scenes:[];
  const index=scenes.findIndex(s=>s?.id===sceneId);
  if(index<0)continue;
  // Episode boundaries are explicit: avoid assuming the prior episode is continuous.
  const scene=scenes[index],prev=scenes[index-1]||null,next=scenes[index+1]||null;
  const pick=s=>s?{id:s.id,voiceover:trim(s.voiceover,950),notes:trim(s.notes,250),
   location:trim(s.location,90),situation:trim(s.situation||s.eventKind,100),
   characters:Array.isArray(s.actors)?s.actors.slice(0,8).map(a=>trim(a.char||a.id,60)):[]}:null;
  return {title:trim(project?.project?.title,110),episodeId:trim(ep.id,80),
   episodeTitle:trim(ep.title,100),sceneId,previous:pick(prev),current:pick(scene),next:pick(next)};
 }
 return null;
}
function signals(bundle){
 if(!bundle?.current)return [];
 const clues=[],prev=bundle.previous,current=bundle.current,next=bundle.next;
 if(!prev)clues.push('ฉากเริ่มตอน: ไม่มีฉากก่อนหน้าในตอนนี้ ห้ามเดาเหตุการณ์ก่อนหน้า');
 if(!next)clues.push('ฉากท้ายตอน: ไม่มีฉากถัดไปในตอนนี้');
 if(!current.voiceover)clues.push('ฉากนี้ไม่มีบทพากย์ — ต้องขอข้อมูลก่อนเสนอแก้บท');
 if(prev?.voiceover&&current.voiceover&&prev.voiceover.trim()===current.voiceover.trim())
  clues.push('บทพากย์ฉากก่อนหน้าและฉากนี้เหมือนกัน ควรตรวจว่าเป็นการย้ำโดยเจตนาหรือคัดลอกผิด');
 if(prev?.location&&current.location&&prev.location!==current.location)
  clues.push('สถานที่เปลี่ยนจากฉากก่อนหน้า: ตรวจว่ามีคำเชื่อมหรือฉากเปลี่ยนสถานที่เพียงพอ');
 if(/(?:\.\.\.|…|!)[ ]*(?:ผม|ฉัน|ไป|เดี๋ยว|ไม่|ช่วย)[^\n]{0,15}|(?:ไป!\s*ไป|ผม\.\.\.\s*ผม)/u.test(current.voiceover))
  clues.push('พบจังหวะหยุดหรือคำซ้ำที่อาจสื่ออารมณ์: อย่าตัดทิ้งก่อนตรวจเจตนาของผู้พูด');
 if(/ไม่แน่ใจ|ยังไม่รู้|ไม่ทราบ|อาจจะ|เหมือนว่า/u.test(current.voiceover))
  clues.push('ผู้เล่ายังไม่แน่ใจ: ห้ามเปลี่ยนถ้อยคำสงสัยให้กลายเป็นข้อเท็จจริง');
 // A warning is a review hint, not proof of logical contradiction.
 return clues;
}
function grams(text){
 const source=trim(text,450).normalize('NFC').toLowerCase().replace(/\s+/g,' ');
 const result=new Set();
 for(let i=0;i<source.length-1;i++)if(!source.slice(i,i+2).includes(' '))result.add(source.slice(i,i+2));
 return result;
}
function examples(bundle,lessons,limit=3){
 const sample=Array.isArray(lessons)?lessons:[];
 const target=grams([bundle?.previous?.voiceover,bundle?.current?.voiceover,bundle?.next?.voiceover].filter(Boolean).join(' '));
 return sample.filter(x=>x&&ISSUES.includes(x.issue)&&typeof x.original==='string'&&typeof x.revised==='string')
  .map(x=>{
   const other=grams([x.previous,x.original,x.next].filter(Boolean).join(' '));
   let shared=0;for(const term of target)if(other.has(term))shared++;
   const score=target.size&&other.size?2*shared/(target.size+other.size):0;
   return {item:x,score};
  }).filter(x=>x.score>=.15).sort((a,b)=>b.score-a.score).slice(0,Math.min(3,Math.max(0,limit)))
  .map(({item,score})=>({issue:item.issue,
   before:trim(item.original,230),after:trim(item.revised,230),
   reason:trim(item.ownerReason||item.teacherReason,200),similarity:+score.toFixed(3)}));
}
function prompt(bundle,related=[],foundationExamples=[],childAdvice=null){
 if(!bundle?.current?.voiceover)throw Error('เลือกฉากที่มีบทพากย์ก่อน');
 const data={task:'thai-story-coherence',
  instructions:'Review Thai narration PREVIOUS/CURRENT/NEXT using editorialChecklist. Identify evidence and distinguish contradictions from unknown information. Prefer minimal changes, preserve deliberate repetition, uncertainty, suspense, emotion and spoken cadence. Preserve canon, established facts and chronology; no invented canon or irreversible events. If no justified change, return ops:[]. Return Thai rationale and at most one updateScene operation for CURRENT voiceover; never auto-apply.',
  editorialChecklist:[...EDITORIAL_CHECKLIST],
  context:bundle,localReviewHints:signals(bundle),
  ownerApprovedExamples:related.slice(0,2),
  syntheticFoundationExamples:foundationExamples.slice(0,1),
  experimentalChildAdvice:childAdvice?{label:childAdvice.label,
   source:'assistant-authored-synthetic',notProductionValidated:true}:null};
 // Preserve structurally valid JSON rather than truncating an escaped string.
 return JSON.stringify(data);
}
function validLesson(l){
 if(!l||typeof l!=='object'||!ISSUES.includes(l.issue))return false;
 return typeof l.original==='string'&&l.original.trim().length>=4&&
  typeof l.revised==='string'&&l.revised.trim().length>=4&&
  l.original.length<=1200&&l.revised.length<=1200;
}
return Object.freeze({ISSUES,EDITORIAL_CHECKLIST,selected,signals,examples,prompt,validLesson});
});
