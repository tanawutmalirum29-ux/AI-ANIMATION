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
 assert.match(js,/StoryAutoTeach\.childScan\(input,null,root\.StoryContinuityCoach\)/);
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
 assert.match(backend,/if not _try_provider_lock\(table, item\["provider"\]/);
 assert.match(backend,/state": "provider-busy"/);
 assert.match(backend,/def _list_jobs/);
 assert.match(backend,/INDEX_PREFIX \+ str\(owner\)/);
 assert.match(backend,/str\(item\.get\("ownerId"\)\) == str\(owner\)/);
});
