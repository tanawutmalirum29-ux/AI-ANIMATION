'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{inspect}=require('../cloud-export/render-qa.cjs');
const {encodeMP4}=require('../cloud-export/transcode.cjs');
test('decoded QA detects black/frozen output, missing audio and wrong frame rate',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cine-qa-')),file=path.join(dir,'broken.mp4');
 try{execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=black:s=96x160:r=10:d=3','-c:v','libx264','-pix_fmt','yuv420p',file]);const r=inspect(file,{expectedAudio:true,expectedFps:30,scenes:[{id:'bad-scene',duration:3}]});for(const code of ['near-black','possible-freeze','audio-missing','frame-rate'])assert.ok(r.issues.some(i=>i.code===code),code);assert.equal(r.issues[0].scene,'bad-scene');assert.equal(r.semanticModel,false);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('shared cloud encoder removes only the padding beyond the rendered timeline',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cine-padding-')),source=path.join(dir,'padded.webm'),file=path.join(dir,'result.mp4');
 try{
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=s=96x160:r=30:d=2','-f','lavfi','-i','sine=frequency=440:duration=2','-af','apad=pad_dur=3','-c:v','libvpx-vp9','-c:a','libopus',source]);
  assert.ok(inspect(source,{expectedDuration:2}).issues.some(i=>i.code==='timeline-duration'),'unbounded silent tail is reported');
  encodeMP4(source,file,{expectedDuration:2,expectedFps:30,expectedAudio:true,timeout:30000});
  const report=inspect(file,{expectedDuration:2,expectedFps:30,expectedAudio:true,expectedAspect:96/160});
  assert.deepEqual(report.issues.filter(i=>i.severity==='error'),[]);assert.ok(Math.abs(report.duration-2)<.1);assert.ok(report.audio.maxVolumeDB> -30);
  assert.deepEqual(report.audio.silenceStarts,[],'audible content remains through the end');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('silent audio is rejected, rather than reporting merely that a stream exists',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cine-silent-')),file=path.join(dir,'silent.mp4');
 try{execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=blue:s=96x160:r=30:d=2','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-shortest','-c:v','libx264','-c:a','aac',file]);const r=inspect(file,{expectedAudio:true});assert.ok(r.audio.present);assert.ok(r.issues.some(i=>i.code==='audio-silent'));}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
