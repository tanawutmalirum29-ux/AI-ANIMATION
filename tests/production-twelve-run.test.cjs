'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const source=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const roles=require('../studio-production-roles.js');
const owner=source('studio-ai-workspace.js');
const member=source('member-portal.js');

test('owner executes eleven production stages, with voice as separate selectable engine',()=>{
 const steps=[...owner.matchAll(/await step\('([^']+)',async/g)].map(x=>x[1]);
 assert.equal(steps.length,11);
 assert.deepEqual(steps,roles.roles.map(x=>x.id));
 assert.match(owner,/runProduction12:\(\)=>runCoordinatedProduction\(\)/);
 assert.match(owner,/getProductionSteps:/);
 assert.match(owner,/stages\.length!==11/);
 assert.match(owner,/unavailable/);
 assert.match(owner,/planSummary:\{ready,failures,unavailable/);
 assert.match(owner,/applyProductionPlan\('assets',ensureBackup\)/);
 assert.match(owner,/applyProductionPlan\('motion',ensureBackup\)/);
 assert.match(owner,/applyProductionPlan\('composition',ensureBackup\)/);
 assert.doesNotMatch(owner,/await step\('audio-director'/);
 assert.match(owner,/engine:voiceEngine,connectionId:motherVoiceConnectionId/);
 assert.match(owner,/StoryMotherProduction\.runRole/);
 assert.match(owner,/applyTiming\('all',1,true\)/);
 assert.match(owner,/StoryVisualQA\?\.inspect/);
});

test('member and guest share the editor one-click producer without owner key or external inference',()=>{
 assert.match(member,/function productionPanel\(\)/);
 assert.match(member,/function runProduction\(\)/);
 assert.match(member,/runProduction12\(\)/);
 assert.match(member,/fillProductionProgress\(progress\)/);
 assert.match(member,/getProductionSteps\?\.\(\)/);
 assert.match(member,/เปิด JSON สำหรับผลิต/);
 assert.match(member,/เริ่มประมวลผล 12 ขั้น/);
 assert.match(member,/โมเดลตรวจบทเดิม · 6 งานเฉพาะทาง/);
 assert.match(member,/\['member','guest'\]/);
 assert.doesNotMatch(member,/apiKey|connectionId|member\.keys\.|teacher\.configure/);
});

test('six legacy CPU advisory endpoints and previously trained script modules are unchanged',()=>{
 const backend=source('autodub/member_ai.py');
 assert.match(backend,/RELEASE_ID="member-six-v1"/);
 assert.match(backend,/trained-local-CPU-only/);
 assert.match(backend,/externalAPIUsed":False/);
 assert.match(source('studio-ai-core.js'),/const roles=Object\.freeze/);
 for(const name of roles.preserved)assert.ok(fs.existsSync(path.join(__dirname,'..',name)),name);
});
