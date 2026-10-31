/* Regression checks for iPad model switching and AI-authored JSON compatibility.
 * Run: node --test tests/ai-workspace-regression.test.cjs
 * Zero external packages or network access needed. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const workspace=fs.readFileSync(path.join(root,'studio-ai-workspace.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');

test('workspace JavaScript parses without invoking browser APIs',()=>{
 assert.doesNotThrow(()=>new Function(workspace));
});

test('dedicated worker is the inference backend, without forced page reload',()=>{
 assert.match(workspace,/CreateWebWorkerMLCEngine/);
 assert.match(workspace,/modelWorker\.terminate\(\)/);
 assert.doesNotMatch(workspace,/location\.reload\(/);
 assert.ok(fs.existsSync(path.join(root,'studio-ai-model-worker.js')));
});

test('model switching releases old worker while retaining page and selected value',()=>{
 const marker='root.StoryAIWorkspace=Object.freeze({mount,render,open:()=>bridge?.openWorkspace(),status,getBusy:()=>busy});';
 assert.ok(workspace.includes(marker));
 const instrument=workspace.replace(marker, 'root.__test={chooseModel,setFake:(worker,id)=>{localEngine={};modelWorker=worker;loadedModel=id},state:()=>({id:chosenModel,loaded:loadedModel,worker:modelWorker})};');
 const data=new Map();
 const storage={getItem:key=>data.get(key)||null,setItem:(key,val)=>data.set(key,val)};
 const win={StoryAIWorkspaceCore:{},location:{}};
 const doc={readyState:'loading',addEventListener(){}};
 new Function('window','document','localStorage','performance','navigator','Worker','URL',instrument)(
  win,doc,storage,{now:()=>0},{},function Worker(){},class URL{}
 );
 let terminated=0;
 win.__test.setFake({terminate(){terminated++}},'Qwen2.5-0.5B-Instruct-q4f16_1-MLC');
 win.__test.chooseModel('Qwen2.5-1.5B-Instruct-q4f16_1-MLC');
 assert.equal(terminated,1);
 assert.equal(win.__test.state().loaded,'');
 assert.equal(win.__test.state().id,'Qwen2.5-1.5B-Instruct-q4f16_1-MLC');
 assert.equal(data.get('storyStudio.aiAnalysisModel.v1'),'Qwen2.5-1.5B-Instruct-q4f16_1-MLC');
});

test('importer safely normalizes known camera/actor aliases, preserves unknown data',()=>{
 const start=html.indexOf('function repairCommonJsonAliases(D){');
 const end=html.indexOf('function normalize(d)',start);
 assert.ok(start>=0&&end>start,'alias normalizer must exist');
 const normalize=new Function(html.slice(start,end)+';return repairCommonJsonAliases;')();
 const scenes=[
  {camera:{type:'wide'},actors:[{face:'concerned',facing:'front',char:'min'}]},
  {camera:{type:'tracking'},actors:[]},
  {camera:{type:'close-up'},actors:[{face:'happy',facing:'left'}]},
  {camera:{type:'future-unknown'},actors:[]}
 ];
 const project={episodes:[{scenes}]};
 const changes=normalize(project);
 assert.equal(changes.length,5);
 assert.deepEqual(scenes.map(x=>x.camera.type),['static','follow','zoom-in','future-unknown']);
 assert.equal(scenes[0].actors[0].face,'think');
 assert.equal(scenes[0].actors[0].facing,'auto');
 assert.equal(scenes[0].actors[0].view,'front');
 assert.equal(scenes[2].actors[0].face,'happy');
 assert.doesNotThrow(()=>normalize({episodes:[null,{scenes:[]},{scenes:[{actors:{notAnArray:true},camera:null}]}]}));
});

test('WebLLM worker handshake falls back to direct runtime without reloading page',async()=>{
 const marker='root.StoryAIWorkspace=Object.freeze({mount,render,open:()=>bridge?.openWorkspace(),status,getBusy:()=>busy});';
 const script=workspace.replace("import('https://esm.run/@mlc-ai/web-llm@0.2.80')","Promise.resolve(root.__fakeWebLLM)")
  .replace(marker,'root.__test={loadLocalModel,state:()=>({loaded:loadedModel,backend:modelBackend,ready:modelLoad.ready,worker:!!modelWorker})};');
 const id='Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
 let fallbackCount=0,terminated=0;
 const engine=()=>({unload:async()=>{},chat:{completions:{create:async()=>({choices:[{message:{content:'พร้อม'}}]})}}});
 class FailedWorker{
  constructor(){this.listeners={};queueMicrotask(()=>this.listeners.message?.({data:{type:'story-worker-error',message:'Worker WebGPU unavailable'}}))}
  addEventListener(name,fn){this.listeners[name]=fn}
  removeEventListener(name){delete this.listeners[name]}
  terminate(){terminated++}
 }
 const win={StoryAIWorkspaceCore:{},__fakeWebLLM:{
  prebuiltAppConfig:{model_list:[{model_id:id}]},
  CreateMLCEngine:async()=>{fallbackCount++;return engine()},
  CreateWebWorkerMLCEngine:async()=>{throw Error('must not invoke worker after bootstrap fails')}
 }};
 new Function('window','document','localStorage','performance','navigator','Worker','URL',script)(
  win,{readyState:'loading',addEventListener(){},baseURI:'https://test.example/'},
  {getItem(){return null},setItem(){}},{now:()=>0},
  {gpu:{requestAdapter:async()=>({})}},FailedWorker,class URL{}
 );
 await win.__test.loadLocalModel(id);
 assert.equal(win.__test.state().backend,'main');
 assert.equal(win.__test.state().ready,true);
 assert.equal(win.__test.state().worker,false);
 assert.equal(fallbackCount,1);
 assert.equal(terminated,1);
});

test('iPad preview prioritizes direct audible media and offers diagnostics',()=>{
 assert.match(html,/PREVIEW_DIRECT_VOICE/);
 assert.match(html,/function checkPreviewAudio\(\)/);
 assert.match(html,/onclick:checkPreviewAudio/);
 assert.match(html,/if\(PREVIEW_DIRECT_VOICE\|\|c\.kind==='voice'\)/);
 assert.match(html,/showPreviewAudioProblem/);
 assert.match(html,/a\.play\(\)\.then/);
});

test('iPad preview plays an existing voice clip and immediately replays after data changes',async()=>{
 const start=html.indexOf('function syncAudioAt(t,play){');
 const end=html.indexOf('\nfunction audioWaveSVG',start);
 assert.ok(start>=0&&end>start);
 const source=html.slice(start,end);
 let data='data:audio/old',now=2500;
 const audioPlayers=new Map(),media=[],retry=new Map();
 const voice={id:'voice1',kind:'voice',duration:5,rate:1,volume:1,data};
 class FakeAudio{
  constructor(src){this.src=src;this.paused=true;this.currentTime=0;media.push(this)}
  pause(){this.paused=true}
  load(){this.loaded=true}
  play(){this.paused=false;this.playCount=(this.playCount||0)+1;return Promise.resolve()}
 }
 const scope={
  VOICE_RECORDER:null,STUDIO_CURRENT_TOOL:'ai',STUDIO_DUB_AUTOPLAY:false,
  pauseAudioPlayers(){},audioEvents:()=>[{c:voice,start:0,cycle:0,limit:5}],
  PREVIEW_DIRECT_VOICE:true,safeClipDuration:c=>c.duration,
  VOICE_PREVIEW_BAD:new Set(),previewContext(){},updateAudioHint(){},
  VOICE_PREVIEW_CLOCK:null,stopVoicePreview(){},VOICE_PREVIEW_BUFFERS:new Map(),
  VOICE_PREVIEW_SOURCES:new Map(),primeVoicePreview(){},
  AUDIO_PLAYERS:audioPlayers,AUDIO_PLAYER_GRAPHS:new Map(),Audio:FakeAudio,
  clipGain:()=>1,eventXGain:()=>1,voiceGainFactor:()=>1,clipAutoGainFactor:()=>1,
  effectiveClipRate:()=>1,cleanNum:(x,d=0)=>Number.isFinite(Number(x))?Number(x):d,
  PREVIEW_MEDIA_RETRY_AT:retry,performance:{now:()=>now},
  clampN:(x,l,h)=>Math.max(l,Math.min(h,x)),showPreviewAudioProblem(){},
  PREVIEW_MEDIA_ERROR:'',createFxNodes(){},applyFxNodes(){},$:()=>({pause(){}})
 };
 const fn=new Function(...Object.keys(scope),source+';return syncAudioAt;')(...Object.values(scope));
 fn(1,true);await Promise.resolve();
 assert.equal(media.length,1);
 assert.equal(media[0].src,'data:audio/old');
 assert.equal(media[0].paused,false);
 voice.data='data:audio/new';
 fn(2,true);await Promise.resolve();
 assert.equal(media[0].src,'data:audio/new');
 assert.equal(media[0].paused,false);
 assert.equal(media[0].playCount,2);
});


test('iPad preview plays original and replaced narration clips without stale audio',async()=>{
 const begin=html.indexOf('function syncAudioAt(t,play){'),end=html.indexOf('\nfunction audioWaveSVG',begin);
 assert.ok(begin>0&&end>begin);
 const players=[],map=new Map(),retry=new Map();
 class MockAudio{
  constructor(src){this._src=src;this.paused=true;this.currentTime=0;players.push(this)}
  get src(){return this._src}set src(v){this._src=v}
  pause(){this.paused=true}
  load(){this.reloaded=true}
  play(){this.paused=false;this.playCount=(this.playCount||0)+1;return Promise.resolve()}
 }
 const event={c:{id:'v1',kind:'voice',data:'data:audio/first',duration:5,rate:1,volume:1,at:0},start:0,cycle:0,limit:5};
 const ctx={
  VOICE_RECORDER:null,STUDIO_CURRENT_TOOL:'ai',STUDIO_DUB_AUTOPLAY:false,
  pauseAudioPlayers(){},audioEvents:()=>[event],PREVIEW_DIRECT_VOICE:true,
  safeClipDuration:c=>c.duration,VOICE_PREVIEW_BAD:new Set(),previewContext:()=>null,
  PREVIEW_AUDIO_CTX:null,updateAudioHint(){},VOICE_PREVIEW_CLOCK:null,stopVoicePreview(){},
  VOICE_PREVIEW_BUFFERS:new Map(),VOICE_PREVIEW_SOURCES:new Map(),primeVoicePreview(){},
  AUDIO_PLAYERS:map,AUDIO_PLAYER_GRAPHS:new Map(),Audio:MockAudio,clipGain:()=>1,
  eventXGain:()=>1,voiceGainFactor:()=>1,clipAutoGainFactor:()=>1,
  effectiveClipRate:()=>1,cleanNum:(x,d=0)=>Number.isFinite(Number(x))?Number(x):d,
  PREVIEW_MEDIA_RETRY_AT:retry,performance:{now:()=>2500},
  clampN:(x,min,max)=>Math.max(min,Math.min(max,x)),
  showPreviewAudioProblem(){},PREVIEW_MEDIA_ERROR:'',createFxNodes(){},applyFxNodes(){},
  $:()=>({pause(){}})
 };
 const run=new Function(...Object.keys(ctx),html.slice(begin,end)+';return syncAudioAt;')(...Object.values(ctx));
 run(1,true);await Promise.resolve();
 assert.equal(players.length,1);
 assert.equal(players[0].src,'data:audio/first');
 assert.equal(players[0].playCount,1);
 event.c.data='data:audio/replaced';
 run(2,true);await Promise.resolve();
 assert.equal(players[0].src,'data:audio/replaced');
 assert.equal(players[0].reloaded,true);
 assert.equal(players[0].playCount,2);
});


test('CPU/WASM models are explicitly selectable without requiring WebGPU',()=>{
 assert.match(workspace,/smollm2-135m-cpu/);
 assert.match(workspace,/qwen2\.5-0\.5b-cpu/);
 assert.match(workspace,/studio-ai-cpu-worker\.js/);
 const marker='root.StoryAIWorkspace=Object.freeze({mount,render,open:()=>bridge?.openWorkspace(),status,getBusy:()=>busy});';
 const instrument=workspace.replace(marker,
  'root.__cpuTest={loadLocalModel,releaseLocalModel,state:()=>({loadedModel,modelBackend,ready:modelLoad.ready,worker:!!modelWorker})};');
 const id='smollm2-135m-cpu';
 let ended=0;
 class FakeWorker{
  constructor(){this.handlers={}}
  addEventListener(type,cb){this.handlers[type]=cb}
  removeEventListener(type){delete this.handlers[type]}
  postMessage(m){
   const event={data:{channel:'story-cpu',type:'complete',requestId:m.requestId,
    result:m.type==='init'?{ready:true}:{choices:[{message:{content:'พร้อม'}}]}}};
   queueMicrotask(()=>this.handlers.message?.(event));
  }
  terminate(){ended++}
 }
 const win={StoryAIWorkspaceCore:{}};
 new Function('window','document','localStorage','performance','navigator','Worker','URL',instrument)(
  win,{readyState:'loading',addEventListener(){},baseURI:'https://local.example/'},
  {getItem(){return null},setItem(){}},{now:()=>100},{},FakeWorker,class URL{}
 );
 return win.__cpuTest.loadLocalModel(id).then(()=>{
  assert.equal(win.__cpuTest.state().loadedModel,id);
  assert.equal(win.__cpuTest.state().modelBackend,'cpu');
  assert.equal(win.__cpuTest.state().ready,true);
  win.__cpuTest.releaseLocalModel();
  assert.equal(ended,1);
 });
});

test('AI-3 standard produces timed cues for complete Thai narration without truncating',()=>{
 const begin=workspace.indexOf('function narrativeChunks(source,limit=24){');
 const end=workspace.indexOf('\nasync function runNarrative(){',begin);
 assert.ok(begin>=0&&end>begin);
 const build=new Function(workspace.slice(begin,end)+';return standardNarrative;')();
 const voice='ในค่ำคืนที่สถานีรถไฟร้าง แสงไฟเหนือชานชาลากะพริบเป็นจังหวะ เสียงลมพัดลอดหน้าต่าง และประตูรถไฟค่อย ๆ เปิดออกโดยไม่มีผู้โดยสารลงมา';
 const src={id:'scene1',duration:22,voiceover:voice,subtitle:[],subtitleCues:[]};
 const result=build(src);
 assert.equal(result.subtitle.length<=3,true);
 assert.ok(result.subtitleCues.length>2);
 assert.equal(result.subtitleCues.at(-1).end,22);
 assert.deepEqual(result.subtitleCues.map(x=>x.text.replace(/\s+/g,'')).join(''),voice.replace(/\s+/g,''));
 assert.ok(result.subtitleCues.every(x=>x.end>x.start&&x.start>=0));
 // Existing manual subtitle timing must not be overwritten by the baseline.
 assert.equal(build({...src,subtitleCues:[{id:'custom',text:'กำหนดเอง',start:0,end:6}]}).subtitleCues,null);
});


test('CPU worker initializes and produces an OpenAI-compatible completion',async()=>{
 const src=fs.readFileSync(path.join(root,'studio-ai-cpu-worker.js'),'utf8');
 const mockSrc=src.replace(
  "import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1')",
  'Promise.resolve(self.__modelLib)'
 );
 const outputs=[];
 const self={postMessage:m=>outputs.push(m),WebAssembly:{}};
 let handler=null,loadCount=0;
 self.addEventListener=(type,cb)=>{if(type==='message')handler=cb};
 const generated=async()=>[{generated_text:'สรุปฉากเรียบร้อย'}];
 generated.tokenizer={encode:value=>[...value].map(x=>x.codePointAt(0))};
 generated.dispose=async()=>{};
 self.__modelLib={env:{backends:{onnx:{wasm:{numThreads:1}}}},
  pipeline:async(task,id,opts)=>{
   loadCount++;
   assert.equal(task,'text-generation');
   assert.equal(opts.device,'wasm');
   assert.equal(opts.dtype,'q4');
   opts.progress_callback({status:'progress',file:'model_q4.onnx',progress:30});
   return generated;
  }};
 new Function('self',mockSrc)(self);
 assert.ok(handler);
 await handler({data:{channel:'story-cpu',type:'init',requestId:'a',model:'smollm2-135m-cpu'}});
 const ready=outputs.find(x=>x.requestId==='a'&&x.type==='complete');
 assert.equal(ready.result.ready,true);
 assert.equal(loadCount,1);
 await handler({data:{channel:'story-cpu',type:'generate',requestId:'b',
  messages:[{role:'user',content:'สรุปฉาก'}],max_tokens:40}});
 const completed=outputs.find(x=>x.requestId==='b'&&x.type==='complete');
 assert.equal(completed.result.choices[0].message.content,'สรุปฉากเรียบร้อย');
 assert.ok(completed.result.usage.completion_tokens>0);
});


test('AI-3 processes a six-scene story one scene at a time with CPU mode',async()=>{
 const marker='root.StoryAIWorkspace=Object.freeze({mount,render,open:()=>bridge?.openWorkspace(),status,getBusy:()=>busy});';
 const instrument=workspace.replace(marker,
  "root.__narrativeTest={set:(b,e)=>{bridge=b;localEngine=e;loadedModel='smollm2-135m-cpu';narrativeModel='smollm2-135m-cpu'},run:runNarrative,report:()=>narrativeReport};");
 const scenes=Array.from({length:6},(_,i)=>({
  id:'s'+i,duration:6,voiceover:'เนื้อเรื่อง '+i,subtitle:['เนื้อเรื่อง '+i],subtitleCues:[]
 }));
 const state={episodes:[{id:'episode1',scenes}],project:{}};
 let count=0;
 const engine={chat:{completions:{create:async()=>{count++;return{choices:[{message:{content:'{"changes":[]}'}}]}}}}};
 const win={StoryAIWorkspaceCore:{}},doc={readyState:'loading',addEventListener(){}};
 class FakeAbortController{
  constructor(){this.signal={aborted:false,addEventListener(){},removeEventListener(){}}}
  abort(){this.signal.aborted=true}
 }
 new Function('window','document','localStorage','performance','navigator','Worker','URL','AbortController',instrument)(
  win,doc,{getItem:()=>null,setItem(){}},{now:()=>100},{},class Worker{},class URL{},FakeAbortController
 );
 win.__narrativeTest.set({get:()=>state,episodeIndex:()=>0},engine);
 await win.__narrativeTest.run();
 assert.equal(count,6);
 assert.match(win.__narrativeTest.report(),/ไม่มีการแก้ไขใหม่/);
});


test('narration preview has a local speech option when no actual voice clip exists',()=>{
 assert.match(html,/function tryPreviewReadNarration\(\)/);
 assert.match(html,/onclick:tryPreviewReadNarration/);
 assert.match(html,/ไม่มีไฟล์เสียงพากย์จริง/);
 assert.match(html,/ไม่ใช่ไฟล์เสียงจริง และไม่รวมในวิดีโอที่ส่งออก/);
});


test('CPU compatibility v2 model can initialize and generate without WebGPU',async()=>{
 const src=fs.readFileSync(path.join(root,'studio-ai-cpu-worker.js'),'utf8');
 const mock=src.replace(
  "import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.15.1')",
  'Promise.resolve(self.__oldPkg)'
 );
 const outputs=[],handlers={};
 const self={postMessage:m=>outputs.push(m),WebAssembly:{}};
 self.addEventListener=(name,cb)=>{handlers[name]=cb};
 let load=0,generatedInput='';
 self.__oldPkg={
  env:{backends:{onnx:{wasm:{numThreads:4}}}},
  pipeline:async(task,repo,opts)=>{
   load++;
   assert.equal(task,'text2text-generation');
   assert.equal(repo,'Xenova/LaMini-Flan-T5-77M');
   assert.equal(opts.quantized,true);
   const fn=async(input,config)=>{
    generatedInput=input;
    assert.ok(config.max_new_tokens<=180);
    return[{generated_text:'the scene needs shorter subtitles'}];
   };
   return fn;
  }
 };
 new Function('self',mock)(self);
 assert.equal(outputs[0]?.type,'boot');
 await handlers.message({data:{channel:'story-cpu',type:'init',requestId:'i',model:'lamini-77m-cpu'}});
 assert.equal(load,1);
 assert.equal(outputs.find(x=>x.type==='complete'&&x.requestId==='i')?.result.ready,true);
 assert.equal(self.__oldPkg.env.backends.onnx.wasm.numThreads,1);
 await handlers.message({data:{channel:'story-cpu',type:'generate',requestId:'g',max_tokens:100,messages:[
  {role:'system',content:'Inspect scene'}, {role:'user',content:'A train arrives late'}
 ]}});
 assert.match(generatedInput,/A train arrives late/);
 assert.equal(outputs.find(x=>x.type==='complete'&&x.requestId==='g').result.choices[0].message.content,
  'the scene needs shorter subtitles');
});

test('CPU worker message errors retain the actual failed stage',async()=>{
 const marker='root.StoryAIWorkspace=Object.freeze({mount,render,open:()=>bridge?.openWorkspace(),status,getBusy:()=>busy});';
 const source=workspace.replace(marker,
  'root.__test={createCpuModelClient};');
 const win={StoryAIWorkspaceCore:{}};
 new Function('window','document','localStorage','performance','navigator','Worker','URL',source)(
  win,{readyState:'loading',addEventListener(){}},{getItem:()=>null,setItem(){}},
  {now:()=>0},{},class Worker{},class URL{}
 );
 let handlers={};
 const worker={
  addEventListener:(event,callback)=>{handlers[event]=callback},
  removeEventListener:()=>{},
  postMessage:()=>{},
  terminate:()=>{}
 };
 const engine=win.__test.createCpuModelClient(worker,()=>{});
 const started=engine.init('lamini-77m-cpu');
 handlers.message({data:{channel:'story-cpu',type:'progress',requestId:'cpu1',
  phase:'ดาวน์โหลดไลบรารี v2',stage:'download',percent:null}});
 handlers.error({message:'Script error',filename:'https://example/worker.js',lineno:9,preventDefault(){}});
 await assert.rejects(started,/ดาวน์โหลดไลบรารี v2.*Script error/);
});


test('short CPU suggestions are shown without inventing JSON edits',async()=>{
 const marker='root.StoryAIWorkspace=Object.freeze({mount,render,open:()=>bridge?.openWorkspace(),status,getBusy:()=>busy});';
 const instrument=workspace.replace(marker,
  "root.__narrativeTest={set:(b,e)=>{bridge=b;localEngine=e;loadedModel='lamini-77m-cpu';narrativeModel='lamini-77m-cpu'},run:runNarrative,report:()=>narrativeReport};");
 const state={episodes:[{id:'ep',scenes:[{
  id:'scene1',duration:10,voiceover:'คืนนี้เรากำลังรอรถไฟขบวนสุดท้าย',subtitle:['คืนนี้เรากำลังรอรถไฟ'],subtitleCues:[]
 }]}],project:{}};
 const engine={chat:{completions:{create:async()=>({
  choices:[{message:{content:'Shorten captions and emphasize the station mood.'}}]
 })}}};
 class FakeAbortController{
  constructor(){this.signal={aborted:false,addEventListener(){},removeEventListener(){}}}
  abort(){this.signal.aborted=true}
 }
 const root={StoryAIWorkspaceCore:{}};
 new Function('window','document','localStorage','performance','navigator','Worker','URL','AbortController',instrument)(
  root,{readyState:'loading',addEventListener(){}},{getItem:()=>null,setItem(){}},
  {now:()=>0},{},class Worker{},class URL{},FakeAbortController
 );
 root.__narrativeTest.set({get:()=>state,episodeIndex:()=>0},engine);
 await root.__narrativeTest.run();
 assert.match(root.__narrativeTest.report(),/ยังไม่แก้โปรเจกต์/);
 assert.match(root.__narrativeTest.report(),/Shorten captions/);
});

test('device preflight checks the worker without downloading a model',async()=>{
 const marker='root.StoryAIWorkspace=Object.freeze({mount,render,open:()=>bridge?.openWorkspace(),status,getBusy:()=>busy});';
 const instrument=workspace.replace(marker,"root.__probeTest={run:probeLocalRuntime,result:()=>runtimeProbeReport};");
 class FakeWorker{
  constructor(){this.handlers={};queueMicrotask(()=>this.handlers.message?.({data:{channel:'story-cpu',type:'boot'}}))}
  addEventListener(k,fn){this.handlers[k]=fn}
  terminate(){}
 }
 const root={StoryAIWorkspaceCore:{}};
 new Function('window','document','localStorage','performance','navigator','Worker','URL',instrument)(
  root,{readyState:'loading',addEventListener(){},baseURI:'https://test.example'},
  {getItem:()=>null,setItem(){}},{now:()=>0},{gpu:null},FakeWorker,class URL{}
 );
 await root.__probeTest.run();
 assert.match(root.__probeTest.result(),/WebGPU: ไม่มี/);
 assert.match(root.__probeTest.result(),/Worker เริ่มทำงานได้/);
 assert.match(root.__probeTest.result(),/ยังไม่ได้ยืนยันว่าโมเดล/);
});
