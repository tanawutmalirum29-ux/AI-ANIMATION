/* Explicit, undoable upgrade for the shipped school example; never runs on load. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.StorySchoolRepair=api;})(typeof window!=='undefined'?window:globalThis,function(){
'use strict';
const copy=v=>JSON.parse(JSON.stringify(v)),cast=new Set(['nont','mind','teacher','zombie']);
const visual=['camera','lighting','light','atmosphere','schoolDoorKeys','worldEffects','choreography','transition'];
const managed=item=>['story-author-v1','studio-production-v1'].includes(item.producer)&&String(item.eventKind).startsWith('school-');
function plan(state,template){
 const result={changes:[],skipped:[],locations:[],locationBefore:JSON.stringify(state.locations||[])};
 if(![...cast].every(id=>state.characters?.some(c=>c.id===id)))return result;
 for(const episode of state.episodes||[])for(const scene of episode.scenes||[]){
  const source=template.episodes[0].scenes.find(s=>s.id===scene.id);
  if(!source||!scene.actors?.some(a=>cast.has(a.char)))continue;
  if(scene.choreography?.revision>=3)continue;
  const reason=scene.cinematicPlan?'ฉากมี Blueprint':scene.locked||scene.lockMotion||scene.locks?.motion?'ล็อกการเคลื่อนไหวไว้':scene.interactions?.length?'มีเหตุการณ์ที่ผู้ใช้จัดเอง':null;
  if(reason){result.skipped.push({id:scene.id,reason});continue;}
  const patch={};for(const field of visual)patch[field]=copy(source[field]??null);
  patch.actors=[...copy(source.actors),...copy(scene.actors.filter(a=>!cast.has(a.char)))];
  patch.characters=[...new Set([...(scene.characters||[]),...patch.actors.map(a=>a.char)])];
  patch.customAssets=[...copy(source.customAssets||[]),...copy((scene.customAssets||[]).filter(a=>!managed(a)))];
  patch.productionEvents=[...new Set([...(source.productionEvents||[]),...(scene.productionEvents||[]).filter(x=>!String(x).startsWith('school-'))])];
  patch.productionPlacements={...copy(scene.productionPlacements||{}),...copy(source.productionPlacements||{})};
  patch.productionMotionOverrides={...copy(scene.productionMotionOverrides||{})};
  for(const key of Object.keys(patch.productionMotionOverrides))if(key.startsWith('school-'))delete patch.productionMotionOverrides[key];
  const replaced=new Set((scene.interactionInitialHold||[]).filter(h=>cast.has(h.actor)&&['flashlight','key','phone'].includes(scene.props?.[h.propIndex]?.kind)).map(h=>h.propIndex));
  patch.props=copy(source.props||[]);const indices=new Map();
  (scene.props||[]).forEach((p,i)=>{if(!replaced.has(i)){indices.set(i,patch.props.length);patch.props.push(copy(p));}});
  patch.interactionInitialHold=[...copy(source.interactionInitialHold||[]),...(scene.interactionInitialHold||[]).filter(h=>indices.has(h.propIndex)).map(h=>({...copy(h),propIndex:indices.get(h.propIndex)}))];
  patch.location='tpz-v3-'+source.location;
  if(!result.locations.some(l=>l.id===patch.location))result.locations.push({...copy(template.locations.find(l=>l.id===source.location)),id:patch.location});
  result.changes.push({episode:episode.id,id:scene.id,before:JSON.stringify(scene),patch});
 }
 return result;
}
function apply(state,review){
 if(JSON.stringify(state.locations||[])!==review.locationBefore)throw Error('ฉากหลังเปลี่ยนแล้ว กรุณาตรวจแผนอีกครั้ง');
 const changes=review.changes.map(item=>{const scene=state.episodes.find(e=>e.id===item.episode)?.scenes.find(s=>s.id===item.id);if(!scene||JSON.stringify(scene)!==item.before)throw Error('โปรเจกต์เปลี่ยนแล้ว กรุณาตรวจแผนอีกครั้ง');return {scene,item};});
 for(const loc of review.locations){const existing=state.locations?.find(l=>l.id===loc.id);if(existing&&JSON.stringify(existing)!==JSON.stringify(loc))throw Error('ฉากหลังรุ่นใหม่ถูกแก้ไว้แล้ว กรุณาเก็บงานนั้นก่อน');}
 state.locations=state.locations||[];
 for(const loc of review.locations)if(!state.locations.some(l=>l.id===loc.id))state.locations.push(copy(loc));
 for(const {scene,item}of changes){Object.assign(scene,copy(item.patch));for(const field of visual)if(scene[field]===null)delete scene[field];}
 return changes.length;
}
function append(state,template,prefix){
 if(!/^[a-zA-Z0-9_-]+$/.test(prefix))throw Error('รหัสตอนใหม่ไม่ถูกต้อง');
 const data=copy(template),map=new Map();
 for(const group of ['characters','locations','voiceProfiles','episodes'])for(const item of data[group]||[])map.set(item.id,prefix+'-'+item.id);
 for(const ep of data.episodes)for(const scene of ep.scenes)map.set(scene.id,prefix+'-'+scene.id);
 const existing=new Set(['characters','locations','voiceProfiles','episodes'].flatMap(k=>(state[k]||[]).map(x=>x.id)).concat((state.episodes||[]).flatMap(e=>e.scenes.map(s=>s.id))));
 if([...map.values()].some(id=>existing.has(id)))throw Error('รหัสซ้ำ กรุณาเพิ่มตอนใหม่อีกครั้ง');
 function remap(value){if(typeof value==='string')return map.get(value)||value;if(Array.isArray(value))return value.map(remap);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,remap(v)]));return value;}
 const fresh=remap(data);
 for(const group of ['characters','locations','voiceProfiles','episodes']){state[group]=state[group]||[];state[group].push(...fresh[group]);}
 return state.episodes.length-fresh.episodes.length;
}
return Object.freeze({plan,apply,append});
});
