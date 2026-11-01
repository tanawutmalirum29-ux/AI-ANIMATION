'use strict';
const assert=require('node:assert/strict');
const {probeAudio,requireAudio,hasMp4Audio,hasWebmAudio}=require('../studio-export-integrity.js');
const hdlr=kind=>{const b=Buffer.alloc(32);b.writeUInt32BE(b.length,0);b.write('hdlr',4);b.write(kind,16);return b};
(async()=>{
 const silent=Buffer.concat([Buffer.from('000000206d6f6f76','hex'),hdlr('vide'),Buffer.alloc(64)]);
 const voiced=Buffer.concat([silent,hdlr('soun')]);
 assert.equal(hasMp4Audio(silent),false,'video-only MP4 must be rejected');
 assert.equal(hasMp4Audio(voiced),true,'MP4 soun handler must be recognized');
 assert.equal(await probeAudio(new Blob([silent]),'mp4'),false,'silent MP4 has no audio track');
 assert.equal(await probeAudio(new Blob([voiced]),'mp4'),true,'MP4 with audio track passes');
 assert.equal(await probeAudio(new Blob([Buffer.from('webm A_OPUS audio'),Buffer.alloc(64)]),'webm'),true,'WebM Opus track passes');
 assert.equal(hasWebmAudio(Buffer.from('webm video only')),false,'WebM video only rejected');
 // Faststart (moov at beginning) and regular MP4 (moov at end) both need coverage.
 const tail=new Blob([Buffer.alloc(2*1024*1024+10),voiced]);
 assert.equal(await probeAudio(tail,'mp4'),true,'moov at file tail must be checked');
 await assert.rejects(requireAudio(new Blob([silent]),'mp4'),/ไม่มีแทร็กเสียงจริง/);
 assert.equal(await requireAudio(new Blob([voiced]),'mp4'),true);
 console.log('PASS audio-track integrity: MP4 and WebM video-only exports are blocked');
})().catch(e=>{console.error(e);process.exitCode=1});
