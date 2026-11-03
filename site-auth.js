/* Site access: GitHub OAuth S256 PKCE with AWS-verified RBAC.
 * Legacy password remains ONLY until the owner configures GitHub OAuth in AWS.
 * Never trust a username, role or identity supplied by the browser.
 */
(function(root){
 'use strict';
 const apiUrl=String((root.STORY_STUDIO_CONFIG||{}).apiUrl||'').trim();
 const enabled=/^https:\/\/[^/?#]+(?:\/[^?#]*)?$/.test(apiUrl);
 const SESSION_KEY='storyStudio.githubSession.v2',LEGACY_KEY='storyStudio.session.v1';
 const PKCE_KEY='storyStudio.githubPKCE.v1';
 let token='',authorized=false,profile=null,mode='loading',config=null;
 let gate=null,notice=null,authButton=null,guestButton=null,busy=false;
 function clear(){
  token='';profile=null;authorized=false;
  try{sessionStorage.removeItem(SESSION_KEY);localStorage.removeItem(LEGACY_KEY)}catch(_){}
 }
 function restore(){
  try{
   const key=mode==='github'?SESSION_KEY:LEGACY_KEY;
   const raw=mode==='github'?sessionStorage.getItem(key):localStorage.getItem(key);
   const saved=JSON.parse(raw||'null');
   if(saved&&typeof saved.token==='string'&&Number(saved.expiresAt)>Date.now()+30000)
    token=saved.token;
  }catch(_){}
 }
 function setAuth(p){
  profile=p||null;authorized=!!p;
  document.body.classList.toggle('access-admin',authorized&&profile.role==='admin');
  document.body.classList.toggle('access-member',authorized&&['member','guest'].includes(profile.role));
  document.body.classList.toggle('access-locked',enabled&&!authorized);
  if(gate)gate.hidden=authorized;
  if(authorized&&['member','guest'].includes(profile.role))root.StoryMemberPortal?.mount({
   profile,request,logout
  });
  else root.StoryMemberPortal?.hide?.();
  root.dispatchEvent(new Event('story-studio-access-change'));
 }
 async function call(payload,authToken){
  if(!enabled)throw Error('ยังไม่ได้ตั้งค่า AWS API');
  const headers={'Content-Type':'application/json'};
  if(authToken)headers.Authorization='Bearer '+authToken;
  let res;
  try{res=await fetch(apiUrl,{method:'POST',headers,
   body:JSON.stringify(payload),cache:'no-store',credentials:'omit'})}
  catch(_){throw Error('เชื่อม AWS ไม่ได้ กรุณาตรวจเครือข่าย')}
  let data;
  try{data=await res.json()}catch(_){throw Error('AWS ส่งข้อมูลผิดรูปแบบ HTTP '+res.status)}
  if(!res.ok){
   const err=Error(String(data?.error||'HTTP '+res.status));
   err.status=res.status;throw err;
  }
  return data;
 }
 function createGate(){
  if(gate)return;
  const style=document.createElement('style');
  style.textContent=[
   'body.access-locked{overflow:hidden!important}',
   '#siteAccessGate[hidden]{display:none!important}',
   '#siteAccessGate{position:fixed;inset:0;z-index:2147483645;display:grid;place-items:center;padding:16px;background:radial-gradient(ellipse at 30% 10%,#243d59,#081222 78%);color:#fff;font:15px/1.5 system-ui,"Noto Sans Thai",sans-serif}',
   '#siteAccessGate .access-card{width:min(440px,100%);padding:26px;background:#152339;border:1px solid #526784;border-radius:16px}',
   '#siteAccessGate h1{font-size:24px;color:#efd3a0;margin:0 0 10px}',
   '#siteAccessGate p{color:#ccd8e8}',
   '#siteAccessGate input{width:100%;padding:13px;font-size:16px;box-sizing:border-box}',
   '#siteAccessGate button{display:block;width:100%;padding:14px;font:inherit;font-weight:700;margin:12px 0;background:#e9c586;color:#152138;border:0;border-radius:8px;min-height:48px}',
   '#siteAccessGate button:disabled{opacity:.5}',
   '#siteAccessGate .access-message{min-height:28px;color:#ffcfbd}',
   'body.access-member> :not(#storyMemberPortal):not(script):not(#siteAccessGate){visibility:hidden!important}',
   'body.access-locked> :not(#siteAccessGate):not(script){visibility:hidden!important}'
  ].join('');
  document.head.append(style);
  gate=document.createElement('div');gate.id='siteAccessGate';gate.setAttribute('role','dialog');
  gate.setAttribute('aria-modal','true');
  const card=document.createElement('div');card.className='access-card';
  const title=document.createElement('h1');title.textContent='AI-ANIMATION';
  const intro=document.createElement('p');intro.textContent='เข้าสู่ระบบอย่างปลอดภัย';
  authButton=document.createElement('button');authButton.type='button';
  authButton.textContent='กำลังตรวจระบบเข้าสู่ระบบ...';
  authButton.disabled=true;
  guestButton=document.createElement('button');guestButton.type='button';
  guestButton.textContent='เข้าใช้ชั่วคราว (ไม่ต้องมี GitHub)';
  guestButton.hidden=true;guestButton.disabled=true;
  notice=document.createElement('p');notice.className='access-message';notice.setAttribute('role','status');
  card.append(title,intro,authButton,guestButton,notice);gate.append(card);document.body.append(gate);
 }
 function status(text){if(notice)notice.textContent=text}
 function legacyGate(){
  if(!gate)return;
  const card=gate.firstChild;
  const label=document.createElement('label');label.textContent='รหัสผ่านเว็บไซต์เดิม (รอเปิด GitHub OAuth)';
  const field=document.createElement('input');field.id='siteAccessPassword';field.type='password';field.autocomplete='current-password';
  field.placeholder='รหัสผ่านเว็บไซต์';
  card.insertBefore(label,authButton);card.insertBefore(field,authButton);
  authButton.textContent='เข้าสู่ระบบด้วยรหัสผ่านเดิม';
  authButton.disabled=false;
  authButton.onclick=async()=>{
   if(busy)return;busy=true;authButton.disabled=true;status('กำลังตรวจ...');
   try{
    const info=await call({action:'login',password:field.value});
    token=info.token;field.value='';
    localStorage.setItem(LEGACY_KEY,JSON.stringify({token,expiresAt:info.expiresAt*1000}));
    setAuth({id:0,login:'legacy-admin',role:'admin'});status('');
   }catch(e){status(e.message);setAuth(null)}
   finally{busy=false;authButton.disabled=false}
  };
 }
 function randomUrlToken(bytes){
  const arr=crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...arr)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
 }
 async function githubLogin(){
  if(busy)return;
  if(!root.crypto?.subtle||!root.crypto?.getRandomValues)throw Error('เบราว์เซอร์ไม่รองรับ OAuth PKCE');
  const state=randomUrlToken(24),verifier=randomUrlToken(48);
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
  const challenge=btoa(String.fromCharCode(...new Uint8Array(hash)))
   .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  sessionStorage.setItem(PKCE_KEY,JSON.stringify({state,verifier,created:Date.now()}));
  const uri=new URL('https://github.com/login/oauth/authorize');
  uri.searchParams.set('client_id',config.clientId);
  uri.searchParams.set('redirect_uri',config.redirectUri);
  uri.searchParams.set('state',state);
  uri.searchParams.set('code_challenge',challenge);
  uri.searchParams.set('code_challenge_method','S256');
  root.location.assign(uri.toString());
 }
 async function guestLogin(){
  if(busy)return;
  busy=true;guestButton.disabled=true;status('กำลังสร้างเซสชันชั่วคราว...');
  try{
   const info=await call({action:'auth.guest.start'});
   if(!info?.token||info.user?.role!=='guest')throw Error('AWS ไม่ยืนยันผู้เยี่ยมชม');
   token=info.token;
   sessionStorage.setItem(SESSION_KEY,JSON.stringify({
    token,expiresAt:info.expiresAt*1000}));
   setAuth(info.user);status('');
  }catch(e){status(e.message)}
  finally{busy=false;guestButton.disabled=false}
 }
 async function handleCallback(){
  const url=new URL(root.location.href);
  const code=url.searchParams.get('code'),state=url.searchParams.get('state');
  const denied=url.searchParams.get('error');
  if(!code&&!denied)return false;
  // Strip one-time OAuth code immediately, before any other page operations.
  url.searchParams.delete('code');url.searchParams.delete('state');
  url.searchParams.delete('error');url.searchParams.delete('error_description');
  root.history.replaceState(null,'',url.pathname+url.search+url.hash);
  if(denied)throw Error('GitHub ไม่อนุญาตการเชื่อมต่อ');
  let pkce=null;
  try{pkce=JSON.parse(sessionStorage.getItem(PKCE_KEY)||'null')}catch(_){}
  sessionStorage.removeItem(PKCE_KEY);
  if(!pkce||!state||pkce.state!==state||Date.now()-pkce.created>600000)
   throw Error('OAuth state ไม่ตรงกัน กรุณาเข้าสู่ระบบใหม่');
  const data=await call({action:'auth.github.exchange',code,codeVerifier:pkce.verifier});
  if(!data.token||!data.user||!['admin','member'].includes(data.user.role))
   throw Error('AWS ไม่ยืนยันข้อมูลบัญชี GitHub');
  token=data.token;
  sessionStorage.setItem(SESSION_KEY,JSON.stringify({token,expiresAt:data.expiresAt*1000}));
  setAuth(data.user);return true;
 }
 async function boot(){
  if(!enabled)return;
  createGate();setAuth(null);
  try{
   config=await call({action:'auth.config'});
   mode=config?.mode==='github'?'github':'legacy-password';
   if(mode==='github'){
    authButton.textContent='เข้าสู่ระบบด้วย GitHub';
    authButton.disabled=false;
    authButton.onclick=()=>githubLogin().catch(e=>status(e.message));
    guestButton.hidden=config.guestEnabled!==true;
    guestButton.disabled=!config.guestEnabled;
    guestButton.onclick=()=>guestLogin().catch(e=>status(e.message));
    try{if(await handleCallback())return}catch(e){status(e.message)}
    restore();
    if(token){
     try{const d=await call({action:'verify'},token);if(d.user){setAuth(d.user);return}}
     catch(_){clear()}
    }
   }else{
    restore();
    if(token){
     try{await call({action:'verify'},token);
      setAuth({id:0,login:'legacy-admin',role:'admin'});return}
     catch(_){clear()}
    }
    legacyGate();
   }
  }catch(e){
   mode='unavailable';authButton.disabled=true;
   status('ตรวจระบบล็อกอินไม่ได้: '+e.message+' · ปิดการเข้าใช้งานไว้เพื่อความปลอดภัย');
  }
 }
 async function request(payload){
  if(!authorized||!token)throw Error('กรุณาเข้าสู่ระบบก่อน');
  try{return await call(Object.assign({action:'synthesize'},payload),token)}
  catch(e){
   if(e.status===401){clear();setAuth(null);throw Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่')}
   throw e;
  }
 }
 function logout(){clear();setAuth(null)}
 root.StoryStudioAccess=Object.freeze({enabled,apiUrl,boot,request,logout,
  isReady:()=>authorized,isAdmin:()=>authorized&&profile?.role==='admin',
  user:()=>profile?{...profile}:null,authMode:()=>mode});
})(window);
