/* Story Studio AI Workspace — shared, dependency-free continuity + response validation.
 * Model output is UNTRUSTED: always validate ops and save a recovery snapshot before auto-apply. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.StoryAIWorkspaceCore=api;
})(typeof globalThis!=='undefined'?globalThis:null,function(){
  'use strict';
  // Exactly two assistants. Writing, storyboarding, motion, QA and asset creation
  // are manual editor responsibilities, not separate AI agents.
  const roles=Object.freeze([
    {id:'voice',name:'AI-1 พากย์เสียง',instruction:'อ่านบทพากย์หรือซับที่ผู้ใช้เขียนเอง สร้างเสียงผ่านระบบพากย์ที่เชื่อมต่อไว้ โดยไม่เขียนบทใหม่'},
    {id:'sound',name:'AI-2 จัดเสียงตามเหตุการณ์',instruction:'เลือกเสียงจากคลังเสียงสังเคราะห์ให้ตรงกับเหตุการณ์ จัดเวลาจากซับและบรรยากาศ ลดเสียงไม่ให้กลบพากย์ ไม่แก้บทหรือภาพ'}
  ]);
  const LIMIT=180;
  const short=(x,n)=>String(x??'').trim().slice(0,n);
  const clone=x=>JSON.parse(JSON.stringify(x));
  const id=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,9);
  function ensure(value){
    const w=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
    if(!Array.isArray(w.history))w.history=[];
    if(!Array.isArray(w.tasks))w.tasks=[];
    if(!w.bible||typeof w.bible!=='object'||Array.isArray(w.bible))w.bible={};
    if(!w.summaries||typeof w.summaries!=='object'||Array.isArray(w.summaries))w.summaries={};
    if(!roles.some(r=>r.id===w.role))w.role='voice';
    if(typeof w.projectId!=='string'||!w.projectId)w.projectId='story'+id();
    if(typeof w.engineModel!=='string')w.engineModel='Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
    return w;
  }
  function historyPush(w,entry){
    ensure(w);w.history.push({id:id(),date:new Date().toISOString(),...entry});
    if(w.history.length>LIMIT)w.history.splice(0,w.history.length-LIMIT);
    return w.history[w.history.length-1];
  }
  function context(state,epIndex=0){
    const project=state?.project||{},w=ensure(project.aiWorkspace||{}),eps=Array.isArray(state?.episodes)?state.episodes:[];
    const characters=(state?.characters||[]).slice(0,26).map(c=>({id:c.id,name:short(c.name,64),role:short(c.role,90),identity:short(c.promptBlock,180)}));
    const episodes=eps.slice(Math.max(0,eps.length-12)).map((e,i)=>({id:e.id,title:short(e.title,90),n:Math.max(0,eps.length-12)+i+1,scenes:e.scenes?.length||0,summary:short(w.summaries?.[e.id],850),cliffhanger:short(e.cliffhanger,160)}));
    const current=eps[epIndex]||eps[0],scenes=(current?.scenes||[]).slice(-6).map(s=>({
      id:s.id,location:s.location,duration:s.duration,voice:short(s.voiceover,155),subtitle:short((s.subtitle||[]).join(' '),155),notes:short(s.notes,170)
    }));
    return {title:short(project.title,90),style:short(project.styleSuffix,180),bible:{
      premise:short(w.bible.premise,1300),world:short(w.bible.world,1300),
      characters:short(w.bible.characters,1300),timeline:short(w.bible.timeline,1300),threads:short(w.bible.threads,1300)
    },characters,episodes,currentEpisode:current?{id:current.id,title:current.title,scenes}:null};
  }
  // Retained for reading historical project data; audio operations are intentionally
  // deterministic and call the existing TTS/sound engines directly.
  function systemPrompt(role,state,epIndex){
    const current=roles.find(r=>r.id===role)||roles[0];
    return 'คุณเป็น '+current.name+'. '+current.instruction+
      '. บทและฉากเป็นของผู้ใช้ ห้ามเขียน ดัดแปลง หรือลบข้อความ. '+JSON.stringify(context(state,epIndex)).slice(0,5300);
  }
  function parseResult(text){
    const raw=String(text||'').trim();
    const fenced=raw.replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,'');
    let out;for(const sample of [fenced,raw.slice(raw.indexOf('{'),raw.lastIndexOf('}')+1)]){
      try{out=JSON.parse(sample);if(out&&typeof out==='object'&&!Array.isArray(out))break;}catch(e){}
    }
    if(!out||typeof out!=='object'||Array.isArray(out))return {reply:short(raw,4500),ops:[],bibleSuggestion:''};
    const ops=Array.isArray(out.ops)?out.ops.filter(x=>x&&typeof x==='object'&&!Array.isArray(x)&&typeof x.op==='string'&&!/delete|replace|remove/i.test(x.op)).slice(0,6):[];
    const suggested=out.assetSuggestion&&typeof out.assetSuggestion==='object'&&!Array.isArray(out.assetSuggestion)&&JSON.stringify(out.assetSuggestion).length<=14000?out.assetSuggestion:null;
    return {reply:short(out.reply||out.message||raw,4500),ops,bibleSuggestion:short(out.bibleSuggestion,1600),assetSuggestion:suggested};
  }
  function validateSnapshot(data){
    if(!data||typeof data!=='object'||Array.isArray(data))throw Error('รูปแบบโปรเจกต์ไม่ถูกต้อง');
    if(!data.project||typeof data.project!=='object')throw Error('ไม่พบข้อมูล project');
    if(!Array.isArray(data.episodes)||!data.episodes.length||data.episodes.some(e=>!Array.isArray(e?.scenes)||!e.scenes.length))throw Error('ไม่พบตอนและฉากที่ถูกต้อง');
    return data;
  }
  function summaryOfSnapshot(data){
    validateSnapshot(data);
    return {title:short(data.project.title||'โปรเจกต์',100),episodes:data.episodes.length,
      scenes:data.episodes.reduce((n,e)=>n+e.scenes.length,0),projectId:ensure(data.project.aiWorkspace||{}).projectId};
  }
  return Object.freeze({roles,ensure,historyPush,context,systemPrompt,parseResult,validateSnapshot,summaryOfSnapshot,clone,id});
});
