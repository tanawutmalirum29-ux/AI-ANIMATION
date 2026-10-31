/* GitHub Actions trusted-base validator: approve only one appended vector asset.
 * This code runs from default branch, not from PR, and executes no PR code. */
import {pathToFileURL} from 'node:url';
const REPO='tanawutmalirum29-ux/AI-ANIMATION';
const cats=new Set(['prop','decor','nature','architecture','fx']);
const kinds=new Set(['rect','circle','ellipse','line','polygon']);
const hex=/^#[0-9a-fA-F]{6}$/;
function assert(condition,message){if(!condition)throw Error(message);}
function scalar(value,min,max){return typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max}
function validateOne(asset){
 assert(asset&&typeof asset==='object'&&!Array.isArray(asset),'asset must be object');
 assert(Object.keys(asset).every(k=>['id','version','name','category','description','shapes'].includes(k)),'unexpected asset key');
 assert(asset.version===1,'invalid asset version');
 assert(typeof asset.id==='string'&&/^[a-z0-9-]{3,80}$/.test(asset.id),'invalid id');
 assert(typeof asset.name==='string'&&asset.name.trim().length>=2&&asset.name.length<=64,'invalid name');
 assert(cats.has(asset.category),'invalid category');
 assert(typeof asset.description==='string'&&asset.description.length<=180,'invalid description');
 assert(Array.isArray(asset.shapes)&&asset.shapes.length>=1&&asset.shapes.length<=60,'invalid shapes');
 for(const s of asset.shapes){
  assert(s&&typeof s==='object'&&!Array.isArray(s)&&kinds.has(s.type),'invalid shape type');
  const allowed=['type','fill','stroke','strokeWidth','opacity'];
  if(s.type==='rect')allowed.push('x','y','w','h','rx');
  if(s.type==='circle')allowed.push('cx','cy','r');
  if(s.type==='ellipse')allowed.push('cx','cy','rx','ry');
  if(s.type==='line')allowed.push('x1','y1','x2','y2');
  if(s.type==='polygon')allowed.push('points');
  assert(Object.keys(s).every(k=>allowed.includes(k)),'unexpected shape field');
  assert(hex.test(s.fill)&& (s.stroke==='none'||hex.test(s.stroke)),'invalid colors');
  assert(scalar(s.opacity,0,1)&&scalar(s.strokeWidth,0,12),'invalid stroke/opacity');
  for(const k of ['x','y','cx','cy','x1','y1','x2','y2','w','h','r','rx','ry']){
   if(Object.hasOwn(s,k))assert(scalar(s[k],0,100)&&( ['w','h','r'].includes(k)?s[k]>=0.1:true),'invalid shape geometry');
  }
  if(s.type==='polygon'){
   assert(Array.isArray(s.points)&&s.points.length>=3&&s.points.length<=30,'invalid polygon');
   assert(s.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>scalar(n,0,100))),'invalid polygon coordinates');
  }
 }
}
export function validateAppendOnly(before,after){
 assert(before?.version===1&&after?.version===1,'catalog version cannot change');
 assert(before&&after&&Object.keys(before).length===2&&Object.keys(after).length===2,'catalog keys cannot change');
 assert(Array.isArray(before.assets)&&Array.isArray(after.assets),'assets must be arrays');
 assert(before.assets.length<300,'catalog capacity reached');
 assert(after.assets.length===before.assets.length+1,'only one asset may be appended');
 assert(JSON.stringify(after.assets.slice(0,-1))===JSON.stringify(before.assets),'existing assets must be unchanged');
 const newAsset=after.assets.at(-1);
 validateOne(newAsset);
 assert(!before.assets.some(a=>a.id===newAsset.id),'duplicate id');
 assert(!before.assets.some(a=>String(a.name||'').trim().toLocaleLowerCase('th')===newAsset.name.trim().toLocaleLowerCase('th')),'duplicate name');
 return {id:newAsset.id,name:newAsset.name,shapes:newAsset.shapes.length};
}
async function get(path,token){
 const r=await fetch('https://api.github.com/repos/'+REPO+path,{headers:{
  Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});
 if(!r.ok)throw Error('GitHub REST HTTP '+r.status);
 return r.json();
}
function decode(obj){
 assert(obj.encoding==='base64'&&typeof obj.content==='string','invalid catalog encoding');
 return JSON.parse(Buffer.from(obj.content,'base64').toString('utf8'));
}
async function run(){
 const token=process.env.GH_TOKEN,prNum=Number(process.env.PR_NUMBER);
 assert(token&&Number.isInteger(prNum)&&prNum>0,'missing authenticated PR context');
 const pr=await get('/pulls/'+prNum,token);
 assert(pr.head?.repo?.full_name===REPO&&pr.base?.repo?.full_name===REPO,'PR from wrong repo');
 assert(pr.user?.login==='tanawutmalirum29-ux','PR author is not repository owner');
 assert(/^studio-art-[a-z0-9-]+$/.test(pr.head?.ref||''),'not an art-vault branch');
 assert(/^Art Vault: .{2,64}$/.test(pr.title||''),'not an art-vault PR');
 assert(pr.changed_files===1,'PR changes extra files');
 const files=await get('/pulls/'+prNum+'/files?per_page=10',token);
 assert(files.length===1&&files[0].filename==='assets/library.json'&&files[0].status==='modified','PR modifies files other than approved catalog');
 const [before,after]=await Promise.all([
  get('/contents/assets/library.json?ref='+encodeURIComponent(pr.base.sha),token),
  get('/contents/assets/library.json?ref='+encodeURIComponent(pr.head.sha),token)
 ]);
 const checked=validateAppendOnly(decode(before),decode(after));
 console.log('PASS: append-only validated asset',checked.id,checked.shapes+' shapes');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 run().catch(err=>{console.error('REJECT Art Vault PR:',err.message);process.exitCode=1});
}
