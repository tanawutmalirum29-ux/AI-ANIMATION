"""Guest and hosted member gateway: no BYOK, no admin elevation, fixed quotas."""
import json, os, sys, types, time, unittest
from unittest import mock
sys.path.insert(0,os.path.join(os.path.dirname(__file__),"..","autodub"))
sys.modules.setdefault("edge_tts",types.ModuleType("edge_tts"))
sys.modules.setdefault("github_assets",types.ModuleType("github_assets"))
import guest_access, github_oauth, member_ai, handler

ENV={"GITHUB_OAUTH_CLIENT_ID":"test-client-id",
     "GITHUB_OAUTH_SECRET_PARAMETER":"/test/oauth",
     "SESSION_SECRET":"stable-test-signing-key-with-more-than-32-bytes",
     "TEACHER_FEEDBACK_TABLE":"testing-feedback"}

def read(r):return r["statusCode"],json.loads(r["body"])

class ConditionalFailure(Exception):
    response={"Error":{"Code":"ConditionalCheckFailedException"}}

class BudgetTable:
    def __init__(self):self.counts={}
    def update_item(self,Key,ExpressionAttributeValues,**kw):
        key=(Key["pk"],Key["sk"])
        current=self.counts.get(key,0)
        if current>=ExpressionAttributeValues[":limit"]:
            raise ConditionalFailure()
        self.counts[key]=current+1

class GuestHostedTests(unittest.TestCase):
    def test_guest_session_expires_uses_verified_ip_and_cannot_impersonate_owner(self):
        table=BudgetTable()
        boto=types.ModuleType("boto3")
        boto.resource=lambda name: types.SimpleNamespace(Table=lambda x:table)
        event={"requestContext":{"http":{"sourceIp":"198.51.100.11"}}}
        with mock.patch.dict(os.environ,ENV),mock.patch.dict(sys.modules,{"boto3":boto}):
            for n in range(3):
                code,body=read(guest_access.start(event))
                self.assertEqual(code,200)
                token=body["token"]
                user=guest_access.verify(token)
                self.assertEqual(user["role"],"guest")
                self.assertNotEqual(user["sub"],str(github_oauth.ADMIN_GITHUB_USER_ID))
                self.assertIsNone(github_oauth.verify(token))
                p,s=token.rsplit(".",1)
                self.assertIsNone(guest_access.verify(p+"."+("a"*len(s))))
            code,_=read(guest_access.start(event))
            self.assertEqual(code,429)
            code,_=read(guest_access.start({}))
            self.assertEqual(code,503)
            # A forged untrusted browser role cannot give a guest admin rights.
            forged=event|{"body":json.dumps({"action":"auth.guest.start","role":"admin"})}
            code,_=read(guest_access.start(forged))
            self.assertEqual(code,429)

    def test_guest_is_restricted_to_member_roles_and_cannot_access_admin(self):
        with mock.patch.dict(os.environ,ENV),mock.patch.object(
                guest_access,"verify",return_value={
                 "sub":"guest-"+"b"*32,"login":"ผู้เยี่ยมชม","role":"guest"}):
            event={"body":json.dumps({"action":"teacher.configure"}),
                   "headers":{"authorization":"Bearer guest.example.fake"}}
            code,_=read(handler.handler(event,None))
            self.assertEqual(code,403)
            event["body"]=json.dumps({"action":"member.keys.list"})
            code,_=read(handler.handler(event,None))
            self.assertEqual(code,403)
            event["body"]=json.dumps({"action":"verify"})
            code,verified=read(handler.handler(event,None))
            self.assertEqual(code,200)
            self.assertEqual(verified["user"]["role"],"guest")
            event["body"]=json.dumps({"action":"member.ai.catalog"})
            code,info=read(handler.handler(event,None))
            self.assertEqual(code,200)
            self.assertEqual(info["moduleCount"],6)

    def test_members_cannot_submit_provider_credentials(self):
        for user in ({"sub":42,"role":"member"},
                     {"sub":"guest-"+"c"*32,"role":"guest"}):
            for injected in ({"apiKey":"my-key"},{"connectionId":"abc"},
                             {"provider":"openrouter"},{"model":"custom"},
                             {"baseUrl":"https://example.org"}):
                data={"role":"qa","message":"ตรวจบท",**injected}
                code,_=read(member_ai.run(data,user))
                self.assertEqual(code,403)

    def test_hosted_provider_cannot_be_selected_by_client_and_uses_server_key(self):
        member_ai._ATTEMPTS.clear()
        mockcfg={"provider":"gemini","model":"gemini-2.5-flash-lite",
                 "key":"server-side-config-only"}
        class Response:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,n):
                return b'{"candidates":[{"content":{"parts":[{"text":"review ok"}]}}]}'
        with mock.patch.object(member_ai,"_hosted_provider",return_value=mockcfg),\
             mock.patch.object(member_ai,"_quota",return_value=(True,"")) as quota,\
             mock.patch.object(member_ai.urllib.request,"urlopen",return_value=Response()) as network:
            code,reply=read(member_ai.run({"role":"qa","message":"ตรวจบท"},
               {"sub":42,"role":"member"}))
        self.assertEqual(code,200,reply)
        self.assertTrue(reply["hostedByWebsite"])
        self.assertFalse(reply["keyStored"])
        self.assertNotIn("server-side-config-only",json.dumps(reply))
        quota.assert_called_once()
        self.assertEqual(network.call_args.kwargs["timeout"],19)

    def test_website_provider_unavailable_fails_closed(self):
        with mock.patch.object(member_ai,"_hosted_provider",return_value=None),\
             mock.patch.object(member_ai,"_quota",side_effect=AssertionError("no quota when unavailable")):
            code,detail=read(member_ai.run({"role":"qa","message":"ตรวจบท"},
                {"sub":55,"role":"member"}))
        self.assertEqual(code,503)
        self.assertIn("ไม่มีโมเดล",detail["error"])

if __name__=="__main__":unittest.main()
