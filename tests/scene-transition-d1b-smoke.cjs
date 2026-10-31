// D1 เก็บตก (v36): live on/off กับฉากที่มี s.image; s.video เป็นแค่ metadata (ไม่ถูกเรนเดอร์) -> ไม่กระทบเฟรม; ส่งออกไม่พัง
const {chromium}=require('playwright');const path=require('path');const assert=require('assert');
(async()=>{
 const root=process.env.ROOT||process.cwd();
 const b=await chromium.launch();const pg=await b.newPage();const errs=[];pg.on('pageerror',e=>errs.push(String(e)));
 await pg.goto('file://'+path.join(root,'index.html'));await pg.waitForTimeout(600);
 const r=await pg.evaluate(async()=>{
  const E=ep(),ch=S.characters[0]?S.characters[0].id:(S.characters.push(charFromPreset(CHAR_PRESETS[0])),S.characters[0].id);
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const W=480,H=270,c=document.createElement('canvas');c.width=W;c.height=H;const ctx=c.getContext('2d',{alpha:false});
  const snap=()=>ctx.getImageData(0,0,W,H).data;
  const diff=(a,b)=>{let n=0,m=0;for(let i=0;i<a.length;i+=4){const d=Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]));if(d>0){n++;if(d>m)m=d}}return{n,m}};
  const mk=o=>Object.assign(newScene(),{location:'studio',duration:3,characters:[ch],actors:[{char:ch,x:40,y:90,facing:'right',pose:'stand'}]},o);
  const frame=async(sc,t)=>{E.scenes=sc;resetTransitionCache();const info={w:W,h:H,captions:false,previous:new Map()};await renderVideoFrame(ctx,t,info);return snap()};
  const o={};
  const build=(live,img,vid)=>[mk(img?{image:png}:{}),mk(Object.assign({transition:Object.assign({type:'dissolve',duration:.8},live===undefined?{}:{live})},img?{image:png}:{},vid?{video:'x.mp4'}:{}))];
  for(const [name,img] of [['noimg',false],['img',true]]){
   const t=3+.4;const on=await frame(build(true,img),t),off=await frame(build(false,img),t),auto=await frame(build(undefined,img),t);
   o[name]={onOff:diff(on,off),autoOn:diff(auto,on)};
  }
  const t=3.4,a=await frame(build(true,true,false),t),v=await frame(build(true,true,true),t);o.video=diff(a,v);
  // ฉากที่มี s.video ผ่านการเปลี่ยนฉากหลายแบบโดยไม่พัง
  o.types=0;for(const type of ['dissolve','blur','zoom','fadeblack','wipe-left','push-left','iris']){const sc=build(true,true,true);sc[1].transition.type=type;await frame(sc,3.3);o.types++}
  return o});
 assert.strictEqual(r.video.n,0,'s.video ไม่ควรเปลี่ยนเฟรม');assert.strictEqual(r.types,7);
 assert.strictEqual(r.noimg.autoOn.n,0,'auto = on สำหรับ dissolve');assert.strictEqual(r.img.autoOn.n,0);
 assert.deepStrictEqual(errs,[]);
 await b.close();console.log('PASS D1b: live on/off + s.image + s.video render without error',JSON.stringify({noimg:r.noimg.onOff,img:r.img.onOff,video:r.video}));
})().catch(e=>{console.error(e);process.exit(1)});
