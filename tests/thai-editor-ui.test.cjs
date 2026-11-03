'use strict';
const assert=require('node:assert/strict'),test=require('node:test');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const content=file=>fs.readFileSync(path.join(root,file),'utf8');

test('editor is separate from frozen member release v1, admin-only at Lambda',()=>{
 const ui=content('studio-ai-workspace.js'),
  backend=content('autodub/handler.py'),members=content('autodub/member_ai.py');
 assert.match(ui,/\['editor','AI ลูกเกลาบท'\]/);
 assert.match(ui,/StoryThaiEditor\.mount\(area,bridge\)/);
 assert.match(backend,/action\.startswith\("editor\."\)/);
 assert.match(backend,/user\.get\("role"\) != "admin"/);
 assert.match(members,/RELEASE_ID = "member-six-v1"/);
 assert.doesNotMatch(members,/thai_editor|editor\.review|editor\.feedback/);
});

test('editor review and owner confirmation never write to original project',()=>{
 const js=content('studio-thai-editor.js');
 assert.doesNotThrow(()=>new Function(js));
 assert.match(js,/action:'editor.review'/);
 assert.match(js,/action:'editor.feedback'/);
 assert.match(js,/reviewedByOwner:true/);
 assert.match(js,/runStamp!==sourceStamp\(project\(\)\)/);
 assert.match(js,/originalProjectUnchanged:true/);
 assert.match(js,/requiresHumanReview:true/);
 assert.match(js,/for\(let i=0;i<scenes.length;i\+=18\)/);
 assert.doesNotMatch(js,/\.apply\(|bridge\.load\(|bridge\.persist\(|updateScene|localStorage|sessionStorage|teacher\.chat/);
});

test('CI and Lambda package exact starter data, training module and static UI',()=>{
 const workflow=content('.github/workflows/deploy-aws-studio.yml');
 const deploy=content('autodub/deploy.sh');
 const amplify=content('amplify.yml');
 const html=content('index.html');
 const ci=content('.github/workflows/teacher-studio-qa.yml');
 assert.match(workflow,/autodub\/thai_editor\.py autodub\/thai_editor_starter_v1\.json/);
 assert.match(deploy,/thai_editor_starter_v1\.json/);
 assert.match(amplify,/studio-thai-editor\.js/);
 assert.match(html,/src="\.\/studio-thai-editor\.js"/);
 assert.match(ci,/python3 autodub\/thai_editor\.py/);
 assert.match(ci,/tests\/test_thai_editor\.py/);
});

test('UI module loads safely and registers a read-only workspace widget',()=>{
 const js=content('studio-thai-editor.js');
 const window={};
 vm.runInNewContext(js,{window});
 assert.equal(typeof window.StoryThaiEditor.mount,'function');
 assert.deepEqual(Object.keys(window.StoryThaiEditor),['mount']);
});
