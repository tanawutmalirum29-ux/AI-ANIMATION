'use strict';
// Regression from the user's combined 720x1280 MP4:
// subtitle backing card was centered while Thai glyph pixels began near x=width/2
// and extended to the right. Test actual painted pixels, not only CSS or JSON.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');

(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('file://'+path.resolve(__dirname,'../index.html'),{waitUntil:'domcontentloaded'});
  const result=await page.evaluate(()=>{
   const originalAspect=S.project.aspect;
   S.project.aspect='9:16';
   try{
    const variants=[
     {text:'สามแสง = ขึ้นที่สูง',w:720,h:1280},
     {text:'ต้องไปถึงหอไฟก่อน\\nน้ำมา',w:720,h:1280},
     {text:'หนึ่ง สอง สามวาบ',w:720,h:1280},
     {text:'ต้องไปถึงหอไฟก่อนน้ำมา',w:360,h:640},
     {text:'น้ำทะเลกำลังไหลย้อนเข้าตลาด',w:360,h:640}
    ];
    const canvases=variants.map(v=>{
     const canvas=document.createElement('canvas');canvas.width=v.w;canvas.height=v.h;
     const ctx=canvas.getContext('2d',{willReadFrequently:true});
     ctx.fillStyle='#111823';ctx.fillRect(0,0,v.w,v.h);
     ctx.textAlign='right';
     const scene={duration:5,subtitleCues:[{id:'test',text:v.text,start:0,end:5}]};
     drawVideoText(ctx,scene,1,v.w,v.h,true);
     const savedAlign=ctx.textAlign;
     const yMin=Math.floor(v.h*.82),rgba=ctx.getImageData(0,yMin,v.w,v.h-yMin).data;
     let minX=v.w,maxX=-1,whiteCount=0;
     for(let y=0;y<v.h-yMin;y++)for(let x=0;x<v.w;x++){
      const i=(y*v.w+x)*4;
      if(rgba[i]>190&&rgba[i+1]>190&&rgba[i+2]>190){
       minX=Math.min(minX,x);maxX=Math.max(maxX,x);whiteCount++;
      }
     }
     return {text:v.text,w:v.w,h:v.h,minX,maxX,whiteCount,
      center:(minX+maxX)/2,savedAlign};
    });
    const stage=document.querySelector('#stage'),sub=document.querySelector('#sub');
    const oldText=sub.textContent;
    sub.textContent='ต้องไปถึงหอไฟก่อนน้ำมา สามแสงหมายถึงขึ้นที่สูง';
    const stageRect=stage.getBoundingClientRect(),rect=sub.getBoundingClientRect();
    const preview={stageWidth:stageRect.width,subtitleWidth:rect.width,
     leftInset:rect.left-stageRect.left,rightInset:stageRect.right-rect.right,
     centered:Math.abs((rect.left+rect.right)/2-(stageRect.left+stageRect.right)/2)};
    sub.textContent=oldText;
    return {canvases,preview};
   }finally{S.project.aspect=originalAspect}
  });
  for(const row of result.canvases){
   assert.ok(row.whiteCount>50,'Thai glyphs must actually be drawn: '+row.text);
   assert.ok(row.minX>=row.w*.07,'caption text must not cross left margin: '+JSON.stringify(row));
   assert.ok(row.maxX<=row.w*.93,'caption text must not cross right margin: '+JSON.stringify(row));
   assert.ok(Math.abs(row.center-row.w/2)<=row.w*.06,
    'visible Thai glyphs must be centered, not left-anchored at middle: '+JSON.stringify(row));
   assert.equal(row.savedAlign,'right','canvas state must be restored after subtitle render');
  }
  if(result.preview.stageWidth>10){
   assert.ok(result.preview.leftInset>=0&&result.preview.rightInset>=0,
    'preview captions must stay inside stage '+JSON.stringify(result.preview));
   assert.ok(result.preview.centered<=2,'preview captions centered '+JSON.stringify(result.preview));
  }
  assert.deepEqual(errors,[],'browser errors during subtitle layout');
  console.log('PASS Thai subtitle safe area: center of painted glyph pixels, 9:16 and 360px, preview bounds',JSON.stringify(result));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
