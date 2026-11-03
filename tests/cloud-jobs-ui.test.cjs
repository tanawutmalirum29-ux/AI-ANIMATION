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


test('large projects are sent in immutable 16-scene chunks and resume after dropped connection',async()=>{
 const {webcrypto}=require('node:crypto');
 const code=source.slice(source.indexOf('async function startUploaded('),
   source.indexOf('async function teach(fallback)'));
 assert.match(code,/teacher\.job\.upload\.prepare/);
 assert.match(code,/teacher\.job\.upload\.chunk/);
 assert.match(code,/teacher\.job\.upload\.commit/);
 const scenes=Array.from({length:293},(_,i)=>({id:'s'+i,
  text:'คืนที่ฝนตกหนัก'.repeat(70),episodeId:'ep'+Math.floor(i/12),
  previous:'ก่อนหน้า',next:'ถัดไป',studentIssue:'keep'}));
 const uploaded=new Map(),counts={prepare:0,chunk:0,commit:0};
 let drop=true,started=false,firstUploadId='';
 async function api(data){
  const action=data.action.split('.').pop();
  if(action==='prepare'){
   counts.prepare++;
   if(firstUploadId)assert.equal(data.uploadId,firstUploadId,
    'same source must produce stable id after network loss');
   firstUploadId=data.uploadId;
   return {chunkSize:16,partCount:19,uploadedParts:[...uploaded.keys()]};
  }
  if(action==='chunk'){
   counts.chunk++;
   if(drop&&data.partIndex===5){drop=false;throw Error('network disconnected')}
   assert.ok(data.scenes.length<=16);
   if(uploaded.has(data.partIndex))throw Error('should not resend uploaded chunks');
   uploaded.set(data.partIndex,data.scenes);
   return {partIndex:data.partIndex};
  }
  if(action==='commit'){
   counts.commit++;
   assert.equal(uploaded.size,19,'must not start until all chunks received');
   started=true;
   return {job:{jobId:'safe',total:293}};
  }
  throw Error('unexpected action '+data.action);
 }
 const root={TextEncoder,crypto:webcrypto},
  adapter={provider:'gemini'},
  repaint=()=>{};
 const compile=new Function('root','request','adapter','repaint',
   'let uploadState=null;'+code+';return startUploaded;');
 // Reassignment of uploadState is scoped to the evaluated helper, not local storage.
 const start=compile(root,api,adapter,repaint);
 await assert.rejects(start('story293',scenes),/network disconnected/);
 assert.equal(counts.commit,0,'AI must not start on partial upload');
 assert.equal(uploaded.size,5);
 const result=await start('story293',scenes);
 assert.equal(result.job.total,293);
 assert.equal(started,true);
 assert.equal(counts.prepare,2);
 assert.equal(counts.chunk,20,'5 original + dropped + 14 remaining');
 assert.equal(counts.commit,1);
 assert.doesNotMatch(code,/localStorage|sessionStorage/);
});
