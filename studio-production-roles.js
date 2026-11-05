/* AI Mother V3 — 11 visual/story production roles, voice as a separate module.
 * Keeps all V1 six-stage IDs and all trained/script-review modules unchanged.
 * A registered role is NOT a trained weight, inference endpoint or finished renderer.
 */
(function(root,factory){
'use strict';
const api=factory();
if(typeof module==='object'&&module.exports)module.exports=api;
if(root)root.StoryProductionRoles=api;
})(typeof globalThis!=='undefined'?globalThis:null,function(){
'use strict';
const VERSION='mother-production-roles-v3';
const roles=Object.freeze([
 {id:'story-analyst',name:'AI-1 Story Analyst',task:'อ่านบทและแยกตัวละคร สถานที่ อารมณ์ วัตถุ และเหตุการณ์',output:'story-beats',support:'existing-script-review-advisory'},
 {id:'continuity-keeper',name:'AI-2 Continuity Keeper',task:'รักษาลำดับเหตุการณ์ รูปลักษณ์ ทรัพย์สิน และความสัมพันธ์ข้ามฉาก',output:'continuity-bible',support:'existing-continuity-coach-advisory'},
 {id:'scene-director',name:'AI-3 Scene Director',task:'แบ่งบทตามเหตุการณ์และคำนวณฉาก/ตอนตามเสียงจริงกับการกระทำ',output:'scene-breakdown',support:'existing-story-only-and-timing-rules'},
 {id:'storyboard-director',name:'AI-4 Storyboard Director',task:'ออกแบบช็อต มุมกล้องและการเปลี่ยนช็อต',output:'shot-plan',support:'existing-shot-ml-advisory'},
 {id:'environment-artist',name:'AI-5 Environment Artist',task:'สร้างรายการฉากหลังและ SVG ของสถานที่จริงตามข้อจำกัดเอนจิน',output:'environment-svg',support:'existing-templates-only'},
 {id:'character-artist',name:'AI-6 Character Artist',task:'สร้างตัวละคร SVG พร้อมข้อต่อและจุดยึดตามคาแรกเตอร์',output:'character-rig',support:'existing-rigs-only'},
 {id:'prop-artist',name:'AI-7 Prop Artist',task:'วาดวัตถุจริงที่มีจุดจับ/ตำแหน่ง/สถานะ ไม่ใช้รูปทรงแทนผิดชนิด',output:'prop-svg',support:'existing-templates-only'},
 {id:'layout-director',name:'AI-8 Layout Director',task:'จัดสเกล ความลึก ระยะห่างและตรวจวัตถุหลุดเฟรม',output:'layout-plan',support:'existing-composition-rules'},
 {id:'motion-director',name:'AI-9 Motion Director',task:'สร้างลำดับท่าทางและ keyframes สำหรับการกระทำต่อเนื่อง',output:'motion-keys',support:'existing-basic-keyframes'},
 {id:'timeline-editor',name:'AI-10 Timeline Editor',task:'ประกอบภาพ เสียง ซับ และเวลาตามเสียงจริง; ไม่ตัดคำ/เสียง',output:'timeline',support:'existing-timing-auditor'},
 {id:'quality-inspector',name:'AI-11 Quality Inspector',task:'ตรวจ Scene Graph เทียบต้นฉบับและขอหลักฐานเฟรม/เสียงก่อนรับวิดีโอ',output:'qa-report',support:'existing-json-qa-not-pixel-qa'}
].map(x=>Object.freeze({...x,status:'role-defined-not-trained-model'})));
const voiceRole=Object.freeze({id:'voice-module',name:'พากย์เสียงแยกต่างหาก',engines:['system','mother']});
const legacyStages=Object.freeze([
 {id:'composition',newRole:'layout-director'},
 {id:'assets',newRole:'environment-artist'},
 {id:'motion',newRole:'motion-director'},
 {id:'voice',newRole:'separate-voice-module'},
 {id:'timing',newRole:'timeline-editor'},
 {id:'qa',newRole:'quality-inspector'}
].map(x=>Object.freeze(x)));
const preserved=Object.freeze([
 'studio-script-ml.js','studio-story-foundation.js','studio-story-coach.js',
 'studio-auto-teach.js','studio-student-learning.js',
 'autodub/story_auto_train.py','autodub/student_learning.py',
 'autodub/thai_editor.py','autodub/teacher.py',
 'training-lab/datasets','training-lab/evaluations'
]);
const types=Object.freeze(['story-beats','continuity-bible','scene-breakdown','shot-plan',
 'environment-svg','character-rig','prop-svg','layout-plan','motion-keys',
 'timeline','qa-report']);
function signature(project){
 const source=(project?.episodes||[]).map(ep=>[ep.id,(ep.scenes||[]).map(
  sc=>[sc.id,sc.voiceover||sc.text||'',sc.notes||''])]);
 const str=JSON.stringify(source);
 let h=2166136261;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619)}
 return ('00000000'+(h>>>0).toString(16)).slice(-8);
}
function createPlan(project){
 if(!project||!Array.isArray(project.episodes)||!project.episodes.length)
  throw Error('ต้องมี episodes ก่อนวางงานผลิต');
 const tasks=[],seen=new Set(),hash=signature(project);
 for(const ep of project.episodes){
  if(!Array.isArray(ep?.scenes))throw Error('ตอนต้องมี scenes');
  for(const sc of ep.scenes){
   const id=String(sc?.id||'');
   if(!id||seen.has(id))throw Error('scene ID ว่างหรือซ้ำ');
   seen.add(id);
   const source=String(sc.voiceover||sc.text||'');
   for(let i=0;i<roles.length;i++){
    const role=roles[i];
    tasks.push({episodeId:String(ep.id||''),sceneId:id,roleId:role.id,
     order:i+1,requires:i?[roles[i-1].id]:[],
     sourceHash:hash,outputType:role.output,status:'pending',
     result:null});
   }
  }
 }
 if(seen.size>400)throw Error('เกิน 400 ฉากในแผนเดียว');
 return {version:VERSION,motherRole:'production-orchestrator',sourceHash:hash,
  scenes:seen.size,roles:roles.length,tasks,
  executable:false,reason:'role plan only: worker dispatch is managed by StoryMotherProduction; dubbing is separate'};
}
return Object.freeze({VERSION,roles,voiceRole,legacyStages,preserved,types,signature,createPlan});
});
