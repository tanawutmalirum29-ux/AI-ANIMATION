'use strict';
const{chromium}=require('playwright'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
(async()=>{const b=await chromium.launch({args:['--no-sandbox']});try{const page=await b.newPage({viewport:{width:1100,height:850}});await page.goto('file://'+path.resolve('index.html')+'?workspace=editor');
for(const aspect of ['9:16','16:9']){const fixture=JSON.parse(fs.readFileSync('examples/cinematic/book.json'));fixture.project.aspect=aspect;
const result=await page.evaluate(async project=>{S=normalize(project);sel=0;selEp=0;T=6;render();const [ar,br]=S.project.aspect.split(':').map(Number),w=ar<br?360:640,h=ar<br?640:360;
const make=()=>{const cv=document.createElement('canvas');cv.width=w;cv.height=h;return cv;},a=make(),b=make(),c=make();
const svg=document.querySelector('#set svg').cloneNode(true);svg.setAttribute('width',w);svg.setAttribute('height',h);a.getContext('2d').drawImage(await imageFromVector(new XMLSerializer().serializeToString(svg)),0,0,w,h);
await renderVideoFrame(b.getContext('2d'),6,{w,h,previous:new Map(),captions:false});sc().subtitle=['ทดสอบคำบรรยาย'];await renderVideoFrame(c.getContext('2d'),6,{w,h,previous:new Map(),captions:true});
const x=a.getContext('2d').getImageData(0,0,w,h).data,y=b.getContext('2d').getImageData(0,0,w,h).data,z=c.getContext('2d').getImageData(0,0,w,h).data;let max=0,bad=0,captionPixels=0,topCaptionPixels=0;
for(let i=0;i<x.length;i+=4){let d=0,cd=0;for(let k=0;k<3;k++){d=Math.max(d,Math.abs(x[i+k]-y[i+k]));cd=Math.max(cd,Math.abs(z[i+k]-y[i+k]));}max=Math.max(max,d);if(d>3)bad++;if(cd>3){captionPixels++;if(Math.floor(i/4/w)<h*.65)topCaptionPixels++;}}
// Reopening a saved plan paints without modifying project data.
return {badFraction:bad/(w*h),max,captionPixels,topCaptionPixels};},fixture);
assert.ok(result.badFraction<.01,JSON.stringify(result));assert.ok(result.captionPixels>100);assert.equal(result.topCaptionPixels,0);
const guard=await page.evaluate(async()=>{sc().audioClips=[{id:'long',kind:'voice',data:'data:audio/wav;base64,dGVzdA==',duration:20,at:0,rate:1,volume:1}];save();openVideoExport();await startVideoExport();return document.querySelector('#videoStatus').textContent;});assert.match(guard,/เสียงยาวกว่า Blueprint/);
console.log('PASS preview/export pixels and caption safe area',aspect,result);}
}finally{await b.close();}})().catch(e=>{console.error(e);process.exit(1)});
