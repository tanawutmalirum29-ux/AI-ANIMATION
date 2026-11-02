'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const teacher=fs.readFileSync(path.join(__dirname,'../studio-teacher.js'),'utf8');

function selectRows(){
 const begin=teacher.indexOf('function filteredMemoryLessons(');
 const end=teacher.indexOf('\nfunction lessonDate(',begin);
 assert.ok(begin>0&&end>begin);
 return new Function(teacher.slice(begin,end)+';return filteredMemoryLessons;')();
}
const rows=[
 {id:'lesson1',label:'keep',text:'ไม่ ไม่ อย่าเปิดประตู',projectId:'story123',
  teacherReason:'พูดด้วยความตกใจ',ownerReason:'รักษาอารมณ์',sceneId:'s01',
  context:{emotion:'fear'}},
 {id:'lesson2',label:'remove',text:'แล้วก็ แล้วก็ เดินต่อ',projectId:'story999',
  teacherReason:'คำเชื่อมซ้ำ',ownerReason:'ไม่ตั้งใจซ้ำ',sceneId:'s02'},
 {id:'lesson3',label:'review',text:'เอ่อ เอ่อ ไม่แน่ใจ',projectId:'story999',
  teacherReason:'บริบทไม่ชัด',sceneId:'s03'}
];

test('memory browser searches Thai script, teacher rationale and scene ID',()=>{
 const filter=selectRows();
 assert.equal(filter(rows,'','all').length,3);
 assert.deepEqual(filter(rows,'ความตกใจ','all').map(x=>x.id),['lesson1']);
 assert.deepEqual(filter(rows,'S02','all').map(x=>x.id),['lesson2']);
 assert.deepEqual(filter(rows,'รักษาอารมณ์','keep').map(x=>x.id),['lesson1']);
 assert.equal(filter(rows,'ไม่','remove').length,1);
 assert.deepEqual(filter(rows,'','review').map(x=>x.id),['lesson3']);
});

test('memory cards are read-only and show original script and model version summaries',()=>{
 for(const text of ["teacher-memory-dashboard","studentMemorySearch","studentMemoryLabel",
     "student.lessons","student.candidates","student.model","teacher-lesson-detail",
     "teacher-model-history","โหลดบทเรียนหน้าถัดไปจาก AWS"])
  assert.ok(teacher.includes(text),'missing '+text);
 assert.match(teacher,/String\(item\.teacherReason\|\|''\)/);
 assert.match(teacher,/String\(item\.ownerReason\|\|''\)/);
 assert.match(teacher,/item\.createdAt/);
 assert.match(teacher,/lessonBrowser\.nextCursor/);
 assert.match(teacher,/เฉพาะหน้าที่โหลดมาแล้ว/);
});
