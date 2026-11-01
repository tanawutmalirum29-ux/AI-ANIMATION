/* Story Studio · Pro workspace (NLE-style multitrack timeline, transport, icon UI).
   Loaded after the main script. Wraps timeline()/ctl()/renderTop(); keeps all data in the existing project model. */
(function(){
'use strict';
if(typeof ep!=='function'||typeof timeline!=='function')return;

/* ---------- icons ---------- */
const IC={
 play:'<path d="M7 4.5v15l13-7.5z" class="f"/>',pause:'<path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z" class="f"/>',
 prev:'<path d="M6 5v14"/><path d="M19 5.5v13L9 12z" class="f"/>',next:'<path d="M18 5v14"/><path d="M5 5.5v13L15 12z" class="f"/>',
 scissors:'<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
 trash:'<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
 mic:'<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4"/>',
 bell:'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
 music:'<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
 library:'<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
 wand:'<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
 magnet:'<path d="M6 15a6 6 0 0 0 12 0V3h-4v12a2 2 0 0 1-4 0V3H6zM6 8h4M14 8h4"/>',
 zin:'<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/>',zout:'<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/>',
 fit:'<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
 vol:'<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a9 9 0 0 1 0 12"/>',
 mute:'<path d="M11 5 6 9H2v6h4l5 4V5zM22 9l-6 6M16 9l6 6"/>',
 loop:'<path d="M17 2l4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3"/>',
 sliders:'<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
 undo:'<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',redo:'<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 15-6.7L21 13"/>',
 menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
 film:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 12h4M3 16h4M17 8h4M17 12h4M17 16h4"/>',
 user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
 grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
 wave:'<path d="M2 12h2M6 8v8M10 4v16M14 7v10M18 9v6M22 12h-2"/>',
 check:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
 up:'<path d="M12 15V3M7 8l5-5 5 5M5 21h14"/>',
 speak:'<path d="M3 11v2M7 8v8M11 4v16M15 8v8M19 10v4"/>',
 chat:'<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-5.4A8 8 0 1 1 21 12z"/>',
 play2:'<path d="m5 3 14 9-14 9z"/>'
};
const ic=(n,extra='')=>`<svg class="pi ${extra}" viewBox="0 0 24 24" aria-hidden="true">${IC[n]||''}</svg>`.replace(/class="f"/g,'fill="currentColor" stroke="none"');
const iconEl=n=>{const t=document.createElement('template');t.innerHTML=ic(n);return t.content.firstChild};

/* ---------- state ---------- */
const KIND_COLOR={voice:'var(--t-voice)',sfx:'var(--t-sfx)',music:'var(--t-music)'};
const KIND_NAME={voice:'พากย์',sfx:'เอฟเฟกต์',music:'เพลง'};
let PPS=0,FIT=true,SNAP=true,SELID=null,SCROLL_L=0,SCROLL_T=0;
let ROOT=null,EVS=[],LANE0=null,PLAY=null,SNAPLINE=null,LASTT=-1,LASTPPS=0,LASTSEL=-1,toastTimer=0;
const r1=x=>Math.round(x*100)/100;
const mmss=t=>{t=Math.max(0,t);const m=Math.floor(t/60),s=t-m*60;return String(m).padStart(2,'0')+':'+s.toFixed(2).padStart(5,'0')};
const E=()=>ep();
const sceneAt=t=>{const st=starts(),n=st.length;let k=0;for(let i=0;i<n;i++)if(st[i]<=t+1e-6)k=i;return k};
function allClips(){const out=[],e=E();e.scenes.forEach((s,i)=>(s.audioClips||[]).forEach(c=>out.push({c,scope:'scene',scene:i,arr:s.audioClips})));(e.musicClips||[]).forEach(c=>out.push({c,scope:'music',scene:-1,arr:e.musicClips}));return out}
const findClip=id=>id?allClips().find(x=>x.c.id===id):null;
const laneOf=c=>c.kind==='music'?'music':c.kind==='sfx'?'sfx':'voice';
function toast(msg){if(!ROOT)return;let t=ROOT.querySelector('.pt-toast');if(!t){t=document.createElement('div');t.className='pt-toast';ROOT.append(t)}t.textContent=msg;t.style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>{t.style.display='none'},2200)}

/* ---------- waveform ---------- */
function waveSVG(c,lenPx){
 const src=Array.isArray(c.wave)&&c.wave.length?c.wave:null,N=src?src.length:64,dur=cleanNum(c.duration)||1;
 const a=src?Math.floor(N*cleanNum(c.trimStart)/dur):0,b=src?Math.max(a+1,Math.ceil(N*(dur-cleanNum(c.trimEnd))/dur)):N;
 const bars=Math.max(4,Math.min(Math.floor(lenPx/3),240));let d='';
 for(let i=0;i<bars;i++){const idx=src?a+Math.floor(i*(b-a)/bars):i;let v=src?src[Math.min(N-1,idx)]:.25+.2*Math.abs(Math.sin(i*.9));v=Math.max(.06,Math.min(1,v));const h=v*40;d+=`M${i+.5} ${50-h}V${50+h}`}
 return `<svg class="wv" viewBox="0 0 ${bars} 100" preserveAspectRatio="none"><path d="${d}" stroke="${KIND_COLOR[laneOf(c)]}" stroke-opacity=".9" stroke-width=".62" fill="none"/></svg>`;
}

/* ---------- snapping ---------- */
function snapPoints(excludeId){
 const pts=[0,T],st=starts(),e=E();st.forEach((s,i)=>{pts.push(s,s+e.scenes[i].duration)});
 for(const ev of EVS){if(ev.c.id===excludeId)continue;const len=Math.min(safeClipDuration(ev.c),ev.limit-ev.start);pts.push(ev.start,ev.start+len)}
 return pts;
}
function snapTime(t,pts,exclude){
 if(!SNAP)return{t:r1(t),hit:null};
 const th=8/PPS;let best=null,bd=th;
 for(const p of pts){const d=Math.abs(p-t);if(d<bd){bd=d;best=p}}
 return best===null?{t:r1(t),hit:null}:{t:best,hit:best};
}
function showSnap(x){if(!SNAPLINE)return;if(x==null){SNAPLINE.style.display='none';return}SNAPLINE.style.display='block';SNAPLINE.style.left=(160+x*PPS)+'px'}

/* ---------- actions ---------- */
function setProp(c,key,v){commit(()=>{c[key]=v;adjustAudioClip(c,key)})}
function deleteClip(id){const x=findClip(id);if(!x)return;commit(()=>{x.arr.splice(x.arr.indexOf(x.c),1)});for(const [k,a] of AUDIO_PLAYERS)if(k.startsWith(x.c.id+':')){a.pause();AUDIO_PLAYERS.delete(k);AUDIO_PLAYER_GRAPHS.delete(k)}SELID=null;timeline()}
function muteClip(id){const x=findClip(id);if(!x)return;commit(()=>{x.c.mute=!x.c.mute})}
function loopClip(id){const x=findClip(id);if(!x)return;commit(()=>{x.c.loop=!x.c.loop})}
function splitClip(id){
 const ev=EVS.find(v=>v.c.id===id&&v.cycle===0),x=findClip(id);if(!ev||!x)return;
 const c=x.c,len=safeClipDuration(c),lead=Math.max(0,cleanNum(c.audioLead)),off=T-ev.start;
 if(c.loop){toast('คลิปวนซ้ำตัดไม่ได้ — ปิดวนซ้ำก่อน');return}
 if(off<=.08||off>=len-.08){toast('วางหัวเข็มบนคลิปที่เลือกก่อน แล้วกด S เพื่อตัด');return}
 const cut=cleanNum(c.trimStart)+off*effectiveClipRate(c),oldEnd=c.trimEnd;
 const second={...c,id:'clip'+uid(),name:(c.name||'คลิป')+' (2)',at:r1(cleanNum(c.at)+off-lead),trimStart:+cut.toFixed(3),trimEnd:oldEnd,fadeIn:0,audioLead:0};
 commit(()=>{c.trimEnd=+(c.duration-cut).toFixed(3);c.fadeOut=0;x.arr.splice(x.arr.indexOf(c)+1,0,second)});
 SELID=second.id;timeline();
}
function muteTrack(kind){const list=allClips().filter(x=>laneOf(x.c)===kind);if(!list.length)return;const mute=!list.every(x=>x.c.mute);commit(()=>list.forEach(x=>{x.c.mute=mute}))}
function pickFile(kind){
 const input=document.createElement('input');input.type='file';input.accept='audio/*';
 input.onchange=async()=>{const f=input.files[0];if(!f)return;
  AUDIO_DESK_SCENE=sceneAt(T);const before=new Set(allClips().map(x=>x.c.id));
  await addAudioFile(f,kind==='music'?'music':kind);
  const fresh=allClips().find(x=>!before.has(x.c.id));
  if(fresh){const c=fresh.c;commit(()=>{if(fresh.scope==='music')c.at=r1(T);else{const j=fresh.scene,pre=prerollSpan(E(),j,E().scenes[j]);c.at=Math.max(0,r1(T-starts()[j]-pre))}});SELID=c.id;timeline();toast('วางคลิปที่หัวเข็มแล้ว · ลากเพื่อจัดตำแหน่ง')}};
 input.click();
}
function setZoom(p,anchorT){
 const sc=ROOT&&ROOT.querySelector('.pt-scroll');const min=2,max=400;p=Math.max(min,Math.min(max,p));
 let ax=0;if(sc&&anchorT!=null)ax=anchorT*PPS-(sc.scrollLeft);
 PPS=p;FIT=false;build();
 const sc2=ROOT.querySelector('.pt-scroll');if(sc2&&anchorT!=null)sc2.scrollLeft=Math.max(0,anchorT*PPS-ax);SCROLL_L=sc2.scrollLeft;
}
function fitZoom(){FIT=true;PPS=0;build()}

/* ---------- build ---------- */
function build(){
 const e=E();if(!e)return;
 const root=$('#tl');if(!root)return;ROOT=root;root.classList.add('pro-tl');
 const oldSc=root.querySelector('.pt-scroll');if(oldSc){SCROLL_L=oldSc.scrollLeft;SCROLL_T=oldSc.scrollTop}
 const tt=Math.max(1,total()),st=starts(),vw=Math.max(300,(root.clientWidth||900)-160-24);
 if(FIT||!PPS)PPS=Math.max(3,Math.min(160,vw/tt));
 const widthPx=Math.max(tt*PPS+60,vw);
 EVS=audioEvents();
 const sel0=findClip(SELID);if(!sel0)SELID=null;

 /* toolbar */
 const B=(icon,label,fn,cls='',title='',kbd='')=>{const b=h('button',{type:'button',className:'pt-btn '+cls,title,onclick:fn});b.innerHTML=ic(icon)+(label?`<span>${label}</span>`:'')+(kbd?`<kbd>${kbd}</kbd>`:'');return b};
 const zoom=h('input',{type:'range',className:'pt-zoom',min:0,max:100,value:Math.round(Math.log(PPS/2)/Math.log(200)*100),title:'ซูมไทม์ไลน์ (Ctrl + ล้อเมาส์)','aria-label':'ซูมไทม์ไลน์',oninput:ev=>{setZoom(2*Math.pow(200,ev.target.value/100),T)}});
 const split=B('scissors','ตัด',()=>SELID?splitClip(SELID):toast('เลือกคลิปเสียงก่อน'),'','ตัดคลิปที่เลือกตรงหัวเข็ม','S');
 const del=B('trash','ลบ',()=>SELID&&deleteClip(SELID),'','ลบคลิปที่เลือก','Del');del.disabled=!SELID;
 const bar=h('div',{className:'pt-bar',role:'toolbar','aria-label':'เครื่องมือไทม์ไลน์'},
  h('div',{className:'grp'},split,del),h('span',{className:'sep'}),
  h('div',{className:'grp'},B('mic','พากย์',()=>pickFile('voice'),'add-voice','เพิ่มไฟล์เสียงพากย์ที่หัวเข็ม'),B('bell','เอฟเฟกต์',()=>pickFile('sfx'),'add-sfx','เพิ่มเสียงเอฟเฟกต์'),B('music','เพลง',()=>pickFile('music'),'add-music','เพิ่มเพลงประกอบ'),B('library','คลังเสียง',()=>openPresetLibrary(),'pro-wide','คลังเสียงสำเร็จรูป'),B('wand','Auto Dubbing',()=>openVoiceStudio(),'pro-wide','สร้างเสียงพากย์ด้วย AI / ออกแบบเสียง')),
  h('span',{className:'grow'}),
  B('magnet','Snap',()=>{SNAP=!SNAP;build()},SNAP?'on':'','ดูดเข้าขอบคลิป/ฉาก/หัวเข็ม'),h('span',{className:'sep'}),
  B('zout','',()=>setZoom(PPS/1.5,T),'','ซูมออก (-)'),zoom,B('zin','',()=>setZoom(PPS*1.5,T),'','ซูมเข้า (+)'),B('fit','พอดี',fitZoom,FIT?'on':'','ย่อให้เห็นทั้งตอน'),
  B('sliders','Sound Desk',()=>{AUDIO_DESK_SCENE=sceneAt(T);openAudioDesk()},'','เปิดตัวแก้ไขเสียงแบบละเอียด'));

 /* clip properties */
 const props=buildProps();

 /* ruler */
 const major=[.1,.2,.5,1,2,5,10,15,30,60,120,300,600].find(s=>s*PPS>=80)||600,minorN=major>=1?(major%5===0?5:4):5;
 const ruler=h('div',{className:'pt-lane ruler-lane',style:`width:${widthPx}px;--grid:${major*PPS}px`});
 for(let t=0;t<=widthPx/PPS+major;t+=major/minorN){const idx=Math.round(t/(major/minorN)),isMaj=idx%minorN===0,x=t*PPS;if(x>widthPx)break;
  const k=h('i',{className:'pt-tick'+(isMaj?' maj':''),style:`left:${x}px`});if(isMaj)k.append(h('span',{},major<1?t.toFixed(1)+'s':mmss(t).replace(/^00:/,'0:').replace(/\.00$/,'')));ruler.append(k)}
 const rulerRow=h('div',{className:'pt-row ruler'},h('div',{className:'pt-head'},'TIMELINE'),ruler);

 /* scene lane */
 const sceneLane=h('div',{className:'pt-lane',style:`width:${widthPx}px;--grid:${major*PPS}px`});
 e.scenes.forEach((s,i)=>{const w=Math.max(8,s.duration*PPS-2),blk=h('div',{className:'pt-scene'+(i===sel?' sel':''),draggable:true,'data-i':i,title:`ฉาก ${i+1} · ${s.duration}s — คลิกเพื่อเลือก · ลากเพื่อสลับลำดับ`,style:`left:${st[i]*PPS+1}px;width:${w}px`,
   onclick:ev=>{ev.stopPropagation();sel=i;T=st[i];playing=false;render()},
   ondragstart:ev=>ev.dataTransfer.setData('text/plain',i),ondragover:ev=>{ev.preventDefault();blk.classList.add('over')},ondragleave:()=>blk.classList.remove('over'),
   ondrop:ev=>{ev.preventDefault();const f=+ev.dataTransfer.getData('text/plain');if(f!==i)commit(()=>{const[m]=e.scenes.splice(f,1);e.scenes.splice(i,0,m);sel=i})}},
   h('b',{},String(i+1)),`${s.duration}s`,h('span',{className:'sub'},(s.subtitle&&s.subtitle[0])||''));
  if(w>150&&(s.actors||[]).length){try{blk.append(poseThumbs(s,i,st))}catch(err){}}
  if(e.clues.some(c=>c.sceneId===s.id))blk.append(h('span',{className:'dot',title:'จุดใบ้'}));sceneLane.append(blk)});
 const videoRow=h('div',{className:'pt-row video',style:'--c:var(--t-video)'},h('div',{className:'pt-head'},h('i',{className:'trk'}),h('span',{className:'nm'},'V1 · ฉาก')),sceneLane);

 /* audio lanes */
 const rows=[];
 for(const kind of ['voice','sfx','music']){
  const items=EVS.filter(v=>laneOf(v.c)===kind),clips=allClips().filter(x=>laneOf(x.c)===kind),allMuted=clips.length>0&&clips.every(x=>x.c.mute);
  const lane=h('div',{className:'pt-lane',style:`width:${widthPx}px;--grid:${major*PPS}px`,'data-kind':kind});
  
  const mb=h('button',{type:'button',className:allMuted?'on':'',title:allMuted?'เปิดเสียงทั้งแทร็ก':'ปิดเสียงทั้งแทร็ก (บันทึกลงคลิป)','aria-label':'ปิดเสียงแทร็ก '+KIND_NAME[kind],onclick:()=>muteTrack(kind)},'M');
  const ab=h('button',{type:'button',title:'เพิ่มไฟล์ลงแทร็กนี้','aria-label':'เพิ่มคลิปลงแทร็ก '+KIND_NAME[kind],onclick:()=>pickFile(kind)});ab.innerHTML=ic(kind==='voice'?'mic':kind==='sfx'?'bell':'music');
  const A=kind==='voice'?'A1':kind==='sfx'?'A2':'A3';
  const row=h('div',{className:'pt-row audio'+(allMuted?' muted':''),style:`--c:${KIND_COLOR[kind]}`},h('div',{className:'pt-head'},h('i',{className:'trk','data-led':kind}),h('span',{className:'nm'},`${A} · ${KIND_NAME[kind]}`),mb,ab),lane);
  if(!clips.length)lane.append(h('div',{className:'pt-empty'},kind==='voice'?'ลากไฟล์เสียง หรือกด 🎙 เพื่อเพิ่มพากย์ที่หัวเข็ม':kind==='sfx'?'ยังไม่มีเสียงเอฟเฟกต์':'ยังไม่มีเพลงประกอบ'));
  for(const ev of items){if(ev.cycle>60)continue;lane.append(clipEl(ev))}
  rows.push(row);
 }
 PLAY=h('div',{className:'pt-playhead'});SNAPLINE=h('div',{className:'pt-snap'});
 const inner=h('div',{className:'pt-inner',style:`width:${160+widthPx}px`},rulerRow,videoRow,...rows,SNAPLINE,PLAY);
 const scroll=h('div',{className:'pt-scroll',onscroll:ev=>{SCROLL_L=ev.target.scrollLeft;SCROLL_T=ev.target.scrollTop}},inner);
 LANE0=sceneLane;
 /* seeking */
 const seek=ev=>{const r=LANE0.getBoundingClientRect();T=Math.max(0,Math.min(total(),(ev.clientX-r.left)/PPS));draw()};
 const startSeek=ev=>{if(ev.button!==0)return;seek(ev);const mv=m=>seek(m),up=()=>{removeEventListener('pointermove',mv);removeEventListener('pointerup',up)};addEventListener('pointermove',mv);addEventListener('pointerup',up)};
 ruler.addEventListener('pointerdown',startSeek);
 rows.forEach(r=>r.querySelector('.pt-lane').addEventListener('pointerdown',ev=>{if(ev.target.closest('.pt-clip'))return;if(SELID){SELID=null;refreshSel()}startSeek(ev)}));
 scroll.addEventListener('wheel',ev=>{if(!(ev.ctrlKey||ev.metaKey||ev.altKey))return;ev.preventDefault();const r=LANE0.getBoundingClientRect(),t=(ev.clientX-r.left)/PPS;setZoom(PPS*(ev.deltaY<0?1.18:1/1.18),t)},{passive:false});

 root.replaceChildren(bar,props,scroll,motionKeyLane());
 root.querySelector('.motion-lane')?.classList.add('pt-motion');
 scroll.scrollLeft=SCROLL_L;scroll.scrollTop=SCROLL_T;
 LASTT=-1;LASTSEL=-1;tickOnce();
}

function clipEl(ev){
 const c=ev.c,kind=laneOf(c),len=Math.max(.05,Math.min(safeClipDuration(c),ev.limit-ev.start)),x=ev.start*PPS,w=Math.max(6,len*PPS),isCyc=ev.cycle>0;
 const el=h('div',{className:'pt-clip'+(SELID===c.id?' sel':'')+(c.mute?' muted':'')+(c.loop?' loop':'')+(isCyc?' cyc':''),'data-id':c.id,style:`left:${x}px;width:${w}px;--c:${KIND_COLOR[kind]}`,title:`${c.name||'คลิป'} · ${len.toFixed(2)}s · ลากเพื่อย้าย ขอบซ้าย/ขวาเพื่อตัด`});
 el.innerHTML=waveSVG(c,w);
 if(c.fadeIn>0)el.append(h('i',{className:'fade i',style:`width:${Math.min(w,c.fadeIn/len*w)}px`}));
 if(c.fadeOut>0)el.append(h('i',{className:'fade o',style:`width:${Math.min(w,c.fadeOut/len*w)}px`}));
 el.append(h('span',{className:'lb'},(c.mute?'🔇 ':'')+(c.loop?'↻ ':'')+(c.name||KIND_NAME[kind])));
 el.append(h('i',{className:'vol',style:`top:${(1-clampN(cleanNum(c.volume,1),0,1))*100}%`,title:'ระดับความดัง'}));
 if(!isCyc&&!c.loop){el.append(h('i',{className:'hd l'}),h('i',{className:'hd r'}))}
 if(!isCyc)el.addEventListener('pointerdown',pe=>onClipDown(pe,el,ev));
 return el;
}

function onClipDown(pe,el,ev){
 if(pe.button!==0)return;pe.stopPropagation();
 const c=ev.c,mode=pe.target.classList.contains('hd')?(pe.target.classList.contains('l')?'l':'r'):'move';
 if(SELID!==c.id){SELID=c.id;refreshSel()}
 const x=findClip(c.id);if(!x)return;
 const S0={mode,x0:pe.clientX,moved:false,at:cleanNum(c.at),ts:cleanNum(c.trimStart),te:cleanNum(c.trimEnd),rate:effectiveClipRate(c),len:safeClipDuration(c),start:ev.start,pts:snapPoints(c.id),newStart:ev.start,applied:0,newTS:cleanNum(c.trimStart),newTE:cleanNum(c.trimEnd)};
 if(c.loop&&mode==='move'){return}
 el.setPointerCapture(pe.pointerId);
 const move=m=>{
  const dx=m.clientX-S0.x0;if(!S0.moved&&Math.abs(dx)<4)return;S0.moved=true;el.classList.add('dragging');const dt=dx/PPS;
  if(mode==='move'){let t=S0.start+dt;const a=snapTime(t,S0.pts),b=snapTime(t+S0.len,S0.pts);let hit=a.hit;
   if(a.hit!==null)t=a.t;else if(b.hit!==null){t=b.t-S0.len;hit=b.hit}else t=r1(t);
   t=Math.max(0,t);S0.newStart=t;el.style.left=t*PPS+'px';showSnap(hit)}
  else if(mode==='l'){const maxTS=cleanNum(c.duration)-S0.te-.05;let ts=Math.max(0,Math.min(maxTS,S0.ts+dt*S0.rate));ts=Math.round(ts*100)/100;S0.newTS=ts;S0.applied=(ts-S0.ts)/S0.rate;el.style.left=(S0.start+S0.applied)*PPS+'px';el.style.width=Math.max(6,(S0.len-S0.applied)*PPS)+'px'}
  else{const maxTE=cleanNum(c.duration)-S0.ts-.05;let te=Math.max(0,Math.min(maxTE,S0.te-dt*S0.rate));te=Math.round(te*100)/100;S0.newTE=te;const nl=(cleanNum(c.duration)-S0.ts-te)/S0.rate;el.style.width=Math.max(6,nl*PPS)+'px'}
 };
 const up=()=>{el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',up);el.removeEventListener('pointercancel',up);showSnap(null);el.classList.remove('dragging');
  if(!S0.moved){return}
  if(mode==='move'){const delta=S0.newStart-S0.start;if(Math.abs(delta)<.001)return;
   const lead=Math.max(0,cleanNum(c.audioLead));
   commit(()=>{
    if(x.scope==='music'){c.at=Math.max(0,r1(S0.at+delta));adjustAudioClip(c)}
    else{const e=E(),raw=S0.start+lead+delta,st=starts(),tt=total();let j=0;for(let k=0;k<st.length;k++)if(st[k]<=Math.min(Math.max(0,raw),tt-.01)+1e-6)j=k;
     const sj=e.scenes[j],pre=prerollSpan(e,j,sj);c.at=Math.max(0,r1(raw-st[j]-pre));
     if(j!==x.scene){x.arr.splice(x.arr.indexOf(c),1);(sj.audioClips=sj.audioClips||[]).push(c)}adjustAudioClip(c)}
   });
  }else if(mode==='l'){commit(()=>{c.trimStart=S0.newTS;c.at=Math.max(0,r1(S0.at+S0.applied));adjustAudioClip(c)})}
  else{commit(()=>{c.trimEnd=S0.newTE;adjustAudioClip(c)})}
 };
 el.addEventListener('pointermove',move);el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up);
}

