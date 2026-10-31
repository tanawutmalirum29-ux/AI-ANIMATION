const assert=require('node:assert/strict');
const C=require('../studio-ai-core.js');
const project={project:{title:'เรื่องยาว',styleSuffix:'Cinematic',aiWorkspace:{bible:{premise:'ปริศนาเมืองเก่า',threads:'ยังไม่พบกุญแจ'},summaries:{e1:'ตัวเอกพบจดหมาย'}}},
 characters:[{id:'p1',name:'นิรันดร์',role:'ผู้สืบสวน'}],
 episodes:[{id:'e1',title:'ตอนที่ 1',cliffhanger:'พบจดหมาย',scenes:[{id:'a',location:'hospital',duration:8,voiceover:'สวัสดี'}]}]};
const w=C.ensure(project.project.aiWorkspace);
assert.ok(w.projectId);assert.equal(C.ensure(w).projectId,w.projectId);assert.equal(C.roles.length,8);
C.historyPush(w,{speaker:'user',text:'เขียนต่อ',role:'writer'});
assert.ok(C.systemPrompt('writer',project,0,w.history).includes('ตัวเอกพบจดหมาย'));
assert.equal(C.context(project,0).characters[0].name,'นิรันดร์');
for(let i=0;i<240;i++)C.historyPush(w,{speaker:'user',text:String(i)});
assert.equal(w.history.length,180);
const good=C.parseResult('{"reply":"จัดฉากแล้ว","ops":[{"op":"updateScene","id":"a","patch":{"duration":8}}],"bibleSuggestion":"จำคำใบ้"}');
assert.equal(good.ops.length,1);assert.equal(good.bibleSuggestion,'จำคำใบ้');
const unsafe=C.parseResult('{"reply":"ไม่ทำลาย","ops":[{"op":"deleteScene","id":"a"},{"op":"updateEpisode","id":"e1","patch":{"title":"บท 2"}}]}');
assert.equal(unsafe.ops.length,1);assert.equal(unsafe.ops[0].op,'updateEpisode');
const plain=C.parseResult('สรุปเนื้อเรื่องอย่างเดียว');
assert.equal(plain.reply,'สรุปเนื้อเรื่องอย่างเดียว');assert.equal(plain.ops.length,0);
assert.throws(()=>C.validateSnapshot({project:{},episodes:[]}));
assert.equal(C.validateSnapshot(project),project);assert.equal(C.summaryOfSnapshot(project).episodes,1);
console.log('PASS: 8 AI roles, story bible, bounded history, safe output parsing, JSON project validation');
