/* Story Studio Asset Library — safe, reusable vector shapes.
 * One shared asset schema in the browser and the authenticated Lambda.
 * No arbitrary HTML/SVG/JS, external images or executable AI output.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.StoryAssetCore=api;
})(typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const types=new Set(['rect','circle','ellipse','line','polygon']);
 const categories=new Set(['prop','decor','nature','architecture','fx']);
 const c=(v,min,max,d)=>Math.max(min,Math.min(max,Number.isFinite(Number(v))?Number(v):d));
 const color=v=>typeof v==='string'&&/^#[a-fA-F0-9]{6}$/.test(v)?v:'#b7c4cf';
 const isObj=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
 function asset(input){
  if(!isObj(input))throw Error('รูปแบบสินทรัพย์ไม่ถูกต้อง');
  const name=String(input.name||'').trim().slice(0,64);
  if(name.length<2)throw Error('กรุณาใส่ชื่อสิ่งของอย่างน้อย 2 ตัวอักษร');
  const category=categories.has(input.category)?input.category:'decor';
  const shapes=Array.isArray(input.shapes)?input.shapes:[];
  if(!shapes.length||shapes.length>60)throw Error('ต้องมีรูปทรง 1–60 รายการ');
  const safe=shapes.map((s,i)=>{
   if(!isObj(s)||!types.has(s.type))throw Error('รูปทรง #'+(i+1)+' ไม่รองรับ');
   const b={type:s.type,fill:color(s.fill),stroke:s.stroke==='none'?'none':color(s.stroke),
    strokeWidth:c(s.strokeWidth,0,12,0),opacity:c(s.opacity,0,1,1)};
   if(s.type==='rect')Object.assign(b,{x:c(s.x,0,100,0),y:c(s.y,0,100,0),w:c(s.w,0.1,100,10),h:c(s.h,0.1,100,10),rx:c(s.rx,0,30,0)});
   if(s.type==='circle')Object.assign(b,{cx:c(s.cx,0,100,50),cy:c(s.cy,0,100,50),r:c(s.r,.1,50,8)});
   if(s.type==='ellipse')Object.assign(b,{cx:c(s.cx,0,100,50),cy:c(s.cy,0,100,50),rx:c(s.rx,.1,50,12),ry:c(s.ry,.1,50,8)});
   if(s.type==='line')Object.assign(b,{x1:c(s.x1,0,100,0),y1:c(s.y1,0,100,0),x2:c(s.x2,0,100,100),y2:c(s.y2,0,100,100),
     stroke:s.stroke==='none'?'none':color(s.stroke||'#ffffff'),strokeWidth:c(s.strokeWidth,.4,12,2)});
   if(s.type==='polygon'){
    if(!Array.isArray(s.points)||s.points.length<3||s.points.length>30)throw Error('Polygon ต้องมี 3–30 จุด');
    b.points=s.points.map(p=>{
     if(!Array.isArray(p)||p.length!==2)throw Error('พิกัด Polygon ไม่ถูกต้อง');
     return[c(p[0],0,100,50),c(p[1],0,100,50)];
    });
   }
   return b;
  });
  return {version:1,id:/^[a-z0-9-]{3,80}$/.test(input.id||'')?input.id:undefined,name,category,
   description:String(input.description||'').trim().slice(0,180),shapes:safe};
 }
 function svg(a){
  const s=asset(a),parts=s.shapes.map(q=>{
   const common=' fill="'+q.fill+'" stroke="'+q.stroke+'" stroke-width="'+q.strokeWidth+'" opacity="'+q.opacity+'"';
   switch(q.type){
   case 'rect':return '<rect x="'+q.x+'" y="'+q.y+'" width="'+q.w+'" height="'+q.h+'" rx="'+q.rx+'"'+common+'/>';
   case 'circle':return '<circle cx="'+q.cx+'" cy="'+q.cy+'" r="'+q.r+'"'+common+'/>';
   case 'ellipse':return '<ellipse cx="'+q.cx+'" cy="'+q.cy+'" rx="'+q.rx+'" ry="'+q.ry+'"'+common+'/>';
   case 'line':return '<line x1="'+q.x1+'" y1="'+q.y1+'" x2="'+q.x2+'" y2="'+q.y2+'"'+common+'/>';
   case 'polygon':return '<polygon points="'+q.points.map(p=>p.join(',')).join(' ')+'"'+common+'/>';
   }
   return '';
  });
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">'+parts.join('')+'</svg>';
 }
 // Bounded SVG instance keyframes are local scene seconds. The same
 // function is used for browser preview and MediaRecorder export.
 function assetFrame(item,local=0){
  const keys=(Array.isArray(item.motionKeys)?item.motionKeys:[]).filter(k=>
   isObj(k)&&Number.isFinite(k.t)).sort((a,b)=>a.t-b.t);
  if(!keys.length)return {x:c(item.x,0,100,50),y:c(item.y,0,100,75),
   scale:c(item.scale,.12,3,1),rotate:c(item.rotate,-180,180,0),
   opacity:c(item.opacity,0,1,1)};
  const t=Math.max(0,Number(local)||0);
  let a=keys[0],b=keys[0];
  if(t>=keys[keys.length-1].t)a=b=keys[keys.length-1];
  else for(let i=0;i<keys.length-1;i++)if(t>=keys[i].t&&t<=keys[i+1].t){
   a=keys[i];b=keys[i+1];break;
  }
  const q=a===b?0:Math.max(0,Math.min(1,(t-a.t)/Math.max(.0001,b.t-a.t)));
  const result={};
  for(const [key,min,max,def] of [['x',0,100,50],['y',0,100,75],
    ['scale',.12,3,1],['rotate',-180,180,0],['opacity',0,1,1]]){
   const base=c(item[key],min,max,def),v0=c(a[key],min,max,base),
    v1=c(b[key],min,max,v0);
   result[key]=v0+(v1-v0)*q;
  }
  return result;
 }
 function sceneMarkup(scene,layer,W,local=0){
  if(!scene||!Array.isArray(scene.customAssets))return '';
  const arr=scene.customAssets.filter(x=>isObj(x)&&!!x.front===(layer==='front')).slice(0,40);
  return arr.map(item=>{
   try{
    const a=asset(item.asset),pose=assetFrame(item,local),x=pose.x*W/100,y=pose.y*.9,
      scale=pose.scale*.42,flip=item.flip?-1:1;
    // SVG is generated from bounded numeric primitives, never user-supplied SVG.
    const elements=svg(a).replace(/^<svg[^>]*>/,'').replace(/<\/svg>$/,'');
    return '<g opacity="'+pose.opacity.toFixed(3)+'" transform="translate('+x.toFixed(2)+' '+y.toFixed(2)+') rotate('+pose.rotate.toFixed(2)+') scale('+(scale*flip).toFixed(3)+' '+scale.toFixed(3)+') translate(-50 -85)">'+elements+'</g>';
   }catch(e){return ''}
  }).join('');
 }
 return Object.freeze({asset,svg,sceneMarkup,assetFrame,categories:[...categories]});
});
