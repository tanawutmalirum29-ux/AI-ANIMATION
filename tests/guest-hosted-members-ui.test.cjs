'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const get=name=>fs.readFileSync(path.join(root,name),'utf8');

test('GitHub and guest sign-in coexist, both using verified server sessions',()=>{
 const site=get('site-auth.js');
 const server=get('autodub/handler.py');
 const guest=get('autodub/guest_access.py');
 assert.match(site,/auth\.github\.exchange/);
 assert.match(site,/auth\.guest\.start/);
 assert.match(site,/guestButton/);
 assert.match(site,/guestEnabled/);
 assert.match(site,/sessionStorage\.setItem\(SESSION_KEY/);
 assert.match(site,/['"]guest['"]/);
 assert.match(server,/guest_access\.verify/);
 assert.match(server,/guest_access\.start/);
 assert.match(guest,/hmac\.compare_digest/);
 assert.match(guest,/SESSION_SECONDS = 2 \* 3600/);
 assert.match(guest,/STARTS_PER_IP_PER_DAY = 3/);
 assert.match(guest,/sourceIp/);
 assert.doesNotMatch(guest,/x-forwarded-for|X-Forwarded-For/);
});
test('members and guests see only website-hosted six specialist v1, never API keys',()=>{
 const portal=get('member-portal.js'),backend=get('autodub/member_ai.py');
 for(const r of ['composition','assets','motion','voice','structure','qa']){
  assert.match(portal,new RegExp("'"+r+"'"));
 }
 assert.match(portal,/member\.ai\.run/);
 assert.doesNotMatch(portal,/member\.keys\.|connectionId|apiKey/);
 assert.match(backend,/def _hosted_provider/);
 assert.match(backend,/def _quota/);
 assert.match(backend,/hostedByWebsite/);
 assert.match(backend,/for field in \(/);
 assert.match(backend,/TEACHER_FEEDBACK_TABLE/);
 assert.match(backend,/\"global\",120/);
 assert.match(backend,/\"account#\"\\+uid,cap/);
 assert.match(backend,/\"guest\"/);
 assert.doesNotMatch(portal,/student\.train|teacher\.autoTeach|teacher\.configure/);
});
test('owner AI Mother receives genuine server tools but never raw secrets or write IAM',()=>{
 const module=get('autodub/owner_inspection.py');
 const teacher=get('autodub/teacher_advisor.py');
 const prompt=get('autodub/teacher.py');
 const handler=get('autodub/handler.py');
 assert.match(module,/git\/trees\/main/);
 assert.match(module,/actions\/runs/);
 assert.match(module,/get_function_configuration/);
 assert.match(module,/get_branch/);
 assert.match(module,/list_jobs/);
 assert.match(module,/describe_table/);
 assert.match(module,/redact|REDACT/);
 assert.doesNotMatch(module,/update_function|put_item|delete_item|update_item|put_parameter|secret_value/);
 assert.match(teacher,/teacher\.advisorInspect/);
 assert.match(teacher,/owner_inspection\.inspect/);
 assert.match(prompt,/ownerTools/);
 assert.match(handler,/teacher\.advisorInspect/);
 assert.match(handler,/user\.get\("role"\) != "admin"/);
});
test('GitHub OIDC deploy bundles guest and owner tools; browser contains no AWS credentials',()=>{
 const workflow=get('.github/workflows/deploy-aws-studio.yml');
 const shell=get('autodub/deploy.sh');
 assert.match(workflow,/autodub\/guest_access\.py/);
 assert.match(workflow,/autodub\/owner_inspection\.py/);
 assert.match(shell,/guest_access\.py/);
 assert.match(shell,/owner_inspection\.py/);
 assert.doesNotMatch(get('amplify.yml'),/guest_access\.py|owner_inspection\.py/);
});
