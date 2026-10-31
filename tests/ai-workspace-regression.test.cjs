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
});