function refreshSel(){
 if(!ROOT)return;
 ROOT.querySelectorAll('.pt-clip').forEach(el=>el.classList.toggle('sel',el.dataset.id===SELID));
 const old=ROOT.querySelector('.pt-props');const nw=buildProps();if(old)old.replaceWith(nw);
 const d=ROOT.querySelector('.pt-btn[title^="ลบ"]');if(d)d.disabled=!SELID;
}

function buildProps(){
 const x=findClip(SELID);
 if(!x)return h('div',{className:'pt-props empty'},'เลือกคลิปเสียงบนแทร็กเพื่อปรับความดัง เฟด ความเร็ว · ลากคลิปเพื่อย้าย · ลากขอบเพื่อตัดหัว/ท้าย · กด Space เพื่อเล่น');
 const c=x.c,ev=EVS.find(v=>v.c.id===c.id&&v.cycle===0),kind=laneOf(c),len=safeClipDuration(c);
 const num=(label,key,min,max,step,unit='')=>h('label',{className:'fld'},label,h('input',{type:'number',min,max,step,value:r1(cleanNum(c[key],key==='rate'?1:0)),onchange:e=>{const v=clampN(cleanNum(e.target.value),min,max);setTimeout(()=>setProp(c,key,v),0)}}),unit);
 const val=h('span',{className:'val'},Math.round(cleanNum(c.volume,1)*100)+'%');
 const vol=h('input',{type:'range',min:0,max:100,value:Math.round(cleanNum(c.volume,1)*100),'aria-label':'ความดัง',
  oninput:e=>{c.volume=e.target.value/100;val.textContent=e.target.value+'%';const v=ROOT.querySelector(`.pt-clip[data-id="${c.id}"] .vol`);if(v)v.style.top=(1-c.volume)*100+'%'},
  onchange:e=>{const nv=e.target.value/100;c.volume=cleanNum(c.__v0,nv);commit(()=>{c.volume=nv})},onpointerdown:()=>{c.__v0=c.volume}});
 const B=(icon,label,fn,cls='',title='',dis=false)=>{const b=h('button',{type:'button',className:'pt-btn '+cls,title,onclick:fn,disabled:dis});b.innerHTML=ic(icon)+(label?`<span>${label}</span>`:'');return b};
 return h('div',{className:'pt-props'},
  (()=>{const s=h('span',{className:'chip',style:`--c:${KIND_COLOR[kind]}`});s.innerHTML=`<i></i>${KIND_NAME[kind]} · `;s.append(document.createTextNode(c.name||'คลิป'));return s})(),
  h('span',{className:'sp'}),h('label',{className:'fld'},'ความดัง',vol,val),
  num('เฟดเข้า','fadeIn',0,60,.1,'s'),num('เฟดออก','fadeOut',0,60,.1,'s'),num('ความเร็ว','rate',.25,3,.05,'×'),
  h('span',{className:'sp'}),h('span',{className:'ro',title:'เริ่ม → ความยาว'},ev?`${mmss(ev.start)} → ${len.toFixed(2)}s`:`${len.toFixed(2)}s`),
  h('span',{className:'sp'}),
  B('play2','ฟัง',()=>{if(ev){T=Math.max(0,ev.start-.05);if(!playing){playing=true;last=performance.now();ctl()}draw()}},'','เล่นจากคลิปนี้'),
  B(c.mute?'mute':'vol','',()=>muteClip(c.id),c.mute?'on':'',c.mute?'เปิดเสียงคลิป (M)':'ปิดเสียงคลิป (M)'),
  B('loop','',()=>loopClip(c.id),c.loop?'on':'',c.loop?'วนซ้ำ: เปิด':'วนซ้ำ: ปิด'),
  B('scissors','ตัด',()=>splitClip(c.id),'','ตัดตรงหัวเข็ม (S)'),
  B('trash','',()=>deleteClip(c.id),'','ลบคลิป (Del)'),
  B('sliders','ขั้นสูง',()=>{AUDIO_DESK_SCENE=x.scene>=0?x.scene:sceneAt(T);AUDIO_DESK_TAB=x.scope;openAudioDesk()},'','โปรไฟล์เสียง · J/L-cut · ส่งออกคลิป'));
}

