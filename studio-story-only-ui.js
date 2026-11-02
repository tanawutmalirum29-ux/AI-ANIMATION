/* Narrative-only workspace — import, edit, export and teach without image fields.
 * The attached Studio Bridge keeps undo/redo. No image renderer or API required
 * to produce text. Teacher API is optional only when the user asks it to teach.
 */
(function(root){
'use strict';
let bridge=null,host=null,chosenId='',notice='',error=false,jsonText='';
const d=root.document,lib=()=>root.StoryOnlyJSON;
function node(tag,attrs={},...parts){
 const n=d.createElement(tag);
 for(const [key,value] of Object.entries(attrs)){
  if(value==null)continue;
  if(key==='className')n.className=value;
  else if(key==='onclick')n.addEventListener('click',value);
  else if(key==='oninput')n.addEventListener('input',value);
  else if(key==='onchange')n.addEventListener('change',value);
  else if(key==='value')n.value=value;
  else if(key==='type')n.type=value;
  else if(key==='rows')n.rows=value;
  else if(key==='accept')n.accept=value;
  else n.setAttribute(key,String(value));
 }
 for(const p of parts)if(p!=null)n.append(p.nodeType?p:d.createTextNode(String(p)));
 return n;
}
function button(label,click){return node('button',{type:'button',onclick:click},label)}
function say(message,bad=false){notice=message;error=bad;const region=host?.querySelector('.story-only-notice');if(region){
 region.textContent=notice;region.dataset.error=String(error)}}
function current(){return bridge?.get?.()}
function list(){
 return (current()?.episodes||[]).flatMap(ep=>(ep.scenes||[])
 .filter(s=>typeof s.voiceover==='string'&&s.voiceover.trim())
 .map(s=>({...s,episodeTitle:ep.title,episodeId:ep.id})));
}
function update(){if(host)render(host,bridge)}
function loadValue(raw){
 try{
  const parsed=JSON.parse(String(raw||'').replace(/^\uFEFF/,''));
  if(!lib()?.appearsTextOnly(parsed)){
   say('ไฟล์นี้เป็นโปรเจกต์อนิเมชันหรือ JSON แบบอื่น ให้ใช้เมนูนำเข้าโปรเจกต์ตามปกติ',true);
   return false;
  }
  const adapted=lib().convert(parsed);
  bridge.loadStoryOnly(adapted);
  chosenId=adapted.episodes[0]?.scenes[0]?.id||'';
  jsonText='';
  notice='นำเข้าเรื่องสำเร็จ · '+lib().stats(adapted).scenes+
   ' ฉาก · ไม่สร้างภาพ กล้อง หรือการเคลื่อนไหว';
  error=false;
  update();
  return true;
 }catch(e){say('นำเข้าเรื่องไม่สำเร็จ: '+e.message,true);return false}
}
async function fileChange(ev){
 const f=ev?.target?.files?.[0];
 if(!f)return;
 if(f.size>500000){say('ไฟล์ JSON ใหญ่เกิน 500 KB',true);return}
 loadValue(await f.text());
}
function download(name,content){
 const blob=new Blob([JSON.stringify(content,null,2)],{type:'application/json;charset=utf-8'});
 const url=URL.createObjectURL(blob),a=node('a',{href:url,download:name});
 d.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);
}
function exportOnly(){
 try{download('story-only-'+Date.now()+'.json',lib().exportTextOnly(current()));
  say('ส่งออก JSON เนื้อเรื่องล้วนแล้ว (ไม่รวมภาพ วิดีโอ ตัวละคร Rig หรือข้อมูลแสง)')}
 catch(e){say(e.message,true)}
}
function saveScene(){
 const id=chosenId,editor=host?.querySelector('#storyOnlyVoiceover');
 if(!editor)return;
 try{
  bridge.updateStoryOnlyScene(id,editor.value);
  say('บันทึกบทฉาก '+id+' แล้ว · ใช้ Undo เพื่อย้อนกลับได้');
  update();
 }catch(e){say(e.message,true)}
}
function getSelected(){
 const arr=list();
 return arr.find(s=>s.id===chosenId)||arr[0]||null;
}
function train(action){
 const teaching=root.StoryAutoTeach;
 if(!teaching){say('ยังไม่พบระบบ AI สอนลูก',true);return}
 teaching.configure?.(bridge);
 const run=action==='scan'?teaching.scan:teaching.teach;
 if(typeof run!=='function'){say('โมดูลสอนยังไม่พร้อม',true);return}
 say(action==='scan'?'AI ลูกกำลังตรวจเนื้อเรื่อง...':
  'AI แม่กำลังประเมินและบันทึกบทเรียนบน AWS... ตรวจสถานะต่อได้ในแท็บ AI ครู / API');
 run().then(result=>{
  say(action==='scan'?('AI ลูกตรวจ '+result.scenes+' ฉาก · ข้าม '+result.skipped+' ฉาก'):
    'AWS ยืนยันบทเรียน '+result.completed+'/'+result.scenes+' ฉาก'+
     (result.error?' · '+result.error:''));
  update();
 }).catch(e=>{say('การสอนยังไม่สำเร็จ: '+e.message,true)});
}
function render(area,source){
 host=area;bridge=source;
 const state=current(),isStory=state?.project?.mode==='story-only';
 const rootEl=node('section',{className:'story-only-workspace'},
  node('h3',{},'เนื้อเรื่องล้วน · Story Writing'),
  node('p',{className:'ai-help'},'นำเข้า JSON บท/ตอน/ฉากโดยไม่ต้องสร้างภาพ ตัวละคร Rig, imagePrompt หรือคำสั่งวิดีโอ บทพากย์เป็นแหล่งข้อมูลหลักสำหรับ AI ลูก'),
  node('div',{className:'story-only-import'},
   node('label',{},'ไฟล์ JSON เนื้อเรื่องล้วน',
    node('input',{id:'storyOnlyFile',type:'file',accept:'.json,application/json',onchange:fileChange})),
   node('label',{},'หรือวาง JSON เนื้อเรื่องล้วน',
    node('textarea',{id:'storyOnlyPaste',rows:4,oninput:ev=>{jsonText=ev.target.value},
     value:jsonText,placeholder:'{"type":"story-only","title":"เรื่องใหม่","chapters":[{"title":"บทที่ 1","text":"ข้อความเรื่อง..."}]}'})),
   node('div',{className:'story-only-actions'},
    button('นำเข้าข้อความ JSON',()=>loadValue(jsonText)),
    button('ดาวน์โหลดตัวอย่าง JSON',()=>download('story-only-example.json',{
      type:'story-only',title:'วันฝนตก',chapters:[{title:'ตอนแรก',
       text:'ฝนตกหนักเหนือหมู่บ้านริมคลอง\n\nชาวบ้านรีบเก็บของขึ้นที่สูงเมื่อระดับน้ำเริ่มเพิ่ม'}]
    })))),
  node('p',{className:'story-only-notice','data-error':String(error),role:'status'},
   notice||(isStory?'กำลังทำงานในโหมดเนื้อเรื่องล้วน':'ยังไม่ได้เปิดโปรเจกต์เนื้อเรื่องล้วน')));
 if(isStory){
  const scenes=list(),first=getSelected(),stats=lib().stats(state);
  rootEl.append(node('div',{className:'story-only-actions'},
   node('strong',{},String(state.project?.title||'ไม่มีชื่อเรื่อง')),
   node('span',{},stats.episodes+' ตอน · '+stats.scenes+' ฉาก · '+stats.characters+' ตัวอักษร'),
   button('ส่งออก JSON เฉพาะเนื้อเรื่อง',exportOnly)));
  if(first){
   const selection=node('select',{id:'storyOnlySelect',onchange:ev=>{chosenId=ev.target.value;update()}},
    ...scenes.map(s=>node('option',{value:s.id,...(s.id===first.id?{selected:'selected'}:{})},
     s.episodeTitle+' · '+s.id)));
   const box=node('textarea',{id:'storyOnlyVoiceover',rows:9,value:first.voiceover});
   rootEl.append(node('label',{},'เลือกฉากเพื่อเขียนหรือแก้ไขบท',selection),
    node('label',{},'เนื้อเรื่อง/บทพากย์ของฉาก',box),
    node('div',{className:'story-only-actions'},
     button('บันทึกบทฉาก',saveScene),
     button('AI ลูกตรวจทั้ง JSON',()=>train('scan')),
     button('AI แม่สอนและบันทึก AWS',()=>train('teach'))),
    node('p',{className:'ai-help'},
     'กด AI ลูกตรวจก่อนได้โดยไม่ใช้ API · การเรียก AI แม่ต้องเชื่อม API และ AWS Studio · บทเรียนที่สอนอัตโนมัติยังไม่ได้รับรองโดยผู้ใช้'));
  }
 }else{
  rootEl.append(node('p',{className:'ai-help'},
   'ขณะนี้เป็นโปรเจกต์อนิเมชันเดิม จะไม่แปลงให้เป็นเนื้อเรื่องล้วนเอง หากต้องการ ให้เปิดไฟล์ JSON บทล้วนในส่วนด้านบน'));
 }
 area.replaceChildren(rootEl);
}
root.StoryOnlyWorkspace=Object.freeze({render});
})(window);
