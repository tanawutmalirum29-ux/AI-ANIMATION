const {chromium}=require('playwright');
const {Script}=require('node:vm');
const fs=require('node:fs'),http=require('node:http');
const assert=require('node:assert/strict');
const paths=['index.html','animated-map.js','animated-map.css','cinematic-fx.js','cinematic-fx.css','character-interaction.js','character-interaction.css'];
const html=fs.readFileSync('index.html','utf8');
[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).forEach(x=>new Script(x));
new Script(fs.readFileSync('character-interaction.js','utf8'));
const server=http.createServer((req,res)=>{let p=(req.url||'/').split('?')[0].slice(1)||'index.html';if(!paths.includes(p)){res.writeHead(404);res.end('missing');return}
res.writeHead(200,{'Content-Type':p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'text/html; charset=utf-8'});res.end(fs.readFileSync(p))});
(async()=>{
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1100,height:800}});
  page.on('pageerror',e=>errors.push(e.stack||e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'load'});
  await page.locator('#sceneSwitchSelect').waitFor({timeout:15000});
  const r=await page.evaluate(()=>{
   const out={};
   const groups=PROP_GROUPS.flatMap(g=>g.kinds);
   out.groups=groups.length;out.missingDraw=groups.filter(k=>typeof PROPS[k]!=='function');
   out.missingLabel=groups.filter(k=>!PROP_LABELS[k]);
   out.badSvg=groups.filter(k=>{const s=PROPS[k]('');return typeof s!=='string'||s.includes('NaN')||s.includes('undefined')||s.length<40});
   out.mustHave=['phone','flashlight','torch','lantern','book','umbrella','camera','tablet','tv','paintingFrame'].filter(k=>!PROPS[k]);
   out.held=0;out.heldFail=[];
   S.characters.push({id:'hc',name:'ผู้ถือ',rig:{style:'human'}});
   for(const k of Object.keys(HELD_PROPS)){
    const a={char:'hc',x:50,y:90,pose:'stand',facing:'right'};
    const sc2=Object.assign(newScene(),{duration:4,actors:[a],props:[{kind:k,x:50,y:85,scale:1,front:false}],interactionInitialHold:[{propIndex:0,actor:'hc',hand:'right'}]});
    const svg=rigScene(sc2.actors,1,4,sc2);
    if(svg.includes('data-held-prop="0"')&&!svg.includes('NaN'))out.held++;else out.heldFail.push(k);
   }
   commit(()=>{S.project.aspect='16:9';const s=sc();s.duration=4;s.location='field';s.actors=[{char:'hc',x:45,y:88,pose:'point',facing:'right'}];s.characters=['hc'];s.props=[{kind:'flashlight',x:50,y:86,scale:1},{kind:'tv',x:70,y:80,scale:1}];s.interactionInitialHold=[{propIndex:0,actor:'hc',hand:'right'}]});
   T=starts()[sel]+1;draw();
   out.rigHeld=document.getElementById('rig').innerHTML.includes('data-held-prop="0"');
   out.setHasTv=document.getElementById('set').innerHTML.length+document.getElementById('setf').innerHTML.length>0;
   out.exportHeld=svgFrameFromWorld(document.getElementById('world'),sc(),640,360).includes('data-held-prop="0"');
   out.validation=StudioAPI.validate(JSON.parse(JSON.stringify(S))).issues.filter(i=>/props/.test(i.path||'')&&i.level==='error').length;
   const panel=propPanel(sc());out.optgroups=panel.querySelectorAll('optgroup').length;out.holdUi=[...panel.querySelectorAll('label')].filter(l=>l.textContent.includes('ให้ตัวละครถือ')).length;
   return out;
  });
  assert.ok(r.groups>=55,'prop pack size '+r.groups);
  assert.deepEqual(r.missingDraw,[]);assert.deepEqual(r.missingLabel,[]);assert.deepEqual(r.badSvg,[]);assert.deepEqual(r.mustHave,[]);
  assert.equal(r.held,Object.keys(await page.evaluate(()=>HELD_PROPS)).length,'held fail: '+r.heldFail.join(','));
  assert.equal(r.rigHeld,true);assert.equal(r.exportHeld,true);assert.equal(r.validation,0);
  assert.ok(r.optgroups>=4);assert.equal(r.holdUi,2);
  assert.deepEqual(errors,[]);
  console.log('PASS handheld props:',JSON.stringify(r));
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);process.exit(1)});
