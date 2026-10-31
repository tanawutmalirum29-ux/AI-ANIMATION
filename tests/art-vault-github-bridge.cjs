const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../studio-asset-core.js');
const source=fs.readFileSync('studio-github-art.js','utf8');
const lib=JSON.parse(fs.readFileSync('assets/library.json','utf8'));
const apiUrl='https://api.github.com/repos/tanawutmalirum29-ux/AI-ANIMATION';
const observed=[];
function response(body,status=200){return {ok:status>=200&&status<300,status,json:async()=>body}}
function encode(s){return Buffer.from(s).toString('base64')}
const fakeFetch=async(url,opt={})=>{
 const path=url.replace(apiUrl,'');observed.push({path,opt});
 if(path==='')return response({full_name:'tanawutmalirum29-ux/AI-ANIMATION',permissions:{push:true}});
 if(path==='/git/ref/heads/main')return response({object:{sha:'a'.repeat(40)}});
 if(path==='/contents/assets/library.json?ref=main')return response({encoding:'base64',sha:'b'.repeat(40),content:encode(JSON.stringify(lib))});
 if(path==='/git/refs')return response({});
 if(path==='/contents/assets/library.json')return response({content:{sha:'c'.repeat(40)}});
 if(path==='/pulls')return response({number:42,html_url:'https://github.com/tanawutmalirum29-ux/AI-ANIMATION/pull/42'});
 return response({message:'forbidden'},403);
};
const root={StoryAssetCore:core};
vm.runInNewContext(source,{window:root,fetch:fakeFetch,TextEncoder,TextDecoder,Uint8Array,
 btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),
 Date,Math,JSON,RegExp,Error});
const bridge=root.StoryGithubArt;
(async()=>{
 assert.equal(bridge.status().connected,false);
 await assert.rejects(()=>bridge.connect('bad-token'),/รูปแบบ/);
 await bridge.connect('github_pat_'+'X'.repeat(30));
 assert.equal(bridge.status().connected,true);
 const proposal=core.asset({id:'vault-new-bridge',name:'ม้านั่งสตูดิโอ',category:'prop',
   description:'ทดสอบ',shapes:[{type:'rect',x:10,y:50,w:80,h:20,fill:'#aaaaaa'}]});
 const res=await bridge.publish(proposal);
 assert.equal(res.number,42);
 assert.equal(res.url,'https://github.com/tanawutmalirum29-ux/AI-ANIMATION/pull/42');
 const mutation=observed.find(x=>x.path==='/contents/assets/library.json'&&x.opt.method==='PUT');
 assert.ok(mutation);
 const contents=JSON.parse(Buffer.from(JSON.parse(mutation.opt.body).content,'base64').toString('utf8'));
 assert.equal(contents.assets.length,lib.assets.length+1);
 assert.equal(contents.assets.at(-1).name,proposal.name);
 assert.ok(observed.every(x=>x.opt.headers.Authorization?.includes('github_pat_')));
 bridge.disconnect();assert.equal(bridge.status().connected,false);
 await assert.rejects(()=>bridge.publish(proposal),/เชื่อม/);
 console.log('PASS: browser GitHub scoped authorization, asset PR, UTF-8 encoding, no persisted token');
})().catch(e=>{console.error(e);process.exit(1)});
