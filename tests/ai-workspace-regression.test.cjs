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
 const end=html.indexOf('\\nfunction audioWaveSVG',start);
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
