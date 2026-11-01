'use strict';
// Own CPU-trained layout advisor for a private/authenticated AWS Lambda backend.
// No external model API, GPU, AWS SDK, or model execution on the user's phone.
// ALWAYS advisory; never changes a scene. Requires explicit model promotion.
const FEATURES=Object.freeze(['gapX','gapY','portrait','count','moving','interaction','locked','edge']);
const respond=(status,body)=>({
 statusCode:status,
 headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},
 body:JSON.stringify(body)
});
function usableModel(model){
 if(!model||model.schema!==1||model.task!=='layout-spacing'||
    model.status!=='approved'||model.active!==true||
    model.training?.mode!=='approved')return false;
 if(!Array.isArray(model.features)||model.features.join('|')!==FEATURES.join('|')||
    !Array.isArray(model.weights)||model.weights.length!==FEATURES.length||
    !model.weights.every(Number.isFinite)||!Number.isFinite(model.bias))return false;
 // Real holdout and an explicit improvement over the baseline are prerequisites.
 const t=model.training,score=t.model,baseline=t.baseline;
 return Number.isInteger(t.examples)&&t.examples>=35&&
  Number.isInteger(t.holdoutExamples)&&t.holdoutExamples>=15&&
  score&&baseline&&Number.isFinite(score.macroF1)&&score.macroF1>=.70&&
  Number.isFinite(baseline.macroF1)&&score.macroF1>=baseline.macroF1+.02&&
  Number.isFinite(score.accuracy)&&Number.isFinite(baseline.accuracy)&&
  score.accuracy>=baseline.accuracy;
}
function validateFeatures(value){
 if(!value||Array.isArray(value)||typeof value!=='object'||
    Object.keys(value).length!==FEATURES.length||
    FEATURES.some(k=>!Object.prototype.hasOwnProperty.call(value,k)||
     typeof value[k]!=='number'||!Number.isFinite(value[k])||value[k]<0||value[k]>1))return false;
 return true;
}
function predict(model,vector){
 const z=model.weights.reduce((a,w,i)=>a+w*vector[FEATURES[i]],model.bias);
 const probability=1/(1+Math.exp(-Math.max(-35,Math.min(35,z))));
 return {probabilitySeparate:Math.round(probability*10000)/10000,
         suggestion:probability>=.7?'review-separation':'no-automatic-change'};
}
async function handler(event={}){
 // Put this Lambda behind IAM/API Gateway authorization; never open an unauthenticated
 // public URL. Authentication is an infrastructure requirement, not implemented here.
 const method=event?.requestContext?.http?.method||event.httpMethod||'POST';
 if(method!=='POST')return respond(405,{error:'METHOD_NOT_ALLOWED'});
 let model;
 try{model=JSON.parse(process.env.AI_LAYOUT_MODEL_JSON||'null')}
 catch(_){return respond(503,{error:'NO_APPROVED_MODEL'})}
 if(!usableModel(model))return respond(503,{error:'NO_APPROVED_MODEL'});
 let body;
 try{
  if(typeof event.body==='string'){
   if(event.body.length>4096)return respond(413,{error:'PAYLOAD_TOO_LARGE'});
   body=JSON.parse(event.body);
  }else body=event.body;
 }catch(_){return respond(400,{error:'INVALID_JSON'})}
 if(!body||Array.isArray(body)||typeof body!=='object'||
    Object.keys(body).length!==1||!validateFeatures(body.features))
  return respond(422,{error:'INVALID_FEATURES'});
 return respond(200,{schema:1,modelTask:'layout-spacing',mode:'advisory',...predict(model,body.features)});
}
module.exports={handler,predict,usableModel,validateFeatures,FEATURES};
