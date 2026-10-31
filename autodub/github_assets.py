"""Safe GitHub asset proposals for Story Studio. New branch, fixed JSON catalog, human-reviewed PR."""
import base64,json,os,secrets,time,urllib.request,urllib.error,math,re
REPO="tanawutmalirum29-ux/AI-ANIMATION"
PATH="assets/library.json"
CATS={"prop","decor","nature","architecture","fx"}
SHAPES={"rect","circle","ellipse","line","polygon"}
HEX=re.compile(r"^#[0-9a-fA-F]{6}$")
class AssetError(Exception):pass
def number(value,lo,hi,default):
 try:n=float(value)
 except (TypeError,ValueError,OverflowError):n=default
 if not math.isfinite(n):n=default
 return round(max(lo,min(hi,n)),3)
def color(value):return value if isinstance(value,str) and HEX.fullmatch(value) else "#b7c4cf"
def clean_asset(source):
 if not isinstance(source,dict):raise AssetError("รูปแบบสินทรัพย์ไม่ถูกต้อง")
 name=str(source.get("name","")).strip()[:64]
 if len(name)<2:raise AssetError("กรุณาใส่ชื่อสิ่งของอย่างน้อย 2 ตัวอักษร")
 category=source.get("category","decor")
 if category not in CATS:category="decor"
 shapes=source.get("shapes")
 if not isinstance(shapes,list) or not 1<=len(shapes)<=60:raise AssetError("ต้องมีรูปทรง 1–60 รายการ")
 cleaned=[]
 for s in shapes:
  if not isinstance(s,dict) or s.get("type") not in SHAPES:raise AssetError("รูปทรงไม่รองรับ")
  typ=s["type"]
  sh={"type":typ,"fill":color(s.get("fill")),"stroke":"none" if s.get("stroke")=="none" else color(s.get("stroke")),"strokeWidth":number(s.get("strokeWidth"),0,12,0),"opacity":number(s.get("opacity"),0,1,1)}
  data={
   "rect":[("x",0,100,0),("y",0,100,0),("w",.1,100,10),("h",.1,100,10),("rx",0,30,0)],
   "circle":[("cx",0,100,50),("cy",0,100,50),("r",.1,50,8)],
   "ellipse":[("cx",0,100,50),("cy",0,100,50),("rx",.1,50,12),("ry",.1,50,8)],
   "line":[("x1",0,100,0),("y1",0,100,0),("x2",0,100,100),("y2",0,100,100)]}
  for key,lo,hi,default in data.get(typ,[]):sh[key]=number(s.get(key),lo,hi,default)
  if typ=="line":
   sh["stroke"]="none" if s.get("stroke")=="none" else color(s.get("stroke") or "#ffffff")
   sh["strokeWidth"]=number(s.get("strokeWidth"),.4,12,2)
  if typ=="polygon":
   pts=s.get("points")
   if not isinstance(pts,list) or not 3<=len(pts)<=30:raise AssetError("Polygon ต้องมี 3–30 จุด")
   sh["points"]=[]
   for pt in pts:
    if not isinstance(pt,list) or len(pt)!=2:raise AssetError("พิกัด Polygon ไม่ถูกต้อง")
    sh["points"].append([number(pt[0],0,100,50),number(pt[1],0,100,50)])
  cleaned.append(sh)
 return {"version":1,"id":"vault-"+secrets.token_hex(8),"name":name,"category":category,"description":str(source.get("description","")).strip()[:180],"shapes":cleaned}
def request(path,token,method="GET",data=None):
 url="https://api.github.com/repos/"+REPO+path
 headers={"Authorization":"Bearer "+token,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"StoryStudio-Asset-Vault"}
 payload=None
 if data is not None:
  payload=json.dumps(data,ensure_ascii=False).encode()
  headers["Content-Type"]="application/json"
 req=urllib.request.Request(url,data=payload,headers=headers,method=method)
 try:
  with urllib.request.urlopen(req,timeout=15) as response:return json.loads(response.read(400000).decode())
 except urllib.error.HTTPError as exc:raise AssetError("GitHub API ตอบ HTTP "+str(exc.code)) from None
 except (urllib.error.URLError,TimeoutError,ValueError,UnicodeError):raise AssetError("ติดต่อ GitHub ไม่สำเร็จ") from None
def propose(source):
 token=os.environ.get("GITHUB_ASSET_TOKEN","")
 if not token:raise AssetError("ยังไม่ได้ตั้งค่า GitHub Token ฝั่ง AWS (ดู README)")
 a=clean_asset(source)
 ref=request("/git/ref/heads/main",token)
 sha=ref.get("object",{}).get("sha")
 if not isinstance(sha,str) or len(sha)!=40:raise AssetError("อ่าน main ไม่สำเร็จ")
 old=request("/contents/"+PATH+"?ref=main",token)
 if old.get("encoding")!="base64" or not old.get("sha"):raise AssetError("อ่านคลังรูปไม่สำเร็จ")
 try:
  catalog=json.loads(base64.b64decode(old["content"]).decode())
  items=catalog["assets"]
  if not isinstance(items,list) or len(items)>=300:raise ValueError("catalog full")
  if any(str(x.get("name","")).strip().casefold()==a["name"].casefold() for x in items if isinstance(x,dict)):raise AssetError("มีชื่อสิ่งของนี้อยู่แล้ว")
  items.append(a)
  encoded=base64.b64encode((json.dumps(catalog,ensure_ascii=False,indent=2)+"\n").encode()).decode()
 except AssetError:raise
 except (ValueError,KeyError,TypeError,UnicodeError):raise AssetError("โครงสร้างคลังไม่ถูกต้อง") from None
 branch="studio-art-"+str(int(time.time()))+"-"+secrets.token_hex(4)
 request("/git/refs",token,"POST",{"ref":"refs/heads/"+branch,"sha":sha})
 request("/contents/"+PATH,token,"PUT",{"message":"art vault: "+a["name"],"content":encoded,"branch":branch,"sha":old["sha"]})
 pr=request("/pulls",token,"POST",{"title":"Art Vault: "+a["name"],"head":branch,"base":"main","body":"Reusable studio vector asset. Category: "+a["category"]+". Shapes: "+str(len(a["shapes"]))+". JSON primitives only, no script or raw SVG. Review before merge."})
 link=pr.get("html_url");num=pr.get("number")
 if not isinstance(link,str) or not link.startswith("https://github.com/"+REPO+"/pull/") or not isinstance(num,int):raise AssetError("GitHub ไม่ส่ง PR ที่ถูกต้อง")
 return {"number":num,"url":link,"assetId":a["id"]}
