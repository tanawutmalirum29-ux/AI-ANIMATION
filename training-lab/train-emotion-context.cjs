#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ml=require('../studio-script-ml.js');
const data=JSON.parse(fs.readFileSync(path.join(__dirname,'datasets/script-emotion-context-demo-v3.json'),'utf8'));
const rows=data.rows;
assert.equal(rows.length,933);
assert.equal(new Set(rows.map(x=>x.group)).size,147);
for(const label of ml.EMOTION_LABELS)assert.ok(rows.filter(x=>x.label===label).length>=96);
const model=ml.trainEmotion(rows);
assert.equal(model.trainRows,749);
assert.equal(model.testRows,184);
assert.ok(model.syntheticAccuracy>=.95,'Synthetic grouped holdout failed; do not publish');
assert.deepEqual(model.weights,ml.EMOTION_MODEL.weights,'Shipped emotion weights do not match CPU training');
assert.deepEqual(model.bias,ml.EMOTION_MODEL.bias,'Shipped bias does not match CPU training');
console.log(JSON.stringify({task:ml.EMOTION_MODEL.task,algorithm:'CPU SGD multinomial softmax',
 data:'933 ASSISTANT-AUTHORED synthetic scenes; never approved user data',
 validation:'184 grouped synthetic holdouts, not independent real-world accuracy',
 trained:749,productionApproved:false,...model},null,2));
