#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ml=require('../studio-script-ml.js');
const source=JSON.parse(fs.readFileSync(path.join(__dirname,'datasets/script-review-assistant-demo.json'),'utf8'));
assert.equal(source.rows.length,60);
assert.equal(new Set(source.rows.map(x=>x.group)).size,30);
assert.ok(source.rows.every(x=>x.label===0||x.label===1));
const result=ml.train(source.rows);
assert.equal(result.trainRows,48);
assert.equal(result.testRows,12);
assert.ok(result.accuracy>=0.9,'Pilot regressed; do not ship model');
assert.deepEqual(result.weights,ml.MODEL.weights,'Browser weights differ from SGD training');
assert.equal(result.bias,ml.MODEL.bias,'Browser bias differs from SGD training');
console.log(JSON.stringify({task:ml.MODEL.task,trainer:'CPU SGD',data:'assistant-authored only / demo, not human-approved',productionModel:false,...result},null,2));
