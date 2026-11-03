"""Transient provider failures preserve AWS checkpoints and never loop endlessly."""
import json
import os
import sys
import time
import unittest
from unittest import mock

sys.path.insert(0,os.path.join(os.path.dirname(__file__),"..","autodub"))
sys.path.insert(0,os.path.dirname(__file__))
import cloud_jobs, teacher, teacher_advisor
from test_cloud_jobs import fixture


def unpack(reply):
    return reply["statusCode"], json.loads(reply["body"])


class TimeoutRecoveryTests(unittest.TestCase):
    def test_teacher_provider_socket_timeout_yields_json_and_reason_code(self):
        config={"gemini":{"key":"fake-secret-should-never-appear",
                          "model":"gemini-3.5-flash-lite"}}
        for error,code in (
            (ValueError("AI provider timed out"),"TEACHER_PROVIDER_TIMEOUT"),
            (ValueError("AI provider network unavailable"),"TEACHER_PROVIDER_NETWORK"),
            (ValueError("AI provider returned HTTP 503"),"TEACHER_PROVIDER_UPSTREAM"),
            (ValueError("AI provider invalid JSON response"),"TEACHER_PROVIDER_BAD_RESPONSE")
        ):
            with self.subTest(code=code), \
                 mock.patch.object(teacher,"_settings",return_value=config), \
                 mock.patch.object(teacher,"_post_json",side_effect=error):
                teacher._REQUEST_TIMES.clear()
                status,result=unpack(teacher._chat({
                    "provider":"gemini","message":"ตรวจคำผิด", "context":""}))
                self.assertIn(status,(502,503))
                self.assertEqual(result["reasonCode"],code)
                self.assertNotIn("fake-secret",json.dumps(result))

    def test_raw_provider_timeout_is_caught_before_lambda_http_502(self):
        class Opener:
            def open(self,*args,**kwargs):
                raise TimeoutError("socket timed out")
        with mock.patch.object(teacher.urllib.request,"build_opener",return_value=Opener()):
            with self.assertRaisesRegex(ValueError,"AI provider timed out"):
                teacher._post_json("https://test.invalid/endpoint",
                                   {"Authorization":"Bearer fake-secret"},
                                   {"message":"hello"})
        class Response:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,n):return b'not-json'
        class JsonOpener:
            def open(self,*args,**kwargs):return Response()
        with mock.patch.object(teacher.urllib.request,"build_opener",
                               return_value=JsonOpener()):
            with self.assertRaisesRegex(ValueError,"AI provider invalid JSON response"):
                teacher._post_json("https://test.invalid/endpoint",{},{"message":"hello"})

    def test_http_429_retry_after_is_sanitized_and_preserved(self):
        import urllib.error
        class Opener:
            def open(self, *_args, **_kwargs):
                raise urllib.error.HTTPError(
                    "https://api.test.invalid", 429, "rate limited",
                    {"Retry-After": "7200", "Authorization": "SECRET_VALUE"}, None)
        with mock.patch.object(teacher.urllib.request, "build_opener",
                               return_value=Opener()):
            with self.assertRaisesRegex(ValueError, "retry-after=7200") as exc:
                teacher._post_json("https://api.test.invalid",
                                   {"Authorization": "Bearer SECRET_VALUE"},
                                   {"message": "test"})
        config = {"gemini": {"key": "fake-secret-should-never-appear",
                              "model": "gemini-3.5-flash-lite"}}
        with mock.patch.object(teacher, "_settings", return_value=config), \
             mock.patch.object(teacher, "_post_json",
                               side_effect=ValueError(
                                   "AI provider returned HTTP 429; retry-after=7200")):
            teacher._REQUEST_TIMES.clear()
            status, result = unpack(teacher._chat({
                "provider": "gemini", "message": "ตรวจบท", "context": "{}"}))
        self.assertEqual(status, 429)
        self.assertEqual(result["retryAfterSeconds"], 7200)
        self.assertNotIn("SECRET_VALUE", json.dumps(result))

    def test_worker_waits_and_keeps_position_on_provider_timeouts(self):
        table,jobid,_=fixture()
        table.rows[("teacher-job#"+jobid,"meta")]["position"]=1
        table.rows[("teacher-job#"+jobid,"meta")]["completedIndices"]=[0]
        import teacher
        reply=teacher._response(503,{
            "reasonCode":"TEACHER_PROVIDER_TIMEOUT","error":"temporary"})
        with mock.patch.object(cloud_jobs,"_table",return_value=table), \
             mock.patch.object(cloud_jobs,"_provider_quota_wait",return_value=0), \
             mock.patch.object(cloud_jobs,"_try_provider_lock",return_value=True), \
             mock.patch.object(cloud_jobs,"_release_provider_lock"), \
             mock.patch.object(teacher,"_auto_teach",return_value=reply):
            for i in range(1,6):
                outcome=cloud_jobs.worker({"jobId":jobid,"generation":0})
                self.assertEqual(outcome["state"],"provider-retry")
                self.assertTrue(outcome["next"])
                self.assertGreaterEqual(outcome["waitSeconds"],25)
                row=table.rows[("teacher-job#"+jobid,"meta")]
                self.assertEqual(row["state"],"queued")
                self.assertEqual(row["position"],1)
                self.assertEqual(row["completedIndices"],[0])
                self.assertEqual(row["saved"],0)
                self.assertEqual(row["transientFailures"],i)
                self.assertEqual(row["lastProviderReason"], "TEACHER_PROVIDER_TIMEOUT")
                self.assertGreater(row["nextRetryAt"], int(time.time()))
                self.assertEqual(cloud_jobs._public(row)["transientFailures"], i)
            last=cloud_jobs.worker({"jobId":jobid,"generation":0})
        self.assertFalse(last["next"])
        self.assertEqual(last["state"],"needs-attention")
        self.assertEqual(table.rows[("teacher-job#"+jobid,"meta")]["position"],1)

    def test_timeout_retries_only_one_scene_instead_of_two(self):
        table, jobid, _ = fixture()
        reply = teacher._response(503, {
            "reasonCode": "TEACHER_PROVIDER_TIMEOUT", "error": "temporary"})
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.object(cloud_jobs, "_provider_quota_wait", return_value=0), \
             mock.patch.object(cloud_jobs, "_try_provider_lock", return_value=True), \
             mock.patch.object(cloud_jobs, "_release_provider_lock"), \
             mock.patch.object(teacher, "_auto_teach", return_value=reply) as called:
            first = cloud_jobs.worker({"jobId": jobid, "generation": 0})
            second = cloud_jobs.worker({"jobId": jobid, "generation": 0})
        self.assertEqual(first["state"], "provider-retry")
        self.assertEqual(second["state"], "provider-retry")
        self.assertEqual([len(x.args[0]["scenes"]) for x in called.call_args_list],
                         [2, 1])
        row = table.rows[("teacher-job#" + jobid, "meta")]
        self.assertEqual(row["position"], 0)
        self.assertEqual(row["completedIndices"], [])
        self.assertEqual(row["lastProviderReason"], "TEACHER_PROVIDER_TIMEOUT")

    def test_teach_provider_timeout_is_longer_than_interactive_timeout(self):
        content = {"candidates": [{"content": {"parts": [{"text":
             '{"teachingLessons":[]}'}]}}]}
        with mock.patch.object(teacher, "_settings", return_value={
             "gemini": {"key": "fake-secret-for-tests", "model": "gemini-2.5-flash"}}), \
             mock.patch.object(teacher, "_post_json", return_value=content) as called:
            teacher._REQUEST_TIMES.clear()
            teacher._chat({"provider": "gemini", "message": "สอนฉาก", "context": "{}"},
                          teach_mode=True)
            self.assertEqual(called.call_args.kwargs["timeout"], 32)
            teacher._chat({"provider": "gemini", "message": "สอนฉาก", "context": "{}"})
            self.assertNotIn("timeout", called.call_args.kwargs)

    def test_worker_catches_raw_timeout_and_recovers_without_skipped_scene(self):
        table,jobid,_=fixture()
        with mock.patch.object(cloud_jobs,"_table",return_value=table), \
             mock.patch.object(cloud_jobs,"_provider_quota_wait",return_value=0), \
             mock.patch.object(cloud_jobs,"_try_provider_lock",return_value=True), \
             mock.patch.object(cloud_jobs,"_release_provider_lock"), \
             mock.patch.object(teacher,"_auto_teach",side_effect=TimeoutError):
            outcome=cloud_jobs.worker({"jobId":jobid,"generation":0})
        self.assertEqual(outcome["state"],"provider-retry")
        self.assertEqual(table.rows[("teacher-job#"+jobid,"meta")]["position"],0)
        self.assertEqual(table.rows[("teacher-job#"+jobid,"meta")]["completedIndices"],[])

    def test_unrecoverable_auth_error_stays_needs_attention(self):
        table,jobid,_=fixture()
        reply=teacher._response(502,{"reasonCode":"TEACHER_PROVIDER_AUTH",
                                    "error":"model unauthorized"})
        with mock.patch.object(cloud_jobs,"_table",return_value=table), \
             mock.patch.object(teacher,"_auto_teach",return_value=reply):
            result=cloud_jobs.worker({"jobId":jobid,"generation":0})
        self.assertEqual(result["state"],"needs-attention")
        self.assertFalse(result["next"])

    def test_mother_compacts_utf8_evidence_but_keeps_aws_learning_numbers(self):
        snapshot={
          "providers":[{"id":"gemini","ready":True,"model":"gemini-3.5-flash-lite"}],
          "narrativeChild":{"available":True,"savedLessons":600,"distinctProjects":8},
          "repetitionChild":{"available":False},
          "editorChild":{"available":True},
          "projectJob":{"available":False},
          "aiCatalog":{"memberRoles":[{"id":str(i),"role":"ภาษา"*70}
                       for i in range(6)],
                       "ownerConnections":[{"name":"Gemini #1","ready":True}]},
          "measuredAt": 1793600000}
        evidence={"available":True,"treeSha":"a"*40,"selectedFiles":["autodub/teacher.py"],
                  "sourceExcerpts":[{"path":"autodub/teacher.py","excerpt":"ภาษาไทย"*2500}]}
        with mock.patch.object(teacher_advisor,"_snapshot",return_value=snapshot), \
             mock.patch.object(teacher_advisor,"_github_evidence",return_value=evidence), \
             mock.patch.object(teacher_advisor,"_cloudwatch_summary",return_value={"requested":False}), \
             mock.patch.object(teacher_advisor,"_job_snapshot",return_value={"available":False}), \
             mock.patch.object(teacher,"_chat",return_value=teacher._response(200,{
                  "reply":"ยังมีบทเรียน 600 รายการ","provider":"gemini",
                  "model":"gemini-3.5-flash-lite"})) as called:
            status,data=unpack(teacher_advisor.handle("teacher.advisorChat",{
                "provider":"gemini","message":"แก้บั๊กในโค้ดอย่างไร"},owner_id=225819900))
        self.assertEqual(status,200)
        body=called.call_args.args[0]
        self.assertLessEqual(len(body["context"].encode("utf-8")),5500)
        self.assertIn("600",body["context"])
        self.assertIn("liveGitHub",body["context"])
        self.assertNotIn("ภาษาไทย"*400,body["context"])

    def test_mother_exception_returns_structured_response_not_raw_502(self):
        snapshot={"providers":[],"narrativeChild":{"available":False},
                  "repetitionChild":{"available":False},"projectJob":{"available":False},
                  "measuredAt":1234,"aiCatalog":{},"editorChild":{"available":False}}
        with mock.patch.object(teacher_advisor,"_snapshot",return_value=snapshot),\
             mock.patch.object(teacher_advisor,"_job_snapshot",return_value={"available":False}),\
             mock.patch.object(teacher_advisor,"_github_evidence",return_value={"available":False,"selectedFiles":[]}),\
             mock.patch.object(teacher_advisor,"_cloudwatch_summary",return_value={"requested":False}),\
             mock.patch.object(teacher,"_chat",side_effect=TimeoutError):
            status,reply=unpack(teacher_advisor.handle("teacher.advisorChat",{
                "provider":"gemini","message":"ตรวจงาน"},owner_id=225819900))
        self.assertEqual(status,503)
        self.assertEqual(reply["reasonCode"],"MOTHER_CALL_FAILED")
        self.assertNotIn("token",json.dumps(reply))


if __name__=="__main__":
    unittest.main()
