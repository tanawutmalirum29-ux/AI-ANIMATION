'use strict';
// Usage: node scripts/analyze-video-reference.cjs input.mp4 output.json
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const Ref=require('../studio-video-reference.js');
const input=process.argv[2],output=process.argv[3];
if(!input||!output)throw Error('Usage: input.mp4 output.json');
const meta=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',input],{encoding:'utf8'}));
const v=meta.streams.find(s=>s.codec_type==='video'),duration=Number(meta.format.duration);
if(!v||duration>180)throw Error('Requires a video <=180 seconds');
const frames=execFileSync('ffmpeg',['-v','error','-i',input,'-vf','fps=2,scale=48:48,format=gray','-an','-f','rawvideo','-'],{maxBuffer:4*1024*1024}),size=48*48,samples=[];let previous;
for(let offset=0;offset+size<=frames.length;offset+=size){const frame=frames.subarray(offset,offset+size);samples.push({time:offset/size/2,delta:+Ref.difference(frame,previous).toFixed(4),luma:+(frame.reduce((s,v)=>s+v,0)/size/255).toFixed(4)});previous=frame;}
const blueprint=Ref.blueprint(samples,duration,{filename:path.basename(input),width:v.width,height:v.height,fps:v.r_frame_rate,audioPresent:meta.streams.some(s=>s.codec_type==='audio'),sampleInterval:.5,sha256:crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex')});
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(blueprint,null,2)+'\n');console.log(`${blueprint.filename}: ${duration.toFixed(2)}s, ${blueprint.shots.length} candidate shots`);
