'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('Teacher Studio and UI scripts parse',()=>{
 assert.doesNotThrow(()=>new Function(read('studio-teacher.js')));
 assert.doesNotThrow(()=>new Function(read('studio-ai-workspace.js')));
});
test('Teacher module is connected to the existing application and Amplify',()=>{
 const html=read('index.html'),workspace=read('studio-ai-workspace.js'),build=read('amplify.yml');
 assert.match(html,/studio-teacher\.js/);
 assert.match(html,/studio-teacher\.css/);
 assert.match(workspace,/StoryTeacherStudio\.mount\(area,bridge\)/);
 assert.match(build,/studio-teacher\.js studio-teacher\.css/);
});
test('Teacher API uses authenticated session, previewed ops and rollback',()=>{
 const front=read('studio-teacher.js'),backend=read('autodub/teacher.py');
 assert.match(front,/StoryStudioAccess\.request/);
 assert.match(front,/dryRun:true/);
 assert.match(front,/saveRecovery\(/);
 assert.match(front,/teacher\.feedback/);
 assert.doesNotMatch(front,/localStorage\.(?:setItem|getItem)\([^\n]*apiKey/);
 assert.match(backend,/TEACHER_SETTINGS_PARAMETER/);
 assert.match(backend,/TEACHER_FEEDBACK_TABLE/);
 assert.match(backend,/TEACHER_ALLOWED_API_HOSTS/);
 assert.match(read('autodub/handler.py'),/action\.startswith\("teacher\."\)/);
});
