"""Owner tools only read safe project GitHub sources and IAM-gated AWS status."""
import base64,json,os,sys,types,unittest
from unittest import mock
sys.path.insert(0,os.path.join(os.path.dirname(__file__),"..","autodub"))
import owner_inspection as owner
import teacher_advisor

class InspectionTests(unittest.TestCase):
    def test_public_repo_tree_exact_file_and_redaction(self):
        tree={"sha":"a"*40,"tree":[
            {"path":"autodub/teacher.py","sha":"b"*40,"type":"blob","size":200},
            {"path":"studio-ai-workspace.js","sha":"c"*40,"type":"blob","size":200},
            {"path":"autodub/.env","sha":"d"*40,"type":"blob","size":200},
            {"path":"autodub/private/keys.py","sha":"e"*40,"type":"blob","size":200},
            {"path":"autodub/archive.pem","sha":"f"*40,"type":"blob","size":200},
        ]}
        code='print("safe")\nPASSWORD = "do-not-send-this"\nAPI_KEY="DO_NOT_EXPOSE_VALUE"\n'
        def github(url,limit=0):
            if "git/trees" in url:return tree
            if "git/blobs" in url:return {"encoding":"base64",
                 "content":base64.b64encode(code.encode()).decode()}
            raise AssertionError(url)
        with mock.patch.object(teacher_advisor,"_github_read",side_effect=github):
            info=owner._github("ตรวจไฟล์ autodub/teacher.py")
        self.assertTrue(info["available"])
        self.assertEqual(info["selectedFiles"][0],"autodub/teacher.py")
        self.assertEqual(info["totalSafeFiles"],2)
        self.assertNotIn("do-not-send-this",json.dumps(info))
        self.assertNotIn("DO_NOT_EXPOSE_VALUE",json.dumps(info))
        self.assertNotIn("private/keys",json.dumps(info))
        self.assertFalse(info["privateReposAccessible"])

    def test_aws_read_only_allowlisted_fields_never_exports_env_or_role(self):
        boto=types.ModuleType("boto3")
        class Client:
            def __init__(self,name):self.name=name
            def get_function_configuration(self,**kw):
                return {"State":"Active","LastUpdateStatus":"Successful",
                        "Environment":{"Variables":{"password":"secret-value"}},
                        "Role":"private-iam-role","LastModified":"timestamp","Runtime":"python3.12"}
            def get_branch(self,**kw):return {"branch":{"enableAutoBuild":True}}
            def list_jobs(self,**kw):
                return {"jobSummaries":[{"jobId":"job-1","status":"SUCCEED",
                     "commitId":"a"*40,"private":"do-not-share"}]}
            def describe_table(self,**kw):
                return {"Table":{"TableStatus":"ACTIVE","ItemCount":25,
                                 "SSEDescription":{"key":"do-not-share"}}}
        boto.client=lambda name,**kw:Client(name)
        with mock.patch.dict(os.environ,{"TEACHER_FEEDBACK_TABLE":"test-table"}),\
             mock.patch.dict(sys.modules,{"boto3":boto}):
            result=owner._aws("ดู aws status deploy")
        self.assertTrue(result["lambda"]["available"])
        self.assertTrue(result["amplify"]["available"])
        self.assertTrue(result["database"]["available"])
        self.assertNotIn("secret-value",json.dumps(result))
        self.assertNotIn("private-iam-role",json.dumps(result))
        self.assertNotIn("do-not-share",json.dumps(result))

    def test_unconfigured_iam_is_reported_missing_not_as_success(self):
        boto=types.ModuleType("boto3")
        def error(*a,**kw):raise RuntimeError("AccessDenied")
        boto.client=lambda name,**kwargs:types.SimpleNamespace(
            get_function_configuration=error,get_branch=error,
            describe_table=error)
        with mock.patch.dict(sys.modules,{"boto3":boto}),\
             mock.patch.dict(os.environ,{"TEACHER_FEEDBACK_TABLE":"test"}):
            result=owner._aws("AWS deploy")
        self.assertFalse(result["lambda"]["available"])
        self.assertFalse(result["amplify"]["available"])
        self.assertFalse(result["database"]["available"])

    def test_member_cannot_call_inspection_route(self):
        sys.modules.setdefault("edge_tts",types.ModuleType("edge_tts"))
        sys.modules.setdefault("github_assets",types.ModuleType("github_assets"))
        import handler,github_oauth
        env={"GITHUB_OAUTH_CLIENT_ID":"test","GITHUB_OAUTH_SECRET_PARAMETER":"test",
             "SESSION_SECRET":"a"*48}
        with mock.patch.dict(os.environ,env):
            token,_=github_oauth.issue_session({"id":1000,"login":"member"})
            event={"headers":{"authorization":"Bearer "+token},
                   "body":json.dumps({"action":"teacher.advisorInspect","question":"AWS"})}
            status=handler.handler(event,None)
        self.assertEqual(status["statusCode"],403)

if __name__=="__main__":unittest.main()
