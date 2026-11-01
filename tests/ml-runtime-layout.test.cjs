'use strict';
const assert=require('node:assert/strict');
const {handler,usableModel,FEATURES}=require('../ml-runtime/layout-handler.cjs');
const original=process.env.AI_LAYOUT_MODEL_JSON;
const features={gapX:.12,gapY:.05,portrait:1,count:.25,moving:0,interaction:0,locked:0,edge:.4};
// MOCK ONLY: this test fixture is not a promoted or real trained model.
const mockedApproved={
 schema:1,task:'layout-spacing',features:FEATURES.slice(),
 weights:[-12,-2,0,0,0,0,0,0],bias:2.8,
 status:'approved',active:true,
 training:{mode:'approved',examples:100,holdoutExamples:25,
 model:{macroF1:.85,accuracy:.9},
 baseline:{macroF1:.72,accuracy:.8}}
};
async function call(body,event={}){
 const result=await handler({httpMethod:'POST',body:JSON.stringify(body),...event});
 return {code:result.statusCode,json:JSON.parse(result.body),headers:result.headers};
}
(async()=>{
 try{
  delete process.env.AI_LAYOUT_MODEL_JSON;
  assert.equal((await call({features})).code,503,'no approved weights must fail closed');
  process.env.AI_LAYOUT_MODEL_JSON=JSON.stringify({...mockedApproved,status:'demo-only',active:false});
  assert.equal((await call({features})).code,503,'demo output cannot serve');
  process.env.AI_LAYOUT_MODEL_JSON=JSON.stringify({...mockedApproved,status:'candidate-review',active:false});
  assert.equal((await call({features})).code,503,'unreviewed candidate cannot serve');
  process.env.AI_LAYOUT_MODEL_JSON=JSON.stringify({...mockedApproved,
   training:{...mockedApproved.training,model:{macroF1:.69,accuracy:.9}}});
  assert.equal((await call({features})).code,503,'weak approved artifact cannot serve');
  process.env.AI_LAYOUT_MODEL_JSON=JSON.stringify(mockedApproved);
  assert.equal(usableModel(mockedApproved),true);
  const good=await call({features});
  assert.equal(good.code,200);
  assert.equal(good.json.mode,'advisory');
  assert.equal(good.json.suggestion,'review-separation');
  assert.ok(good.json.probabilitySeparate>.7);
  assert.equal((await call({features:{...features,gapX:5}})).code,422);
  assert.equal((await call({features:{...features,notes:'private story'}})).code,422);
  assert.equal((await call({features}, {httpMethod:'GET'})).code,405);
  assert.equal((await handler({httpMethod:'POST',body:'{malformed'})).statusCode,400);
  assert.equal((await handler({httpMethod:'POST',body:'x'.repeat(4097)})).statusCode,413);
  assert.ok(!good.headers['Access-Control-Allow-Origin'],'never imply public CORS access');
  console.log('PASS: Lambda CPU inference rejects demo/candidate, validates input, and returns advisory-only predictions');
 }finally{
  if(original===undefined)delete process.env.AI_LAYOUT_MODEL_JSON;
  else process.env.AI_LAYOUT_MODEL_JSON=original;
 }
})().catch(err=>{console.error(err);process.exitCode=1});
