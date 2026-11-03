'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'studio-cloud-teach.js'),'utf8');
const core=fs.readFileSync(path.join(root,'studio-auto-teach.js'),'utf8');
const lambda=fs.readFileSync(path.join(root,'autodub/handler.py'),'utf8');
const workflow=fs.readFileSync(path.join(root,'.github/workflows/deploy-aws-studio.yml'),'utf8');
const bootstrap=fs.readFileSync(path.join(root,'autodub/setup-cloud-jobs.sh'),'utf8');
test('cloud controls are authoritative and resume after app reopens',()=>{
 for(const action of ['teacher.job.start','teacher.job.status','teacher.job.find',
  'teacher.job.results','teacher.job.config'])
  assert.ok(source.includes(action),action);
 for(const action of ["'pause'","'resume'","'cancel'"])
  assert.ok(source.includes(action),action);
 assert.match(source,/visibilitychange/);
 assert.match(source,/addEventListener\('online'/);
 assert.match(source,/adapter\.applyLessons/);
 assert.doesNotMatch(source,/localStorage\.setItem/);
});
test('existing in-browser logic remains as a fallback with separate cloud controller',()=>{
 assert.match(core,/async function teachLocal/);
 assert.match(core,/StoryCloudTeach\.teach/);
 assert.match(core,/StoryCloudTeach\?\.decorate/);
 assert.match(core,/function mount/);
 assert.match(core,/function downloadCompletedStory/);
});
test('server rejects member cloud commands and uses direct worker event',()=>{
 assert.match(lambda,/if action\.startswith\("teacher\.job\."\)/);
 assert.match(lambda,/not oauth_mode or not user or user\.get\("role"\) != "admin"/);
 assert.match(lambda,/event\.get\("cloudJobWorker"\) is True/);
 assert.match(workflow,/autodub\/cloud_jobs\.py/);
});
test('one-time provisioning preserves existing settings and waits without running lambda',()=>{
 assert.match(bootstrap,/aws stepfunctions create-state-machine/);
 assert.match(bootstrap,/SecondsPath/);
 assert.match(bootstrap,/get-function-configuration/);
 assert.match(bootstrap,/TEACHER_JOB_STATE_MACHINE_ARN/);
 assert.doesNotMatch(bootstrap,/delete-table|delete-parameter|secretKey/);
});
