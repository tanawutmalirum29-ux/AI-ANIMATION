"""Offline security tests for GitHub verified admin and restricted member BYOK API."""
import json,os,sys,types,unittest
from unittest import mock
sys.path.insert(0,os.path.join(os.path.dirname(__file__),"..","autodub"))
sys.modules.setdefault("edge_tts",types.ModuleType("edge_tts"))
sys.modules.setdefault("github_assets",types.ModuleType("github_assets"))
import github_oauth,member_ai,handler

ENV={"GITHUB_OAUTH_CLIENT_ID":"Ov23githubtestid",
     "GITHUB_OAUTH_SECRET_PARAMETER":"/test/github/secret",
     "SESSION_SECRET":"x"*64,
     "SITE_PASSWORD_HASH":"AA","SITE_PASSWORD_SALT":"BB"}

def result(value):
    return value["statusCode"],json.loads(value["body"])
def event(action,token=None,**kwargs):
    return {"body":json.dumps({"action":action,**kwargs}),
            "headers":{"authorization":"Bearer "+token} if token else {}}

class OAuthRoleTests(unittest.TestCase):
    def test_verified_numeric_github_user_id_only_admin(self):
        with mock.patch.dict(os.environ,ENV):
            token,claims=github_oauth.issue_session({"id":225819900,"login":"renamed-owner"})
            self.assertEqual(claims["role"],"admin")
            self.assertEqual(github_oauth.verify(token)["role"],"admin")
            user_token,user=github_oauth.issue_session({"id":332211,"login":"tanawutmalirum29-ux"})
            self.assertEqual(user["role"],"member")
            self.assertEqual(github_oauth.verify(user_token)["role"],"member")
            self.assertNotEqual(user["role"],"admin")

    def test_signature_roles_and_version_cannot_be_forged(self):
        with mock.patch.dict(os.environ,ENV):
            token,_=github_oauth.issue_session({"id":998,"login":"member"})
            a,b=token.split(".")
            item=json.loads(github_oauth._unb64(a));item["role"]="admin"
            forged=github_oauth._b64(json.dumps(item).encode())+"."+b
            self.assertIsNone(github_oauth.verify(forged))
            self.assertIsNone(github_oauth.verify("garbage"))
            self.assertIsNone(github_oauth.verify("A"*5000))
            item["v"]=1
            forged2=github_oauth._b64(json.dumps(item).encode())+"."+b
            self.assertIsNone(github_oauth.verify(forged2))

    def test_exchange_discards_github_access_token_and_uses_github_api_id(self):
        fake=types.ModuleType("boto3")
        fake.client=lambda n:types.SimpleNamespace(get_parameter=lambda **kw:{
            "Parameter":{"Value":"super_private_secret"}})
        calls=[]
        def github(url,headers,payload=None):
            calls.append((url,headers,payload))
            if url.endswith("access_token"):
                return {"access_token":"ghu_private_long_token_1234"}
            return {"id":225819900,"login":"verified-owner"}
        with mock.patch.dict(os.environ,ENV),mock.patch.dict(sys.modules,{"boto3":fake}),\
             mock.patch.object(github_oauth,"_github_json",side_effect=github):
            code,body=result(github_oauth.exchange({"code":"long_github_code12345",
                                          "codeVerifier":"A"*43}))
        self.assertEqual(code,200)
        self.assertEqual(body["user"]["role"],"admin")
        self.assertNotIn("ghu_private",json.dumps(body))
        self.assertNotIn("super_private",json.dumps(body))
        self.assertIn(b"code_verifier=",calls[0][2])
        self.assertEqual(calls[1][1]["Authorization"],"Bearer ghu_private_long_token_1234")

    def test_member_cannot_access_any_admin_server_actions_or_old_password(self):
        with mock.patch.dict(os.environ,ENV):
            token,_=github_oauth.issue_session({"id":1234,"login":"guest"})
            for action in ("student.storyAutoTrain","teacher.configure","teacher.autoLessons",
                           "teacher.lessonHistory","export.prepare","proposeAsset",
                           "synthesize","login"):
                code,body=result(handler.handler(event(action,token),None))
                self.assertEqual(code,403,action)
            status,body=result(handler.handler(event("verify",token),None))
            self.assertEqual(status,200)
            self.assertEqual(body["user"]["role"],"member")
            code,_=result(handler.handler(event("login",password="old"),None))
            self.assertEqual(code,401)

    def test_admin_access_and_public_config_are_separate(self):
        with mock.patch.dict(os.environ,ENV):
            token,_=github_oauth.issue_session({"id":225819900,"login":"admin"})
            code,public=result(handler.handler(event("auth.config"),None))
            self.assertEqual(code,200);self.assertEqual(public["mode"],"github")
            self.assertNotIn("secret",json.dumps(public))
            code,user=result(handler.handler(event("verify",token),None))
            self.assertEqual(code,200);self.assertEqual(user["user"]["role"],"admin")
            with mock.patch("teacher.handle",return_value=handler._resp(200,{"ready":True})):
                code,_=result(handler.handler(event("teacher.status",token),None))
                self.assertEqual(code,200)

    def test_legacy_only_before_oauth_is_provisioned(self):
        with mock.patch.dict(os.environ,{"GITHUB_OAUTH_CLIENT_ID":"",
                                       "GITHUB_OAUTH_SECRET_PARAMETER":""}):
            code,info=result(github_oauth.config())
        self.assertEqual(code,200);self.assertEqual(info["mode"],"legacy-password")

    def test_member_byok_rejects_paid_openrouter_and_unknown_roles(self):
        user={"sub":1111,"role":"member"}
        for values in [{"role":"teacher","provider":"openrouter","model":"openrouter/free"},
                       {"role":"qa","provider":"openrouter","model":"openai/gpt-4o"},
                       {"role":"qa","provider":"gemini","model":"unknown"}]:
            data={"apiKey":"long_private_key_123","message":"ตรวจบท",**values}
            code,_=result(member_ai.run(data,user))
            self.assertEqual(code,403)

if __name__=="__main__":unittest.main()
