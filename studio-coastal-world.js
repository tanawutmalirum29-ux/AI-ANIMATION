/* Cinematic coastal SVG worlds — authored reusable panoramas.
 * Pure procedural SVG: no external images, script, fonts, or model APIs.
 * Coordinates are the 90-high Story Studio world, W grows with camera.world.
 * Back and front layers use the same drawing in preview + exported MP4.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.StoryCoastalWorld=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const TYPES=Object.freeze(['coastal-harbor','coastal-workshop','coastal-cliff','lighthouse-lantern','coastal-hill']);
 const clamp=(n,a,b,d=a)=>Number.isFinite(Number(n))?Math.min(b,Math.max(a,Number(n))):d;
 const f=n=>(Math.round(n*100)/100).toString();
 const R=(x,y,w,h,c,rx=0,op=1)=>'<rect x="'+f(x)+'" y="'+f(y)+'" width="'+f(Math.max(0,w))+'" height="'+f(Math.max(0,h))+'" rx="'+f(rx)+'" fill="'+c+'" opacity="'+f(op)+'"/>';
 const E=(x,y,rx,ry,c,op=1)=>'<ellipse cx="'+f(x)+'" cy="'+f(y)+'" rx="'+f(rx)+'" ry="'+f(ry)+'" fill="'+c+'" opacity="'+f(op)+'"/>';
 const C=(x,y,r,c,op=1)=>'<circle cx="'+f(x)+'" cy="'+f(y)+'" r="'+f(r)+'" fill="'+c+'" opacity="'+f(op)+'"/>';
 const P=(d,c,op=1,stroke='none',sw=.7)=>'<path d="'+d+'" fill="'+c+'" opacity="'+f(op)+'" stroke="'+stroke+'" stroke-width="'+f(sw)+'" stroke-linejoin="round"/>';
 const L=(x1,y1,x2,y2,c,w=1,op=1)=>'<path d="M'+f(x1)+' '+f(y1)+'L'+f(x2)+' '+f(y2)+'" fill="none" stroke="'+c+'" stroke-width="'+f(w)+'" opacity="'+f(op)+'" stroke-linecap="round"/>';
 const tri=(a,b,c,color,op=1)=>P('M'+f(a[0])+' '+f(a[1])+'L'+f(b[0])+' '+f(b[1])+'L'+f(c[0])+' '+f(c[1])+'Z',color,op);
 const effect=(scene,k)=>scene&&scene.worldEffects&&scene.worldEffects[k]===true;
 const amt=(scene,k,d=0)=>clamp(scene&&scene.worldEffects&&scene.worldEffects[k],0,1,d);
 const clock=(local,duration)=>clamp(local,0,1000,0)/Math.max(1,clamp(duration,1,500,8));
 function boat(x,y,scale=1){
  return '<g transform="translate('+f(x)+' '+f(y)+') scale('+f(scale)+')">'+
   P('M-9 -3L10 -3L6 1L-6 1Z','#344c59')+
   R(-1.1,-16,1.2,13,'#d5d6cc')+tri([.1,-15],[.1,-5],[7,-6],'#b2c8cf',.85)+
   L(-7,-2,9,-2,'#daaf73',.6)+'</g>';
 }
 function tinyHouse(x,y,scale,c='#6f7479'){
  return '<g transform="translate('+f(x)+' '+f(y)+') scale('+f(scale)+')">'+
   R(-9,-17,18,17,c)+P('M-11 -17L0 -25L11 -17Z','#4d515e')+
   R(-6,-13,4,5,'#d8b77e',.5)+R(2,-13,4,5,'#d8b77e',.5)+R(-1.8,-9,3.6,9,'#384854',.3)+'</g>';
 }
 function market(x,y,scale,shade,light=true){
  const awning=Array.from({length:5},(_,i)=>
   R(-10+i*4,-25,4,3,i%2===0?shade:'#ece0bf',0)).join('');
  const produce=['#d49b54','#8fbc8c','#c87858','#b1a06c'].map((v,i)=>E(-7+i*4.4,-7,2.2,1.1,v)).join('');
  return '<g data-world-object="market-stall" transform="translate('+f(x)+' '+f(y)+') scale('+f(scale)+')">'+
   R(-9,-22,1.5,22,'#847a73')+R(7.5,-22,1.5,22,'#847a73')+
   P('M-11 -23L-8 -32L8 -32L11 -23Z','#443e48')+awning+
   R(-10,-11,20,3,'#a38a6b',.5)+R(-8,-8,16,8,'#5a5151')+produce+
   R(-7,-7,5,6,'#735944')+R(2,-7,5,6,'#735944')+
   (light?C(0,-27,1.6,'#ffe6a2',.95)+C(0,-27,4.3,'#ffda85',.13):'')+'</g>';
 }
 function lighthouse(x,base,scale=1,beam=false,direction='right',phase=1){
  let body='<g data-world-object="lighthouse-exterior" transform="translate('+f(x)+' '+f(base)+') scale('+f(scale)+')">'+
   E(0,1,18,3,'#1c3440',.6)+
   P('M-8 0L-6 -60L6 -60L8 0Z','#d2d0c7')+
   P('M-7 -19L7 -19L6.8 -26L-6.7 -26Z','#ae6664')+
   P('M-6.5 -40L6.5 -40L6.2 -47L-6.2 -47Z','#ae6664')+
   R(-1.8,-12,3.6,12,'#304752',1)+
   R(-8,-62,16,3,'#535a68',.7)+
   R(-7,-72,14,10,'#bed6df',1,.8)+
   Array.from({length:5},(_,i)=>L(-6.6+i*3.3,-72,-6.6+i*3.3,-62,'#394e60',.65)).join('')+
   R(-8.4,-73,16.8,2,'#525b66')+
   P('M-8.5 -73L0 -80L8.5 -73Z','#373f50')+
   R(-.6,-84,1.2,5,'#46556b')+C(0,-84.6,1.2,'#e8c684')+
   R(-11,-61,22,1.4,'#485160')+
   Array.from({length:7},(_,i)=>L(-10.4+i*3.5,-61,-10.4+i*3.5,-58.2,'#53606b',.55)).join('');
  if(beam){
   const side=direction==='left'?-1:1;
   body+=tri([side*1,-67],[side*104,-102],[side*100,-33],'#f8d994',.18*phase)+
    C(0,-67,5.3,'#ffecad',.24*phase)+C(0,-67,1.8,'#fff5cd',phase);
  }
  return body+'</g>';
 }
 // Tiny animated background people live inside the same wide world as the market.
 // Each pose is driven from scene time, not from screen dimensions or browser FPS.
 function person(x,y,shirt='#c8a46f',arm='rest',carry=false){
  const hands=arm==='warn'?
   L(x-1.1,y-6,x-3.3,y-11,'#c79a7f',.85)+L(x+1.2,y-6,x+4.2,y-9,'#c79a7f',.85):
   L(x-1.1,y-6,x-2.6,y-2.2,'#c79a7f',.85)+L(x+1.2,y-6,x+2.7,y-2.2,'#c79a7f',.85);
  return '<g data-world-object="market-person">'+
   E(x,y+.5,3,1,'#182f40',.32)+
   L(x-.8,y-2.3,x-1.5,y,'#324756',1.15)+L(x+.8,y-2.3,x+1.6,y,'#324756',1.15)+
   P('M'+f(x-1.6)+' '+f(y-7.5)+'L'+f(x+1.6)+' '+f(y-7.5)+'L'+f(x+1.3)+' '+f(y-2)+'L'+f(x-1.3)+' '+f(y-2)+'Z',shirt)+
   C(x,y-9,1.6,'#c79a7f')+P('M'+f(x-1.8)+' '+f(y-9.5)+'Q'+f(x)+' '+f(y-13)+' '+f(x+1.8)+' '+f(y-9.5),'#343b44')+
   hands+(carry?'<g data-world-object="evacuation-crate">'+R(x-3.2,y-7.7,6.4,4.4,'#b38a60',.25)+
   L(x-2.8,y-5.5,x+2.8,y-5.5,'#e1b87a',.6)+'</g>':'')+'</g>';
 }
 function harbor(W,local,scene,front){
  const t=Math.min(1,clock(local,scene.duration)),x=q=>W*q;
  const leak=effect(scene,'gateLeak'),flood=effect(scene,'marketFlood');
  const waterRise=effect(scene,'waterRise')||effect(scene,'gateLeak')||flood;
  const warning=effect(scene,'marketWarning'),evac=effect(scene,'evacuation');
  const empty=effect(scene,'marketEmpty')||(flood&&!warning&&!evac);
  const safeHill=effect(scene,'safeHill'),blackout=effect(scene,'blackout'),seq=effect(scene,'sequentialBlackout');
  const surface=76-(waterRise?Math.min(7,t*7):0);
  if(front){
   // Shore highlights belong at the feet, not as a rectangle over the actors.
   let foam=Array.from({length:12},(_,i)=>{
    const xx=x(.04+i*.035),yy=surface+1+(i%3);
    return L(xx,yy,xx+2+(i%3),yy,'#b6d9de',.28,.3+.2*Math.sin(local*1.4+i));
   }).join('');
   if(leak){
    for(let j=0;j<6;j++){
     const xx=x(.585)+j*1.4+.7*Math.sin(local*4+j);
     foam+=C(xx,76+j*.23,Math.max(.22,.55-j*.04),'#d9f4eb',.36);
    }
   }
   return foam;
  }
  let o=
   // Distant coast and sea: a quiet upper horizon, not a giant dark sky panel.
   P('M0 49Q'+f(x(.18))+' 45 '+f(x(.34))+' 48T'+f(W)+' 47L'+f(W)+' 64L0 64Z','#29485a',.65)+
   P('M0 61Q'+f(x(.22))+' 58 '+f(x(.42))+' 63L'+f(W)+' 67L'+f(W)+' 90L0 90Z','#243b4c')+
   R(0,66,x(.48),24,'#2c5c70')+
   Array.from({length:17},(_,i)=>L(x(i*.027),70+(i%5)*3,x(i*.027)+3,70+(i%5)*3,'#91bcc1',.3,.7)).join('')+
   boat(x(.13),72,.7)+boat(x(.3),72,.57)+
   // Concrete quay kept ABOVE the water. This establishes two real elevation levels.
   R(x(.17),66,x(.27),16,'#717878')+R(x(.17),64,x(.27),2.5,'#a4a49b')+
   Array.from({length:9},(_,i)=>L(x(.17+i*.03),69,x(.17+i*.03),81,'#445057',.55,.7)).join('')+
   // A water gauge: five tick marks plus a MOVING level pointer.
   '<g data-world-object="water-level-gauge">'+
   R(x(.421),63,2.2,19,'#d4d0be',.3)+
   Array.from({length:5},(_,i)=>L(x(.421),66+i*3.2,x(.421)+1.5,66+i*3.2,'#324a5a',.5)).join('')+
   tri([x(.422),surface],[x(.417),surface-1.25],[x(.417),surface+1.25],'#f7cb78')+'</g>'+
   // Upstream water RISES visibly against the concrete and gate-left threshold.
   '<g data-world-object="upstream-water">'+
   P('M'+f(x(.365))+' '+f(surface)+'Q'+f(x(.39))+' '+f(surface-1.2)+' '+f(x(.417))+' '+f(surface)+
    'L'+f(x(.465))+' '+f(surface-.9)+'L'+f(x(.465))+' 83L'+f(x(.365))+' 83Z','#43899e',.94)+
   L(x(.368),surface,x(.463),surface-1,'#c2e4df',.85,.75)+'</g>'+
   // Flood-control *sluice*, not a house door: an open water channel flanked
   // by massive concrete piers, hoist housing, steel slide and pressure jets.
   '<g data-world-object="floodgate">'+
   R(x(.453),42,5.2,42,'#939995')+R(x(.602),42,5.2,42,'#939995')+
   R(x(.45),40,x(.163),5.4,'#b4b0a4',.6)+
   P('M'+f(x(.454))+' 43L'+f(x(.454)+5)+' 43L'+f(x(.454)+5)+' 83L'+f(x(.454))+' 86Z','#5f7277')+
   R(x(.459),48,x(.14),31,'#334a55')+
   // Nested vertical steel rails and corrugated water-stopping SLIDE panel.
   R(x(.471),49,x(.112),28,'#697982')+
   Array.from({length:9},(_,i)=>L(x(.472),51+i*2.85,x(.581),51+i*2.85,i%2?'#bf7966':'#3b5765',.66)).join('')+
   R(x(.473),49,1.4,30,'#b8b9ad')+R(x(.58),49,1.4,30,'#b8b9ad')+
   // Rust flaking on the lower slide, and a hoist gear/shaft on TOP.
   Array.from({length:7},(_,i)=>R(x(.479+i*.016),56+(i%3)*5,1.1,1.6,'#a96754',.15, .82)).join('')+
   C(x(.528),38.3,4,'#465461')+C(x(.528),38.3,2.7,'#bdaf95')+
   Array.from({length:8},(_,i)=>{const a=i*Math.PI/4;return L(x(.528)+Math.cos(a),38.3+Math.sin(a),x(.528)+Math.cos(a)*3.5,38.3+Math.sin(a)*3.5,'#51646b',.8)}).join('')+
   R(x(.525),42,1.5,9,'#d0bb9e')+
   // Channel banks visibly funnel water through the gate.
   P('M'+f(x(.44))+' 78L'+f(x(.48))+' 80L'+f(x(.61))+' 80L'+f(x(.64))+' 89L'+f(x(.42))+' 89Z','#556970')+
   '</g>'+
   // The lowland market is elevated above the shoreline with a street in front.
   P('M'+f(x(.605))+' 63L'+f(x(.72))+' 57L'+f(x(.85))+' 61L'+f(W)+' 57L'+f(W)+' 82L'+f(x(.60))+' 82Z','#465763')+
   [0.65,0.76,0.89].map((v,i)=>tinyHouse(x(v),66,.55+i*.08,['#5a6770','#746b6c','#566c70'][i])).join('')+
   P('M'+f(x(.595))+' 81L'+f(x(.88))+' 81L'+f(x(.95))+' 69L'+f(W)+' 65L'+f(W)+' 90L'+f(x(.595))+' 90Z','#73746d')+
   L(x(.61),83,x(.89),83,'#b9b1a0',.5,.7)+
   market(x(.66),79,.86,'#ad685e',!blackout&&(!seq||t<.5))+
   market(x(.77),79,.9,'#63918d',!blackout&&(!seq||t<.7))+
   market(x(.88),79,.86,'#a0845f',!blackout&&(!seq||t<.9))+
   lighthouse(x(.97),62,.44,!blackout||effect(scene,'signalVisible'),'left',.7)+
   [0.24,0.39,0.61].map((v,i)=>{
    const xx=x(v),on=!blackout&&(!seq||t<.2+i*.28);
    return R(xx-.4,50,.8,14,'#45545a')+
     P('M'+f(xx-2)+' 52L'+f(xx+2)+' 52L'+f(xx+1.3)+' 49L'+f(xx-1.3)+' 49Z','#baae8e')+
     (on?C(xx,50,4,'#f8d79d',.12)+C(xx,50,.8,'#ffe6ae'):'');
   }).join('');
  // Market must be OCCUPIED before the warning. Evacuation is a causal event,
  // not an unmotivated empty row of stalls.
  if(!empty&&!safeHill){
   const q=evac?Math.min(1,t*1.4):0;
   const crowd=[.645,.752,.865];
   o+='<g data-world-object="populated-market">'+crowd.map((v,i)=>{
    const px=x(v+.065*q),py=79-q*(3.5+i*.8);
    return person(px,py,['#d8a15a','#9bb0a3','#c17d75'][i],
      warning||evac?'warn':'rest',evac||warning);
   }).join('')+'</g>';
   if(warning||evac){
    o+='<g data-world-object="merchant-response">'+
     // Box visibly LIFTS and MOVES uphill as the warning is acted on.
     [0,1].map((i)=>{
      const u=Math.max(0,Math.min(1,(t-.15-i*.14)*1.55)),xx=x(.705+i*.11)+u*x(.08);
      return '<g data-world-object="moving-crates">'+
       R(xx,76-u*10,5.4,4,'#a57e52',.3)+
       L(xx,77-u*10,xx+5.4,77-u*10,'#e7c18a',.55)+'</g>';
     }).join('')+'</g>';
   }
  }
  // Water jet has source and destination; no giant transparent triangle.
  if(leak){
   const intensity=.4+.6*t;
   o+='<g data-world-object="gate-leak-jet">'+
    P('M'+f(x(.582))+' 75.2Q'+f(x(.612))+' '+f(73+Math.sin(local*4)*.7)+' '+f(x(.645))+
     ' 80L'+f(x(.638))+' 82Q'+f(x(.6))+' 77 '+f(x(.582))+' 78Z','#72bed1',intensity)+
    Array.from({length:5},(_,i)=>L(x(.585+i*.01),76+i*.5,x(.62+i*.009),79+i*.5,'#d6f7f0',.35,.9)).join('')+
    Array.from({length:6},(_,i)=>C(x(.62+i*.006),80+Math.sin(local*5+i)*1.5,.5,'#bbefeb',.58)).join('')+'</g>';
  }
  // Evacuation itself moves figures from lowland to uphill; unlike the old
  // disappearing silhouettes, the market is clearly shown populated first.
  if(effect(scene,'evacuation')&&!empty){
   const q=Math.min(1,t*1.2);
   o+='<g data-world-object="evacuating-villager">'+
    person(x(.73+.17*q),78-9*q,'#d49d6e','warn',true)+
    person(x(.79+.12*q),77-8*q,'#83b2a3','rest',true)+'</g>';
  }
  // Water fills the LOWER street surface with a wavy shoreline; the top
  // stays below stall counters until the concluding moment, not over roofs.
  if(flood){
   const top=88-8*t,land=x(.605),end=x(.925);
   o+='<g data-world-object="market-street-flood">'+
    P('M'+f(land)+' '+f(top+2)+'Q'+f(x(.68))+' '+f(top-1)+' '+f(x(.74))+' '+f(top)+
      'T'+f(end)+' '+f(top+1)+'L'+f(end)+' 90L'+f(land)+' 90Z','#387a91',.81)+
    Array.from({length:10},(_,i)=>L(x(.615+i*.031),top+1+(i%3)*1.6,x(.63+i*.031),top+1+(i%3)*1.6,'#a2d8d8',.35)).join('')+
    '</g>';
  }
  // End-state reveal: high-ground path and visible SAFE group, not an empty
  // market at the start. This sits at the far end of the same wide panorama.
  if(safeHill){
   o+='<g data-world-object="safe-hill">'+
    P('M'+f(x(.885))+' 76Q'+f(x(.94))+' 58 '+f(W)+' 61L'+f(W)+' 90L'+f(x(.885))+' 90Z','#6f8776')+
    L(x(.895),76,x(.99),62,'#c0b294',.8)+
    person(x(.948),65,'#d79e55','rest',false)+
    person(x(.965),63,'#8bbaa7','rest',false)+
    person(x(.982),65,'#ba8581','rest',false)+'</g>';
  }
  return o;
 }
 function workshop(W,local,scene,front){
  const x=q=>W*q;
  if(front)return '';
  return R(0,17,W,65,'#363d49',0,.4)+
   Array.from({length:Math.ceil(W/8)},(_,i)=>L(i*8,21,i*8,77,'#9aa2a4',.23,.12)).join('')+
   // Tall window with rain outside instead of rain falling through the room.
   R(x(.69),20,W*.22,33,'#917f70',1)+R(x(.695),21,W*.21,30,'#274458')+
   L(x(.8),21,x(.8),52,'#98abae',1.2)+L(x(.695),36,x(.91),36,'#98abae',.8)+
   Array.from({length:12},(_,i)=>L(x(.7+i*.016),23+(i%3)*4,x(.7+i*.016)-1.5,32+(i%3)*4,'#cce2e7',.45,.4)).join('')+
   // Tool rack: visually reads as WORKSHOP, not domestic living room.
   R(x(.14),33,W*.32,27,'#66594e')+R(x(.145),34,W*.31,25,'#4f5759')+
   Array.from({length:5},(_,i)=>L(x(.17+i*.05),41,x(.17+i*.05),51,'#c9af87',.8)).join('')+
   Array.from({length:4},(_,i)=>C(x(.19+i*.05),42,1,'#bcc6c5')).join('')+
   R(x(.22),63,W*.41,3,'#9b8067')+
   R(x(.24),66,2,15,'#665e56')+R(x(.6),66,2,15,'#665e56')+
   // Hand crank, paper notebook and big warning sketch on bench.
   R(x(.34),59,8,4,'#dbc9a8')+L(x(.37),59,x(.37),63,'#826d5a',.7)+
   R(x(.5),56,8,5,'#343a45',1)+C(x(.54),56,2.4,'#b8a78e')+
   R(x(.08),45,W*.1,25,'#625c59')+
   [0,1,2].map(i=>R(x(.08),45+i*7,W*.1,1.6,'#b29976')).join('')+
   C(x(.51),37,5,'#ffe3a4',.12)+
   (effect(scene,'notebookOpen')?
    '<g data-world-object="open-notebook">'+
    R(x(.31),57,6+5*clock(local,scene.duration),4,'#e5d8bb',.3)+
    R(x(.31)+6,57,6,4,'#f1ead5',.3)+
    L(x(.31)+6,57,x(.31)+6,61,'#8b6a57',.55)+'</g>':'')+
   (effect(scene,'signalDiagram')?
    '<g data-world-object="three-ray-diagram">'+C(x(.39),57,1.6,'#e7c57b')+
    [0,1,2].map(i=>L(x(.39),57,x(.39)-4+i*4,53-i%2*2,'#ad7650',.7)).join('')+'</g>':'');
 }
 function cliff(W,local,scene,front){
  const x=q=>W*q,t=clock(local,scene.duration),broken=effect(scene,'bridgeFall');
  if(front)return '';
  let o=P('M0 61Q'+f(x(.3))+' 54 '+f(x(.55))+' 65T'+f(W)+' 54L'+f(W)+' 90L0 90Z','#24475a')+
   P('M0 76L'+f(x(.28))+' 53L'+f(x(.44))+' 57L'+f(x(.55))+' 68L'+f(x(.7))+' 51L'+f(W)+' 65L'+f(W)+' 90L0 90Z','#46565b')+
   P('M0 84L'+f(x(.28))+' 62L'+f(x(.4))+' 62L'+f(x(.58))+' 75L'+f(x(.84))+' 60L'+f(W)+' 68L'+f(W)+' 90L0 90Z','#727978')+
   // Broken bridge over a small dark gully (clear before / after).
   P('M'+f(x(.39))+' 67L'+f(x(.48))+' 75L'+f(x(.58))+' 70L'+f(x(.58))+' 90L'+f(x(.39))+' 90Z','#173743')+
   L(x(.39),68,x(.485),67,'#c4a982',1.5)+
   L(x(.49),67+(broken?8*t:0),x(.58),68+(broken?14*t:0),'#c4a982',1.5)+
   [0.42,0.46,0.52,0.56].map((v,i)=>R(x(v),66+(broken&&i>1?t*8:0),2,2,'#816850')).join('')+
   lighthouse(x(.85),70,.9,effect(scene,'beaconOn'),'left',.85)+
   Array.from({length:6},(_,i)=>E(x(.05+i*.16),80+(i%2)*4,9,4,'#3b4c55',.9)).join('')+
   boat(x(.18),68,.4);
  if(effect(scene,'toolboxFall')){
   const q=clamp((t-.22)/.65,0,1),boxX=x(.49)+q*11,boxY=48+q*q*41;
   o+='<g data-world-object="falling-toolbox" transform="translate('+f(boxX)+' '+f(boxY)+') rotate('+f(q*70)+')" opacity="'+f(1-q*.95)+'">'+
    R(-4,-4,8,5,'#9f5149',.8)+R(-4,-5,8,1.4,'#db8169')+
    R(-1.4,-7,3,2,'#aeb4aa',.3)+'</g>';
  }
  return o;
 }
 function lantern(W,local,scene,front){
  const x=q=>W*q,t=clock(local,scene.duration),on=effect(scene,'beaconOn'),
   snapped=effect(scene,'beltBreak'),repaired=effect(scene,'beltRepair'),facing=scene.worldEffects?.beamDirection==='village'?'left':'right',
   flashes=effect(scene,'threeFlashes');
  if(front)return R(0,84,W,1.4,'#b1a292',.4,.65);
  const flashPhase=flashes?([.12,.34,.56].some(start=>t>=start&&t<start+.1)?1:0):1;
  const lit=on&&(!snapped||t<.58)?flashPhase:0;
  let o=R(0,12,W,64,'#344452',0,.46)+
   // Lantern room CURVED window bays + heavy steel mullions.
   Array.from({length:Math.ceil(W/23)},(_,i)=>{
    const xx=i*23;return R(xx,19,19.5,40,'#253f53')+
     P('M'+f(xx)+' 19Q'+f(xx+9.7)+' 7 '+f(xx+19.5)+' 19Z','#52616c')+
     R(xx+17.8,14,2,47,'#70818a')+
     L(xx+1,42,xx+18,42,'#8da0a5',.8)+
     Array.from({length:3},(_,j)=>L(xx+3+j*5,23,xx+5+j*5,40,'#91afb8',.45,.26)).join('');
   }).join('')+
   // Lighthouse glass giant Fresnel lens, not a household lamp.
   '<g data-world-object="fresnel-lens">'+E(x(.63),30,20,18,'#fbdfa3',.11*lit)+
   P('M'+f(x(.63)-12)+' 13L'+f(x(.63)+12)+' 13L'+f(x(.63)+15)+' 48L'+f(x(.63)-15)+' 48Z','#9dbbc0',.65)+
   Array.from({length:7},(_,i)=>{
    const yy=18+i*4;return L(x(.63)-13,yy,x(.63)+13,yy,i%2?'#d4d3bd':'#9be3ef',.8,.75);
   }).join('')+
   E(x(.63),31,9,12,'#ecd8a3',.52)+C(x(.63),31,5.4,'#fff1bc',lit*.9)+'</g>'+
   // An articulated reflector redirects the signal, not a stationary lamp.
   '<g data-world-object="reflector-mirror" transform="rotate('+
    f(effect(scene,'reflectorTurn')? -35+65*t:-35)+' '+f(x(.63))+' 31)">'+
    L(x(.63)-10,25,x(.63)+10,25,'#d9e9e4',1.8)+
    L(x(.63)-10,25,x(.63)-10,39,'#e4d3b0',.8)+'</g>'+
   // Large gear train + manual crank assembly at left.
   R(x(.16),53,x(.45),4,'#9c8875')+R(x(.28),48,3,35,'#5e6267')+
   '<g data-world-object="hand-crank" transform="rotate('+
     f(effect(scene,'crankTurn')?720*t:0)+' '+f(x(.32))+' 51)">'+
   C(x(.32),51,7,'#535c62')+C(x(.32),51,4.8,'#ac9f86')+C(x(.32),51,2,'#51616a')+
   Array.from({length:8},(_,i)=>{const angle=i*Math.PI/4;return L(x(.32)+Math.cos(angle)*2.3,51+Math.sin(angle)*2.3,x(.32)+Math.cos(angle)*6,51+Math.sin(angle)*6,'#5b6067',.75)}).join('')+
   L(x(.32),51,x(.32)+7,48,'#d0b18c',1.5)+C(x(.32)+7,48,1.8,'#674d41')+'</g>'+
   // Belt visibly connects two pulleys and can snap / fall.
   C(x(.46),51,4,'#5e6267')+C(x(.58),51,3,'#5e6267')+
   (snapped&&t>=.58?L(x(.46),47,x(.51),54+10*t,'#be9777',2)+L(x(.51),54+10*t,x(.58),48,'#be9777',2):
    L(x(.46),47,x(.58),48,repaired?'#d6b38c':'#be9777',2)+L(x(.46),55,x(.58),54,repaired?'#d6b38c':'#be9777',2))+
   // Metal service stairs, no furniture or sofa.
   R(x(.05),67,W*.15,2,'#596b73')+
   Array.from({length:6},(_,i)=>L(x(.06+i*.021),67-i*3,x(.19+i*.021),67-i*3,'#929a9d',.75)).join('')+
   R(0,80,W,4,'#666b72');
  if(lit){
   const side=facing==='left'?-1:1;
   o+=tri([x(.63),30],[x(.63)+side*W*.4,-10],[x(.63)+side*W*.4,65],'#ffdb81',.23)+
      C(x(.63),31,8,'#ffedbb',.3);
  }
  return o;
 }
 function hill(W,local,scene,front){
  const x=q=>W*q;
  if(front)return '';
  let o=P('M0 47Q'+f(x(.35))+' 32 '+f(x(.56))+' 48T'+f(W)+' 43L'+f(W)+' 90L0 90Z','#7b9391')+
   P('M0 62Q'+f(x(.25))+' 49 '+f(x(.47))+' 63T'+f(W)+' 56L'+f(W)+' 90L0 90Z','#59737a')+
   Array.from({length:8},(_,i)=>tinyHouse(x(.07+i*.1),70,.28+i%2*.1,'#576876')).join('')+
   lighthouse(x(.67),63,.42,true,'left',.75)+
   P('M0 84L'+f(x(.38))+' 69L'+f(x(.71))+' 77L'+f(W)+' 64L'+f(W)+' 90L0 90Z','#607e6e')+
   C(x(.85),15,10,'#f4dcb3',.53);
  return o;
 }
 function render(set,layer,W,local=0,scene={}){
  const kind=typeof set==='string'?set:set&&set.worldArt;
  if(!TYPES.includes(kind))return '';
  const width=clamp(W,20,1100,160),t=clamp(local,0,1000,0),front=layer==='front';
  let svg='';
  if(kind==='coastal-harbor')svg=harbor(width,t,scene,front);
  if(kind==='coastal-workshop')svg=workshop(width,t,scene,front);
  if(kind==='coastal-cliff')svg=cliff(width,t,scene,front);
  if(kind==='lighthouse-lantern')svg=lantern(width,t,scene,front);
  if(kind==='coastal-hill')svg=hill(width,t,scene,front);
  return '<g data-world-art="'+kind+'" data-world-layer="'+layer+'">'+svg+'</g>';
 }
 return Object.freeze({TYPES,render});
});
