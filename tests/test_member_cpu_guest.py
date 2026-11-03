"""Member v1: trained CPU models ONLY, guest session, no external AI or quotas."""
import json,os,sys,types,unittest
from unittest import mock
sys.path.insert(0,os.path.join(os.path.dirname(__file__),"..","autodub"))
sys.modules.setdefault("edge_tts",types.ModuleType("edge_tts"))
sys.modules.setdefault("github_assets",types.ModuleType("github_assets"))
import guest_access,member_ai,github_oauth,handler,thai_editor

ENV={"GITHUB_OAUTH_CLIENT_ID":"test-oauth-client",
     "GITHUB_OAUTH_SECRET_PARAMETER":"/test/github",
     "SESSION_SECRET":"test-long-unchanging-session-secret-of-adequate-length"}
def unpack(reply):return reply["statusCode"],json.loads(reply["body"])
def evt(action,token=None,**extra):
    return {"body":json.dumps({"action":action,**extra}),
            "headers":{"authorization":"Bearer "+token} if token else {}}

class MemberCPUGuestTests(unittest.TestCase):
    def test_temporary_guest_can_login_without_quota_or_github(self):
        with mock.patch.dict(os.environ,ENV):
            for i in range(9):
                code,data=unpack(handler.handler(evt("auth.guest.start"),None))
                self.assertEqual(code,200)
                self.assertTrue(data["temporary"])
                token=data["token"]
                guest=guest_access.verify(token)
                self.assertEqual(guest["role"],"guest")
                self.assertIsNone(github_oauth.verify(token))
                state,body=unpack(handler.handler(evt("verify",token),None))
                self.assertEqual(state,200)
                self.assertEqual(body["user"]["role"],"guest")
                self.assertEqual(unpack(handler.handler(evt("teacher.advisorInspect",token),None))[0],403)
                self.assertEqual(unpack(handler.handler(evt("teacher.configure",token),None))[0],403)
                self.assertEqual(unpack(handler.handler(evt("member.keys.list",token),None))[0],403)
                changed=token.rsplit(".",1)[0]+"."+"f"*43
                self.assertIsNone(guest_access.verify(changed))
                self.assertIsNone(guest_access.verify("guest.not-valid.bad"))
    def test_cpu_catalog_never_claims_six_independent_trained_models(self):
        model=thai_editor._baseline()
        with mock.patch.object(member_ai,"_models",return_value={"thai-editor":{
            "model":model,"version":model["version"],
            "status":"experimental-synthetic-starter","source":"local"}}):
            code,result=unpack(member_ai.catalog())
        self.assertEqual(code,200)
        self.assertEqual(result["moduleCount"],6)
        self.assertEqual(result["trainedModelCount"],1)
        self.assertFalse(result["externalAPIAllowed"])
        self.assertFalse(result["quotasEnabled"])
        self.assertFalse(result["trainedSeparateWeights"])
        self.assertEqual({i["id"] for i in result["modules"] if i["ready"]},
                         {"voice","qa"})
    def test_member_cpu_inference_is_read_only_and_uses_no_provider_client(self):
        model=thai_editor._baseline()
        available={"thai-editor":{"model":model,"version":model["version"],
                    "status":"experimental","source":"bundled"}}
        for user in ({"sub":321,"role":"member"},
                     {"sub":"guest-"+"d"*32,"role":"guest"}):
            with mock.patch.object(member_ai,"_models",return_value=available),\
                 mock.patch.object(thai_editor,"_suggest",wraps=thai_editor._suggest) as infer:
                code,data=unpack(member_ai.run({
                    "release":"member-six-v1","role":"voice",
                    "message":"งสนนี้เราต้องทำให้สำเร็จ"},user))
                self.assertEqual(code,200,data)
                self.assertEqual(data["source"],"trained-local-CPU-only")
                self.assertFalse(data["externalAPIUsed"])
                self.assertEqual(data["findings"][0]["suggestions"][0]["suggested"],
                                 "งานนี้เราต้องทำให้สำเร็จ")
                self.assertFalse(data["appliedToProject"])
                infer.assert_called_once()
    def test_no_model_no_fake_generation_and_never_falls_back_to_provider(self):
        with mock.patch.object(member_ai,"_models",return_value={}):
            code,data=unpack(member_ai.run({
                "role":"assets","message":"ทำฉาก SVG ต้นไม้"}, {"sub":4,"role":"member"}))
            self.assertEqual(code,409)
            self.assertTrue(data["requiresTraining"])
            self.assertFalse(data["externalAPIUsed"])
    def test_any_external_api_parameters_are_denied_before_model_load(self):
        for user in ({"sub":6,"role":"member"},{"sub":"guest-"+"c"*32,"role":"guest"}):
            for attr in ("apiKey","connectionId","provider","model","baseUrl","endpoint"):
                with mock.patch.object(member_ai,"_models",
                                       side_effect=AssertionError("no read on BYOK")):
                    code,_=unpack(member_ai.run({
                        "role":"qa","message":"ตรวจบทนี้","release":"member-six-v1",
                        attr:"unsafe"},user))
                self.assertEqual(code,403)
    def test_member_routes_allow_cpu_only_and_keep_admin_commands_private(self):
        with mock.patch.dict(os.environ,ENV):
            token,_=github_oauth.issue_session({"id":98765,"login":"user"})
            with mock.patch.object(member_ai,"catalog",return_value=member_ai._resp(
                200,{"moduleCount":6})) as cat:
                code,data=unpack(handler.handler(evt("member.ai.catalog",token),None))
                self.assertEqual(code,200);cat.assert_called_once()
            for action in ("teacher.connection.list","teacher.advisorInspect","teacher.job.list",
                           "student.model","editor.status","export.prepare","synthesize"):
                code,_=unpack(handler.handler(evt(action,token),None))
                self.assertEqual(code,403,action)
    def test_member_v1_not_bound_to_daily_or_minute_quota(self):
        self.assertFalse(hasattr(member_ai,"_quota"))
        self.assertFalse(hasattr(member_ai,"_ATTEMPTS"))
        self.assertFalse(hasattr(guest_access,"STARTS_PER_IP_PER_DAY"))
        self.assertFalse(hasattr(guest_access,"_table"))

if __name__=="__main__":unittest.main()
