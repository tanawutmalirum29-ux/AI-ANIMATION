#!/usr/bin/env node
'use strict';
// Retrains emotion + repeat-intent models on the combined multi-genre SYNTHETIC datasets.
// Usage: node train-script-ml-v3.cjs [--write]   (--write patches the shipped constants)
const fs=require('node:fs'),path=require('node:path');
const file=path.join(__dirname,'../studio-script-ml.js');
const ml=require(file);
const D=n=>JSON.parse(fs.readFileSync(path.join(__dirname,'datasets',n),'utf8'));
const emo=D('script-emotion-context-demo-v3.json').rows,int=D('script-repeat-intent-demo-v3.json').rows;
const em=ml.trainEmotion(emo),it=ml.trainIntent(int);
// Harder check: leave-one-genre-out for emotion (train excludes the genre entirely)
const genres=[...new Set(emo.map(r=>r.theme))].filter(g=>!/^multiscene|^night|^storm|^evacuation|^travel|^rescue|^family$|^work$|^school$|^weather|^harbor|^forest|^village$/.test(g)||false);
const newGenres=[...new Set(emo.filter(r=>r.group.startsWith('v3-')).map(r=>r.theme))];
let ok=0,n=0;const per={};
for(const g of newGenres){
 const train=emo.filter(r=>r.theme!==g),test=emo.filter(r=>r.theme===g);
 // reuse trainer with every train row in the train split: remap group so none is held out
 const tr=train.map(r=>({...r,group:'x-01'}));
 const m=ml.trainEmotion(tr.concat(test.map(r=>({...r,group:'x-05'}))));
 per[g]=m.syntheticAccuracy;ok+=m.correct;n+=m.testRows;
}
const lgo=ok/n;
const out={emotion:{trainRows:em.trainRows,testRows:em.testRows,groupedHoldout:em.syntheticAccuracy,leaveOneGenreOut:+lgo.toFixed(4),worstGenre:Object.entries(per).sort((a,b)=>a[1]-b[1])[0]},
 intent:{trainRows:it.trainRows,testRows:it.testRows,groupedHoldout:it.holdoutAccuracy}};
console.log(JSON.stringify(out,null,1));
if(process.argv.includes('--write')){
 let s=fs.readFileSync(file,'utf8');
 const fmt=a=>JSON.stringify(a);
 s=s.replace(/(const EMOTION_MODEL=Object\.freeze\(\{schema:2,task:'thai-scene-emotion',status:)'[^']*'(,\n labels:\[\.\.\.EMOTION_LABELS\],features:\[\.\.\.EMOTION_NAMES\],weights:)\[\[[\s\S]*?\]\],\n bias:\[[^\]]*\],trainRows:\d+,heldOutRows:\d+,syntheticHoldoutAccuracy:[\d.]+\}\)/,
  (m,a,b)=>`${a}'assistant-synthetic-demo-only'${b}${fmt(em.weights)},\n bias:${fmt(em.bias)},trainRows:${em.trainRows},heldOutRows:${em.testRows},syntheticHoldoutAccuracy:${em.syntheticAccuracy}})`);
 s=s.replace(/(const INTENT_MODEL=Object\.freeze\(\{schema:1,task:'thai-repetition-intent',status:'synthetic-demo-not-approved',\n features:\[\.\.\.INTENT_NAMES\],labels:\[\.\.\.INTENT_LABELS\],\n weights:)\[\[[\s\S]*?\]\],\n bias:\[[^\]]*\],trainRows:\d+,heldOutRows:\d+,assistantDemoAccuracy:[\d.]+\}\)/,
  (m,a)=>`${a}${fmt(it.weights)},\n bias:${fmt(it.bias)},trainRows:${it.trainRows},heldOutRows:${it.testRows},assistantDemoAccuracy:${it.holdoutAccuracy}})`);
 fs.writeFileSync(file,s);console.log('constants patched');
}
