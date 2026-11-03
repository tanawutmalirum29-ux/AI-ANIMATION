'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const d=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(d,p),'utf8');
test('all non-admin roles have absolutely no external provider or BYOK path',()=>{
 const backend=read('autodub/member_ai.py');
 const browser=read('member-portal.js');
 const handler=read('autodub/handler.py');
 assert.match(backend,/trained-local-CPU-only/);
 assert.match(backend,/import thai_editor/);
 assert.match(backend,/story_auto_train/);
 assert.match(backend,/student_learning/);
 assert.doesNotMatch(backend,/urllib|requests\.|httpx|gemini|openrouter|openai|urlopen|_quota|_ATTEMPTS/);
 assert.doesNotMatch(browser,/member\.keys\.|apiKey|connectionId|provider|modelUrl/);
 assert.match(browser,/readiness\(role\)/);
 assert.match(browser,/member\.ai\.run/);
 assert.match(handler,/if user\["role"\] != "admin":/);
 assert.match(handler,/action\.startswith\("member\.keys\."\)/);
});
test('six v1 positions show truthful readiness, including those without trained weights',()=>{
 const portal=read('member-portal.js');
 for(const id of ['composition','assets','motion','voice','structure','qa'])
   assert.match(portal,new RegExp("'"+id+"'"));
 assert.match(portal,/trainingRequired|รอฝึก/);
 assert.match(portal,/role:selected/);
 assert.match(portal,/release:'member-six-v1'/);
 assert.doesNotMatch(portal,/student\.train|teacher\.autoTeach/);
});
test('guest authentication works without GitHub and has no quotas',()=>{
 const site=read('site-auth.js'),guest=read('autodub/guest_access.py');
 assert.match(site,/auth\.guest\.start/);
 assert.match(site,/guestEnabled/);
 assert.match(site,/guestButton/);
 assert.match(site,/['"]guest['"]/);
 assert.match(guest,/SESSION_SECONDS = 2 \* 3600/);
 assert.match(guest,/hmac\.compare_digest/);
 assert.doesNotMatch(guest,/STARTS_PER_IP|MAX.*QUOTA|boto3|dynamodb/);
});
test('owner diagnostics remain owner-only and do not forward keys',()=>{
 const owner=read('autodub/owner_inspection.py');
 const chat=read('studio-mother-chat.js');
 const advisor=read('autodub/teacher_advisor.py');
 assert.match(owner,/get_function_configuration/);
 assert.match(owner,/get_branch/);
 assert.match(owner,/describe_table/);
 assert.match(advisor,/owner_inspection\.inspect/);
 assert.match(chat,/teacher\.advisorInspect/);
 assert.match(owner,/REDACT/);
 assert.doesNotMatch(owner,/put_parameter|update_function|delete_item|start_build/);
});
