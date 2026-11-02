(function(root,factory){
'use strict';
const api=factory();
if(typeof module==='object'&&module.exports)module.exports=api;
if(root)root.StoryScriptML=api;
})(typeof globalThis!=='undefined'?globalThis:null,function(){
'use strict';
// SGD v2: assistant-authored data only; user examples held out for regression, not added as labels.
const NAMES=Object.freeze(['duplicateConnector','duplicatePause','repeatPunctuation','filler','nearConnector','length','veryLong','stutter']);
const MODEL=Object.freeze({schema:1,task:'thai-narration-review',status:'experimental-assistant-demo',data:'assistant-authored-only',features:[...NAMES],weights:[5.611543,2.484846,7.577056,2.484846,0.891972,0.592996,0,3.376818],bias:-4.031453,trainedGroups:44,holdoutGroups:11,holdoutAccuracy:1});
const clamp=(n,a=0,b=1)=>Math.min(b,Math.max(a,n));
function features(value){
 const t=String(value||'').slice(0,1200),count=re=>[...t.matchAll(re)].length;
 return [
  clamp(count(/(?:แล้วก็\s*){2,}|(?:จากนั้น\s*){2,}|(?:ในตอนนั้น\s*){2,}|(?:เพราะว่า\s*){2,}/gu)),
  clamp(count(/(?:เอ่อ\s*){2,}|(?:คือว่า\s*){2,}|(?:แบบว่า\s*){2,}/gu)),
  clamp(count(/([!?])\1+|[.]{4,}/gu)),
  clamp(count(/เอ่อ|คือว่า|แบบว่า/gu)/2),
  clamp(count(/แล้วก็.{0,22}แล้วก็|จากนั้น.{0,20}จากนั้น|เพราะว่า.{0,20}เพราะว่า/gu)),
  clamp([...t].length/150),
  clamp(Math.max(0,[...t].length-125)/130),
  clamp(count(/(.{2,8})\s+\1/gu))
 ];
}
function probability(value,model=MODEL){
 if(!model||model.task!=='thai-narration-review'||model.features.join('|')!==NAMES.join('|')||model.weights.length!==NAMES.length)return null;
 const v=features(value),z=model.weights.reduce((sum,w,i)=>sum+w*v[i],model.bias);
 return 1/(1+Math.exp(-Math.max(-30,Math.min(30,z))));
}
// Every proposed edit is a conservative rule. The SGD MODEL predicts risk only.
// Do not claim that model weights generate new words or understand story meaning.
// Three-way CPU-trained intent model. The weights were fitted to 200 assistant-authored
// demonstration examples (40 story groups), NOT human-approved real-world data.
// It predicts edit suitability, but NEVER writes text: propose() stays rule-limited.
const INTENT_LABELS=Object.freeze(['remove','keep','review']);
const INTENT_NAMES=Object.freeze(['duplicateConnector','repeatPunctuation','repeatFiller','ellipsis','quotes','dialogue','narration','unknownMode','emotion','uncertainEmotion','tenseSituation','emphasisWords']);
const INTENT_MODEL=Object.freeze({schema:1,task:'thai-repetition-intent',status:'synthetic-demo-not-approved',
 features:[...INTENT_NAMES],labels:[...INTENT_LABELS],
 weights:[[0.456032,0.384369,0.3835,-0.396176,-0.805042,-0.805042,2.656392,-1.418734,-0.805042,-1.418734,-0.805042,-0.395109],
 [-0.404409,-0.180629,-0.180098,-0.304172,1.318056,1.318056,-1.077522,-0.58181,1.318056,-0.58181,1.318056,0.728032],
 [-0.051623,-0.20374,-0.203402,0.700348,-0.513014,-0.513014,-1.57887,2.000544,-0.513014,2.000544,-0.513014,-0.332923]],
 bias:[1.221252,-0.961776,-0.259476],trainRows:160,heldOutRows:40,assistantDemoAccuracy:1});
function sceneContext(scene){
 const voice=scene?.voiceDirection||{};
 return {
  mode:String(scene?.scriptMode||scene?.narrativeMode||voice.mode||'narration'),
  emotion:String(scene?.emotion||scene?.voiceEmotion||voice.emotion||''),
  situation:String(scene?.situation||scene?.eventKind||scene?.event?.kind||''),
  subtitle:Array.isArray(scene?.subtitle)?scene.subtitle:[]
 };
}
function intentFeatures(value,context={}){
 const text=String(value||'');
 const mode=String(context.mode||'narration').toLowerCase(),
  emotion=String(context.emotion||'').toLowerCase(),
  situation=String(context.situation||'').toLowerCase();
 return [
  /(?:แล้วก็\s*){2,}|(?:จากนั้น\s*){2,}|(?:เพราะว่า\s*){2,}|(?:ในตอนนั้น\s*){2,}/u.test(text)?1:0,
  /[!?]{2,}|[.]{4,}/u.test(text)?1:0,
  /(?:เอ่อ\s*){2,}|(?:คือว่า\s*){2,}|(?:แบบว่า\s*){2,}/u.test(text)?1:0,
  /…|\.{3}|มะ\.\.\.|มะ…/u.test(text)?1:0,
  /[“”"'«»]/u.test(text)?1:0,
  mode==='dialogue'?1:0,
  mode==='narration'?1:0,
  mode==='unknown'?1:0,
  /fear|anger|sad|surprise|hesitat|emphas|กลัว|ตกใจ|โกรธ|เศร้า|ลังเล|ย้ำ/u.test(emotion)?1:0,
  /uncertain|unknown|ไม่แน่ใจ/u.test(emotion)?1:0,
  /danger|confront|panic|threat|argument|กลัว|ทะเลาะ|วิกฤต/u.test(situation)?1:0,
  /มันมาแล้ว! มันมาแล้ว|ออกไป! ฉันบอกให้ออกไป|รอแล้วรอเล่า/u.test(text)?1:0
 ];
}
function intentProbability(text,context={},model=INTENT_MODEL){
 if(!model||model.task!=='thai-repetition-intent'||model.features.join('|')!==INTENT_NAMES.join('|')||
  model.weights.length!==3)return null;
 const v=intentFeatures(text,context),scores=model.weights.map((w,i)=>w.reduce((z,val,j)=>z+val*v[j],model.bias[i]));
 const max=Math.max(...scores),values=scores.map(x=>Math.exp(x-max)),sum=values.reduce((a,b)=>a+b,0);
 return values.map(x=>x/sum);
}
function classifyIntent(text,context={}){
 const probabilities=intentProbability(text,context),best=Math.max(...probabilities),
  label=INTENT_LABELS[probabilities.indexOf(best)];
 const mode=String(context.mode||'narration').toLowerCase(),
  emotion=String(context.emotion||'').toLowerCase(),
  situation=String(context.situation||'').toLowerCase();
 // Safety policy: explicit expression/quotation outranks the synthetic classifier.
 const protectedExpression=/[“”"'«»]/u.test(text)||
  mode==='dialogue'||/fear|anger|sad|surprise|hesitat|emphas|กลัว|ตกใจ|โกรธ|เศร้า|ลังเล|ย้ำ/u.test(emotion)||
  /danger|confront|panic|threat|argument|ทะเลาะ|วิกฤต/u.test(situation);
 const uncertain=mode==='unknown'||/uncertain|unknown|ไม่แน่ใจ/u.test(emotion)||
  /…|\.{3}/u.test(text);
 const indicators=intentFeatures(text,context);
 // A quoted sentence or dramatic punctuation alone is NOT evidence of repetition.
 // Word/phrase repetitions can be intentional; the classification is context-aware.
 const hasRepetition=!!(indicators[0]||indicators[1]||indicators[2]||indicators[11]||
  /([\p{Script=Thai}]{2,20})(?:\s+|[!！?？…]|\.{3})\s*\1/u.test(text));
 const emotionalNarration=mode==='narration'&&
  (/fear|anger|sad|surprise|hesitat|emphas|กลัว|ตกใจ|โกรธ|เศร้า|ลังเล|ย้ำ/u.test(emotion)||
   /danger|confront|panic|threat|argument|ทะเลาะ|วิกฤต/u.test(situation));
 let decision='review';
 if(!hasRepetition)decision='clean';
 else if(/รอแล้วรอเล่า|ทำแล้วทำเล่า/u.test(text))decision='keep'; // Conventional Thai emphasis, not a copy-paste error.
 else if(mode==='dialogue'||/[“”"'«»]/u.test(text))decision='keep';
 else if(emotionalNarration)decision='review'; // No silent removal or unjustified certainty.
 else if(protectedExpression)decision='keep';
 else if(uncertain)decision='review';
 else if(label==='remove'&&best>=.85)decision='remove';
 return {label,decision,hasRepetition,confidence:best,probabilities,
  reason:decision==='clean'?'ไม่พบรูปแบบคำซ้ำที่ต้องเสนอแก้':
   decision==='keep'?'พบคำซ้ำในบทพูดหรือการเน้นที่ควรรักษาไว้':
   decision==='review'?(emotionalNarration?'บทบรรยายมีคำซ้ำพร้อมอารมณ์หรือเหตุการณ์กดดัน ต้องตรวจเจตนาของผู้เขียน':
    'บริบทกำกวมหรือความมั่นใจไม่พอ — ต้องให้ผู้เขียนพิจารณา'):
   'บทบรรยายปกติและโมเดลทดลองประเมินว่าคำซ้ำอาจเป็นข้อผิดพลาด'};
}
function trainIntent(rows,epochs=380){
 const weights=Array.from({length:3},()=>Array(INTENT_NAMES.length).fill(0)),bias=Array(3).fill(0);
 const groupIndex=x=>Number(String(x.group||'').slice(-2));
 const train=rows.filter(x=>groupIndex(x)%5!==0),test=rows.filter(x=>groupIndex(x)%5===0);
 for(let ep=0;ep<epochs;ep++){
  const lr=.09/(1+ep/150);
  for(const row of train){
   const v=intentFeatures(row.text,row),scores=weights.map((w,k)=>w.reduce((z,val,j)=>z+val*v[j],bias[k]));
   const max=Math.max(...scores),exps=scores.map(z=>Math.exp(z-max)),sum=exps.reduce((a,b)=>a+b,0);
   for(let k=0;k<3;k++){
    const err=exps[k]/sum-(INTENT_LABELS[k]===row.label?1:0);
    for(let j=0;j<INTENT_NAMES.length;j++)weights[k][j]-=lr*(err*v[j]+.0005*weights[k][j]);
    bias[k]-=lr*err;
   }
  }
 }
 const candidate={task:INTENT_MODEL.task,features:INTENT_NAMES,weights,bias};
 const correct=test.filter(row=>{
  const probs=intentProbability(row.text,row,candidate),choice=INTENT_LABELS[probs.indexOf(Math.max(...probs))];
  return choice===row.label;
 }).length;
 return {weights:weights.map(w=>w.map(v=>+v.toFixed(6))),bias:bias.map(v=>+v.toFixed(6)),
  trainRows:train.length,testRows:test.length,correct,holdoutAccuracy:test.length?correct/test.length:0};
}

function propose(value,context={}){
 const original=String(value||'');
 if(!original.trim()||classifyIntent(original,context).decision!=='remove')return original;
 let after=original;
 const edits=[
  [/(?:แล้วก็\s*){2,}/gu,'แล้วก็ '],
  [/(?:จากนั้น\s*){2,}/gu,'จากนั้น '],
  [/(?:ในตอนนั้น\s*){2,}/gu,'ในตอนนั้น '],
  [/(?:เพราะว่า\s*){2,}/gu,'เพราะว่า '],
  [/(?:เอ่อ\s*){2,}/gu,'เอ่อ '],
  [/(?:คือว่า\s*){2,}/gu,'คือว่า '],
  [/(?:แบบว่า\s*){2,}/gu,'แบบว่า '],
  [/([!?])\1+/gu,'$1']
 ];
 for(const [re,next]of edits)after=after.replace(re,next);
 if(after===original)return original; // Perfect no-op on repeated review.
 return after.replace(/ {2,}/gu,' ').trim();
}
function warnings(value){
 const text=String(value||'');
 const issues=[];
 // These are simple conservative HEURISTICS, not learned semantic understanding.
 if(/ฝนหยุดตก[\s\S]{0,100}ฝนยังตก|ฝนยังตก[\s\S]{0,100}ฝนหยุดตก/u.test(text))
  issues.push('อาจขัดแย้ง: ฝนหยุดตกและยังตกในช่วงเดียวกัน — ตรวจลำดับเหตุการณ์');
 if(/ไฟดับ[\s\S]{0,100}ไฟยังสว่าง|ไฟยังสว่าง[\s\S]{0,100}ไฟดับ/u.test(text))
  issues.push('อาจขัดแย้ง: ไฟดับแต่ยังสว่าง — ตรวจบริบท');
 if([...text].length>190)
  issues.push('ข้อความพากย์ยาวมาก ตรวจการแบ่งจังหวะและความยาวเสียงจริง');
 if(/[“”"']/.test(text)&&/(?:เอ่อ\s*){2,}|(?:แล้วก็\s*){2,}/u.test(text))
  issues.push('มีคำซ้ำในคำพูดตัวละคร อาจตั้งใจแสดงอาการลังเล จึงไม่แก้ให้อัตโนมัติ');
 return issues;
}
function subtitleAudit(lines){
 const src=Array.isArray(lines)?lines:[],messages=[];
 if(src.length>3)messages.push('ซับมีมากกว่า 3 บรรทัดในหนึ่งหน้า');
 for(let i=0;i<src.length;i++){
  const raw=String(src[i]||'');
  const length=typeof Intl!=='undefined'&&Intl.Segmenter?
   [...new Intl.Segmenter('th',{granularity:'grapheme'}).segment(raw)].length:[...raw].length;
  if(length>28)messages.push('ซับบรรทัด '+(i+1)+' ยาว '+length+' ตัวอักษรที่มองเห็น (แนะนำไม่เกิน 28)');
 }
 return messages;
}
function review(value,context={}){
 const text=String(value||''),risk=probability(text),intent=classifyIntent(text,context),proposed=propose(text,context);
 const hasEdit=proposed!==text;
 const issues=[...warnings(text),...subtitleAudit(context.subtitle)];
 if(intent.decision==='review'&&intent.hasRepetition)
  issues.push('คำซ้ำอาจเป็นลีลาการพูด: โปรดตรวจอารมณ์และสถานการณ์ก่อนแก้');
 return {risk,intent,needsReview:hasEdit||issues.length>0||(risk>=0.6&&intent.decision==='review'),hasEdit,proposed,warnings:issues,
  explanation:hasEdit?'เสนอแก้คำหรือเครื่องหมายซ้ำเฉพาะจุด โดยให้คุณอนุมัติก่อน':
  intent.decision==='clean'?'ไม่พบคำซ้ำที่จำเป็นต้องแก้':
  intent.decision==='keep'?'รักษาคำซ้ำที่อาจตั้งใจใช้แสดงอารมณ์หรือเน้นความหมาย':
  issues.length?'ไม่แก้บทอัตโนมัติ แต่พบจุดต้องตรวจคุณภาพ':
  risk>=.6?'โมเดลทดลองพบความเสี่ยง แต่ยังไม่มีคำแก้ปลอดภัย':
  'ข้อความผ่านการตรวจเบื้องต้น — ไม่มีข้อเสนอแก้ซ้ำ (idempotent)'};
}
// Reproducible CPU stochastic gradient descent; source pair held out together.
function train(rows,epochs=300){
 const w=Array(NAMES.length).fill(0),b={value:0};
 const trainRows=rows.filter(x=>Number(x.group)%5!==0),testRows=rows.filter(x=>Number(x.group)%5===0);
 const samples=trainRows.map(x=>({v:features(x.text),label:x.label}));
 for(let e=0;e<epochs;e++){
  const lr=.11/(1+e/135);
  for(const sample of samples){
   let z=b.value;for(let j=0;j<w.length;j++)z+=w[j]*sample.v[j];
   const p=1/(1+Math.exp(-Math.max(-25,Math.min(25,z)))),err=p-sample.label;
   for(let j=0;j<w.length;j++)w[j]-=lr*(err*sample.v[j]+.0006*w[j]);
   b.value-=lr*err;
  }
 }
 const scores=testRows.map(x=>({expected:x.label,predicted:probability(x.text,{task:MODEL.task,features:NAMES,weights:w,bias:b.value})>=.5?1:0}));
 return {weights:w.map(x=>+x.toFixed(6)),bias:+b.value.toFixed(6),
  accuracy:scores.length?scores.filter(x=>x.expected===x.predicted).length/scores.length:0,
  trainRows:trainRows.length,testRows:testRows.length,groups:new Set(trainRows.map(x=>x.group)).size};
}
// Batch review never mutates source projects, never trains on a user's script,
// and keeps a per-scene snapshot so later changes cannot be silently overwritten.
function reviewProject(project){
 const entries=[],episodes=Array.isArray(project?.episodes)?project.episodes:[];
 let withNarration=0,changes=0,attention=0,passed=0,clean=0,kept=0;
 for(let ei=0;ei<episodes.length;ei++){
  const ep=episodes[ei]||{},scenes=Array.isArray(ep.scenes)?ep.scenes:[];
  for(let si=0;si<scenes.length;si++){
   const scene=scenes[si]||{},original=String(scene.voiceover||'');
   const key=ei+':'+si,hasText=!!original.trim();
   const result=hasText?review(original,sceneContext(scene)):null;
   if(hasText){
    withNarration++;
    if(result.hasEdit)changes++;
    else if(result.needsReview)attention++;
    else {passed++;if(result.intent?.decision==='clean')clean++;else if(result.intent?.decision==='keep')kept++;}
   }
   entries.push({key,episodeIndex:ei,sceneIndex:si,episodeTitle:String(ep.title||('ตอนที่ '+(ei+1))),
    sceneId:scene.id,original,subtitleSnapshot:JSON.stringify(Array.isArray(scene.subtitle)?scene.subtitle:[]),
    hasText,contextSnapshot:JSON.stringify(sceneContext(scene)),result});
  }
 }
 return {entries,stats:{scenes:entries.length,withNarration,changes,attention,passed,clean,kept,missing:entries.length-withNarration}};
}
function verifyBatchSelection(project,entries,selectedKeys){
 const chosen=new Set(selectedKeys||[]),selected=[];
 const episodes=Array.isArray(project?.episodes)?project.episodes:[];
 const allIds=[];
 for(const ep of episodes)for(const scene of (Array.isArray(ep?.scenes)?ep.scenes:[])){
  if(scene?.id!=null)allIds.push(scene.id);
 }
 if(allIds.length!==new Set(allIds).size)throw Error('โปรเจกต์มี scene.id ซ้ำ ไม่สามารถแก้เป็นชุดอย่างปลอดภัย');
 const keys=new Set((entries||[]).map(x=>x.key));
 for(const key of chosen)if(!keys.has(key))throw Error('มีฉากที่ไม่ได้อยู่ในรายงาน กรุณาวิเคราะห์ใหม่');
 for(const entry of entries||[]){
  if(!chosen.has(entry.key))continue;
  const scene=episodes[entry.episodeIndex]?.scenes?.[entry.sceneIndex];
  if(!scene||scene.id!==entry.sceneId||
     String(scene.voiceover||'')!==entry.original||
     JSON.stringify(Array.isArray(scene.subtitle)?scene.subtitle:[])!==entry.subtitleSnapshot||
     JSON.stringify(sceneContext(scene))!==entry.contextSnapshot)
   throw Error('บทหรือซับมีการเปลี่ยนหลังวิเคราะห์ กรุณาวิเคราะห์ใหม่: '+entry.key);
  const fresh=review(scene.voiceover,sceneContext(scene));
  if(!fresh.hasEdit||fresh.proposed!==entry.result?.proposed)
   throw Error('ข้อเสนอไม่ตรงกับโมเดลปัจจุบัน กรุณาวิเคราะห์ใหม่: '+entry.key);
  selected.push({entry,scene,proposed:fresh.proposed});
 }
 return selected;
}
return Object.freeze({NAMES,MODEL,features,probability,propose,review,warnings,subtitleAudit,train,reviewProject,verifyBatchSelection,INTENT_MODEL,intentFeatures,intentProbability,classifyIntent,trainIntent,sceneContext});
});