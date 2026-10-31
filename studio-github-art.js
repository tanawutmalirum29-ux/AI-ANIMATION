/* Free GitHub-only Art Vault connector. Token stays in this tab's JS memory (never in repo,
 * localStorage, IndexedDB, project JSON or GitHub Actions logs). Scoped to one repo/file.
 * Users explicitly connect once per open tab and opt in to auto-publishing. */
(function(root,factory){
 const api=factory(root);
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.StoryGithubArt=api;
})(typeof window!=='undefined'?window:null,function(root){
 'use strict';
 const REPO='tanawutmalirum29-ux/AI-ANIMATION';
 const FILE='assets/library.json',BASE='https://api.github.com/repos/'+REPO;
 let secret='',busy=false,windowStart=0,submissions=0;
 function status(){return {connected:!!secret,busy,repository:REPO};}
 const basic={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
 async function api(path,method='GET',payload,token=secret){
  if(!token)throw Error('ยังไม่ได้เชื่อม GitHub ในแท็บนี้');
  if(!/^\/(?:git\/ref\/heads\/main|git\/refs|contents\/assets\/library\.json(?:\?ref=main)?|pulls|)$/.test(path))
   throw Error('ไม่อนุญาตให้เข้าถึง GitHub endpoint นี้');
  const res=await fetch(BASE+path,{method,headers:{...basic,Authorization:'Bearer '+token,
    ...(payload!==undefined?{'Content-Type':'application/json'}:{})},
    ...(payload!==undefined?{body:JSON.stringify(payload)}:{}),credentials:'omit',cache:'no-store'});
  let data;try{data=await res.json()}catch(e){data={}}
  if(!res.ok)throw Error('GitHub HTTP '+res.status+(res.status===403?' (สิทธิ์ไม่เพียงพอหรือชน rate limit)':''));
  return data;
 }
 async function connect(value){
  const next=String(value||'').trim();
  if(!/^(?:github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(next))throw Error('รูปแบบ GitHub fine-grained token ไม่ถูกต้อง');
  // Only verify repository permissions, never send tokens to the studio backend.
  const res=await fetch(BASE,{headers:{...basic,Authorization:'Bearer '+next},credentials:'omit',cache:'no-store'});
  if(!res.ok)throw Error('ตรวจ GitHub token ไม่สำเร็จ HTTP '+res.status);
  const info=await res.json();
  if(info.full_name!==REPO||!info.permissions?.push)throw Error('Token ไม่มีสิทธิ์เขียน repository นี้');
  secret=next;
  return status();
 }
 function disconnect(){secret='';return status();}
 function b64Encode(str){
  const data=new TextEncoder().encode(str);
  let raw='';for(let i=0;i<data.length;i+=8192)raw+=String.fromCharCode(...data.subarray(i,i+8192));
  return btoa(raw);
 }
 function b64Decode(str){
  const raw=atob(String(str).replace(/\s/g,'')),a=Uint8Array.from(raw,c=>c.charCodeAt(0));
  return new TextDecoder('utf-8',{fatal:true}).decode(a);
 }
 async function publish(input){
  if(!secret)throw Error('ต้องเชื่อม GitHub ก่อนส่งคลังรูป');
  if(busy)throw Error('กำลังส่งผลงานอีกชิ้นไป GitHub');
  const core=root?.StoryAssetCore;
  if(!core)throw Error('ไม่พบตัวตรวจรูปทรง');
  const asset=core.asset(input);
  const now=Date.now();
  if(now-windowStart>3600000){windowStart=now;submissions=0}
  if(submissions>=5)throw Error('จำกัด 5 Pull Requests ต่อชั่วโมง เพื่อป้องกันการส่งเกินจำเป็น');
  busy=true;
  try{
   const ref=await api('/git/ref/heads/main');
   const sha=ref.object?.sha;
   if(!/^[0-9a-f]{40}$/.test(sha||''))throw Error('อ่าน main branch ไม่สำเร็จ');
   const old=await api('/contents/'+FILE+'?ref=main');
   if(old.encoding!=='base64'||!old.sha)throw Error('อ่านไฟล์คลังรูปไม่ได้');
   const catalog=JSON.parse(b64Decode(old.content));
   if(catalog.version!==1||!Array.isArray(catalog.assets)||catalog.assets.length>=300)
     throw Error('คลัง GitHub เต็มหรือรูปแบบไม่ถูกต้อง');
   const sameName=a=>a&&typeof a.name==='string'&&a.name.trim().toLocaleLowerCase('th')===asset.name.toLocaleLowerCase('th');
   if(catalog.assets.some(sameName))return {alreadyExists:true,assetId:asset.id};
   if(catalog.assets.some(a=>a.id&&a.id===asset.id))throw Error('ID ของรูปซ้ำกับ GitHub');
   catalog.assets.push(asset);
   const branch='studio-art-'+now.toString(36)+'-'+Math.random().toString(36).slice(2,9);
   await api('/git/refs','POST',{ref:'refs/heads/'+branch,sha});
   await api('/contents/'+FILE,'PUT',{
     message:'art vault: '+asset.name,
     content:b64Encode(JSON.stringify(catalog,null,2)+'\n'),branch,sha:old.sha
   });
   const pr=await api('/pulls','POST',{
     title:'Art Vault: '+asset.name,head:branch,base:'main',
     body:'Art Vault: validated vector primitive asset; changes limited to assets/library.json. Automated asset-only QA runs before merge.'
   });
   if(!Number.isInteger(pr.number)||!new RegExp('^https://github\\.com/'+REPO.replace('/','\\/')+'/pull/\\d+$').test(pr.html_url||''))
     throw Error('GitHub ไม่ส่งลิงก์ PR ที่ถูกต้อง');
   submissions++;
   return {url:pr.html_url,number:pr.number,assetId:asset.id};
  }finally{busy=false}
 }
 return Object.freeze({connect,disconnect,status,publish});
});