/* ---------- live updates (playhead, LEDs, timecode) ---------- */
function tickOnce(){
 if(!ROOT||!PLAY)return;
 if(T!==LASTT||PPS!==LASTPPS){
  PLAY.style.left=(160+T*PPS)+'px';
  const sc=ROOT.querySelector('.pt-scroll');
  if(sc&&playing){const x=T*PPS,view=sc.clientWidth-160;if(x>sc.scrollLeft+view-50||x<sc.scrollLeft)sc.scrollLeft=Math.max(0,x-60)}
  LASTT=T;LASTPPS=PPS;
  for(const kind of ['voice','sfx','music']){let on=false;for(const ev of EVS){if(laneOf(ev.c)!==kind||ev.c.mute)continue;const len=Math.min(safeClipDuration(ev.c),ev.limit-ev.start);if(T>=ev.start&&T<ev.start+len){on=true;break}}
   const led=ROOT.querySelector(`[data-led="${kind}"]`);if(led)led.classList.toggle('on',on&&playing)}
  }
 const ck=document.getElementById('clock');if(ck){const str=mmss(T)+'  /  '+mmss(total());if(ck.textContent!==str)ck.textContent=str}
 if(sel!==LASTSEL){LASTSEL=sel;ROOT.querySelectorAll('.pt-scene').forEach(b=>b.classList.toggle('sel',+b.dataset.i===sel))}
}
function tick(){requestAnimationFrame(tick);try{tickOnce()}catch(e){}}

