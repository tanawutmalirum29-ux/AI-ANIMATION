"""Offline test: strict schema and mocked GitHub pull request flow."""
import importlib.util, pathlib, os, json, base64
from unittest.mock import patch
path=pathlib.Path(__file__).resolve().parent.parent/"autodub"/"github_assets.py"
spec=importlib.util.spec_from_file_location("github_assets",path)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
valid={"name":"ทดสอบรูปวาด","category":"decor","shapes":[{"type":"circle","cx":50,"cy":50,"r":12,"fill":"#abcdef"}]}
assert module.clean_asset(valid)["name"]=="ทดสอบรูปวาด"
try:
 module.clean_asset({"name":"invalid","shapes":[{"type":"unknown"}]})
 raise AssertionError("unsupported primitive was accepted")
except module.AssetError:pass
observed=[]
def emulate(path,secret,method="GET",data=None):
 observed.append((path,method,data))
 if path=="/git/ref/heads/main":return {"object":{"sha":"a"*40}}
 if method=="GET":
  data=json.dumps({"version":1,"assets":[]}).encode()
  return {"sha":"b"*40,"encoding":"base64","content":base64.b64encode(data).decode()}
 if path=="/pulls":return {"number":14,"html_url":"https://github.com/tanawutmalirum29-ux/AI-ANIMATION/pull/14"}
 return {}
with patch.dict(os.environ,{"GITHUB_ASSET_TOKEN":"offline-example"}),patch.object(module,"request",side_effect=emulate):
 result=module.propose(valid)
assert result["number"]==14
assert len([x for x in observed if x[1]=="PUT"])==1
assert [x for x in observed if x[1]=="PUT"][0][0]=="/contents/assets/library.json"
print("PASS: strict artist primitives and PR to approved catalog only")
