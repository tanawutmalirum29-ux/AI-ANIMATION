#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ml=require('../studio-script-ml.js');
const doc=JSON.parse(fs.readFileSync(path.join(__dirname,'datasets/script-repeat-intent-demo-v3.json'),'utf8'));
const rows=doc.rows,groups=new Set(rows.map(x=>x.group)),labels=['remove','keep','review'];
assert.equal(rows.length,659);assert.equal(groups.size,91);
for(const label of labels)assert.ok(rows.filter(x=>x.label===label).length>=40);
const result=ml.trainIntent(rows);
assert.equal(result.trainRows,529);assert.equal(result.testRows,130);
assert.equal(result.holdoutAccuracy,1,'Synthetic grouped holdout regression');
assert.deepEqual(result.weights,ml.INTENT_MODEL.weights,'Browser weights differ from reproducible CPU SGD');
assert.deepEqual(result.bias,ml.INTENT_MODEL.bias,'Browser bias differs from reproducible SGD');
console.log(JSON.stringify({model:'thai-repetition-intent',training:'CPU SGD 3-way softmax',data:'659 assistant-authored synthetic rows; NOT human-approved',groupedHoldout:true,productionApproved:false,...result},null,2));
