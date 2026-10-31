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
with patch.object(mod.time,"time",return_value=auth["expiresAt"]+1):
    assert result(req("verify",bearer),401)
print("PASS: Lambda password hashing, signed session, expiration, voice auth, legacy-key rejection")
