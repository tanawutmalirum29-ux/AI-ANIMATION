'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),get=p=>fs.readFileSync(path.join(root,p),'utf8');
test('GitHub sign-in uses PKCE S256 and role-aware access; never trust user-selected role',()=>{
 const client=get('site-auth.js');
 assert.match(client,/auth\.config/);
 assert.match(client,/auth\.github\.exchange/);
 assert.match(client,/crypto\.subtle\.digest\('SHA-256'/);
 assert.match(client,/code_challenge_method','S256'/);
 assert.match(client,/sessionStorage\.setItem\(PKCE_KEY/);
 assert.match(client,/pkce\.state!==state/);
 assert.match(client,/root\.history\.replaceState/);
 assert.match(client,/user:\(\)=>profile/);
 assert.doesNotMatch(client,/setAuth\(\{role:'admin'/);
});
test('Member has six unique hosted web AI roles with no admin tabs',()=>{
 const portal=get('member-portal.js');
 for(const id of ['composition','assets','motion','voice','structure','qa'])
  assert.match(portal,new RegExp("'"+id+"'"));
 assert.match(portal,/member\.ai\.run/);
 assert.match(portal,/role:selected|role:id/);
 assert.match(portal,/storyMember\.tasks/);
 assert.match(portal,/member\.ai\.run/);
 assert.doesNotMatch(portal,/member\.keys\./);
 assert.match(portal,/JSON\.parse\(raw\)/);
 assert.doesNotMatch(portal,/localStorage\.setItem\([^)]*apiKey/);
 assert.doesNotMatch(portal,/student\.storyAutoTrain|teacher\.configure|teacher\.autoTeach/);
});
test('AWS Lambda authenticates GitHub numeric-ID signed session before backend routing',()=>{
 const handler=get('autodub/handler.py'),oauth=get('autodub/github_oauth.py');
 assert.match(handler,/if user\["role"\] != "admin":/);
 assert.match(handler,/return _resp\(403/);
 assert.match(handler,/auth\.github\.exchange/);
 assert.match(handler,/github_oauth\.verify/);
 assert.match(oauth,/ADMIN_GITHUB_USER_ID = 225819900/);
 assert.match(oauth,/api\.github\.com\/user/);
});
test('GitHub OAuth secret stays in SSM; deploy includes both server modules',()=>{
 const setup=get('autodub/setup-github-oauth.sh');
 const workflow=get('.github/workflows/deploy-aws-studio.yml');
 assert.match(setup,/aws ssm put-parameter/);
 assert.match(setup,/SecureString/);
 assert.match(setup,/ssm:GetParameter/);
 assert.match(setup,/GITHUB_OAUTH_CLIENT_ID/);
 assert.match(workflow,/github_oauth\.py autodub\/member_ai\.py/);
 assert.match(get('amplify.yml'),/member-portal\.js member-portal\.css/);
 assert.match(get('index.html'),/member-portal\.js/);
});
