'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const base=path.resolve(__dirname,'..');
const source=p=>fs.readFileSync(path.join(base,p),'utf8');
test('multi JSON UI validates source without sending project media or private keys',()=>{
 const js=source('studio-multi-json.js');
 assert.doesNotThrow(()=>new Function(js));
 assert.match(js,/picker\.multiple=true/);
 assert.match(js,/MAX_FILES=8/);
 assert.match(js,/MAX_FILE_BYTES=8\*1024\*1024/);
 assert.match(js,/StoryAutoTeach\.childScan\(project,null,root\.StoryContinuityCoach\)/);
 assert.match(js,/normalizeForTraining\(input\)/);
 assert.match(js,/check\.skipped\.length/);
 assert.match(js,/root\.crypto\.subtle\.digest/);
 assert.match(js,/startBatchProject/);
 assert.match(js,/teacher\.job\.list/);
 assert.match(js,/teacher\.job\.'\+action/);
 assert.doesNotMatch(js,/localStorage\.setItem|sessionStorage\.setItem|innerHTML\s*=|apiKey\s*:/);
});
test('AWS intake reuses original safe 16-scene upload API and preserves existing teach API',()=>{
 const cloud=source('studio-cloud-teach.js');
 assert.match(cloud,/async function startBatchProject/);
 assert.match(cloud,/teacher\.job\.upload\.prepare/);
 assert.match(cloud,/teacher\.job\.upload\.chunk/);
 assert.match(cloud,/teacher\.job\.upload\.commit/);
 assert.match(cloud,/startBatchProject\}\);/);
 assert.match(cloud,/startUploaded\(pid,scenes,chosen,onProgress/);
 assert.match(cloud,/async function teach\(fallback\)/);
});
test('app tab, static bundle and CSS all include multi JSON',()=>{
 const work=source('studio-ai-workspace.js'),
  html=source('index.html'),amplify=source('amplify.yml'),
  css=source('studio-teacher.css');
 assert.match(work,/\['batch','สอนหลาย JSON'\]/);
 assert.match(work,/StoryMultiJSON\.mount\(area\)/);
 assert.match(html,/src="\.\/studio-multi-json\.js"/);
 assert.match(amplify,/studio-multi-json\.js/);
 assert.match(css,/\.multi-json-item/);
});
test('provider-wide lock avoids unmanaged parallel API inference and uses existing AWS IAM',()=>{
 const backend=source('autodub/cloud_jobs.py');
 assert.match(backend,/PROVIDER_LOCK_PREFIX/);
 assert.match(backend,/def _try_provider_lock/);
 assert.match(backend,/def _release_provider_lock/);
 assert.match(backend,/if not _try_provider_lock\(table, credential_id/);
 assert.match(backend,/state": "provider-busy"/);
 assert.match(backend,/def _list_jobs/);
 assert.match(backend,/INDEX_PREFIX \+ str\(owner\)/);
 assert.match(backend,/str\(item\.get\("ownerId"\)\) == str\(owner\)/);
});

test('user can add many named encrypted connections and distribute complete stories by pending-scene load',()=>{
 const browser=source('studio-multi-json.js');
 const manager=source('autodub/teacher_connections.py');
 const worker=source('autodub/cloud_jobs.py');
 const handler=source('autodub/handler.py');
 const deploy=source('.github/workflows/deploy-aws-studio.yml');
 assert.match(browser,/teacher\.connection\.list/);
 assert.match(browser,/teacher\.connection\.add/);
 assert.match(browser,/teacher\.connection\.remove/);
 assert.match(browser,/function planAssignments\(batch\)/);
 assert.match(browser,/sort\(\(a,b\)=>b\.count-a\.count\)/);
 assert.match(browser,/connectionId:conn\.id/);
 assert.match(browser,/type='password'/);
 assert.match(manager,/MAX_EXTRA_KEYS = 6/);
 assert.match(manager,/extraConnections/);
 assert.match(manager,/uuid\.uuid4\(\)/);
 assert.match(manager,/teacher\._save_settings\(settings\)/);
 assert.match(worker,/credential_id = item\.get\("connectionId"\) or item\["provider"\]/);
 assert.match(handler,/action\.startswith\("teacher\.connection\."\)/);
 assert.match(deploy,/autodub\/teacher_connections\.py/);
});

test('auto scheduler sends whole largest stories to least-loaded connections and pins retries',()=>{
 const js=source('studio-multi-json.js');
 const begin=js.indexOf('function planAssignments(batch){');
 const end=js.indexOf('async function start(){',begin);
 assert.ok(begin>0&&end>begin);
 const isolated=js.slice(begin,end);
 const connections=[
  {id:'key-a',name:'Gemini A',provider:'gemini'},
  {id:'key-b',name:'Gemini B',provider:'gemini'}];
 const jobs=[{connectionId:'key-b',remaining:120,state:'running'}];
 const files=[
  {count:60,name:'small'},
  {count:200,name:'big'},
  {count:100,name:'middle'}];
 const fn=new Function('connections','jobs','selection',
   isolated+';return planAssignments;');
 const plan=fn(connections,jobs,'auto')(files);
 assert.equal(plan.get(files[1]).id,'key-a'); // 200 vs 120
 assert.equal(plan.get(files[2]).id,'key-b'); // 200 vs 120
 assert.equal(plan.get(files[0]).id,'key-a'); // 200 vs 220
 files[2].connectionId='key-a';
 const pinned=fn(connections,jobs,'auto')(files);
 assert.equal(pinned.get(files[2]).id,'key-a','retry cannot change its API credential');
 assert.equal(plan.size,3,'a story is assigned as one immutable unit');
});
test('multiple credentials are encrypted server-side, admin-scoped and resumable',()=>{
 const backend=source('autodub/cloud_upload.py');
 const server=source('autodub/teacher.py');
 const handler=source('autodub/handler.py');
 const deploy=source('.github/workflows/deploy-aws-studio.yml');
 assert.match(server,/teacher_connections\.resolve\(settings, provider, body\.get\("connectionId"\)\)/);
 assert.match(backend,/teacher\.job\.upload\.find/);
 assert.match(backend,/teacher-upload-index#/);
 assert.match(backend,/item\.get\("connectionId"\)/);
 assert.match(handler,/teacher\.connection\./);
 assert.match(handler,/user\.get\("role"\) != "admin"/);
 assert.match(deploy,/teacher_connections\.py/);
 assert.doesNotMatch(source('studio-multi-json.js'),/localStorage\.setItem|sessionStorage\.setItem/);
});

test('batch intake converts story-only chapters, paragraphs and scenes without altering animation projects',()=>{
 const story=require('../studio-story-only.js');
 const teacher=require('../studio-auto-teach.js');
 const browser={StoryOnlyJSON:story};
 vm.runInNewContext(source('studio-multi-json.js'),{window:browser});
 const normalize=browser.StoryMultiJSON.normalizeForTraining;
 const samples=[
  {type:'story-only',title:'บทผจญภัย',chapters:[{id:'ep01',title:'บทหนึ่ง',
    paragraphs:['รถไฟเข้าสู่อุโมงค์มืด','มีผู้โดยสารลึกลับรออยู่']}]},
  {type:'story-only',title:'เรื่องสืบสวน',chapters:[{id:'ep01',
    scenes:[{id:'ep01-s01',text:'ผู้ตรวจสอบพบหลักฐานที่ผิดปกติ'},
      {id:'ep01-s02',text:'เธอจึงตรวจสอบวันเวลาอีกครั้ง'}]}]},
  {type:'story-only',title:'ละครครอบครัว',episodes:[{id:'ep01',
    scenes:[{id:'ep01-s01',text:'ลูกสาวกลับมาเยี่ยมแม่ที่บ้าน'}]}]},
  {title:'บทที่ไม่มีป้ายชนิด',episodes:[{id:'ep01',
    scenes:[{id:'ep01-s01',text:'ตัวละครเดินเข้าสู่ห้องประชุม'}]}]}
 ];
 for(const sample of samples){
  const project=normalize(sample);
  assert.equal(project.project.title,sample.title);
  const scanned=teacher.childScan(project,null,null);
  assert.equal(scanned.skipped.length,0);
  assert.ok(scanned.rows.length>0);
  assert.ok(scanned.rows.every(r=>r.text.length>3));
 }
 const full={version:1,project:{title:'โปรเจกต์วิดีโอ'},episodes:[
  {id:'ep01',scenes:[{id:'ep01-s01',voiceover:'เสียงบรรยายของวิดีโอ',imagePrompt:'moonlight'}]}]};
 assert.strictEqual(normalize(full),full,'visual project should not be rewritten');
 assert.throws(()=>normalize({type:'story-only',chapters:[{title:'ว่าง',text:''}]}),/ไม่มี|ว่าง/);
});
