const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const {validateAppendOnly}=await import('../.github/scripts/validate-art-pr.mjs');
 const before=JSON.parse(fs.readFileSync('assets/library.json','utf8'));
 const example={version:1,id:'vault-test-asset',name:'ดาวตกห้องเรียน',category:'fx',
 description:'ประกอบฉาก',shapes:[{type:'circle',fill:'#123456',stroke:'none',strokeWidth:0,opacity:1,cx:50,cy:50,r:12}]};
 const after=structuredClone(before);after.assets.push(example);
 assert.equal(validateAppendOnly(before,after).id,example.id);
 const changed=structuredClone(after);changed.assets[0].name='ห้ามแก้ของเดิม';
 assert.throws(()=>validateAppendOnly(before,changed),/existing assets/);
 const extra=structuredClone(after);extra.hack=true;
 assert.throws(()=>validateAppendOnly(before,extra),/catalog keys/);
 const unsafe=structuredClone(after);unsafe.assets.at(-1).shapes[0].fill='url(javascript:evil)';
 assert.throws(()=>validateAppendOnly(before,unsafe),/invalid colors/);
 const redundant=structuredClone(after);redundant.assets.at(-1).id=before.assets[0].id;
 assert.throws(()=>validateAppendOnly(before,redundant),/duplicate id/);
 const script=structuredClone(after);script.assets.at(-1).shapes[0].onclick='alert(1)';
 assert.throws(()=>validateAppendOnly(before,script),/unexpected shape field/);
 console.log('PASS: trusted-branch PR validation blocks modifications and malicious SVG');
})().catch(e=>{console.error(e);process.exit(1)});
