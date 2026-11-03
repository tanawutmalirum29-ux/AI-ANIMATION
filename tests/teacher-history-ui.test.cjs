'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),get=p=>fs.readFileSync(path.join(root,p),'utf8');
test('history UI shows AWS AI mother lessons independently from manually approved repeat lessons',()=>{
 const ui=get('studio-teacher.js'),server=get('autodub/teacher.py');
 assert.match(ui,/ประวัติการสอนจาก AI แม่ · AWS/);
 assert.match(ui,/teacher\.lessonHistory/);
 assert.match(ui,/student\.storyAutoStatus/);
 assert.match(ui,/บทที่ AI แม่เสนอ/);
 assert.match(ui,/เหตุผลที่ AI แม่สอน/);
 assert.match(ui,/loadTeacherHistory\(false\)/);
 assert.match(ui,/teacherHistoryPanel\(\)/);
 assert.match(ui,/บทเรียนคำซ้ำที่บันทึกผ่านระบบอนุมัติรายฉาก/);
 assert.match(server,/def _lesson_history\(body\):/);
 assert.match(server,/Key\("sk"\)\.begins_with\("teach#"\)/);
 assert.match(server,/teacher\.lessonHistory/);
});
test('read-only training status is not confused with old student candidates',()=>{
 const py=get('autodub/story_auto_train.py'),routes=get('autodub/student_learning.py');
 assert.match(py,/def status\(\):/);
 assert.match(py,/minimumProjects/);
 assert.match(py,/lastTraining/);
 assert.match(py,/activeVersion/);
 assert.match(routes,/student\.storyAutoStatus/);
 assert.doesNotMatch(py.slice(py.indexOf('def status():'),py.indexOf('\ndef model()')),/train\(\)/);
});
test('teacher dashboard source remains syntactically valid',()=>{
 assert.doesNotThrow(()=>new Function(get('studio-teacher.js')));
});
