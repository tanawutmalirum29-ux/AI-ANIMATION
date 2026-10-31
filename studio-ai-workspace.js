/* Story Studio AI Workbench — free on-device model with guarded automatic project editing.
 * The browser loads an open-source local WebLLM model on first prompt; no cloud AI API key,
 * paid inference endpoint, GitHub Models API, or new server billing required.
 * Untrusted ops are dry-run validated and backed up before automatic application.
 */
(function(root){
'use strict';
const core=root.StoryAIWorkspaceCore;
if(!core)return;
const DB='storyStudio.projectLibrary.v1',STORE='snapshots';
let bridge,rootElement,view='chat',audioScope='episode',busy=false,progress='',lastError='',db=null,dbPromise=null;
let targetMinutes=5,splitEpisodes=true,lastAudit=null;
const MAX_TASKS=130;
const LOCAL_MODELS=[
 {id:'standard',label:'มาตรฐาน · Timing Engine (ค่าเริ่มต้น)',mb:0},
 {id:'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',label:'Qwen 2.5 · 0.5B',mb:280},
 {id:'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',label:'Qwen 2.5 · 1.5B',mb:870},
 {id:'Qwen2.5-3B-Instruct-q4f16_1-MLC',label:'Qwen 2.5 · 3B',mb:1750},
 {id:'Qwen2.5-7B-Instruct-q4f16_1-MLC',label:'Qwen 2.5 · 7B (อุปกรณ์แรง)',mb:4100},
 {id:'smollm2-135m-cpu',label:'CPU/WASM · SmolLM2 135M (ภาษาไทยจำกัด)',backend:'wasm',mb:185},
 {id:'qwen2.5-0.5b-cpu',label:'CPU/WASM · Qwen 2.5 0.5B (ไม่ใช้ WebGPU)',backend:'wasm',mb:790}
];
const MODEL_KEY='storyStudio.aiAnalysisModel.v1';
let chosenModel=(()=>{try{return localStorage.getItem(MODEL_KEY)||'standard'}catch(_){return 'standard'}})();
if(!LOCAL_MODELS.some(m=>m.id===chosenModel))chosenModel='standard';
let localEngine=null,loadedModel='',modelReport='',modelUnavailable=false,modelWorker=null,modelAbortController=null,modelBackend='',modelCleanup=Promise.resolve();
let gpuCapability=null;
let modelLoad={active:false,ready:false,model:'',percent:null,stage:'',started:0,lastUpdate:0,rate:0,error:''};
function formatElapsed(seconds){const n=Math.max(0,Math.floor(seconds));return n>=60?Math.floor(n/60)+' นาที '+n%60+' วินาที':n+' วินาที'}
function updateModelLoad(patch){
 modelLoad={...modelLoad,...patch,lastUpdate:performance.now()};
 const box=rootElement?.querySelector('#aiModelLoadStatus');
 if(box){
  box.hidden=!modelLoad.active&&!modelLoad.error&&!modelLoad.ready;
  const bar=box.querySelector('progress'),label=box.querySelector('[data-model-label]'),
   detail=box.querySelector('[data-model-detail]');
  const value=modelLoad.percent;
  if(bar){if(value===null)bar.removeAttribute('value');else bar.value=value}
  if(label)label.textContent=modelLoad.error?'โหลดโมเดลไม่สำเร็จ':modelLoad.ready?'โมเดล '+modelLoad.model+' พร้อมใช้งาน':modelLoad.active?
   'กำลังโหลด '+modelLoad.model+(value===null?'':' · '+value+'%'):'โหลดโมเดลเสร็จ';
  if(detail)detail.textContent=modelLoad.error||modelLoad.stage+
   (modelLoad.started?' · ผ่านไป '+formatElapsed((performance.now()-modelLoad.started)/1000):'');
 }
}
function modelLoadPanel(){
 const bar=e('progress',{max:100,'aria-label':'ความคืบหน้าการโหลดโมเดล'});
 const panel=e('section',{id:'aiModelLoadStatus',role:'status','aria-live':'polite',
  style:'padding:12px;border:1px solid var(--line, #6b7280);border-radius:12px;margin:12px 0;'},
  e('strong',{'data-model-label':''},'กำลังเตรียม AI'),
  bar,e('small',{'data-model-detail':'',style:'display:block;overflow-wrap:anywhere'},''));
 panel.hidden=!modelLoad.active&&!modelLoad.error&&!modelLoad.ready;
 queueMicrotask(()=>updateModelLoad({}));
 return panel;
}

function confirmModelAction(message){
 return new Promise(resolve=>{
  const overlay=document.createElement('div');
  overlay.setAttribute('role','presentation');
  overlay.style.cssText='position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:18px;';
  const card=document.createElement('section');
  card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');
  card.setAttribute('aria-label','ยืนยันการใช้โมเดล AI');
  card.style.cssText='width:min(420px,100%);background:#1c304b;color:#fff;border:1px solid #6484a8;border-radius:16px;padding:22px;box-shadow:0 20px 60px #0008;';
  const title=document.createElement('h3');title.textContent='ยืนยันการทำงานของ AI';title.style.margin='0 0 12px';
  const info=document.createElement('p');info.textContent=message;info.style.cssText='line-height:1.6;white-space:pre-wrap';
  const actions=document.createElement('div');actions.style.cssText='display:flex;justify-content:flex-end;gap:12px;margin-top:20px;flex-wrap:wrap';
  const cancel=document.createElement('button'),ok=document.createElement('button');
  cancel.type=ok.type='button';cancel.textContent='ยกเลิก';ok.textContent='ดำเนินการ';
  for(const b of [cancel,ok])b.style.cssText='border:1px solid #7f99b6;border-radius:10px;padding:12px 18px;background:#284361;color:white;cursor:pointer;min-height:44px';
  ok.style.background='#d9b46e';ok.style.color='#101e30';
  actions.append(cancel,ok);card.append(title,info,actions);overlay.append(card);document.body.append(overlay);
  const previous=document.activeElement;
  const done=value=>{document.removeEventListener('keydown',key);overlay.remove();previous?.focus?.();resolve(value)};
  const key=ev=>{if(ev.key==='Escape'){ev.preventDefault();done(false)}};
  document.addEventListener('keydown',key);
  cancel.addEventListener('click',()=>done(false),{once:true});
  ok.addEventListener('click',()=>done(true),{once:true});
  overlay.addEventListener('click',ev=>{if(ev.target===overlay)done(false)});
  cancel.focus();
 });
}
function releaseLocalModel(){
 // A terminated worker releases its own tokenizer. For Safari compatibility mode,
 // await the direct engine's unload before allocating another GPU engine.
 if(modelWorker){try{modelWorker.terminate()}catch(_){}modelWorker=null}
 else if(localEngine?.unload){try{modelCleanup=Promise.resolve(localEngine.unload()).catch(()=>{})}catch(_){}}
 localEngine=null;loadedModel='';modelUnavailable=false;modelBackend='';
}
function cancelLocalTask(){
 if(!modelAbortController)return;
 modelAbortController.abort();
 releaseLocalModel();
 updateModelLoad({active:false,ready:false,error:'ยกเลิกงาน AI แล้ว · โปรเจกต์ยังอยู่ในหน้าเดิม',percent:null});
}
function abortableModelWork(promise){
 const signal=modelAbortController?.signal;
 if(!signal)return Promise.resolve(promise);
 if(signal.aborted)return Promise.reject(Error('ยกเลิกงาน AI แล้ว'));
 return new Promise((resolve,reject)=>{
  const abort=()=>{signal.removeEventListener('abort',abort);reject(Error('ยกเลิกงาน AI แล้ว'))};
  signal.addEventListener('abort',abort,{once:true});
  Promise.resolve(promise).then(value=>{signal.removeEventListener('abort',abort);resolve(value)},
   err=>{signal.removeEventListener('abort',abort);reject(err)});
 });
}

function createCpuModelClient(worker,callback){
 let requestNumber=0;
 const pending=new Map();
 const onMessage=ev=>{
  const m=ev.data;
  if(m?.channel!=='story-cpu')return;
  if(m.type==='progress'){callback?.(m);return}
  const item=pending.get(m.requestId);
  if(!item)return;
  pending.delete(m.requestId);
  if(m.type==='error')item.reject(Error(String(m.message||'CPU model failure')));
  else if(m.type==='complete')item.resolve(m.result);
 };
 const onError=ev=>{
  ev.preventDefault?.();
  for(const p of pending.values())p.reject(Error('CPU Worker ทำงานล้มเหลว'));
  pending.clear();
 };
 worker.addEventListener('message',onMessage);
 worker.addEventListener('error',onError);
 const send=(type,payload={})=>new Promise((resolve,reject)=>{
  const requestId='cpu'+(++requestNumber);
  pending.set(requestId,{resolve,reject});
  try{worker.postMessage({channel:'story-cpu',type,requestId,...payload})}
  catch(err){pending.delete(requestId);reject(err)}
 });
 return {init:id=>send('init',{model:id}),chat:{completions:{create:options=>send('generate',{
  messages:options.messages,max_tokens:options.max_tokens,temperature:options.temperature
 })}},unload:async()=>{
  for(const p of pending.values())p.reject(Error('CPU โมเดลถูกปิด'));
  pending.clear();
  worker.removeEventListener('message',onMessage);
  worker.removeEventListener('error',onError);
  worker.terminate();
 }};
}
async function loadCpuModel(id,selected){
 updateModelLoad({active:true,ready:false,model:selected.label,percent:null,
  stage:'เตรียม AI แบบ CPU/WASM · ไม่ต้องใช้ WebGPU',started:performance.now(),error:''});
 let worker=null;
 try{
  await abortableModelWork(modelCleanup);
  worker=new Worker(new URL('./studio-ai-cpu-worker.js',document.baseURI),{type:'module'});
  modelWorker=worker;
  const engine=createCpuModelClient(worker,p=>{
   if(modelWorker!==worker)return;
   updateModelLoad({percent:Number.isFinite(p.percent)?p.percent:null,stage:String(p.stage||'กำลังโหลด CPU').slice(0,260)});
  });
  await abortableModelWork(engine.init(id));
  updateModelLoad({active:true,ready:false,percent:100,stage:'ตรวจสอบการสร้างข้อความจริงบน CPU'});
  const check=await abortableModelWork(engine.chat.completions.create({
   messages:[{role:'user',content:'ตอบคำว่า พร้อม'}],max_tokens:10,temperature:0
  }));
  if(!String(check.choices?.[0]?.message?.content||'').trim())throw Error('CPU โมเดลไม่สร้างข้อความ');
  if(modelWorker!==worker)throw Error('ยกเลิกการโหลดโมเดลแล้ว');
  localEngine=engine;loadedModel=id;modelBackend='cpu';modelUnavailable=false;
  updateModelLoad({active:false,ready:true,percent:100,error:'',
   stage:'CPU/WASM ผ่านการสร้างข้อความแล้ว · อาจประมวลผลช้ากว่า GPU มาก'});
  return engine;
 }catch(err){
  if(worker){try{worker.terminate()}catch(_){}}
  if(modelWorker===worker)modelWorker=null;
  localEngine=null;loadedModel='';modelBackend='';
  updateModelLoad({active:false,ready:false,percent:null,
   error:'CPU/WASM ไม่สำเร็จ: '+String(err?.message||err),stage:'ไม่สามารถประมวลผลบนอุปกรณ์นี้'});
  throw err;
 }
}
function chooseModel(id){
 if(busy)return;
 const next=LOCAL_MODELS.some(m=>m.id===id)?id:'standard';
 if(localEngine&&loadedModel!==next)releaseLocalModel();
 chosenModel=next;
 try{localStorage.setItem(MODEL_KEY,chosenModel)}catch(_){}
 modelReport='';
 updateModelLoad({active:false,ready:!!localEngine,error:'',percent:localEngine?100:null,
  model:LOCAL_MODELS.find(m=>m.id===next)?.label||next,
  stage:localEngine?'โมเดลอยู่ในหน่วยความจำ พร้อมใช้งาน':'เลือกโมเดลแล้ว · สามารถโหลดได้โดยไม่รีเฟรชเว็บ'});
 render();
}
async function webGpuReady(){
 if(!navigator.gpu)return false;
 try{return !!(await navigator.gpu.requestAdapter())}catch(_){return false}
}
function invalidateModelOnFailure(err){
 if(!/disposed|deleted object|tokenizer\*|device lost|out of memory|wasm/i.test(String(err?.message||err)))return;
 releaseLocalModel();
 updateModelLoad({active:false,ready:false,percent:null,
  error:'Tokenizer/WebGPU ของโมเดลนี้ใช้งานไม่ได้ · เลือกโมเดลอื่นหรือกดทดสอบใหม่ได้โดยไม่ต้องรีโหลดเว็บไซต์'});
}
async function waitWorkerBootstrap(worker){
 return new Promise((resolve,reject)=>{
  let finished=false;
  const clean=()=>{
   worker.removeEventListener('message',onMessage);
   worker.removeEventListener('error',onError);
   clearTimeout(timeout);
  };
  const done=(error)=>{
   if(finished)return;finished=true;clean();
   if(error)reject(error);else resolve();
  };
  const onMessage=event=>{
   if(event.data?.type==='story-worker-ready')done();
   if(event.data?.type==='story-worker-error')done(Error(event.data.message||'WebLLM Worker เริ่มไม่ได้'));
  };
  const onError=event=>{event.preventDefault();done(Error('Worker ไม่สามารถโหลด module ได้ (Safari/CDN/CSP)'))};
  const timeout=setTimeout(()=>done(Error('WebLLM Worker ตอบกลับช้าเกิน 25 วินาที')),25000);
  worker.addEventListener('message',onMessage);
  worker.addEventListener('error',onError);
 });
}
async function loadLocalModel(id){
 if(localEngine&&loadedModel===id&&!modelUnavailable)return localEngine;
 if(!LOCAL_MODELS.some(m=>m.id===id&&m.id!=='standard'))throw Error('โมเดลไม่ถูกต้อง');
 if(localEngine||modelWorker)releaseLocalModel();
 const selected=LOCAL_MODELS.find(m=>m.id===id);
 if(selected.backend==='wasm')return loadCpuModel(id,selected);
 updateModelLoad({active:true,ready:false,model:selected.label,percent:null,
  stage:'ตรวจสอบ WebGPU',started:performance.now(),error:''});
 let worker=null,engine=null,backend='worker',warning='',workerBooted=false;
 try{
  await abortableModelWork(modelCleanup);
  if(!(await webGpuReady()))throw Error('เบราว์เซอร์นี้ไม่มี WebGPU · เลือกโมเดล CPU/WASM ในรายการ หรือใช้มาตรฐานแทน')
  updateModelLoad({stage:'โหลด WebLLM จาก CDN',percent:null});
  const webllm=await abortableModelWork(import('https://esm.run/@mlc-ai/web-llm@0.2.80').catch(()=>import('https://esm.sh/@mlc-ai/web-llm@0.2.80')));
  if(!webllm.prebuiltAppConfig.model_list.some(m=>m.model_id===id))
   throw Error('WebLLM รุ่นนี้ไม่มีโมเดล '+selected.label);
  const onProgress=p=>{
   const n=Number(p.progress);
   updateModelLoad({percent:Number.isFinite(n)?Math.max(0,Math.min(100,Math.round(n*100))):null,
    stage:String(p.text||'กำลังโหลดโมเดล').slice(0,260)});
  };
  try{
   updateModelLoad({stage:'ตรวจสอบ Web Worker ใน Safari',percent:null});
   worker=new Worker(new URL('./studio-ai-model-worker.js',document.baseURI),{type:'module'});
   modelWorker=worker;
   await abortableModelWork(waitWorkerBootstrap(worker));
   workerBooted=true;
   updateModelLoad({stage:'โหลดโมเดลใน Web Worker',percent:0});
   engine=await abortableModelWork(webllm.CreateWebWorkerMLCEngine(worker,id,{initProgressCallback:onProgress}));
  }catch(workerError){
   if(modelAbortController?.signal.aborted||workerBooted)throw workerError;
   // Only fall back when Safari cannot *start* the worker. Never launch a second
   // large model immediately after a failed GPU allocation/OOM in a live worker.
   if(worker){worker.terminate();worker=null;modelWorker=null}
   backend='main';
   warning='Web Worker ใช้งานไม่ได้: '+String(workerError?.message||workerError).slice(0,170);
   updateModelLoad({stage:'โหมดเข้ากันได้กับ iPad · ประมวลผลโดยตรงในหน้าเว็บ',percent:null,error:''});
   engine=await abortableModelWork(webllm.CreateMLCEngine(id,{initProgressCallback:onProgress}));
  }
  updateModelLoad({active:true,ready:false,percent:100,
   stage:'ทดสอบ Tokenizer และการสร้างข้อความจริง',error:''});
  await abortableModelWork(engine.chat.completions.create({
   messages:[{role:'user',content:'ตอบคำว่า พร้อม'}],max_tokens:12,temperature:0
  }));
  if(modelAbortController?.signal.aborted)throw Error('ยกเลิกงาน AI แล้ว');
  localEngine=engine;loadedModel=id;modelUnavailable=false;modelBackend=backend;
  updateModelLoad({active:false,ready:true,percent:100,error:'',
   stage:'AI พร้อมใช้งาน · '+(backend==='worker'?'Web Worker':'โหมดเข้ากันได้กับ iPad')+
    (warning?' · '+warning:'')});
  return engine;
 }catch(err){
  if(worker){try{worker.terminate()}catch(_){}}
  if(modelWorker===worker)modelWorker=null;
  if(engine&&backend==='main'){try{await engine.unload?.()}catch(_){}}
  localEngine=null;loadedModel='';modelBackend='';
  updateModelLoad({active:false,ready:false,percent:null,
   error:String(err?.message||err),stage:'โหลดหรือทดสอบ AI ไม่สำเร็จ'});
  throw err;
 }
}
function analysisInput(){
 const state=bridge.get(),scope=audioScope,epIndex=bridge.episodeIndex();
 const episodes=scope==='all'?state.episodes:scope==='episode'?[state.episodes[epIndex]]:[state.episodes[epIndex]];
 const scenes=episodes.flatMap(ep=>(scope==='scene'?[ep.scenes[bridge.sceneIndex?.()||0]]:ep.scenes).filter(Boolean).map(sc=>({
  id:sc.id,duration:sc.duration,voiceover:String(sc.voiceover||'').slice(0,450),
  actors:Array.isArray(sc.actors)?sc.actors.length:0,
  audioClips:Array.isArray(sc.audioClips)?sc.audioClips.length:0,
  notes:String(sc.notes||'').slice(0,180)
 }))).slice(0,18);
 return {scenes,baseline:evaluate().stats};
}
async function benchmarkModel(applyChanges=false){
 if(busy)return;
 if(chosenModel==='standard'){previewAudit();modelReport='มาตรฐาน: ไม่ต้องดาวน์โหลดโมเดล · ไม่มีโควตา · ใช้การตรวจเวลาจริง';render();return}
 const model=LOCAL_MODELS.find(m=>m.id===chosenModel);
 if(model.backend!=='wasm'&&gpuCapability===false){modelReport='อุปกรณ์นี้ไม่มี WebGPU ใช้ Qwen แบบ GPU ไม่ได้ · เปลี่ยนตัวเลือกเป็น CPU/WASM หรือมาตรฐาน';render();return}
 if(!(localEngine&&loadedModel===chosenModel&&!modelUnavailable)&&!(await confirmModelAction(
  'เตรียมโมเดล '+model.label+'\\n'+(model.backend==='wasm'?'CPU อาจช้ามากและใช้ RAM สูง ไม่มีการเรียก API':'ต้องรองรับ WebGPU')+
  '\\nหากยังไม่มีแคชต้องดาวน์โหลดประมาณ '+model.mb+' MB · ดำเนินการบนเครื่องนี้?')))return;
 busy=true;modelAbortController=new AbortController();render();
 const start=performance.now();
 try{
  const engine=await loadLocalModel(chosenModel);
  const loadedMs=performance.now()-start;
  const sample=analysisInput();
  status('กำลังทดสอบการวิเคราะห์ฉากด้วย '+model.label);
  const inferenceStart=performance.now();
  const response=await abortableModelWork(engine.chat.completions.create({messages:[
   {role:'system',content:'คุณเป็นผู้ช่วยตรวจจังหวะภาพยนตร์ภาษาไทย วิเคราะห์ JSON ที่มีอยู่ ห้ามแต่งหรือแก้บท ตอบสั้นๆเป็นภาษาไทย ระบุฉากที่อาจยาวเกินเสียงพากย์ และบอกว่าไม่สามารถยืนยันความยาวเสียงจริงได้หากไม่มีข้อมูลเสียง ห้ามเดาตัวเลขความยาวเสียง'},
   {role:'user',content:JSON.stringify(sample).slice(0,7000)}
  ],temperature:0.1,max_tokens:220}));
  const inferenceSec=Math.max(.001,(performance.now()-inferenceStart)/1000);
  const tokens=response.usage?.completion_tokens||0;
  const answer=String(response.choices?.[0]?.message?.content||'ไม่มีคำตอบ').slice(0,1500);
  modelReport='รุ่น: '+model.label+'\nโหลดรวม: '+(loadedMs/1000).toFixed(1)+' วินาที\nวิเคราะห์: '+inferenceSec.toFixed(1)+' วินาที'+(tokens?'\nความเร็ว: '+(tokens/inferenceSec).toFixed(1)+' token/วินาที':'')+'\nผลวิเคราะห์ (ยังไม่แก้ JSON):\n'+answer;
  if(applyChanges){
   status('กำลังให้ AI วิเคราะห์แผนแก้ไข JSON จริง…');
   const state=bridge.get(),audit=evaluate(),scope=audioScope;
   const selected=audit.scenes.filter(x=>x.kind!=='other').slice(0,20);
   const scenes=selected.map(x=>{
    const ep=state.episodes.find(ep=>ep.id===x.episodeId);
    const scene=ep?.scenes?.find(sc=>sc.id===x.sceneId);
    return {id:x.sceneId,old:x.old,baseline:x.suggested,voiceEnd:x.voicedSeconds,
     hasTimedEvents:x.hasTimedEvents,kind:x.kind,
     notes:String(scene?.notes||'').slice(0,350),
     actors:(scene?.actors||[]).slice(0,6).map(a=>({at:a.at,to:a.to,motion:a.motion})),
     audioClips:(scene?.audioClips||[]).slice(0,8).map(c=>({kind:c.kind,at:c.at,duration:c.duration,loop:c.loop}))};
   });
   const proposal=await abortableModelWork(engine.chat.completions.create({messages:[
    {role:'system',content:'You are an animation timing editor. Return ONLY valid JSON {"changes":[{"id":"existing scene id","duration":number,"reason":"Thai concise explanation"}]}. Do not change story text, actors, dialogue, audio, scene order, or create scenes. Keep all narration and timed animation/audio events. Duration in seconds. For scenes with voice clips, duration must be >= voiceEnd+0.35. If a scene has timed events, prefer keeping old duration. Limit to existing ids. Avoid arbitrary changes. You may make no changes.'},
    {role:'user',content:JSON.stringify({scenes,targetMinutes,scope}).slice(0,12000)}
   ],temperature:0.1,max_tokens:700}));
   const raw=String(proposal.choices?.[0]?.message?.content||'').trim().replace(/^\x60\x60\x60(?:json)?/i,'').replace(/\x60\x60\x60$/,'').trim();
   const parsed=JSON.parse(raw);
   if(!Array.isArray(parsed.changes))throw Error('AI ไม่ส่ง changes JSON ที่ถูกต้อง');
   const byId=new Map(scenes.map(x=>[x.id,x]));
   const ops=[],reasons=[];
   for(const change of parsed.changes.slice(0,20)){
    const base=byId.get(change.id);
    if(!base||!Number.isFinite(change.duration))continue;
    const duration=Math.round(change.duration*100)/100;
    if(duration<1||duration>600||Math.abs(duration-base.old)<.1)continue;
    if(base.hasTimedEvents&&duration<base.old)continue;
    if(base.voiceEnd>0&&duration<base.voiceEnd+.35)continue;
    if(base.kind==='needs-dub'&&duration<base.old)continue;
    ops.push({op:'updateScene',id:base.id,patch:{duration}});
    reasons.push(base.id+': '+base.old+' → '+duration+' วินาที · '+String(change.reason||'').slice(0,100));
   }
   if(ops.length){
    const editor=root.StudioAPI;
    if(!editor?.apply)throw Error('StudioAPI ไม่พร้อม');
    const dry=editor.apply(ops,{dryRun:true});
    if(!dry.ok)throw Error('ตรวจแผนแก้ไขไม่ผ่าน');
    await backupBeforeEdit();
    const applied=editor.apply(ops);
    if(!applied.applied)throw Error('ไม่สามารถแก้ JSON ตามแผน AI');
   }
   modelReport+='\n\nAI ปรับระยะเวลาจริง '+ops.length+' ฉาก (สำรองก่อนแก้):\n'+(reasons.join('\n')||'ไม่มีฉากที่ AI เสนอแก้ภายใต้ข้อจำกัดความปลอดภัย');
  }
  status((applyChanges?'AI วิเคราะห์และปรับโปรเจกต์เสร็จ':'ทดสอบสำเร็จ')+' · '+model.label);
 }catch(err){invalidateModelOnFailure(err);modelReport='ทดสอบไม่สำเร็จ: '+String(err.message||err);status(modelReport,true)}
 finally{busy=false;modelAbortController=null;render()}
}


let narrativeModel='standard',narrativeMode='preserve',narrativeReport='';
const NARRATIVE_MODEL_KEY='storyStudio.narrativeModel.v1';
try{narrativeModel=localStorage.getItem(NARRATIVE_MODEL_KEY)||'standard'}catch(_){}
if(!LOCAL_MODELS.some(m=>m.id===narrativeModel))narrativeModel='standard';
function narrativeScenes(){
 const state=bridge.get(),index=bridge.episodeIndex(),ep=state.episodes[index];
 if(!ep)throw Error('ไม่พบตอนปัจจุบัน');
 const list=audioScope==='all'?state.episodes: [ep];
 return list.flatMap(episode=>(audioScope==='scene'?[episode.scenes[bridge.sceneIndex?.()||0]]:episode.scenes)
 .filter(Boolean).map(scene=>({id:scene.id,episode:episode.id,duration:scene.duration,
  voiceover:String(scene.voiceover||'').slice(0,1000),
  subtitle:Array.isArray(scene.subtitle)?scene.subtitle:[],
  subtitleCues:Array.isArray(scene.subtitleCues)?scene.subtitleCues:[],
  notes:String(scene.notes||'').slice(0,250)}))).slice(0,12);
}
function narrativeChunks(source,limit=24){
 const value=String(source||'').replace(/\s+/g,' ').trim();
 if(!value)return [];
 const segmented=typeof Intl!=='undefined'&&Intl.Segmenter;
 const units=segmented?[...new Intl.Segmenter('th',{granularity:'word'}).segment(value)].map(x=>x.segment):[value];
 const graphemes=str=>segmented?[...new Intl.Segmenter('th',{granularity:'grapheme'}).segment(str)].map(x=>x.segment):[...str];
 const chunks=[];let current='';
 const length=str=>[...str].length;
 const push=()=>{if(current.trim())chunks.push(current.trim());current=''};
 for(const unit of units){
  if(length(current+unit)<=limit){current+=unit;continue}
  push();
  if(length(unit)<=limit){current=unit;continue}
  for(const glyph of graphemes(unit)){
   if(length(current+glyph)>limit)push();
   current+=glyph;
  }
 }
 push();return chunks;
}
function standardNarrative(sc){
 const source=String(sc.voiceover||(sc.subtitle||[]).join(' ')).trim();
 if(!source)return null;
 // Never discard text after 3 lines. One subtitle page can contain 1-2 lines,
 // but many timed cues may be needed to cover the complete original narration.
 const chunks=narrativeChunks(source,24);
 const current=Array.isArray(sc.subtitle)?sc.subtitle:[];
 const subtitle=current.length>0&&current.length<=3&&current.every(x=>[...x].length<=28)?
  current:chunks.slice(0,3);
 let subtitleCues=null;
 if(!sc.subtitleCues?.length){
  const cueText=[];
  for(let i=0;i<chunks.length;i+=2)cueText.push(chunks.slice(i,i+2).join('\n'));
  const weights=cueText.map(x=>Math.max(2,[...x].length));
  const sum=weights.reduce((v,n)=>v+n,0)||1;
  const duration=Math.max(.2,Number(sc.duration)||4);
  let elapsed=0;
  subtitleCues=cueText.map((text,i)=>{
   const end=i===cueText.length-1?duration:Math.min(duration,elapsed+duration*weights[i]/sum);
   const cue={id:'ai3'+sc.id+'c'+i,text,start:+elapsed.toFixed(2),end:+end.toFixed(2)};
   elapsed=end;return cue;
  });
 }
 return {id:sc.id,voiceover:sc.voiceover,subtitle,subtitleCues};
}
async function runNarrative(){
 if(busy)return;
 busy=true;modelAbortController=new AbortController();render();
 try{
  const scenes=narrativeScenes();
  if(!scenes.length)throw Error('ไม่มีฉากให้ปรับ');
  let changes=[];
  if(narrativeModel==='standard'){
   changes=scenes.map(standardNarrative).filter(Boolean);
  }else{
   const engine=await loadLocalModel(narrativeModel);
   const rules=narrativeMode==='preserve'?'Keep voiceover EXACTLY unchanged. Only improve subtitle segmentation.':
    narrativeMode==='polish'?'Polish voiceover language and subtitles without changing events, identities, or plot.':
    'You may creatively rewrite narration and add small lines for atmosphere, but do not invent plot events or change identities.';
   const response=await abortableModelWork(engine.chat.completions.create({messages:[
    {role:'system',content:'You are a Thai animation narration and subtitle editor. Return ONLY JSON {"changes":[{"id":"scene id","voiceover":"Thai narration","subtitle":["Thai subtitle line"]}]}. '+rules+' Each subtitle line <=28 Thai characters, NO MORE THAN 3 lines per scene. Use concise subtitles while preserving the complete voiceover. Do not change scene order or other fields. Keep story faithful. Output only scenes that need edits.'},
    {role:'user',content:JSON.stringify(scenes).slice(0,11000)}
   ],temperature:.25,max_tokens:1300}));
   const raw=String(response.choices?.[0]?.message?.content||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/```$/,'').trim();
   const parsed=JSON.parse(raw);
   if(!Array.isArray(parsed.changes))throw Error('โมเดลไม่ได้ส่ง changes JSON');
   changes=parsed.changes;
  }
  const byId=new Map(scenes.map(x=>[x.id,x])),ops=[],summary=[];
  for(const item of changes.slice(0,12)){
   const old=byId.get(item.id);
   if(!old||!Array.isArray(item.subtitle)||item.subtitle.length>3)continue;
   const subtitle=item.subtitle.map(x=>String(x||'').trim());
   if(subtitle.some(x=>!x))continue;
   if(subtitle.some(x=>[...x].length>28))continue;
   const voiceover=narrativeMode==='preserve'||narrativeModel==='standard'?old.voiceover:String(item.voiceover||old.voiceover).slice(0,1500);
   if(!voiceover&&!subtitle.some(Boolean))continue;
   const patch={voiceover,subtitle};
   // Keep explicitly authored subtitle timings. Estimated cues are created only
   // for the standard mode when the scene previously had no timed captions.
   if(voiceover!==old.voiceover)patch.subtitleCues=[];
   else if(narrativeModel==='standard'&&Array.isArray(item.subtitleCues)&&
    item.subtitleCues.length&&!(old.subtitleCues||[]).length)patch.subtitleCues=item.subtitleCues;
   const changedCues=Object.prototype.hasOwnProperty.call(patch,'subtitleCues');
   if(voiceover===old.voiceover&&JSON.stringify(subtitle)===JSON.stringify(old.subtitle)&&!changedCues)continue;
   ops.push({op:'updateScene',id:old.id,patch});
   summary.push(old.id+': '+(voiceover!==old.voiceover?'ปรับบทบรรยายและซับ':
    changedCues?'จัดช่วงเวลาซับโดยประมาณ':'จัดซับใหม่'));
  }
  if(ops.length){
   const editor=root.StudioAPI;
   if(!editor?.apply)throw Error('StudioAPI ไม่พร้อม');
   const dry=editor.apply(ops,{dryRun:true});
   if(!dry.ok)throw Error('ตรวจรูปแบบการแก้ไขไม่ผ่าน: '+JSON.stringify((dry.errors||[]).slice(0,3))+' · '+JSON.stringify((dry.issues||[]).filter(x=>x.level==='error').slice(0,3)));
   await backupBeforeEdit();
   const result=editor.apply(ops);
   if(!result.applied)throw Error('ไม่สามารถใช้แผน AI-3: '+JSON.stringify((result.errors||[]).slice(0,3)));
  }
  const changedVoice=ops.some(o=>o.patch.subtitleCues?.length===0&&o.patch.voiceover);
  narrativeReport='AI-3 ปรับ '+ops.length+' ฉาก'+
   (ops.length?'\n'+summary.join('\n'):'\nไม่มีการแก้ไขใหม่ที่ผ่านเกณฑ์ หรือทุกฉากมีบทและซับเหมาะสมอยู่แล้ว')+
   (changedVoice?'\nบทเปลี่ยนแล้ว: กรุณาพากย์ใหม่ด้วย AI-2':
    ops.some(o=>o.patch.subtitleCues?.length)?'\nเวลาซับเป็นการประมาณจากความยาวฉาก ยังไม่ใช่การจับเวลาตามเสียงพากย์จริง':'');
  status(narrativeReport);
 }catch(err){invalidateModelOnFailure(err);narrativeReport='AI-3 ไม่สำเร็จ: '+String(err.message||err);status(narrativeReport,true)}
 finally{busy=false;modelAbortController=null;render()}
}
const e=(tag,props={},...children)=>{
 const element=document.createElement(tag);
 for(const [k,v]of Object.entries(props)){
   if(k==='className')element.className=v;
   else if(k==='value')element.value=v;
   else if(k==='checked')element.checked=!!v;
   else if(k==='selected')element.selected=!!v;
   else if(k==='disabled')element.disabled=!!v;
   else if(k==='style')element.style.cssText=v;
   else if(k.startsWith('on')&&typeof v==='function')element.addEventListener(k.slice(2),v);
   else if(v!==null&&v!==undefined)element.setAttribute(k,String(v));
 }
 for(const ch of children.flat()){if(ch===null||ch===undefined||ch===false)continue;element.append(ch instanceof Node?ch:document.createTextNode(String(ch)))}
 return element;
};
const button=(label,handler,extra={})=>e('button',{type:'button',onclick:handler,...extra},label);
const now=()=>new Date().toISOString();
const humanDate=s=>{try{return new Date(s).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'})}catch(_){return s||''}};
function w(){return core.ensure(bridge?.get()?.project?.aiWorkspace||{})}
function persist(mutator){
 const s=bridge.get();
 if(!s.project.aiWorkspace)s.project.aiWorkspace=core.ensure({});
 const state=core.ensure(s.project.aiWorkspace);
 mutator(state);
 bridge.persist();
}
function status(message,fail=false){progress=message;lastError=fail?message:'';const node=rootElement?.querySelector('#aiWorkspaceStatus');if(node){node.textContent=message;node.dataset.error=String(!!fail)}}
function setView(id){view=id;render()}
function createTask(role,scope){
 if(!['voice','structure'].includes(role))throw Error('รองรับแค่ AI ตรวจจังหวะและ AI พากย์');
 if(!['scene','episode','all'].includes(scope))throw Error('ขอบเขตไม่ถูกต้อง');
 const prompt=role==='voice'?'พากย์จากโปรเจกต์ JSON ที่นำเข้าแล้ว':'ตรวจเวลาจริงของฉากและตอนจาก JSON + คลิปพากย์จริง';
 const job={id:core.id(),role,scope,prompt,status:'queued',createdAt:now(),
  updatedAt:now(),targetMinutes,splitEpisodes:role==='structure'&&splitEpisodes,
  response:'',ops:[]};
 persist(s=>{s.role=role;s.tasks.push(job);if(s.tasks.length>MAX_TASKS)s.tasks.splice(0,s.tasks.length-MAX_TASKS);
  core.historyPush(s,{speaker:'user',role,text:prompt+' · '+scope,taskId:job.id})});
 return job;
}
function queueWork(role){
 if(busy){status('กำลังจัดการงานก่อนหน้าอยู่',true);return}
 try{const job=createTask(role,audioScope);runTask(job.id)}
 catch(err){status('เริ่มตรวจงานไม่ได้: '+err.message,true)}
}
function evaluate(scope=audioScope,minutes=targetMinutes){
 if(!bridge?.auditTiming)throw Error('ระบบตรวจเวลาจริงยังไม่พร้อม');
 return bridge.auditTiming(scope,{targetMinutes:minutes});
}
function previewAudit(){
 try{
  lastAudit=evaluate();
  const m=lastAudit.stats;
  status('ตรวจจาก JSON จริง '+m.inspected+' ฉาก · มีเสียง '+m.withVoice+
   ' ฉาก · ต้องแก้เวลา '+m.edits+' ฉาก · ตอนยาวเกิน '+m.overlongEpisodes+' ตอน');
 }catch(err){status('ตรวจโครงงานไม่สำเร็จ: '+err.message,true)}
 render();
}
async function applyTiming(scope,minutes,includeSplits){
 const audit=evaluate(scope,minutes);
 const split=includeSplits&&scope!=='scene'?root.StoryTimingAuditor?.planEpisodeSplits(
  bridge.get(),audit,{scope,episodeIndex:bridge.episodeIndex(),targetMinutes:minutes}):null;
 const ops=[...(split?.ops||[]),...audit.ops];
 lastAudit=audit;
 if(!ops.length)return {audit,split,changes:0};
 const editor=root.StudioAPI;
 if(!editor?.apply)throw Error('StudioAPI ไม่พร้อมแก้โปรเจกต์');
 const dry=editor.apply(ops,{dryRun:true});
 if(!dry.ok)throw Error('ตรวจ JSON ก่อนแก้ไม่ผ่าน: '+((dry.errors||[]).map(e=>e.msg).join('; ')||
 (dry.issues||[]).find(x=>x.level==='error')?.msg||'คำสั่งไม่ถูกต้อง'));
 try{await backupBeforeEdit()}catch(err){throw Error('ไม่แก้โปรเจกต์ เพราะสำรองข้อมูลไม่ได้: '+err.message)}
 const applied=editor.apply(ops);
 if(!applied.applied)throw Error('ไม่สามารถใช้แผนจัดจังหวะกับโปรเจกต์');
 return {audit,split,changes:ops.length};
}

async function backupBeforeEdit(){
 const state=bridge.get(),metadata=core.summaryOfSnapshot(state);
 const snapshot=JSON.stringify(state),database=await openDb();
 const record={id:metadata.projectId+'-script-before-'+Date.now()+'-'+core.id(),projectId:metadata.projectId,
   title:metadata.title+' (ก่อนจัดบท)',savedAt:now(),episodes:metadata.episodes,scenes:metadata.scenes,
   size:snapshot.length,snapshot};
 await new Promise((resolve,reject)=>{
   const tx=database.transaction(STORE,'readwrite');
   tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error||Error('สร้างสำรองก่อนแก้ไม่สำเร็จ'));
   tx.objectStore(STORE).put(record);
 });
 return record;
}
// No pasted story or replacement script operations: work on imported JSON itself.
function setJob(id,patch){
 persist(s=>{const j=s.tasks.find(t=>t.id===id);if(j)Object.assign(j,patch,{updatedAt:now()})});
}
async function runTask(taskId){
 if(busy){status('มีงานอื่นกำลังทำอยู่',true);return}
 const task=w().tasks.find(t=>t.id===taskId);if(!task)return;
 if(!['voice','structure'].includes(task.role)){
  status('งานจากบทบาท AI เก่าอ่านย้อนหลังได้อย่างเดียว',true);return;
 }
 busy=true;setJob(taskId,{status:'running',error:''});render();
 status(task.role==='voice'?'กำลังสร้างเสียงจาก JSON และแบ่งช่วงพูดยาวเป็นคลิปสั้น':
  'กำลังตรวจจังหวะจากเสียงจริง เหตุการณ์ และเวลาในทุกฉาก');
 try{
  let reply,summary=null;
  if(task.role==='voice'){
   const result=await bridge.narrate(task.scope||'episode');
   if(!result?.ok)throw Error(result?.error||'บริการ Edge TTS ยังไม่พร้อม');
   reply='พากย์เสร็จ '+result.made+' คลิป'+(result.failed?' · ผิดพลาด '+result.failed+' คลิป':'');
   if(result.made){
    try{
     const fixed=await applyTiming(task.scope,task.targetMinutes,false);
     reply+=' · ตรวจความยาวเสียงจริงและปรับเวลาฉาก '+fixed.changes+' จุด';
     summary=fixed.audit.stats;
    }catch(err){reply+=' · ยังปรับเวลาอัตโนมัติไม่ได้: '+err.message}
   }
   reply+=' · รักษาเนื้อเรื่องและเหตุการณ์เดิม';
  }else{
   const fixed=await applyTiming(task.scope,task.targetMinutes,task.splitEpisodes);
   const stats=fixed.audit.stats;
   summary={...stats,newEpisodes:fixed.split?.created||0,warnings:fixed.split?.warnings||[]};
   reply='ตรวจ '+stats.inspected+' ฉากจาก JSON เดิม · เสียงจริง '+stats.withVoice+
    ' ฉาก · ปรับเวลา '+fixed.audit.ops.length+' ฉาก'+
    (fixed.split?.created?' · แบ่งเพิ่ม '+fixed.split.created+' ตอน':'')+
    ' · เป้าหมาย '+task.targetMinutes+' นาที/ตอน'+
    (stats.withoutVoice?' · ยังไม่มีคลิปเสียง '+stats.withoutVoice+' ฉาก':'')+
    (summary.warnings?.length?' · ตอนที่มีเพลง/เหตุการณ์ต่อเนื่องยังไม่ย้ายฉากเอง':'')+
    ' · ไม่เขียนเรื่องหรือสร้างฉากปลอม';
  }
  setJob(taskId,{status:'done',response:reply,ops:[],planSummary:summary});
  persist(s=>core.historyPush(s,{speaker:'assistant',role:task.role,text:reply,taskId}));
  status(reply);
 }catch(err){
  const msg=String(err.message||err).slice(0,450);
  setJob(taskId,{status:'failed',error:msg});status('งานยังไม่เสร็จ: '+msg,true);
 }finally{busy=false;render()}
}

function exportText(name,data,mime='application/json'){
 const url=URL.createObjectURL(new Blob([data],{type:mime+';charset=utf-8'}));
 const a=e('a',{href:url,download:name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}

function renderChat(container){
 const pane=e('section',{className:'ai-chat-panel'});
 pane.append(e('h3',{},'ผู้ช่วย 3 ตัว · ใช้โปรเจกต์ JSON จาก AI ภายนอกโดยตรง'),
  e('p',{className:'ai-help'},'บท ฉาก ภาพ ตัวละคร และเหตุการณ์มาจาก JSON ที่นำเข้าแล้ว ผู้ช่วยตรวจงานจริง ไม่ให้วางบทใหม่ และไม่สร้างเนื้อเรื่องแทน'));
 const cards=e('div',{className:'ai-audio-agents'});
 const scope=e('select',{'aria-label':'ขอบเขตตรวจและพากย์',onchange:evt=>{audioScope=evt.target.value;lastAudit=null;render()}},
  ...[['scene','เฉพาะฉากปัจจุบัน'],['episode','ตอนปัจจุบัน'],['all','ทุกตอนในโปรเจกต์']].map(([id,label])=>
   e('option',{value:id,selected:id===audioScope},label)));
 const minutes=e('input',{type:'number','aria-label':'ความยาวเป้าหมายต่อตอน (นาที)',min:1,max:30,step:1,
   value:targetMinutes,onchange:evt=>{targetMinutes=Math.min(30,Math.max(1,Number(evt.target.value)||5));lastAudit=null}});
 const splitting=e('label',{className:'ai-auto-toggle'},e('input',{type:'checkbox',checked:splitEpisodes,
  onchange:evt=>{splitEpisodes=!!evt.target.checked}}),
  ' แบ่งตอนที่ยาวเกิน ณ รอยต่อฉากเดิม (เฉพาะเมื่อย้ายได้อย่างปลอดภัย)');
 const structure=e('article',{className:'ai-audio-agent'},
  e('h4',{},'AI-1 · ตรวจจังหวะฉากและความยาวตอนจากงานจริง'),
  e('p',{},'ตรวจว่าเสียงพากย์จบเมื่อไร เทียบกับ duration ของฉาก ถ้าเหลือภาพนิ่งค้างนานจะลดเวลา ถ้าเสียงยังไม่จบจะขยายเวลา พร้อมตรวจความยาวแต่ละตอน'),
  e('div',{className:'ai-script-settings'},
   e('label',{},'เครื่องมือวิเคราะห์',
    e('select',{'aria-label':'เลือกโมเดล AI วิเคราะห์ฉาก',onchange:evt=>chooseModel(evt.target.value)},
     ...LOCAL_MODELS.map(m=>e('option',{value:m.id,selected:m.id===chosenModel},m.label)))),
   button(busy?'กำลังทดสอบ…':loadedModel===chosenModel&&localEngine?'ทดสอบอีกครั้ง · โมเดลพร้อมแล้ว':'โหลดและทดสอบโมเดล',()=>benchmarkModel(false),{disabled:busy}),
   ...(chosenModel==='standard'?[]:[button('ให้ AI วิเคราะห์และปรับฉากจริง',()=>benchmarkModel(true),{disabled:busy,className:'ai-primary'})]),
   e('small',{},(gpuCapability===false?'ไม่พบ WebGPU บนอุปกรณ์นี้ · ใช้ CPU/WASM (ทดลอง) หรือมาตรฐานได้ · GPU ใช้ไม่ได้':'มาตรฐานไม่ต้องโหลด AI · Qwen GPU ต้องมี WebGPU · CPU/WASM ไม่ต้องมี WebGPU · ไม่มีค่า API'))),
  ...(modelReport?[e('pre',{className:'ai-response',style:'white-space:pre-wrap;overflow-wrap:anywhere'},modelReport)]:[]),
  e('div',{className:'ai-script-settings'},e('label',{},'ตรวจขอบเขต',scope),
    e('label',{},'นาทีต่อตอน',minutes)),
  splitting,
  e('div',{className:'ai-actions'},
    button('ตรวจปัญหา (ยังไม่แก้)',previewAudit,{disabled:busy}),
    button(busy?'กำลังตรวจ…':'ตรวจและปรับโปรเจกต์',()=>queueWork('structure'),{disabled:busy,className:'ai-primary'})),
  e('small',{},'ใช้ระยะเวลาของไฟล์เสียงจริงเมื่อมี · ไม่ย่อฉากที่มี actor/เหตุการณ์ต่อเนื่อง · มีสำรองก่อนแก้ + Undo'));
 if(lastAudit){
  const m=lastAudit.stats;
  const report=e('div',{className:'ai-response'},e('strong',{},'ผลตรวจจาก JSON ที่กำลังเปิด'),
   e('p',{},'ตรวจ '+m.inspected+' ฉาก · มีไฟล์เสียง '+m.withVoice+' · ยังไม่มีเสียง '+m.withoutVoice+
    ' · ฉากต้องปรับ '+m.edits+' · ตอนยาวเกิน '+m.overlongEpisodes));
  for(const ep of lastAudit.episodes)report.append(e('p',{},
   'ตอน '+ep.episode+' — '+ep.old.toFixed(1)+' วินาที → ประเมินหลังแก้ '+
   ep.projected.toFixed(1)+' วินาที'+(ep.overBy>5?' · เกินเป้า '+ep.overBy.toFixed(1)+' วินาที':'')));
  for(const issue of lastAudit.issues.slice(0,10))report.append(e('small',{},
   'ตอน '+issue.episode+' ฉาก '+issue.scene+' · '+({shorten:'ภาพค้างหลังพากย์',extend:'เสียงยาวเกินฉาก',
    review:'ต้องตรวจเหตุการณ์ประกอบ', 'needs-dub':'ยังไม่มีไฟล์เสียง'}[issue.kind]||'ตรวจเพิ่มเติม')+
   (issue.kind==='shorten'||issue.kind==='extend'?' ('+issue.old+' → '+issue.suggested+' วินาที)':'')));
  structure.append(report);
 }
 const voice=e('article',{className:'ai-audio-agent'},
  e('h4',{},'AI-2 · พากย์เสียงจากฉากที่เขียนเสร็จ'),
  e('p',{},'พากย์ข้อความ voiceover / subtitle จาก JSON เดิม แบ่งข้อความที่ยาวเป็นคลิปสั้นเพื่อลดการเว้นวรรคนานเกินไป ใช้ความยาว MP3 จริงจัดจังหวะอีกครั้งหลังจบ'),
  button(busy?'กำลังพากย์…':'พากย์และจัดเวลาหลังพากย์',()=>queueWork('voice'),{disabled:busy,className:'ai-primary'}),
  e('small',{},'ทำงานบน Edge TTS ที่เชื่อมไว้เดิม · หากบริการไม่พร้อม จะแจ้งว่าไม่สามารถพากย์ได้ ไม่แสดงผลสำเร็จปลอม'));
 const narrative=e('article',{className:'ai-audio-agent'},
 e('h4',{},'AI-3 · ผู้กำกับบทบรรยายและซับไตเติล'),
 e('p',{},'ใช้ JSON ภายนอกเป็นต้นฉบับ · ปรับคำบรรยายและการแบ่งซับ · สำรองก่อนแก้ · เมื่อเปลี่ยนบทต้องพากย์ใหม่'),
 e('div',{className:'ai-script-settings'},
  e('label',{},'โมเดล AI-3 (เลือกแยกจาก AI-1)',e('select',{onchange:ev=>{if(busy)return;const next=ev.target.value;if(localEngine&&next!==loadedModel)releaseLocalModel();narrativeModel=next;try{localStorage.setItem(NARRATIVE_MODEL_KEY,next)}catch(_){}updateModelLoad({active:false,ready:!!localEngine,error:'',percent:localEngine?100:null,stage:localEngine?'พร้อมใช้งาน':'เปลี่ยนโมเดลแล้ว · ไม่ต้องรีโหลดเว็บไซต์'});render()}},
   ...LOCAL_MODELS.map(m=>e('option',{value:m.id,selected:m.id===narrativeModel},m.label)))),
  e('label',{},'ระดับการปรับบท',e('select',{onchange:ev=>{narrativeMode=ev.target.value}},
   ...[['preserve','รักษาบทเดิม · จัดซับ'],['polish','ปรับสำนวนให้น่าฟัง'],['creative','Creative Director · เรียบเรียงเพิ่ม']].map(([id,label])=>e('option',{value:id,selected:id===narrativeMode},label))))),
 button(busy?'กำลังทำงาน…':'ให้ AI-3 ปรับบทและซับจริง',runNarrative,{disabled:busy,className:'ai-primary'}),
 ...(narrativeReport?[e('pre',{className:'ai-response',style:'white-space:pre-wrap;overflow-wrap:anywhere'},narrativeReport)]:[]));
 cards.append(structure,voice,narrative);
 pane.append(modelLoadPanel(),...(busy&&modelAbortController?[button('ยกเลิกงาน AI / โหลดโมเดล',cancelLocalTask,{className:'ai-cancel'} )]:[]),cards,e('p',{className:'ai-help'},'เครื่องมืออื่น เช่น Sound Desk กล้อง เอฟเฟกต์ และคลัง GitHub ยังอยู่ แต่ไม่ได้เป็นผู้ช่วย AI เพิ่ม'));
 container.append(pane);
}

function renderTasks(container){
 const tasks=w().tasks.slice().reverse(),pane=e('section',{className:'ai-task-panel'});
 pane.append(e('div',{className:'ai-section-head'},e('h3',{},'ประวัติการตรวจจังหวะและพากย์'),e('span',{},'บันทึกงานเก่าไว้เป็นประวัติ · มีผู้ช่วย 3 ตัวเท่านั้น')));
 if(!tasks.length)pane.append(e('p',{className:'ai-help'},'ยังไม่มีงาน กดตรวจ JSON หรือเริ่มพากย์เสียง'));
 for(const task of tasks){
  const role=core.roles.find(r=>r.id===task.role);
  const box=e('article',{className:'ai-task','data-task-id':task.id});
  box.append(e('div',{className:'ai-task-head'},e('strong',{},role?.name||'งาน AI เก่า (อ่านอย่างเดียว)'),
   e('span',{className:'ai-task-state','data-state':task.status},
    ({queued:'รอทำ',running:'กำลังทำ',done:'เสร็จ',failed:'ผิดพลาด',applied:'งานเก่า',interrupted:'หยุดไป'}[task.status]||task.status))));
  box.append(e('p',{},task.prompt||''));
  if(task.response)box.append(e('div',{className:'ai-response'},e('p',{},task.response)));
  if(task.error)box.append(e('p',{className:'ai-error'},task.error));
  const actions=e('div',{className:'ai-actions'});
  if(['voice','structure'].includes(task.role)&&['queued','failed','interrupted'].includes(task.status))
   actions.append(button('ลองทำงานอีกครั้ง',()=>runTask(task.id),{disabled:busy,className:'ai-primary'}));
  if(task.response)actions.append(button('คัดลอกผล',()=>navigator.clipboard?.writeText(task.response).then(()=>status('คัดลอกแล้ว')).catch(()=>status('คัดลอกไม่สำเร็จ',true))));
  box.append(actions);pane.append(box);
 }
 container.append(pane);
}
function renderBible(container){
 const s=w(),pane=e('section',{className:'ai-bible-panel'});
 pane.append(e('h3',{},'สมุดความต่อเนื่อง (Story Bible)'),e('p',{className:'ai-help'},'บันทึกข้อมูลที่ต้องจำข้ามฉากและข้ามตอน ข้อมูลนี้จะถูกส่งเป็นบริบทให้ AI ในเครื่องโดยอัตโนมัติ — ไม่ใช่ความจำถาวรของโมเดล'));
 const fields=[['premise','แนวเรื่อง / แกนหลัก','ธีม แนวทางและตอนจบที่วางไว้'],['world','โลก / กฎ / สถานที่','สิ่งที่เปลี่ยนไม่ได้และบรรยากาศ'],['characters','ตัวละคร / ความสัมพันธ์','นิสัย ความสัมพันธ์ เสียงและข้อมูลคงที่'],['timeline','เหตุการณ์ / ลำดับเวลา','เหตุการณ์สำคัญ ใครรู้เรื่องอะไรแล้ว'],['threads','ปมค้าง / สิ่งที่ต้องตามต่อ','เบาะแส ปริศนา สัญญาที่ต้องกลับมาเฉลย']];
 for(const [key,label,placeholder]of fields){
   const input=e('textarea',{rows:3,placeholder,onchange:evt=>{persist(w=>w.bible[key]=evt.target.value.slice(0,10000));status('บันทึกสมุดความต่อเนื่องแล้ว')}});
   input.value=s.bible[key]||'';pane.append(e('label',{className:'ai-field'},label,input));
 }
 const ep=bridge.episode(),id=ep?.id;
 if(id){const note=e('textarea',{rows:5,placeholder:'ตอนนี้เกิดอะไรขึ้น? ตัวละครรู้ข้อมูลอะไร ปมไหนยังไม่เฉลย? เขียนสรุปก่อนเริ่มตอนถัดไป',onchange:evt=>{persist(w=>w.summaries[id]=evt.target.value.slice(0,10000));status('บันทึกสรุปตอนแล้ว')}});note.value=s.summaries[id]||'';pane.append(e('label',{className:'ai-field'},'สรุปตอนปัจจุบัน · '+ep.title,note))}
 pane.append(e('div',{className:'ai-actions'},button('สร้างตอนถัดไปแบบต่อเนื่อง',()=>{if(root.confirm('สร้างตอนถัดไปโดยคงฉาก ตัวละคร และบรรยากาศท้ายตอนเดิม? กรุณาบันทึกสรุปตอนปัจจุบันก่อน')){bridge.continueEpisode();status('สร้างตอนถัดไปต่อเนื่องแล้ว · อัปเดตสรุปตอนใหม่ก่อนส่ง AI');render()}},{className:'ai-primary'}),button('ดาวน์โหลดสมุดเรื่อง',()=>exportText('story-bible.json',JSON.stringify({bible:s.bible,summaries:s.summaries},null,2))),button('คัดลอกบริบทให้ AI ภายนอก',()=>{navigator.clipboard?.writeText(JSON.stringify(core.context(bridge.get(),bridge.episodeIndex()),null,2)).then(()=>status('คัดลอกบริบทแล้ว')).catch(()=>status('ไม่รองรับการคัดลอก กรุณาดาวน์โหลด JSON',true))})));
 container.append(pane);
}
function openDb(){
 if(db)return Promise.resolve(db);
 if(dbPromise)return dbPromise;
 dbPromise=new Promise((resolve,reject)=>{
   if(!('indexedDB' in root)){reject(Error('เบราว์เซอร์นี้ไม่รองรับ IndexedDB'));return}
   const req=indexedDB.open(DB,1);
   req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE,{keyPath:'id'})};
   req.onsuccess=()=>{db=req.result;resolve(db)};
   req.onerror=()=>reject(req.error||Error('เปิดฐานข้อมูลไม่ได้'));
 }).catch(err=>{dbPromise=null;throw err});
 return dbPromise;
}
async function records(){
 const database=await openDb();
 return new Promise((resolve,reject)=>{const q=database.transaction(STORE,'readonly').objectStore(STORE).getAll();q.onsuccess=()=>resolve(q.result.sort((a,b)=>String(b.savedAt).localeCompare(String(a.savedAt))));q.onerror=()=>reject(q.error||Error('อ่านโปรเจกต์ไม่ได้'))});
}
async function saveRevision(){
 const state=bridge.get(),s=core.ensure(state.project.aiWorkspace||{});state.project.aiWorkspace=s;
 bridge.persist();const snapshot=JSON.stringify(state);const meta=core.summaryOfSnapshot(state);
 const record={id:s.projectId+'-'+Date.now()+'-'+core.id(),projectId:s.projectId,title:meta.title,savedAt:now(),episodes:meta.episodes,scenes:meta.scenes,size:snapshot.length,snapshot};
 try{
  const database=await openDb();
  await new Promise((resolve,reject)=>{
    const tx=database.transaction(STORE,'readwrite');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||Error('พื้นที่ไม่พอ'));tx.objectStore(STORE).put(record);
  });
  status('บันทึกโปรเจกต์เวอร์ชัน '+humanDate(record.savedAt)+' ลงเครื่องแล้ว · แนะนำให้ดาวน์โหลด JSON สำรองด้วย');renderLibrary();
 }catch(err){status('บันทึกลงเครื่องไม่ได้: '+err.message+' — กรุณาดาวน์โหลด JSON เพื่อสำรอง',true)}
}
async function openRevision(id){
 try{
  const database=await openDb(),record=await new Promise((resolve,reject)=>{const q=database.transaction(STORE,'readonly').objectStore(STORE).get(id);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});
  if(!record)throw Error('ไม่พบเวอร์ชัน');
  const project=core.validateSnapshot(JSON.parse(record.snapshot));
  if(!root.confirm('เปิดเวอร์ชัน “'+record.title+'” ? โปรเจกต์ปัจจุบันจะถูกแทนที่ กรุณาบันทึกเวอร์ชันหรือดาวน์โหลด JSON ก่อน'))return;
  bridge.load(project);status('เปิดเวอร์ชัน '+humanDate(record.savedAt)+' สำเร็จ');
  view='projects';render();
 }catch(err){status('เปิดเวอร์ชันไม่สำเร็จ: '+err.message,true)}
}
async function deleteRevision(id){
 if(!root.confirm('ลบเวอร์ชันนี้ออกจากเครื่องถาวร? หากไม่มี JSON สำรองจะกู้ไม่ได้'))return;
 try{
  const database=await openDb();
  await new Promise((resolve,reject)=>{const tx=database.transaction(STORE,'readwrite');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.objectStore(STORE).delete(id)});
  status('ลบเวอร์ชันแล้ว');renderLibrary();
 }catch(err){status('ลบไม่ได้: '+err.message,true)}
}
async function renderLibrary(){
 const target=rootElement?.querySelector('#aiProjectLibrary');if(!target)return;
 target.replaceChildren(e('p',{className:'ai-help'},'กำลังโหลดรายการโปรเจกต์...'));
 try{
  const list=await records();
  if(!target.isConnected)return;
  target.replaceChildren();
  if(!list.length)target.append(e('p',{className:'ai-help'},'ยังไม่มีเวอร์ชันที่บันทึกในเครื่อง กด “บันทึกเวอร์ชัน” เพื่อเริ่ม'));
  for(const record of list.slice(0,100)){
    target.append(e('article',{className:'ai-snapshot'},
      e('div',{},e('strong',{},record.title),e('small',{},humanDate(record.savedAt)+' · '+record.episodes+' ตอน · '+record.scenes+' ฉาก · '+(record.size/1048576).toFixed(2)+' MB')),
      e('div',{className:'ai-actions'},
        button('เปิดเวอร์ชัน',()=>openRevision(record.id),{className:'ai-primary'}),
        button('ดาวน์โหลด JSON',()=>exportText('story-studio-'+record.savedAt.slice(0,10)+'.json',record.snapshot)),
        button('ลบ',()=>deleteRevision(record.id))
      )
    ));
  }
  if(list.length>100)target.append(e('p',{className:'ai-help'},'แสดง 100 เวอร์ชันล่าสุด'));
 }catch(err){target.replaceChildren(e('p',{className:'ai-error'},'ไม่สามารถอ่านคลังโปรเจกต์: '+err.message+' (ยังดาวน์โหลด JSON ได้)'))}
}
function renderProjects(container){
 const pane=e('section',{className:'ai-project-panel'},
  e('h3',{},'บันทึกโปรเจกต์และเวอร์ชัน'),
  e('p',{className:'ai-help'},'เก็บโปรเจกต์ในอุปกรณ์นี้ผ่าน IndexedDB และส่งออก JSON สำหรับย้ายเครื่อง ข้อมูลเสียงและภาพในโปรเจกต์จะถูกรวมในไฟล์ด้วย'),
  e('div',{className:'ai-actions'},
    button('บันทึกเวอร์ชันในเครื่อง',saveRevision,{className:'ai-primary'}),
    button('ดาวน์โหลดโปรเจกต์ JSON',()=>bridge.exportJSON()),
    button('เปิดโปรเจกต์จาก JSON',()=>bridge.importJSON())
  ),
  e('p',{className:'ai-help'},'สำคัญ: ข้อมูลในเบราว์เซอร์อาจถูกลบเมื่อเคลียร์ข้อมูลเว็บหรือเปลี่ยนเครื่อง — ไม่ใช่ Cloud Save และยังไม่มีการซิงก์ข้ามอุปกรณ์'),
  e('div',{id:'aiProjectLibrary',className:'ai-project-list'})
 );
 container.append(pane);renderLibrary();
}
function render(){
 if(!rootElement||!bridge)return;
 rootElement.replaceChildren(
  e('div',{className:'ai-header'},e('div',{},e('h2',{},'AI Production · 3 ผู้ช่วย'),
   e('p',{},'ตรวจฉากจาก JSON จริง · เทียบเสียงกับความยาว · พากย์เสียง'))),
  e('p',{id:'aiWorkspaceStatus',className:'ai-status','data-error':String(!!lastError),role:'status','aria-live':'polite'},
    progress||'เปิด JSON ที่ AI ภายนอกเขียนไว้ แล้วตรวจความยาวฉาก/ตอนจากไฟล์จริงได้เลย'),
  e('nav',{className:'ai-tabs','aria-label':'พื้นที่ทำงาน AI'},
   ...[['chat','3 ผู้ช่วย AI'],['tasks','ประวัติ'],['bible','ข้อมูลเรื่อง'],['projects','โปรเจกต์'],['assets','คลังรูป / GitHub']].map(([id,label])=>
    button(label,()=>setView(id),{className:view===id?'active':'','aria-current':view===id?'page':null}))),
  e('div',{id:'aiWorkspaceContent',className:'ai-workspace-content'})
 );
 const area=rootElement.querySelector('#aiWorkspaceContent');
 if(view==='chat')renderChat(area);
 else if(view==='tasks')renderTasks(area);
 else if(view==='bible')renderBible(area);
 else if(view==='assets'){if(root.StoryArtVault)root.StoryArtVault.mount(area,bridge);else area.append(e('p',{className:'ai-error'},'ไม่พบโมดูลคลังรูป'))}
 else renderProjects(area);
}
function mount(){
 bridge=root.StoryStudioBridge;
 rootElement=document.querySelector('#aiWorkspacePanel');
 if(!rootElement||!bridge)return;
 const state=w();
 if(state.tasks.some(t=>t.status==='running'))persist(s=>{for(const t of s.tasks)if(t.status==='running')t.status='interrupted'});
 render();
 webGpuReady().then(ready=>{gpuCapability=ready;render()}).catch(()=>{gpuCapability=false;render()});
}
root.StoryAIWorkspace=Object.freeze({mount,render,open:()=>bridge?.openWorkspace(),status,getBusy:()=>busy});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});
else mount();
})(window);
