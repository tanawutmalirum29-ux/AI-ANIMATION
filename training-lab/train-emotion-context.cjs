#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ml=require('../studio-script-ml.js');
const data=JSON.parse(fs.readFileSync(path.join(__dirname,'datasets/script-emotion-context-demo-v1.json'),'utf8'));
const rows=data.rows;
assert.equal(rows.length,576);
assert.equal(new Set(rows.map(x=>x.group)).size,96);
for(const label of ml.EMOTION_LABELS)assert.equal(rows.filter(x=>x.label===label).length,96);
const model=ml.trainEmotion(rows);
assert.equal(model.trainRows,462);
assert.equal(model.testRows,114);
assert.ok(model.syntheticAccuracy>=.95,'Synthetic grouped holdout failed; do not publish');
assert.deepEqual(model.weights,ml.EMOTION_MODEL.weights,'Shipped emotion weights do not match CPU training');
assert.deepEqual(model.bias,ml.EMOTION_MODEL.bias,'Shipped bias does not match CPU training');
console.log(JSON.stringify({task:ml.EMOTION_MODEL.task,algorithm:'CPU SGD multinomial softmax',
 data:'576 ASSISTANT-AUTHORED synthetic scenes; never approved user data',
 validation:'114 grouped synthetic holdouts, not independent real-world accuracy',
 trained:462,productionApproved:false,...model},null,2));
