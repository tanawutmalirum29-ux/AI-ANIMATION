'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('Member version one exposes only the six released role prompts',()=>{
 const py=read('autodub/member_ai.py');
 const js=read('member-portal.js');
 for(const id of ['composition','assets','motion','voice','structure','qa']){
  assert.match(py,new RegExp('"'+id+'":'));
  assert.match(js,new RegExp("'"+id+"'"));
 }
 assert.match(py,/RELEASE_ID = "member-six-v1"/);
 assert.match(py,/trainedSeparateWeights": False/);
 assert.match(py,/autoUpgrades": False/);
 assert.match(js,/member\.ai\.catalog/);
 assert.match(js,/release:'member-six-v1'/);
 assert.match(js,/รุ่น 1/);
 assert.doesNotMatch(js,/teacher\.autoTeach|student\.train|student\.storyAutoTrain/);
});
test('member keys use signed GitHub identity, AWS AES-GCM, and never browser storage',()=>{
 const py=read('autodub/member_keys.py');
 const js=read('member-portal.js');
 const handler=read('autodub/handler.py');
 assert.match(py,/member-api-vault#/);
 assert.match(py,/AESGCM/);
 assert.match(py,/user\.get\("sub"\)/);
 assert.match(py,/member\.keys\.list/);
 assert.match(py,/member\.keys\.add/);
 assert.match(py,/member\.keys\.remove/);
 assert.match(py,/REMOVE encrypted, nonce, fingerprint/);
 assert.match(js,/member\.keys\.list/);
 assert.match(js,/member\.keys\.add/);
 assert.match(js,/member\.keys\.remove/);
 assert.match(js,/connectionId:selectedKey/);
 assert.match(js,/payload\.connectionId=selectedKey/);
 assert.doesNotMatch(js,/localStorage\.setItem\([^)]*apiKey/);
 assert.match(handler,/user\["role"\] != "admin"/);
 assert.match(handler,/action\.startswith\("member\.keys\."\)/);
});
test('admin AI Mother dashboard shows six roles, actual CPU model statuses and connection count',()=>{
 const adviser=read('autodub/teacher_advisor.py');
 const chat=read('studio-mother-chat.js');
 const adminKeys=read('autodub/teacher_connections.py');
 assert.match(adviser,/member_ai\.catalog\(\)/);
 assert.match(adviser,/memberRolesTrainedWeights": False/);
 assert.match(adviser,/repetitionChild/);
 assert.match(adviser,/narrativeChild/);
 assert.match(adviser,/ownerConnections/);
 assert.match(chat,/snapshot\?\.aiCatalog/);
 assert.match(chat,/ownerConnections/);
 assert.match(chat,/connectionId:e\.target\.value/);
 assert.match(chat,/teacher\.advisorChat',provider,connectionId,message/);
 assert.match(adviser,/"connectionId": body\.get\("connectionId"\)/);
 assert.match(chat,/เปิดหน้าสอนหลาย JSON/);
 assert.match(chat,/6 ผู้ช่วยรุ่น 1/);
 assert.match(adminKeys,/ownerGitHubId/);
 assert.match(adminKeys,/ADMIN_ID = "225819900"/);
});
test('production Lambda bundles ciphertext library but never publishes a credential in Amplify',()=>{
 const deploy=read('.github/workflows/deploy-aws-studio.yml');
 const cloud=read('autodub/deploy.sh');
 assert.match(deploy,/edge-tts cryptography/);
 assert.match(deploy,/autodub\/member_keys\.py/);
 assert.match(cloud,/edge-tts cryptography/);
 assert.match(cloud,/member_keys\.py/);
 assert.doesNotMatch(read('amplify.yml'),/member_keys\.py/);
});
