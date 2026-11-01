'use strict';
// The latest user export improved narration pacing but still lacks key visual beats.
// These tests check JSON preflight only. They do NOT pretend to inspect MP4 pixels.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const qa=require('../studio-visual-qa.js');
const make=(id,voiceover,extra={})=>({
 id,voiceover,imagePrompt:'',actors:[],props:[],customAssets:[],
 graphicCards:[],sfx:[],duration:7,...extra
});
const source={episodes:[
 {id:'ep2',scenes:[
  make('s07','นิลกับตาอินวิ่งฝ่าฝนขึ้นทางหิน',{
   actors:[{char:'nil',x:18,y:90,pose:'run',toX:57},
           {char:'ta_in',x:12,y:90,pose:'walk',toX:48}]}),
  make('s08','สะพานไม้ผุยุบตัวต่อหน้า กล่องเครื่องมือหลุดมือและหายลงน้ำ',
   {actors:[{char:'nil',pose:'jump',x:48,y:90}]}),
  make('s11','เธอหมุนคันปั่นจนโคมติดขึ้น แต่กระจกสะท้อนยังหันออกทะเล'),
  make('s12','สายพานเก่าขาดผึง แสงดับ'),
 ]},
 {id:'ep3',scenes:[
  make('s15','หนึ่งวาบ สองวาบ สามวาบ นิลปิดเปิดบานบังแสงซ้ำ'),
  make('s18','นิลปิดสมุดและนั่งลงอย่างสงบ',
   {actors:[{char:'nil',x:30,y:90},{char:'ta_in',x:52,y:90}]})
 ]}
]};
const before=JSON.stringify(source);
const report=qa.inspect(source);
assert.equal(report.inspected,6);
const events=new Set(report.issues.map(i=>i.event));
for(const event of ['bridge-collapse','falling-item','light-switch',
 'reflector-motion','belt-break','three-flashes','actor-overlap'])
 assert.ok(events.has(event),'must flag unsupported visual story beat: '+event);
assert.equal(JSON.stringify(source),before,'QA cannot silently mutate the authored JSON');
const scope=qa.inspect(source,{scope:'episode',episodeIndex:1});
assert.ok(scope.issues.some(i=>i.event==='three-flashes'));
assert.ok(scope.issues.every(i=>i.episode===2));
const single=qa.inspect(source,{scope:'scene',episodeIndex:0,sceneId:'s08'});
assert.ok(single.issues.some(i=>i.event==='bridge-collapse'));
assert.ok(single.issues.every(i=>i.sceneId==='s08'));
const authored={episodes:[{id:'ok',scenes:[
 make('bridge','สะพานไม้ผุยุบตัวต่อหน้า',{
  props:[{kind:'bridge',id:'bridge1',motionKeys:[{t:0,x:40},{t:4,x:50}]}]}),
 make('flash','หนึ่งวาบ สองวาบ สามวาบ',{
  cinematicFx:{type:'light',duration:6,keyframes:[{t:0},{t:1},{t:2},{t:3}]} }),
 make('apart','คนสองคนยืนข้างกัน',{
  actors:[{char:'a',x:20,y:90},{char:'b',x:55,y:90}]})
]}]};
const cleared=qa.inspect(authored);
assert.equal(cleared.issues.length,0,'existing action/FX and safe actor spacing should not be falsely rejected');
const portrait={episodes:[{scenes:[
 make('silent','แสงอ่อนเหนือหน้าต่าง',{imagePrompt:'A bright lighthouse, storm at night'}),
 make('hold','หยุดนิ่งดูทะเล',{notes:'[HOLD]'}),
]}]};
assert.equal(qa.inspect(portrait).issues.length,0,'ambient images and authored holds are not missing action cues');
console.log('PASS: visual coverage preflight protects authored events, identifies overlap, and makes no changes');
