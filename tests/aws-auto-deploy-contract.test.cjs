'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('GitHub deploy uses OIDC rather than static keys, on pushes to main',()=>{
 const y=read('.github/workflows/deploy-aws-studio.yml');
 assert.match(y,/branches: \[main\]/);
 assert.match(y,/id-token: write/);
 assert.match(y,/aws-actions\/configure-aws-credentials@v6/);
 assert.match(y,/vars\.AWS_DEPLOY_ROLE_ARN/);
 assert.match(y,/lambda update-function-code/);
 assert.doesNotMatch(y,/aws-access-key-id|aws-secret-access-key/);
 assert.doesNotMatch(y,/lambda update-function-configuration/);
 assert.match(y,/branch\.enableAutoBuild/);
});
test('One-time IAM OIDC bootstrap restricts role to repository main and specific Lambda',()=>{
 const script=read('autodub/setup-github-deploy.sh');
 assert.match(script,/token\.actions\.githubusercontent\.com/);
 assert.match(script,/repo:"\+repo\+":ref:refs\/heads\/main/);
 assert.match(script,/sts:AssumeRoleWithWebIdentity/);
 assert.match(script,/aws iam put-role-policy/);
 assert.match(script,/story-studio-gha-limited-deploy/);
 assert.match(script,/aws sts get-caller-identity/);
 assert.match(script,/gh variable set AWS_DEPLOY_ROLE_ARN/);
 assert.doesNotMatch(script,/iam:\*|ssm:GetParameter|ssm:PutParameter|dynamodb:|secretsmanager:/);
});
test('AI mother keys live in AWS not localStorage; selection automatically restores',()=>{
 const server=read('autodub/teacher.py'),ui=read('studio-teacher.js');
 assert.match(server,/Type="SecureString", Overwrite=True/);
 assert.match(server,/def _disconnect\(body\):/);
 assert.match(server,/teacher\.disconnect/);
 assert.match(ui,/statusData=await api\('teacher\.status'\)/);
 assert.match(ui,/savedProviders\.length/);
 assert.match(ui,/function disconnectProvider\(p\)/);
 assert.match(ui,/confirmDisconnect:true/);
 assert.match(ui,/PROVIDER_STORAGE_KEY/);
 assert.doesNotMatch(ui,/localStorage\?\.setItem\(.+apiKey/);
});
