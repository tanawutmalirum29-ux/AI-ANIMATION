'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const story=require('../studio-story-only.js');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const original='คืนหนึ่งฝนตกหนัก ชาวบ้านจึงรีบยกของขึ้นชั้นบน';
test('single story-only JSON imports without media, Rig or imagePrompt requirements',()=>{
 const project=story.convert({type:'story-only',title:'คืนฝนตก',story:original});
 assert.equal(project.project.mode,'story-only');
 assert.equal(project.episodes.length,1);
 assert.equal(project.episodes[0].scenes[0].voiceover,original);
 assert.equal(project.characters.length,0);
 assert.equal(project.locations.length,0);
 assert.equal(project.episodes[0].scenes[0].imagePrompt,'');
 assert.ok(story.appearsTextOnly({type:'story-only',title:'x',story:original}));
});
test('chapters, paragraphs, text scenes and existing voiceover scenes are supported',()=>{
 const data={title:'สามบท',chapters:[
  {title:'เปิดเรื่อง',text:'ต้นได้ยินเสียงแปลก\n\nเขาจึงเดินไปดู'},
  {title:'ตอนสอง',paragraphs:['ตำรวจมาถึง','ชาวบ้านให้ข้อมูล']},
  {title:'จบเรื่อง',scenes:[{id:'end',text:'ทุกคนกลับบ้าน'}]}]};
 const parsed=story.convert(data);
 assert.equal(parsed.episodes.length,3);
 assert.equal(parsed.episodes[0].scenes.length,2);
 assert.equal(parsed.episodes[1].scenes.length,2);
 assert.equal(parsed.episodes[2].scenes[0].id,'end');
 const episodes=story.convert({episodes:[{title:'บททดลอง',scenes:[
  {id:'s1',voiceover:'เสียงกระซิบดังขึ้นจากประตู'},
  {id:'s2',text:'ทุกคนหยุดฟังเสียง'}]}]});
 assert.equal(episodes.episodes[0].scenes.length,2);
});
test('long Thai manuscript is split without losing any original character',()=>{
 const text='ชายคนนั้นเดินไปตามทางแคบ'.repeat(150);
 const parsed=story.convert({story:text});
 const scenes=parsed.episodes[0].scenes;
 assert.ok(scenes.length>1);
 assert.ok(scenes.every(s=>s.voiceover.length<=1100));
 assert.equal(scenes.map(s=>s.voiceover).join(''),text);
 assert.equal(story.stats(parsed).scenes,scenes.length);
});
test('script-only export roundtrips without animation metadata or text loss',()=>{
 const parsed=story.convert({type:'story-only',title:'หนังสั้น',chapters:[
  {title:'ตอนหนึ่ง',text:'ประตูเปิดออก\n\nเขามองเห็นแสง'},
  {title:'ตอนสอง',text:'ทุกคนวิ่งหนี'}]});
 const exported=story.exportTextOnly(parsed);
 assert.equal(exported.type,'story-only');
 assert.equal(exported.title,'หนังสั้น');
 assert.ok(!('characters' in exported)&&!('locations' in exported));
 const wire=JSON.stringify(exported);
 assert.ok(!wire.includes('imagePrompt'));
 assert.ok(!wire.includes('camera'));
 const reimport=story.convert(exported);
 assert.deepEqual(reimport.episodes.map(e=>e.scenes.map(s=>s.voiceover)),
  parsed.episodes.map(e=>e.scenes.map(s=>s.voiceover)));
});
test('full animation JSON with visual fields remains untouched',()=>{
 const full={version:1,project:{title:'ภาพเคลื่อนไหว'},characters:[],locations:[],
  episodes:[{id:'ep1',scenes:[{id:'s1',voiceover:'บทหนึ่ง',imagePrompt:'river'}]}]};
 assert.equal(story.appearsTextOnly(full),false);
 assert.equal(story.convertIfNeeded(full),full);
 const rig={...full,characters:[{id:'hero',rig:{style:'human'}}]};
 assert.equal(story.convertIfNeeded(rig),rig);
});
test('invalid/missing content cannot overwrite studio, or truncate oversized story',()=>{
 assert.throws(()=>story.convert({type:'story-only',story:''}),/ไม่มี|ว่าง/);
 assert.throws(()=>story.convert({type:'story-only',story:'x'.repeat(205000)}),/200,000/);
 assert.throws(()=>story.convert({type:'story-only',chapters:[{title:'empty',text:''}]}),/ว่าง|ไม่มี/);
 assert.throws(()=>story.convert({type:'story-only',chapters:Array.from({length:81},()=>({text:'ข้อความ'}))}),/1–80/);
});
test('AI workspace, file import, paste import and AWS teacher integrate with story-only JSON',()=>{
 const html=read('index.html'),workspace=read('studio-ai-workspace.js'),
  ui=read('studio-story-only-ui.js'),auto=read('studio-auto-teach.js'),
  build=read('amplify.yml');
 assert.ok(html.indexOf('studio-story-only.js')>=0);
 assert.ok(html.indexOf('studio-story-only-ui.js')>=0);
 assert.match(html,/window\.StoryOnlyJSON\?\.convertIfNeeded\(d\)/);
 assert.match(html,/window\.StoryOnlyJSON\.convert\(d\)/);
 assert.match(html,/loadStoryOnly:\(input\)/);
 assert.match(html,/updateStoryOnlyScene:\(id,text\)/);
 assert.match(workspace,/story-only','เนื้อเรื่องล้วน/);
 assert.match(ui,/bridge\.loadStoryOnly\(adapted\)/);
 assert.match(ui,/bridge\.updateStoryOnlyScene\(id,editor\.value\)/);
 assert.match(ui,/StoryAutoTeach/);
 assert.match(auto,/function configure\(source,selectedProvider\)/);
 assert.match(build,/studio-story-only\.js studio-story-only-ui\.js/);
 assert.doesNotMatch(ui,/fetch\(.+image|generateImage|imagePrompt\s*:/);
});
