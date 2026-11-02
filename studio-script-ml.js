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
 weights:[[0.032789,0.17706,0.576461,-0.660547,-0.433492,-0.433492,2.039315,-1.508002,-2.429294,-1.508002,-2.027099,-0.027942],[-0.195922,-0.121412,-0.380609,0.534472,0.936176,0.936176,-0.36701,-0.633159,3.103757,-0.633159,2.277976,0.099478],[0.163133,-0.055649,-0.195852,0.126075,-0.502684,-0.502684,-1.672305,2.141161,-0.674463,2.141161,-0.250877,-0.071536]],
 bias:[1.737617,-1.094103,-0.643513],trainRows:529,heldOutRows:130,assistantDemoAccuracy:1});
// Real CPU-trained softmax parameters, fitted to synthetic Thai scene examples.
// The model detects lexical evidence, NOT general emotion comprehension.
const EMOTION_LABELS=Object.freeze(["neutral","fear","anger","sadness","surprise","hesitation"]);
const EMOTION_SOURCES=Object.freeze(['text','previous','next','notes']);
const EMOTION_PATTERN=Object.freeze([/ตามปกติ|เรียบร้อย|ไม่มีเหตุผิดปกติ|เป็นระเบียบ|ดำเนินงานต่ออย่างปกติ|ทำงานตามขั้นตอน/u,
/ตัวสั่น|กรีดร้อง|หวาดกลัว|กลัว|วิ่งหนี|หลบภัย|หัวใจเต้นแรง|ตื่นตระหนก|ถอยกรูด|หนีไม่ทัน|มือสั่น|หอบหายใจ|ร้องช่วยด้วย|ผวา|หนีเร็ว|ประตูพัง|ขนลุก|สยอง|ขาอ่อน|หวาดผวา|หลอน/u,
/กำหมัด|โกรธ|โมโห|ตบโต๊ะ|ตำหนิ|ขึ้นเสียง|เดือดดาล|โวยวาย|ทะเลาะ|เถียง|ต่อว่า|หลบไป|อย่ามาขวาง|เกรี้ยวกราด|ถอยไปอย่าง|แค้นเคือง|กัดฟัน|ตวาด|เดือด|คับแค้น/u,
/น้ำตา|ร้องไห้|เสียใจ|สูญเสีย|เศร้า|อาลัย|สะอื้น|จากไป|คิดถึง|ใจสลาย|โศกเศร้า|น้ำตาคลอ|บอกลา|เหงา|หัวใจหนักอึ้ง/u,
/สะดุ้ง|ตกใจ|ตะลึง|อุทาน|อะไรนะ|คาดไม่ถึง|ไม่คาดฝัน|ประหลาดใจ|กะทันหัน|โผล่|ไม่น่าเชื่อ|จริงเหรอ|ตกตะลึง|อึ้ง|ช็อก|ไม่คาดคิด/u,
/เอ่อ|ลังเล|ไม่แน่ใจ|อ้ำอึ้ง|ตัดสินใจไม่|ไม่มั่นใจ|ตะกุกตะกัก|คือว่า|หยุดคิด|ไม่ลง|ชั่งใจ|ลังเลใจ|ไม่กล้าก้าว/u]);
const EMOTION_NAMES=Object.freeze(EMOTION_SOURCES.flatMap(f=>EMOTION_LABELS.map(l=>f+'_'+l)).concat(['repetition','interruption','quoted']));
const EMOTION_MODEL=Object.freeze({schema:2,task:'thai-scene-emotion',status:'assistant-synthetic-demo-only',
 labels:[...EMOTION_LABELS],features:[...EMOTION_NAMES],weights:[[6.572682,-0.92836,-0.926006,-0.453988,-0.924985,-1.191199,1.999373,-0.095452,-0.516901,-0.799988,-0.768961,-0.930251,2.903489,0.01191,-1.275914,-0.185782,-1.573391,-1.112462,2.481412,-1.523681,-1.537479,-1.493566,-1.72243,-1.24514,0.222885,0,-0.494438],[-1.579107,4.179799,-0.830972,-0.618848,-1.037537,-0.566053,0.418767,3.966385,-1.256016,0.097198,-1.479109,-0.308247,-0.593171,3.078731,-1.443026,-0.700233,-1.632962,-0.513775,-0.545017,4.173947,-0.698759,-0.679169,-0.883817,-0.594182,-0.532887,0,0.009931],[-1.700804,-0.707568,4.368403,-0.538325,-0.897156,-0.508909,-0.310329,-0.467445,4.283349,-0.398858,-0.888127,-0.453442,-0.771994,-0.374993,4.64558,-0.621111,-0.706589,-0.455518,-0.488215,-0.633599,4.178501,-0.583379,-0.783444,-0.497779,0.125444,0,0.156758],[-2.259265,-1.143007,-1.197518,4.562164,-1.40948,-0.76635,-1.373127,-1.779325,-1.200386,2.362307,-0.657366,-0.950467,-0.727682,-1.412429,-0.938213,3.932754,-0.495423,-0.940281,-0.496371,-0.781,-0.729771,4.296884,-0.683234,-0.740562,-0.254808,0,-0.370616],[-0.775121,-0.747338,-0.74244,-2.36398,4.189863,-1.907464,-0.633882,-0.612093,-0.803784,-0.882731,3.455674,-1.884367,-0.910322,-0.318248,-0.533237,-1.80131,4.085597,-1.761431,-0.516674,-0.666122,-0.652397,-0.999977,3.844245,-1.731312,0.454227,0,0.453001],[-0.258385,-0.653525,-0.671467,-0.587023,0.079295,4.939975,-0.100802,-1.01207,-0.506262,-0.377929,0.337889,4.526773,0.09968,-0.984971,-0.455189,-0.624319,0.322767,4.783467,-0.435135,-0.569546,-0.560096,-0.540793,0.228681,4.808976,-0.014861,0,0.245365]],
 bias:[-0.715436,-0.165281,-0.116023,1.420069,-0.056382,-0.366947],trainRows:749,heldOutRows:184,syntheticHoldoutAccuracy:0.9836956521739131});
