'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const registry=require('../studio-production-roles.js');
const oldCore=require('../studio-ai-core.js');
const storyOnly=require('../studio-story-only.js');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const guide=JSON.parse(read('training-lab/EXTERNAL_WRITER_GUIDE_V2.json'));
const curriculum=JSON.parse(read('training-lab/datasets/production-role-curriculum-v2.json'));

test('twelve namespaced production positions coexist with all six V1 stage IDs',()=>{
 assert.equal(registry.roles.length,12);
 assert.equal(new Set(registry.roles.map(x=>x.id)).size,12);
 assert.deepEqual(registry.roles.map(x=>x.output),registry.types);
 assert.equal(registry.legacyStages.length,6);
 assert.deepEqual(registry.legacyStages.map(x=>x.id),
  ['composition','assets','motion','voice','timing','qa']);
 assert.deepEqual(oldCore.roles.map(x=>x.id),
  ['composition','assets','motion','voice','structure','qa']);
 assert.ok(registry.roles.every(r=>r.status==='role-defined-not-trained-model'));
});
test('read-only scene routing keeps narrator input and pre-existing project unchanged',()=>{
 const input=storyOnly.convert(guide.exampleImportable);
 const original=JSON.stringify(input),hash=registry.signature(input);
 const plan=registry.createPlan(input);
 assert.equal(plan.scenes,4);
 assert.equal(plan.roles,12);
 assert.equal(plan.tasks.length,48);
 assert.equal(plan.sourceHash,hash);
 assert.equal(plan.executable,false);
 assert.deepEqual(plan.tasks.filter(x=>x.sceneId==='s2').map(x=>x.order),
  Array.from({length:12},(_,i)=>i+1));
 assert.equal(plan.tasks.find(x=>x.sceneId==='s2'&&x.roleId==='motion-director')
  .requires[0],'layout-director');
 assert.equal(JSON.stringify(input),original,'plan must not edit voiceover or JSON');
 assert.notEqual(registry.signature({...input,episodes:[{...input.episodes[0],
  scenes:[{...input.episodes[0].scenes[0],voiceover:'ข้อความใหม่'},...input.episodes[0].scenes.slice(1)]}]}),hash);
});
test('all twelve training fixtures refer to active roles but remain unverified examples',()=>{
 assert.equal(curriculum.examples.length,12);
 assert.equal(curriculum.notWeightTraining,true);
 assert.equal(curriculum.notApprovedSamples,true);
 assert.equal(curriculum.sourceScript.type,'story-only');
 assert.deepEqual(new Set(curriculum.examples.map(e=>e.roleId)),
  new Set(registry.roles.map(r=>r.id)));
 assert.ok(curriculum.examples.every(e=>e.input&&e.expected&&
  Array.isArray(e.acceptance)&&e.acceptance.length>=2));
 const imported=storyOnly.convert(curriculum.sourceScript);
 assert.equal(imported.episodes[0].scenes.length,4);
});
test('external storywriter guide provides an importable story-only sample',()=>{
 assert.equal(guide.compatibleInputType,'story-only');
 assert.equal(guide.exampleImportable.type,'story-only');
 assert.equal(storyOnly.appearsTextOnly(guide.exampleImportable),true);
 assert.ok(guide.instructions.some(x=>x.includes('ห้ามตัดบท')));
 assert.equal(guide.productionStageRoles.length,12);
});
test('old script AI and existing training pipeline are protected, never shadowed',()=>{
 for(const p of registry.preserved)assert.ok(fs.existsSync(path.join(__dirname,'..',p)),p);
 const script=read('studio-script-ml.js'),foundation=read('studio-story-foundation.js');
 assert.match(script,/StoryScriptML/);assert.match(script,/trainedGroups:/);
 assert.match(foundation,/StoryNarrativeFoundation/);
 assert.match(read('studio-auto-teach.js'),/teacher\.autoLessons/);
 assert.match(read('studio-ai-workspace.js'),/runCoordinatedProduction/);
 assert.match(read('studio-production-planner.js'),/AI-6/);
});
test('mother is taught the topology and Amplify includes the new registry',()=>{
 const backend=read('autodub/teacher_advisor.py');
 const mother=read('studio-mother-chat.js');
 const html=read('index.html'),amp=read('amplify.yml');
 assert.match(backend,/PRODUCTION_ROLE_IDS/);
 assert.match(backend,/preservedScriptSystems/);
 assert.match(backend,/productionExecutable": False/);
 assert.match(mother,/StoryProductionRoles/);
 assert.match(html,/src="\.\/studio-production-roles\.js"/);
 assert.match(amp,/studio-production-roles\.js/);
});
