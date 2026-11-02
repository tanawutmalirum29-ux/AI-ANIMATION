#!/usr/bin/env node
'use strict';
// Reproducible CPU training/evaluation. Synthetic examples are not owner approved.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ml=require('../studio-story-foundation.js');
const file=path.join(__dirname,'datasets/thai-narrative-editor-foundation-v1.json');
const data=JSON.parse(fs.readFileSync(file,'utf8'));
const verified=ml.validate(data),report=ml.evaluate(data);
const split=ml.splitByStory(data),trainGroups=new Set(split.train.map(x=>x.group)),
 testGroups=new Set(split.test.map(x=>x.group));
assert.equal(data.rows.length,75);
assert.equal(verified.groups,15);
assert.deepEqual(Object.values(verified.counts),[15,15,15,15,15]);
assert.equal([...testGroups].filter(x=>trainGroups.has(x)).length,0,
 'No story may appear in both training and holdout sets');
assert.equal(report.testRows,15);
const model=ml.fit(data.rows);
assert.equal(model.task,'thai-narrative-edit-diagnosis');
console.log(JSON.stringify({
 task:data.task,training:'CPU multinomial Naive Bayes, Thai character 2/3-grams',
 provenance:'assistant-authored synthetic foundation; NOT human approved',
 rows:verified.rows,storyGroups:verified.groups,labels:verified.counts,
 holdout:report,productionValidated:false,autoRewriteEnabled:false
},null,2));