/* ---------- wrappers ---------- */
const origTimeline=window.timeline;
window.timeline=function(){try{build()}catch(err){console.error('pro timeline failed, fallback',err);origTimeline()}};
const origCtl=window.ctl;
window.ctl=function(){origCtl();skinCtl()};
function skinCtl(){
 const c=document.getElementById('ctl');if(!c)return;
 const btns=[...c.querySelectorAll(':scope>button')];
 const put=(b,html,cls)=>{if(!b)return;b.innerHTML=html;if(cls)b.classList.add(cls)};
 put(btns[0],ic('prev'));put(btns[1],ic(playing?'pause':'play'));put(btns[2],ic('next'));
 put(btns[3],ic('vol')+'<span>ตรวจเสียง</span>','ctl-t');put(btns[4],ic('speak')+'<span>อ่านบท</span>','ctl-t');
 btns[0]&&(btns[0].title='ฉากก่อนหน้า');btns[2]&&(btns[2].title='ฉากถัดไป');btns[1]&&(btns[1].title='เล่น / หยุด (Space)');
 const ck=document.getElementById('clock');if(ck)ck.textContent=mmss(T)+'  /  '+mmss(total());
}
const origTop=window.renderTop;
window.renderTop=function(){origTop();skinTop()};
function skinTop(){
 const t=document.getElementById('top');if(!t)return;
 const u=t.querySelector('.undo-btn'),r=t.querySelector('.redo-btn'),m=t.querySelector('.menu-toggle');
 if(u){u.innerHTML=ic('undo');u.title='ย้อนกลับ (Ctrl+Z)'}if(r){r.innerHTML=ic('redo');r.title='ทำซ้ำ (Ctrl+Y)'}
 if(m){m.innerHTML=ic('menu')+'<span>เมนู</span>'}
 if(!t.querySelector('.top-spacer')&&u){
  const sp=h('span',{className:'top-spacer'}),sep=h('span',{className:'sep'}),ex=h('button',{type:'button',className:'export-btn',title:'ส่งออกวิดีโอทั้งตอน',onclick:()=>openVideoExport()});ex.innerHTML=ic('up')+'<span>ส่งออก</span>';
  t.insertBefore(sp,u);m.before(sep,ex);
 }
}
const NAV_LABEL={scene:['ฉาก','film'],ai:['AI','chat'],characters:['ตัวละคร','user'],library:['ไลบรารี','grid'],record:['พากย์','mic'],audio:['เสียง','wave'],voices:['โทนเสียง','sliders'],smart:['ตรวจงาน','check'],export:['ส่งออก','up']};
function decorateNav(){
 const nav=document.getElementById('studioToolNav');if(!nav)return;
 nav.querySelectorAll('button[data-tool]').forEach(b=>{if(b.dataset.pro)return;const d=NAV_LABEL[b.dataset.tool];if(!d)return;b.title=b.textContent.trim();b.innerHTML=ic(d[1])+'<span>'+d[0]+'</span>';b.dataset.pro='1'});
}
/* ---------- keyboard ---------- */
addEventListener('keydown',e=>{
 const t=e.target;if(t&&(/INPUT|TEXTAREA|SELECT/.test(t.tagName)||t.isContentEditable))return;
 if(e.ctrlKey||e.metaKey||e.altKey)return;
 if(document.querySelector('dialog[open]:not(#audioDesk):not(#voiceStudio):not(#smartDialog):not(#videoDialog)'))return;
 const k=e.key;
 if(k==='s'||k==='S'){if(SELID){e.preventDefault();splitClip(SELID)}}
 else if(k==='Delete'||k==='Backspace'){if(SELID){e.preventDefault();deleteClip(SELID)}}
 else if(k==='m'||k==='M'){if(SELID){e.preventDefault();muteClip(SELID)}}
 else if(k==='='||k==='+'){e.preventDefault();setZoom(PPS*1.4,T)}
 else if(k==='-'||k==='_'){e.preventDefault();setZoom(PPS/1.4,T)}
 else if(k==='0'){e.preventDefault();fitZoom()}
 else if(k==='Home'){e.preventDefault();T=0;draw()}
 else if(k==='End'){e.preventDefault();T=Math.max(0,total()-.01);draw()}
 else if(k===','||k==='.'){e.preventDefault();const d=e.shiftKey?1:.1;T=Math.max(0,Math.min(total(),T+(k==='.'?d:-d)));draw()}
 else if(k==='Escape'){if(SELID){SELID=null;refreshSel()}}
},true);
let rz=0;addEventListener('resize',()=>{if(!FIT)return;clearTimeout(rz);rz=setTimeout(()=>{try{build()}catch(e){}},120)});

/* ---------- boot ---------- */
decorateNav();const nav=document.getElementById('studioToolNav');if(nav)new MutationObserver(decorateNav).observe(nav,{childList:true});
skinTop();skinCtl();build();requestAnimationFrame(tick);
window.StudioPro={build,select:id=>{SELID=id;build()},ic};
})();