function emotionFeatures(value,context={}){
 const parts=[String(value||''),String(context.previous||''),String(context.next||''),String(context.notes||'')];
 const result=[];
 for(const part of parts)for(const re of EMOTION_PATTERN)result.push(re.test(part.slice(0,400))?1:0);
 const t=parts[0];
 return result.concat([/(?:แล้วก็\s*){2,}|(?:เอ่อ\s*){2,}/u.test(t)?1:0,/…|\.{3}/u.test(t)?1:0,/[“”"'«»]/u.test(t)?1:0]);
}
function emotionProbabilities(text,context={},model=EMOTION_MODEL){
 if(!model||model.task!=='thai-scene-emotion'||model.features.join('|')!==EMOTION_NAMES.join('|')||
  model.weights.length!==6)return null;
 const v=emotionFeatures(text,context),scores=model.weights.map((w,k)=>w.reduce((z,a,i)=>z+a*v[i],model.bias[k]));
 const maximum=Math.max(...scores),exps=scores.map(x=>Math.exp(x-maximum)),sum=exps.reduce((a,b)=>a+b,0);
 return exps.map(x=>x/sum);
}
function inferEmotion(text,context={}){
 const features=emotionFeatures(text,context),probs=emotionProbabilities(text,context),max=Math.max(...probs);
 const winner=EMOTION_LABELS[probs.indexOf(max)];
 const sourceNames=EMOTION_SOURCES;
 const raw=String(context.emotion||'').trim().toLowerCase();
 const tagSource=String(context.emotionSource||'provided').toLowerCase();
 const declared=EMOTION_LABELS.find(x=>x===raw)||
  (/กลัว|หวาดกลัว/.test(raw)?'fear':
   /โกรธ|โมโห/.test(raw)?'anger':/เศร้า|เสียใจ/.test(raw)?'sadness':
   /ตกใจ|ประหลาดใจ/.test(raw)?'surprise':/ลังเล/.test(raw)?'hesitation':null);
 // Explicit author metadata is primary, but generated voiceDirection defaults
 // are NOT reliable human annotations.
 if(declared&&tagSource!=='default'&&tagSource!=='voice-default')
  return {label:declared,source:'author-tag',hasEvidence:true,conflict:false,
   decisionEvidence:'author-declared',modelLabel:winner,scores:probs};
 const sourceHits=sourceNames.map((source,i)=>EMOTION_LABELS
  .filter((label,k)=>(i===0||i===3||k>0)&&features[i*6+k]>0));
 const allHits=sourceHits.flat(),hasEvidence=features.slice(0,24).some(Boolean);
 const conflict=new Set(allHits).size>1;
 let label='unknown',source='no-evidence',localConflict=false;
 // Prefer evidence in the actual scene to another speaker's next line.
 for(const index of [0,3,1,2]){
  const hits=sourceHits[index];
  if(hits.length>1){localConflict=true;source=sourceNames[index];break}
  if(hits.length===1){
   // A weak 'เอ่อ' alone is not reliable intentional hesitation.
   const hay=String(index===0?text:context[sourceNames[index]]||'');
   if(hits[0]==='hesitation'&&/เอ่อ/u.test(hay)&&
    !/ลังเล|ไม่แน่ใจ|อ้ำอึ้ง|ตัดสินใจไม่|ไม่มั่นใจ|ตะกุกตะกัก|คือว่า/u.test(hay))
    continue;
   label=hits[0];source=sourceNames[index];
   // A lone neighbor cue cannot override a conflicting trained prediction.
   // Explicit current-text evidence wins over a neighboring speaker's words.
   if(index>0&&winner!==label)label='unknown';
   break;
  }
 }
 // Do not treat negated feelings or an unresolved contradiction as proof.
 if(/ไม่กลัว|ไม่ได้โกรธ|ไม่เศร้า|ไม่ตกใจ/u.test(String(text||'')))label='unknown';
 if(localConflict)label='unknown';
 if(source==='previous'&&sourceHits[2].length===1&&sourceHits[2][0]!==label)label='unknown';
 if(source==='next'&&sourceHits[1].length===1&&sourceHits[1][0]!==label)label='unknown';
 const sourceActual=source;
 if(label==='unknown'&&source==='no-evidence'&&features.slice(0,24).some(Boolean))
  source='conflicting-or-weak';
 return {label,source,hasEvidence,conflict:conflict||localConflict,
  decisionEvidence:label==='unknown'?'insufficient-or-conflicting':'lexical-emotion-cue',
  modelLabel:winner,scores:probs};
}
function trainEmotion(rows,epochs=250){
 const w=EMOTION_LABELS.map(()=>Array(EMOTION_NAMES.length).fill(0)),bias=EMOTION_LABELS.map(()=>0);
 const train=rows.filter(x=>Number(String(x.group).slice(-2))%5!==0),test=rows.filter(x=>Number(String(x.group).slice(-2))%5===0);
 for(let ep=0;ep<epochs;ep++){
  const lr=.095/(1+ep/120);
  for(const row of train){
   const v=emotionFeatures(row.text,row),scores=w.map((ws,k)=>ws.reduce((sum,weight,i)=>sum+weight*v[i],bias[k]));
   const maximum=Math.max(...scores),exps=scores.map(z=>Math.exp(z-maximum)),sum=exps.reduce((a,b)=>a+b,0);
   for(let k=0;k<EMOTION_LABELS.length;k++){
    const err=exps[k]/sum-(row.label===EMOTION_LABELS[k]?1:0);
    for(let i=0;i<EMOTION_NAMES.length;i++)w[k][i]-=lr*(err*v[i]+.0004*w[k][i]);
    bias[k]-=lr*err;
   }
  }
 }
 const model={task:EMOTION_MODEL.task,features:EMOTION_NAMES,weights:w,bias};
 const correct=test.filter(row=>{const p=emotionProbabilities(row.text,row,model);
  return EMOTION_LABELS[p.indexOf(Math.max(...p))]===row.label}).length;
 return {weights:w.map(v=>v.map(z=>+z.toFixed(6))),bias:bias.map(z=>+z.toFixed(6)),
  trainRows:train.length,testRows:test.length,correct,syntheticAccuracy:test.length?correct/test.length:0};
}

function sceneContext(scene,previous=null,next=null){
 const voice=scene?.voiceDirection||{};
 const topEmotion=String(scene?.emotion||scene?.voiceEmotion||'').trim();
 const voiceEmotion=String(voice.emotion||'').trim();
 return {
  mode:String(scene?.scriptMode||scene?.narrativeMode||voice.mode||'narration'),
  emotion:topEmotion||voiceEmotion,
  emotionSource:topEmotion?'scene':voiceEmotion&&voiceEmotion.toLowerCase()!=='neutral'?'voice-direction':'default',
  situation:String(scene?.situation||scene?.eventKind||scene?.event?.kind||''),
  genre:String(scene?.genre||''),
  subtitle:Array.isArray(scene?.subtitle)?scene.subtitle:[],
  notes:String(scene?.notes||'').slice(0,400),previous:String(previous?.voiceover||'').slice(0,400),
  next:String(next?.voiceover||'').slice(0,400)
 };
}
function sceneContextById(project,id){
 const episodes=Array.isArray(project?.episodes)?project.episodes:[];
 for(const ep of episodes){const list=Array.isArray(ep?.scenes)?ep.scenes:[];
  for(let i=0;i<list.length;i++)if(list[i]?.id===id)return sceneContext(list[i],list[i-1],list[i+1]);}
 return null;
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
 const indicators=intentFeatures(text,context),inferredEmotion=inferEmotion(text,context);
 const impliedEmotion=inferredEmotion.label!=='unknown'&&inferredEmotion.label!=='neutral';
 // A quoted sentence or dramatic punctuation alone is NOT evidence of repetition.
 // Word/phrase repetitions can be intentional; the classification is context-aware.
 const hasRepetition=!!(indicators[0]||indicators[1]||indicators[2]||indicators[11]||
  /([\p{Script=Thai}]{2,20})(?:\s+|[!！?？…]|\.{3})\s*\1/u.test(text)||
  /(ออกไป|ถอยไป|หลบไป|กลับมา|ไม่จริง|ช่วยด้วย)[!！?？]?[^\n]{0,45}\1/u.test(text));
 const emotionalNarration=mode==='narration'&&
  (/fear|anger|sad|surprise|hesitat|emphas|กลัว|ตกใจ|โกรธ|เศร้า|ลังเล|ย้ำ/u.test(emotion)||
   /danger|confront|panic|threat|argument|ทะเลาะ|วิกฤต/u.test(situation));
 let decision='review';
 if(!hasRepetition)decision='clean';
 else if(/รอแล้วรอเล่า|ทำแล้วทำเล่า/u.test(text))decision='keep'; // Conventional Thai emphasis, not a copy-paste error.
 else if(mode==='dialogue'||/[“”"'«»]/u.test(text))decision='keep';
 else if(emotionalNarration||impliedEmotion&&mode==='narration'&&
  (indicators[0]||indicators[2]||indicators[11]||emotionFeatures(text,context).slice(1,6).some(Boolean)))decision='review'; // Inferred danger => human review, never delete.
 else if(magicChant(text,context))decision='keep'; // spells/chants repeat on purpose
 else if(protectedExpression)decision='keep';
 else if(uncertain)decision='review';
 else if(label==='remove'&&best>=.85)decision='remove';
 return {label,decision,hasRepetition,confidence:best,probabilities,
  emotion:inferredEmotion,
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
// Miraculous / mysterious events may CONTRADICT ordinary logic on purpose
// ("แม้ไฟจะดับ แต่ยังมีแสงสว่างสาดส่องเข้ามา ไม่รู้จากที่ใด"). Detect the author's
// signal in the line itself or in the scene metadata and do not flag it as an error.
const MAGIC_TEXT=/ปาฏิหาริย์|มหัศจรรย์|อัศจรรย์|เวทมนตร์|วิเศษ|ลึกลับ|เหนือธรรมชาติ|น่าประหลาด|ประหลาดยิ่ง|ไม่รู้(?:ว่า)?(?:มา)?จาก(?:ที่ใด|ไหน|แห่งใด|ที่ไหน)|ไม่รู้ที่มา|ไร้ที่มา|ไม่มีที่มา|ราวกับ(?:มี|ว่า)|ราวกับปาฏิหาริย์|ไม่มีใครอธิบายได้|อธิบายไม่ได้|ไม่มีใครรู้(?:ที่มา|ว่า)|ราวกับ|เสมือน|พระเจ้า|พระเป็นเจ้า|ศักดิ์สิทธิ์|เทพ|เทวดา|นางฟ้า|วิญญาณ|ภูตผี|มังกร|เหมือนฝัน|ปริศนา|ลอยอยู่กลางอากาศ|ส่องแสงเอง|เรืองแสง|ในใจ|ในดวงตา|ในหัวใจ|ในความฝัน/u;
const MAGIC_META=/magic|miracle|mystic|mystery|supernatural|fantasy|wonder|surreal|ปาฏิหาริย์|มหัศจรรย์|อัศจรรย์|เวทมนตร์|ลึกลับ|เหนือธรรมชาติ|แฟนตาซี|เหนือจริง/u;
const CONCESSIVE=/(?:แม้|ถึงแม้|ทั้งที่|ทั้ง ๆ ที่)[\s\S]{0,60}(?:แต่|ก็ยัง|กลับ|ยังคง)/u;
function intentionalContrast(value,context={}){
 const text=String(value||'');
 const meta=[context.situation,context.emotion,context.genre,context.eventKind,context.notes,context.tags&&[].concat(context.tags).join(' ')].map(x=>String(x||'')).join(' ');
 if(MAGIC_META.test(meta))return true;
 if(MAGIC_TEXT.test(text))return true;
 return CONCESSIVE.test(text)&&/ไม่รู้|ปริศนา|ประหลาด|แปลก/u.test(text);
}
const CHANT=/คาถา|มนตร์|ร่ายเวท|ร่ายคาถา|ท่องคาถา|สวดมนต์|บทสวด|ร่ายรำ|เปิดเถิด|จงตื่น|จงมา/u;
function magicChant(text,context={}){
 const meta=[context.situation,context.emotion,context.genre,context.eventKind,context.notes].map(x=>String(x||'')).join(' ');
 return CHANT.test(String(text||''))||MAGIC_META.test(meta);
}
function warnings(value,context={}){
 const text=String(value||'');
 const issues=[];
 const magical=intentionalContrast(text,context);
 // These are simple conservative HEURISTICS, not learned semantic understanding.
 const PAIRS=[
  [/ฝนหยุดตก/u,/ฝนยังตก/u,'ฝนหยุดตกและยังตกในช่วงเดียวกัน — ตรวจลำดับเหตุการณ์'],
  [/ไฟดับ/u,/ไฟยังสว่าง|ยังมีแสง|ยังสว่าง/u,'ไฟดับแต่ยังสว่าง — ตรวจบริบท'],
  [/มืดสนิท/u,/เห็นชัด|สว่างจ้า|เห็นได้ทุกอย่าง/u,'มืดสนิทแต่เห็นชัด — ตรวจบริบท'],
  [/เงียบสนิท|ไม่มีเสียง/u,/เสียงดังลั่น|เสียงกึกก้อง/u,'เงียบสนิทแต่เสียงดัง — ตรวจบริบท'],
  [/ประตูปิดสนิท|ประตูล็อก/u,/ประตูเปิดอยู่|เดินผ่านประตูเข้ามา/u,'ประตูปิดแต่เปิดอยู่ — ตรวจลำดับเหตุการณ์'],
  [/เสียชีวิตแล้ว|ตายแล้ว|สิ้นใจ/u,/ยังหายใจ|ลุกขึ้นเดิน|พูดขึ้น/u,'ตายแล้วแต่ยังเคลื่อนไหว — ตรวจบริบท'],
  [/ไม่มีใครอยู่|ห้องว่างเปล่า/u,/ทุกคนอยู่ในห้อง|คนเต็มห้อง/u,'ว่างเปล่าแต่มีคนเต็ม — ตรวจบริบท']];
 if(!magical)for(const [x,y,msg] of PAIRS)
  if(new RegExp(x.source+'[\\s\\S]{0,100}'+y.source+'|'+y.source+'[\\s\\S]{0,100}'+x.source,'u').test(text))issues.push('อาจขัดแย้ง: '+msg);
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
 const issues=[...warnings(text,context),...subtitleAudit(context.subtitle)];
 if(intent.decision==='review'&&intent.hasRepetition)
  issues.push('คำซ้ำอาจเป็นลีลาการพูด: โปรดตรวจอารมณ์และสถานการณ์ก่อนแก้');
 return {risk,intent,intentionalContrast:intentionalContrast(text,context),needsReview:hasEdit||issues.length>0||(risk>=0.6&&intent.decision==='review'),hasEdit,proposed,warnings:issues,
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
   const context=sceneContext(scene,scenes[si-1],scenes[si+1]);
   const result=hasText?review(original,context):null;
   if(hasText){
    withNarration++;
    if(result.hasEdit)changes++;
    else if(result.needsReview)attention++;
    else {passed++;if(result.intent?.decision==='clean')clean++;else if(result.intent?.decision==='keep')kept++;}
   }
   entries.push({key,episodeIndex:ei,sceneIndex:si,episodeTitle:String(ep.title||('ตอนที่ '+(ei+1))),
    sceneId:scene.id,original,subtitleSnapshot:JSON.stringify(Array.isArray(scene.subtitle)?scene.subtitle:[]),
    hasText,contextSnapshot:JSON.stringify(context),result});
  }
 }
 return {entries,stats:{scenes:entries.length,withNarration,changes,attention,passed,clean,kept,missing:entries.length-withNarration}};
}

// ---- Comparison package helpers (pure, testable). They never mutate the source project.
// buildProposedProject returns a COPY with every AI proposal applied exactly as the
// editor would (voiceover + regenerated subtitles + stale-voice flags when `prepare` is given).
function buildProposedProject(project,entries,options={}){
 const copy=JSON.parse(JSON.stringify(project||{})),applied=[],skipped=[];
 const scenes=new Map();
 for(const ep of Array.isArray(copy.episodes)?copy.episodes:[])
  for(const scene of Array.isArray(ep?.scenes)?ep.scenes:[])if(scene?.id!=null)scenes.set(scene.id,scene);
 for(const entry of entries||[]){
  const proposed=entry?.result?.proposed;
  if(!entry?.result?.hasEdit||typeof proposed!=='string')continue;
  const scene=scenes.get(entry.sceneId);
  if(!scene){skipped.push({key:entry.key,sceneId:entry.sceneId,reason:'scene-missing'});continue}
  if(String(scene.voiceover||'')!==entry.original){skipped.push({key:entry.key,sceneId:entry.sceneId,reason:'text-changed-since-analysis'});continue}
  let patch={voiceover:proposed};
  if(typeof options.prepare==='function'){
   try{const prepared=options.prepare({...scene,voiceover:proposed,subtitle:[],subtitleCues:[]});
    if(prepared){patch.subtitle=prepared.subtitle;patch.subtitleCues=prepared.subtitleCues}
    else patch.subtitleNote='subtitle-not-regenerated'}
   catch(_){patch.subtitleNote='subtitle-not-regenerated'}
  }
  const note=patch.subtitleNote;delete patch.subtitleNote;
  Object.assign(scene,patch);
  if((scene.audioClips||[]).some(c=>c.kind==='voice'&&c.data&&!c.mute))
   scene.audioClips=scene.audioClips.map(c=>c.kind==='voice'&&c.data?{...c,mute:true,staleNarration:true}:c);
  applied.push({key:entry.key,sceneId:entry.sceneId,subtitleRegenerated:!note&&typeof options.prepare==='function'});
 }
 return {project:copy,applied,skipped};
}
function mdCell(x){return String(x==null?'':x).replace(/\|/g,'\\|').replace(/\r?\n/g,' ⏎ ')}
function comparisonMarkdown(report){
 const st=report?.stats||{},entries=Array.isArray(report?.entries)?report.entries:[];
 const out=['# รายงานเทียบบท: ต้นฉบับ vs ที่เอไอเสนอ','',
  `- สร้างเมื่อ: ${mdCell(report?.createdAt)}`,
  `- โมเดล: ${mdCell(JSON.stringify(report?.models||{}))}`,
  `- สถิติ: ${mdCell(JSON.stringify(st))}`,
  '- หมายเหตุ: โมเดลฝึกจากข้อมูลสังเคราะห์ที่ผู้ช่วยเขียนเอง ไม่ใช่ข้อมูลจริงที่อนุมัติแล้ว ใช้เพื่อตรวจโดยคนเท่านั้น',''];
 const changed=entries.filter(e=>e.hasEdit);
 out.push(`## ข้อเสนอแก้ (${changed.length} ฉาก)`,'');
 if(changed.length){out.push('| ตอน | ฉาก | id | ต้นฉบับ | เอไอเสนอ | เหตุผล/การตัดสิน |','|---|---|---|---|---|---|');
  for(const e of changed)out.push(`| ${mdCell(e.episodeTitle||e.episodeIndex)} | ${e.sceneIndex+1} | ${mdCell(e.sceneId)} | ${mdCell(e.original)} | ${mdCell(e.proposed)} | ${mdCell(e.intent?.decision+': '+(e.intent?.reason||''))} |`)}
 else out.push('_ไม่มีข้อเสนอแก้_');
 const attn=entries.filter(e=>!e.hasEdit&&(e.needsReview||(e.warnings||[]).length));
 out.push('',`## ฉากที่ต้องคนตรวจ ไม่แก้อัตโนมัติ (${attn.length} ฉาก)`,'');
 for(const e of attn)out.push(`- ตอน ${mdCell(e.episodeTitle||e.episodeIndex)} ฉาก ${e.sceneIndex+1} (${mdCell(e.sceneId)}): "${mdCell(e.original)}" — ${mdCell((e.warnings||[]).join(' / ')||e.intent?.decision)}`);
 const kept=entries.filter(e=>!e.hasEdit&&e.intent?.decision==='keep');
 out.push('',`## ที่เอไอตั้งใจเก็บไว้ (${kept.length} ฉาก)`,'');
 for(const e of kept)out.push(`- ฉาก ${e.sceneIndex+1} (${mdCell(e.sceneId)}): "${mdCell(e.original)}"`);
 return out.join('\n')+'\n';
}

// One text-only file with EVERY script word: original next to the AI proposal, per scene.
// No images, audio or other heavy project data, so it is small enough to send in one go.
function scriptOnlyMarkdown(project,entries,report,proposedResult){
 const byId=new Map((entries||[]).map(e=>[e.sceneId,e]));
 const proposedScenes=new Map();
 for(const ep of Array.isArray(proposedResult?.project?.episodes)?proposedResult.project.episodes:[])
  for(const s of Array.isArray(ep?.scenes)?ep.scenes:[])proposedScenes.set(s.id,s);
 const list=a=>(Array.isArray(a)?a:[]).map(x=>typeof x==='string'?x:(x?.name||x?.id||'')).filter(Boolean).join(', ');
 const lines=(a)=>(Array.isArray(a)?a:[]).map(x=>typeof x==='string'?x:JSON.stringify(x));
 const out=['# ไฟล์บทเดียว: ต้นฉบับ vs ที่เอไอเสนอ (ทุกฉาก ทุกคำ)','',
  `- สร้างเมื่อ: ${mdCell(report?.createdAt||'')}`,
  `- โปรเจกต์: ${mdCell(project?.project?.title||project?.title||project?.project?.name||'')}`,
  `- โมเดล: ${mdCell(JSON.stringify(report?.models||{}))}`,
  `- สถิติ: ${mdCell(JSON.stringify(report?.stats||{}))}`,
  '- โมเดลฝึกจากข้อมูลสังเคราะห์ที่ผู้ช่วยเขียนเอง ใช้ช่วยตรวจโดยคนเท่านั้น',
  '- วิธีอ่าน: "ต้นฉบับ" = บทปัจจุบัน · "เอไอเสนอ" = ข้อเสนอแก้ (ถ้าเขียนว่า "ไม่แก้" แปลว่าเอไอไม่เสนอเปลี่ยน)',''];
 const chars=list(project?.characters);if(chars)out.push(`- ตัวละคร: ${mdCell(chars)}`,'');
 const json=[];let total=0,changed=0;
 (Array.isArray(project?.episodes)?project.episodes:[]).forEach((ep,ei)=>{
  out.push(`## ตอน ${ei+1}: ${mdCell(ep?.title||ep?.id||'')}`,'');
  for(const k of ['hiddenMistake','cliffhanger'])if(ep?.[k])out.push(`- ${k}: ${mdCell(typeof ep[k]==='string'?ep[k]:JSON.stringify(ep[k]))}`);
  if(Array.isArray(ep?.clues)&&ep.clues.length)out.push(`- clues: ${mdCell(ep.clues.map(c=>typeof c==='string'?c:(c?.text||c?.id||JSON.stringify(c))).join(' | '))}`);
  out.push('');
  (Array.isArray(ep?.scenes)?ep.scenes:[]).forEach((scene,si)=>{
   total++;
   const entry=byId.get(scene?.id),res=entry?.result,ps=proposedScenes.get(scene?.id);
   const original=String(scene?.voiceover||''),proposed=res?.hasEdit&&typeof res.proposed==='string'?res.proposed:null;
   if(proposed!==null)changed++;
   const vd=scene?.voiceDirection||{};
   out.push(`### ตอน ${ei+1} · ฉาก ${si+1} (${mdCell(scene?.id)})`,'',
    `- ตัวละคร: ${mdCell(list(scene?.characters)||'-')} · สถานที่: ${mdCell(scene?.location||'-')} · ความยาว: ${mdCell(scene?.duration||'-')} วิ`,
    `- โหมด: ${mdCell(scene?.scriptMode||scene?.narrativeMode||vd.mode||'narration')} · อารมณ์ที่ระบุ: ${mdCell(scene?.emotion||vd.emotion||'-')} · สถานการณ์: ${mdCell(scene?.situation||'-')}`,
    '',`**ต้นฉบับ:** ${original||'_(ไม่มีบทพากย์)_'}`,'',
    `**เอไอเสนอ:** ${proposed!==null?proposed:'_ไม่แก้_'}`,'');
   const subO=lines(scene?.subtitle),subP=ps&&proposed!==null?lines(ps.subtitle):null;
   if(subO.length)out.push(`ซับต้นฉบับ: ${mdCell(subO.join(' / '))}`);
   if(subP&&subP.length&&JSON.stringify(subP)!==JSON.stringify(subO))out.push(`ซับที่เอไอเสนอ: ${mdCell(subP.join(' / '))}`);
   if(res){
    out.push(`การตัดสินใจ: ${mdCell(res.intent?.decision||'-')}${res.intent?.reason?' — '+mdCell(res.intent.reason):''}${res.intentionalContrast?' · (เหตุการณ์มหัศจรรย์/ตั้งใจขัดแย้ง)':''}`);
    if((res.warnings||[]).length)out.push(`คำเตือน: ${mdCell(res.warnings.join(' / '))}`);
   }
   if(scene?.notes)out.push(`โน้ต: ${mdCell(scene.notes)}`);
   out.push('');
   json.push({episode:ei+1,scene:si+1,id:scene?.id,original,proposed,decision:res?.intent?.decision||null,warnings:res?.warnings||[]});
  });
 });
 out.push('---','',`รวม ${total} ฉาก · เอไอเสนอแก้ ${changed} ฉาก`,'',
  '<details><summary>ข้อมูลดิบ (JSON) สำหรับเทียบอัตโนมัติ</summary>','','```json',JSON.stringify(json,null,1),'```','','</details>','');
 return out.join('\n');
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
     JSON.stringify(sceneContext(scene,episodes[entry.episodeIndex]?.scenes?.[entry.sceneIndex-1],
       episodes[entry.episodeIndex]?.scenes?.[entry.sceneIndex+1]))!==entry.contextSnapshot)
   throw Error('บทหรือซับมีการเปลี่ยนหลังวิเคราะห์ กรุณาวิเคราะห์ใหม่: '+entry.key);
  const fresh=review(scene.voiceover,sceneContext(scene,episodes[entry.episodeIndex]?.scenes?.[entry.sceneIndex-1],
   episodes[entry.episodeIndex]?.scenes?.[entry.sceneIndex+1]));
  if(!fresh.hasEdit||fresh.proposed!==entry.result?.proposed)
   throw Error('ข้อเสนอไม่ตรงกับโมเดลปัจจุบัน กรุณาวิเคราะห์ใหม่: '+entry.key);
  selected.push({entry,scene,proposed:fresh.proposed});
 }
 return selected;
}
return Object.freeze({NAMES,MODEL,features,probability,propose,review,warnings,subtitleAudit,train,reviewProject,verifyBatchSelection,buildProposedProject,comparisonMarkdown,scriptOnlyMarkdown,intentionalContrast,INTENT_MODEL,intentFeatures,intentProbability,classifyIntent,trainIntent,sceneContext,sceneContextById,EMOTION_MODEL,EMOTION_LABELS,emotionFeatures,emotionProbabilities,inferEmotion,trainEmotion});
});