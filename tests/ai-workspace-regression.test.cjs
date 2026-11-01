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


test('AI-3 standard produces timed cues for complete Thai narration without truncating',()=>{
 const begin=workspace.indexOf('function narrativeChunks(source,limit=24){');
 const end=workspace.indexOf('\nasync function runNarrative(',begin);
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


test('narration preview has a local speech option when no actual voice clip exists',()=>{
 assert.match(html,/function tryPreviewReadNarration\(\)/);
 assert.match(html,/onclick:tryPreviewReadNarration/);
 assert.match(html,/ไม่มีไฟล์เสียงพากย์จริง/);
 assert.match(html,/ไม่ใช่ไฟล์เสียงจริง และไม่รวมในวิดีโอที่ส่งออก/);
});


test('AI-3 → AI-2 → AI-1 coordinated production safely creates two ~60s episodes',async()=>{
 const core=require('../studio-ai-core.js');
 const auditor=require('../studio-timing-auditor.js');
 const marker='root.StoryAIWorkspace=Object.freeze({mount,render,open:()=>bridge?.openWorkspace(),status,getBusy:()=>busy});';
 const backupStart='async function backupBeforeEdit(){';
 const backupEnd='// No pasted story or replacement script operations';
 const start=workspace.indexOf(backupStart),stop=workspace.indexOf(backupEnd,start);
 assert.ok(start>0&&stop>start,'backups function must exist');
 const instrument=workspace.slice(0,start)+'async function backupBeforeEdit(){return {ok:true}}\n'+workspace.slice(stop);
 const source=instrument.replace(marker,
  'root.__productionTest={setup:b=>{bridge=b},run:runCoordinatedProduction,state:()=>({busy,progress,lastError})};');
 const original=Array.from({length:6},(_,i)=>({
  id:'s'+i,duration:20,voiceover:'รถไฟมาถึงสถานี เวลาเที่ยงคืน',
  subtitle:['รถไฟมาถึงสถานี'],subtitleCues:[{id:'c'+i,text:'รถไฟมาถึงสถานี',start:0,end:18}],
  audioClips:[]
 }));
 const state={project:{title:'Episode QA',aiWorkspace:{}},episodes:[{id:'e1',title:'ต้นฉบับยาวเกิน',scenes:structuredClone(original)}],characters:[]};
 const applied=[];
 const editor={apply:(ops,options={})=>{
  if(!options.dryRun){
   applied.push(...ops.map(op=>op.op));
   for(const op of ops){
    if(op.op==='replaceScenes')state.episodes.find(e=>e.id===op.episode).scenes=op.scenes;
    if(op.op==='addEpisode')state.episodes.splice(op.index,0,op.episode);
    if(op.op==='updateEpisode')Object.assign(state.episodes.find(e=>e.id===op.id),op.patch);
    if(op.op==='updateScene')Object.assign(state.episodes.flatMap(e=>e.scenes).find(s=>s.id===op.id),op.patch);
   }
  }
  return {ok:true,applied:true};
 }};
 const bridge={get:()=>state,persist(){},episodeIndex:()=>0,sceneIndex:()=>0,
  auditTiming:(scope,opts)=>auditor.audit(state,{...opts,scope,episodeIndex:0}),
  narrate:async scope=>{
   assert.equal(scope,'all');
   for(const scene of state.episodes.flatMap(e=>e.scenes)){
    scene.audioClips=[{id:'v'+scene.id,data:'data:audio/test',kind:'voice',duration:20,at:0,rate:1}];
   }
   return {ok:true,made:6,failed:0};
  }
 };
 const win={StoryAIWorkspaceCore:core,StoryTimingAuditor:auditor,StudioAPI:editor};
 new Function('window','document','localStorage','performance','navigator','Worker','URL',source)(
  win,{readyState:'loading',addEventListener(){}},
  {getItem:()=>null,setItem(){}},{now:()=>1},{},class Worker{},class URL{}
 );
 win.__productionTest.setup(bridge);
 await win.__productionTest.run();
 assert.equal(state.episodes.length,2);
 assert.ok(state.episodes.every(ep=>{
  const seconds=ep.scenes.reduce((sum,x)=>sum+x.duration,0);
  return seconds>=60&&seconds<=65&&ep.targetSeconds===60;
 }));
 assert.deepEqual(state.episodes.flatMap(e=>e.scenes.map(s=>s.id)),original.map(s=>s.id));
 assert.deepEqual(state.episodes.flatMap(e=>e.scenes.map(s=>s.voiceover)),original.map(s=>s.voiceover));
 assert.ok(applied.includes('replaceScenes'));
 assert.ok(state.episodes.flatMap(e=>e.scenes).every(s=>s.audioClips.length===1));
 assert.equal(state.project.aiWorkspace.production.stage,'ready');
 assert.equal(state.project.aiWorkspace.production.pendingDub,false);
 assert.deepEqual(state.project.aiWorkspace.production.handoffs.map(x=>x.role),['AI-3','AI-2','AI-1']);
 assert.equal(win.__productionTest.state().busy,false);
});

test('external JSON prompt may exceed the 60s target without requiring content deletion',()=>{
 assert.match(html,/ต้นฉบับสามารถยาวกว่านี้ได้/);
 assert.match(html,/60 วินาที/);
 assert.match(html,/65 วินาที/);
 assert.match(workspace,/function runCoordinatedProduction\(\)/);
 const core=require('../studio-ai-core.js');
 const state={project:{title:'สถานีปลายทาง',aiWorkspace:{}},episodes:[{
  id:'e',title:'แนะนำ',scenes:[{id:'s',duration:120,voiceover:'ข้อความต้นฉบับ'}]
 }]};
 const context=core.context(state,0);
 assert.equal(context.production.targetSeconds,60);
 assert.equal(context.production.maxSeconds,65);
 assert.match(core.systemPrompt('structure',state,0),/AI-3 → AI-2 → AI-1/);
});

test('only the built-in Timing Engine remains: no model workers, CDNs or model pickers',()=>{
 assert.ok(!fs.existsSync(path.join(root,'studio-ai-model-worker.js')));
 assert.ok(!fs.existsSync(path.join(root,'studio-ai-cpu-worker.js')));
 for(const word of ['web-llm','transformers','esm.run','WebGPU','new Worker','LOCAL_MODELS','loadLocalModel'])
  assert.ok(!workspace.includes(word),'workspace must not contain '+word);
 const amplify=fs.readFileSync(path.join(root,'amplify.yml'),'utf8');
 assert.ok(!/worker/i.test(amplify));
});

