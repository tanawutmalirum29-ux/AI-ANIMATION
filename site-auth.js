/* Story Studio authenticated AI gateway. PUBLIC endpoint only; never store passwords in code. */
(function(root){
 'use strict';
 const apiUrl=String((root.STORY_STUDIO_CONFIG||{}).apiUrl||'').trim();
 const enabled=/^https:\/\/[^/?#]+(?:\/[^?#]*)?$/.test(apiUrl);
 const SESSION_KEY='storyStudio.session.v1';
 let token='',authorized=false,gate=null,busy=false;
 function clear(){token='';authorized=false;try{localStorage.removeItem(SESSION_KEY)}catch(e){}}
 function restore(){try{const saved=JSON.parse(localStorage.getItem(SESSION_KEY)||'null');if(saved&&typeof saved.token==='string'&&Number(saved.expiresAt)>Date.now()+30000)token=saved.token}catch(e){}}
 function setAuth(value){authorized=!!value;document.body.classList.toggle('access-locked',enabled&&!authorized);if(gate)gate.hidden=!enabled||authorized;root.dispatchEvent(new Event('story-studio-access-change'))}
 async function call(payload,authToken){
  if(!enabled)throw new Error('ยังไม่ได้ตั้งค่าบริการ AI บนเซิร์ฟเวอร์');
  const headers={'Content-Type':'application/json'};
  if(authToken)headers.Authorization='Bearer '+authToken;
  let response;try{response=await fetch(apiUrl,{method:'POST',headers,body:JSON.stringify(payload),cache:'no-store',credentials:'omit'})}
  catch(e){throw new Error('เชื่อมต่อบริการ AI ไม่ได้ กรุณาตรวจอินเทอร์เน็ตและตั้งค่า AWS')}
  let data;try{data=await response.json()}catch(e){throw new Error('เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ (HTTP '+response.status+')')}
  if(!response.ok){const err=new Error(String((data&&data.error)||('HTTP '+response.status)));err.status=response.status;throw err}
  return data;
 }
 function createGate(){
  if(gate)return;
  const css=document.createElement('style');css.textContent=[
   'body.access-locked{overflow:hidden!important}',
   '#siteAccessGate[hidden]{display:none!important}',
   '#siteAccessGate{position:fixed;inset:0;z-index:2147483645;display:grid;place-items:center;padding:24px;background:radial-gradient(ellipse at 40% 24%,#243d5f 0%,#0a1527 75%);overflow-y:auto;color:#f5ead8;font:15px/1.55 system-ui,"Noto Sans Thai",sans-serif}',
   '#siteAccessGate .access-card{width:min(440px,100%);padding:30px 24px;background:#15253d;border:1px solid #50617c;border-radius:18px;box-shadow:0 22px 90px #0009}',
   '#siteAccessGate h1{font-size:23px;margin:0 0 5px;color:#e5c88c}',
   '#siteAccessGate p{margin:0 0 18px;color:#bfd0df}',
   '#siteAccessGate label{display:block;margin:0 0 7px;font-size:14px;color:#f5ead8}',
   '#siteAccessGate input{display:block;width:100%;min-height:46px;padding:12px;font-size:16px;border-radius:10px}',
   '#siteAccessGate button{display:block;width:100%;margin-top:15px;min-height:44px;border:0;background:#e2c28c;color:#16233a;font-weight:750;font-size:16px}',
   '#siteAccessGate button:disabled{opacity:.6}',
   '#siteAccessGate .access-message{min-height:24px;margin:12px 0 0;color:#ffd9aa}',
   '#siteAccessGate small{display:block;margin-top:12px;color:#b6c7d7}',
   '@media(max-width:480px){#siteAccessGate{padding:14px}#siteAccessGate .access-card{padding:23px 18px}}'
  ].join('');
  document.head.append(css);
  gate=document.createElement('div');gate.id='siteAccessGate';gate.setAttribute('role','dialog');
  gate.setAttribute('aria-modal','true');gate.setAttribute('aria-labelledby','siteAccessTitle');
  const card=document.createElement('div');card.className='access-card';
  const title=document.createElement('h1');title.id='siteAccessTitle';title.textContent='Story Studio Director';
  const intro=document.createElement('p');intro.textContent='ใส่รหัสผ่านสตูดิโอครั้งเดียว เพื่อเข้าใช้งานและเปิดเครื่องมือพากย์ AI อัตโนมัติ';
  const form=document.createElement('form');form.autocomplete='on';
  const label=document.createElement('label');label.htmlFor='siteAccessPassword';label.textContent='รหัสผ่านสตูดิโอ';
  const input=document.createElement('input');input.id='siteAccessPassword';input.type='password';input.required=true;
  input.autocomplete='current-password';input.placeholder='รหัสผ่านที่ตั้งไว้ใน AWS';
  const button=document.createElement('button');button.type='submit';button.textContent='เข้าสู่สตูดิโอ';
  const status=document.createElement('p');status.className='access-message';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  form.append(label,input,button,status);card.append(title,intro,form);
  const foot=document.createElement('small');foot.textContent='ตรวจรหัสกับ AWS Lambda รหัสผ่านไม่ได้บันทึกในเบราว์เซอร์';card.append(foot);
  gate.append(card);document.body.append(gate);
  form.addEventListener('submit',async e=>{
   e.preventDefault();if(busy)return;busy=true;button.disabled=true;status.textContent='กำลังตรวจรหัสผ่าน...';
   try{
    const data=await call({action:'login',password:input.value});
    if(!data.token||!Number.isFinite(Number(data.expiresAt)))throw new Error('เซิร์ฟเวอร์ไม่ส่งข้อมูลเข้าสู่ระบบ');
    token=data.token;input.value='';
    try{localStorage.setItem(SESSION_KEY,JSON.stringify({token,expiresAt:Number(data.expiresAt)*1000}))}catch(e){}
    status.textContent='';setAuth(true);
   }catch(err){status.textContent=err.message;setAuth(false)}
   finally{busy=false;button.disabled=false}
  });
 }
 async function boot(){
  if(!enabled)return;
  createGate();restore();setAuth(false);
  if(token){try{await call({action:'verify'},token);setAuth(true);return}catch(e){clear()}}
  setAuth(false);
 }
 async function request(payload){
  if(!enabled)throw new Error('บริการ AI ยังไม่ได้ติดตั้ง');
  if(!authorized||!token){setAuth(false);throw new Error('กรุณาเข้าสู่สตูดิโอก่อนใช้ AI')}
  try{return await call(Object.assign({action:'synthesize'},payload),token)}
  catch(err){if(err.status===401||err.status===403){clear();setAuth(false);throw new Error('เซสชันหมดอายุ กรุณาใส่รหัสผ่านอีกครั้ง')}throw err}
 }
 function logout(){clear();setAuth(false)}
 root.StoryStudioAccess=Object.freeze({enabled,apiUrl,boot,request,logout,isReady:()=>authorized});
})(window);
