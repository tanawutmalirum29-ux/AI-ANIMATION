"""Offline Lambda security contract test: no external AWS/TTS required."""
import base64
import hashlib
import importlib.util
import json
import os
import pathlib
import sys
import types
from unittest.mock import patch

async def fake_stream(self):
    yield {"type":"audio","data":b"FAKE_MP3"}

class FakeCommunicate:
    def __init__(self,*args,**kwargs):
        pass
    stream=fake_stream

sys.modules["edge_tts"]=types.SimpleNamespace(Communicate=FakeCommunicate)
salt=b"\x01"*24
password="test password 123 secure"
os.environ["SITE_PASSWORD_SALT"]=salt.hex()
os.environ["SITE_PASSWORD_HASH"]=hashlib.pbkdf2_hmac("sha256",password.encode(),salt,260000).hex()
os.environ["SESSION_SECRET"]="test_session_secret_for_offline_testing_only"
os.environ["DUB_KEY"]="legacy_key_should_be_rejected"
path=pathlib.Path(__file__).resolve().parent.parent/"autodub"/"handler.py"
sys.path.insert(0,str(path.parent))
spec=importlib.util.spec_from_file_location("autodub_handler",path)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

def req(action, headers=None, **fields):
    return mod.handler({"headers":headers or {}, "requestContext":{"http":{"sourceIp":"test-ip"}},
       "body":json.dumps({"action":action, **fields})},None)

def result(response,expected):
    assert response["statusCode"]==expected,response
    assert response["headers"]["Cache-Control"]=="no-store"
    return json.loads(response["body"])

assert result(req("login",password="wrong"),401)["error"]
auth=result(req("login",password=password),200)
token=auth["token"]
bearer={"authorization":"Bearer "+token}
assert auth["expiresAt"]>0
assert result(req("verify",bearer),200)=={"ok":True}
assert result(req("synthesize",bearer,text="สวัสดี",voice="th-TH-NiwatNeural"),200)["audio"]==base64.b64encode(b"FAKE_MP3").decode()
assert result(req("synthesize",{"x-dub-key":"legacy_key_should_be_rejected"},text="สวัสดี"),401)
assert result(req("verify",{"Authorization":"Bearer "+token+"bad"}),401)
assert result(req("synthesize",bearer,text=""),400)
assert result(req("not-allowed",bearer),400)
sample_art={"name":"เครื่องประดับฉาก","shapes":[{"type":"circle","r":12}]}
assert result(req("proposeAsset",{"x-dub-key":"legacy_key_should_be_rejected"},asset=sample_art),401)
assert result(req("proposeAsset",{"authorization":"Bearer invalid"},asset=sample_art),401)
with patch.object(mod.github_assets,"propose",return_value={"number":15,"url":"https://github.com/tanawutmalirum29-ux/AI-ANIMATION/pull/15"}):
    assert result(req("proposeAsset",bearer,asset=sample_art),200)["number"]==15
with patch.object(mod.time,"time",return_value=auth["expiresAt"]+1):
    assert result(req("verify",bearer),401)

# Hosted AI is server-only: protected by the studio session, disabled without API key.
valid={"system":"ตอบ JSON ตามสคีมา","prompt":"แก้บทพากย์ฉากแรก"}
assert result(req("aiGenerate",**valid),401)
assert result(req("aiGenerate",bearer,**valid),503)["error"]

class FakeResponse:
    def __enter__(self):return self
    def __exit__(self,*args):return False
    def read(self,*args):
        return json.dumps({"model":"gpt-6-luna","output":[{"type":"message",
            "content":[{"type":"output_text","text":'{"reply":"เรียบร้อย","ops":[]}'}]}]}).encode()

def fake_urlopen(request,timeout):
    assert request.full_url=="https://api.openai.com/v1/responses"
    assert request.get_header("Authorization")=="Bearer test-api-key-only"
    data=json.loads(request.data.decode())
    assert data["store"] is False
    assert data["model"]=="gpt-6-luna"
    assert timeout<=23
    return FakeResponse()

with patch.dict(os.environ,{"OPENAI_API_KEY":"test-api-key-only","OPENAI_MODEL":"gpt-6-luna"}):
    assert result(req("aiGenerate",bearer,system="",prompt="สั่งงาน"),400)["error"]
    with patch.object(mod.urllib.request,"urlopen",side_effect=fake_urlopen):
        response=result(req("aiGenerate",bearer,**valid),200)
        assert response["text"]=='{"reply":"เรียบร้อย","ops":[]}'
    with patch.object(mod.urllib.request,"urlopen",side_effect=mod.urllib.error.HTTPError(
          "https://api.openai.com/v1/responses",429,"rate-limited",{},None)):
        assert result(req("aiGenerate",bearer,**valid),429)["error"]
print("PASS: Lambda sessions, hosted AI auth, API key isolation, provider gateway, validation")

