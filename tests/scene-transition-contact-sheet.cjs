// contact sheet ก่อน/หลัง A1: แถวบน = ฉากเดิมค้างนิ่ง (live:false), แถวล่าง = ฉากเดิมยังขยับ (live:true)
const {chromium}=require('playwright');const path=require('path'),fs=require('fs');
(async()=>{
 const root=process.env.ROOT||process.cwd(),out=process.env.OUT||'/tmp/out';fs.mkdirSync(out,{recursive:true});
 const b=await chromium.launch();const pg=await b.newPage({viewport:{width:1280,height:800}});
 await pg.goto('file://'+path.join(root,'index.html'));await pg.waitForTimeout(600);
 const url=await pg.evaluate(async()=>{
  if(!S.characters.some(c=>c.id==='cs1'))S.characters.push({id:'cs1',name:'A',rig:{style:'human'}});
  const E=ep(),ch='cs1',mk=o=>Object.assign(newScene(),{location:'studio',duration:3},o);
  E.scenes=[mk({actors:[{char:ch,x:35,y:90,facing:'right',pose:'wave'}],characters:[ch]}),mk({actors:[{char:ch,x:70,y:90,facing:'right',pose:'stand'}],characters:[ch],transition:{type:'dissolve',duration:.6}})];
  const st=starts()[1],W=320,H=180,sheet=document.createElement('canvas');sheet.width=W*4;sheet.height=H*2;const sx=sheet.getContext('2d');
  const c=document.createElement('canvas');c.width=W;c.height=H;const ctx=c.getContext('2d');
  for(const [row,live] of [[0,false],[1,true]]){E.scenes[1].transition.live=live;resetTransitionCache();const info={w:W,h:H,captions:false,previous:new Map()};
   for(let col=0;col<4;col++){await renderVideoFrame(ctx,st+col*.15,info);sx.drawImage(c,col*W,row*H)}}
  sx.fillStyle='#fff';sx.font='14px sans-serif';sx.fillText('live:false (frozen)',6,16);sx.fillText('live:true',6,H+16);
  T=0;draw();return sheet.toDataURL('image/png')});
 fs.writeFileSync(path.join(out,'contact-sheet-A1.png'),Buffer.from(url.split(',')[1],'base64'));
 await b.close();console.log('wrote',path.join(out,'contact-sheet-A1.png'));
})().catch(e=>{console.error(e);process.exit(1)});
