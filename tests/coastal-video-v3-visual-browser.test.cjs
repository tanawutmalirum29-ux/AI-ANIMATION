'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const path=require('node:path'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:820,height:1180},deviceScaleFactor:1});
  const errs=[];page.on('pageerror',e=>errs.push(e.message));
  const story=JSON.parse(fs.readFileSync(path.resolve(__dirname,
   '../examples/coastal-gate-ml-training-one-episode.json'),'utf8'));
  await page.goto('file://'+path.resolve(__dirname,'../index.html')+'?workspace=editor',{waitUntil:'domcontentloaded'});
  const inspect=await page.evaluate(story=>{
   const S=StoryStudioBridge.get();
   S.project.aspect='9:16';S.project.subMax=28;S.characters=story.characters;S.locations=story.locations;
   S.episodes=[story.episodes[0]];selEp=0;sel=0;T=0;fit();
   const boxes=()=>{
    const stage=document.querySelector('#stage').getBoundingClientRect();
    const find=q=>[...document.querySelectorAll(q)].map(el=>{
     const b=el.getBoundingClientRect(),h=Math.max(0,Math.min(stage.bottom,b.bottom)-Math.max(stage.top,b.top)),
       w=Math.max(0,Math.min(stage.right,b.right)-Math.max(stage.left,b.left));
     return {h,bh:b.height,w,bw:b.width,
      top:(b.top-stage.top)/stage.height,left:(b.left-stage.left)/stage.width,
      visible:h>5&&w>5};
    });
    return {gauge:find('[data-world-object="market-tide-gauge"]'),
      roofline:find('[data-world-object="market-roofline"]'),
      gate:find('[data-world-object="floodgate"]'),
      merchantPhase:document.querySelector('[data-world-object="merchant-acknowledgment"]')?.getAttribute('data-story-phase')||'',
      hill:find('[data-world-object="safe-hill"] [data-world-object="market-person"]'),
      warning:find('[data-world-object="merchant-acknowledgment"] [data-world-object="market-person"]'),
      flood:find('[data-world-object="market-street-flood"]'),
      caption:document.getElementById('sub').textContent};
   };
   const sets=[];
   for(const [i,q] of [[0,.20],[1,.7],[2,.58],[3,.86]]){
    const start=S.episodes[0].scenes.slice(0,i).reduce((sum,sc)=>sum+sc.duration,0);
    sel=i;T=start+S.episodes[0].scenes[i].duration*q;draw();sets.push(boxes());
   }
   const phrases=['ค่ำคืนนี้ฝนตกหนัก ตลาด','ทุกคนหนีขึ้นที่สูงได้ทัน','พิมมองเห็นบานเหล็ก ของประตูระบายน้ำ','ไม่นาน น้ำก็เอ่อถึงหน้าร้าน'];
   const captions=phrases.map(x=>formatTimedCaption(x));
   return {sets,captions};
  },story);
  const [opening,leak,warning,ending]=inspect.sets;
  assert.ok(opening.gauge.some(x=>x.visible&&x.h>16),
   'tide marker MUST be readable in the opening market shot: '+JSON.stringify(opening.gauge));
  assert.ok(ending.roofline.every(x=>x.bh < ending.hill[0].bh*2.3),
   'market background must be a low roofline, not tall wall across the flood: '+JSON.stringify(ending.roofline));
  assert.ok(warning.warning.some(x=>x.visible&&x.h>25),
   'acknowledging merchant must be visible and readable in portrait frame: '+JSON.stringify(warning.warning));
  assert.ok(ending.hill.filter(x=>x.visible&&x.h>22).length>=2,
   'safe hill needs at least two readable visible villagers: '+JSON.stringify(ending.hill));
  assert.ok(!ending.gate.some(x=>x.visible&&x.w>12),
   'huge blue panel is the sluice gate leaking into the final shot, not flood water: '+JSON.stringify(ending.gate));
  assert.ok(ending.hill.filter(x=>x.visible&&x.left>.15&&x.left<.85).length>=2,
   'safe villagers must not sit at the cropped right edge: '+JSON.stringify(ending.hill));
  assert.equal(warning.merchantPhase,'carry','warning scene must reach crate-carry phase');
  assert.ok(ending.flood.length,'bounded street flood exists');
  assert.ok(ending.flood.every(x=>x.top>.66),
   'flood may not form a tall blue sheet above market: '+JSON.stringify(ending.flood));
  for(const txt of inspect.captions){
   const flat=txt.replace(/\n/g,'');
   if(flat.includes('ที่สูง'))assert.ok(!/ที่\nสูง/.test(txt),'must never split Thai compound ที่สูง: '+txt);
   if(flat.includes('หน้าร้าน'))assert.ok(!/หน้า\nร้าน/.test(txt),'must never split หน้าร้าน: '+txt);
   const lines=txt.split('\n');
   assert.ok(lines.length<=2,'never more than 2 lines');
   if(lines.length>1)assert.ok([...lines[1]].length>=6,'no stranded Thai word: '+JSON.stringify(lines));
   assert.ok(lines.every(l=>[...l].length<=19),'portrait safe line width');
  }
  assert.deepEqual(errs,[]);
  console.log('PASS: merchant and hill readable at portrait preview size, flooding stays below shopfronts, Thai captions balanced');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
