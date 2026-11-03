'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const base=path.resolve(__dirname,'..'),get=p=>fs.readFileSync(path.join(base,p),'utf8');
test('AI Mother chat module is browser-valid, safely rendered, and isolated from editor chat',()=>{
 const source=get('studio-mother-chat.js');
 assert.doesNotThrow(()=>new Function(source));
 assert.match(source,/teacher\.advisorStatus/);
 assert.match(source,/teacher\.advisorChat/);
 assert.match(source,/root\.StoryStudioAccess\.request/);
 assert.match(source,/textContent=String\(text\)/);
 assert.match(source,/thread\.filter\(m=>!m\.error\)\.slice\(-8\)/);
 assert.match(source,/maxLength=2500/);
 assert.match(source,/MAX_HISTORY=30/);
 assert.match(source,/activeVersion/);
 assert.doesNotMatch(source,/localStorage|sessionStorage|innerHTML\s*=/);
 assert.doesNotMatch(source,/student\.train|teacher\.autoTeach|\.apply\(/);
});
test('mother room is a first-class app tab, bundled into Amplify',()=>{
 const workspace=get('studio-ai-workspace.js'),html=get('index.html'),amp=get('amplify.yml');
 assert.match(workspace,/\['mother','คุยกับ AI แม่'\]/);
 assert.match(workspace,/StoryMotherChat\.mount\(area,bridge\)/);
 assert.match(html,/src="\.\/studio-mother-chat\.js"/);
 assert.match(amp,/studio-mother-chat\.js/);
 assert.match(get('studio-teacher.css'),/\.mother-chat-log/);
});
test('server route enforces existing admin-only GitHub OAuth and model secrets stay in AWS',()=>{
 const handler=get('autodub/handler.py'),
  backend=get('autodub/teacher.py'),
  advisor=get('autodub/teacher_advisor.py'),
  deploy=get('.github/workflows/deploy-aws-studio.yml');
 assert.match(handler,/if user\["role"\] != "admin":/);
 assert.match(backend,/teacher\.advisorChat/);
 assert.match(backend,/advisor_mode=True|advisor_mode=False/);
 assert.match(advisor,/story_auto_train\.status\(\)/);
 assert.match(advisor,/student_learning\._model\(\{\}\)/);
 assert.match(advisor,/curated-backend-manifest-not-live-repository-scan/);
 assert.match(deploy,/autodub\/teacher_advisor\.py/);
});
