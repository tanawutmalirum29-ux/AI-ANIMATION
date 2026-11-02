const test=require('node:test'),assert=require('node:assert/strict');
const ml=require('../studio-script-ml.js');
const project=()=>({title:'ทดสอบ',episodes:[{title:'ตอน 1',scenes:[
 {id:'s1',voiceover:'ฝนเริ่มตกหนัก แล้วก็ แล้วก็ น้ำจากคลองค่อย ๆ สูงขึ้น',subtitle:['เก่า'],audioClips:[{kind:'voice',data:'x',mute:false}]},
 {id:'s2',voiceover:'แม้ไฟจะดับ แต่ยังมีแสงสว่าง ไม่รู้จากที่ใด สาดส่องเข้ามา'},
 {id:'s3',voiceover:'จงตื่น จงตื่น ผู้พิทักษ์แห่งแสง'},
 {id:'s4',voiceover:'เขาเดินไปตลาดตามปกติ'}]}]});
test('proposed project applies every proposal to a COPY; original untouched',()=>{
 const p=project(),before=JSON.stringify(p),rep=ml.reviewProject(p);
 const r=ml.buildProposedProject(p,rep.entries,{prepare:s=>({subtitle:[s.voiceover.slice(0,10)],subtitleCues:[]})});
 assert.equal(JSON.stringify(p),before,'source mutated');
 assert.equal(r.applied.length,1);
 const s1=r.project.episodes[0].scenes[0];
 assert.equal(s1.voiceover,'ฝนเริ่มตกหนัก แล้วก็ น้ำจากคลองค่อย ๆ สูงขึ้น');
 assert.equal(s1.subtitle[0],s1.voiceover.slice(0,10));
 assert.equal(s1.audioClips[0].mute,true);assert.equal(s1.audioClips[0].staleNarration,true);
 for(const i of [1,2,3])assert.equal(r.project.episodes[0].scenes[i].voiceover,p.episodes[0].scenes[i].voiceover,'non-proposal scene changed');
});
test('scenes edited after analysis are skipped, not overwritten',()=>{
 const p=project(),rep=ml.reviewProject(p);p.episodes[0].scenes[0].voiceover='แก้เองแล้ว';
 const r=ml.buildProposedProject(p,rep.entries);
 assert.equal(r.applied.length,0);assert.equal(r.skipped[0].reason,'text-changed-since-analysis');
 assert.equal(r.project.episodes[0].scenes[0].voiceover,'แก้เองแล้ว');
});
test('markdown report lists proposals, keeps magic/chant scenes unflagged',()=>{
 const p=project(),rep=ml.reviewProject(p);
 const report={createdAt:'x',stats:rep.stats,entries:rep.entries.map(e=>({key:e.key,episodeIndex:e.episodeIndex,sceneIndex:e.sceneIndex,sceneId:e.sceneId,episodeTitle:e.episodeTitle,original:e.original,proposed:e.result?.proposed||e.original,hasEdit:!!e.result?.hasEdit,needsReview:!!e.result?.needsReview,warnings:e.result?.warnings||[],intent:e.result?.intent}))};
 const md=ml.comparisonMarkdown(report);
 assert.match(md,/ข้อเสนอแก้ \(1 ฉาก\)/);assert.match(md,/s1/);
 assert.ok(!/ขัดแย้ง/.test(md),'magic scene wrongly flagged');
});
test('single script-only file holds every scene, original beside proposal, and stays small',()=>{
 const p=project();p.episodes[0].scenes[0].image='data:image/png;base64,'+'A'.repeat(200000);
 const rep=ml.reviewProject(p),r=ml.buildProposedProject(p,rep.entries);
 const md=ml.scriptOnlyMarkdown(p,rep.entries,{createdAt:'x',stats:rep.stats},r);
 assert.ok(md.length<20000,'heavy data leaked into script file');
 for(const s of p.episodes[0].scenes)assert.ok(md.includes(s.voiceover),'missing '+s.id);
 assert.match(md,/\*\*เอไอเสนอ:\*\* ฝนเริ่มตกหนัก แล้วก็ น้ำจากคลองค่อย ๆ สูงขึ้น/);
 assert.match(md,/รวม 4 ฉาก · เอไอเสนอแก้ 1 ฉาก/);
 assert.ok(!/คำเตือน:/.test(md),'magic/chant scene got a warning');
});
