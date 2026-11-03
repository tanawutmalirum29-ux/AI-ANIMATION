"""Extra AI keys: encrypted store, automatic names, job pinning and safe removal."""
import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "autodub"))
sys.path.insert(0, os.path.dirname(__file__))
import teacher
import teacher_connections as keys
import cloud_jobs
from test_cloud_jobs import Table, fixture

def decode(resp):
    return resp["statusCode"], json.loads(resp["body"])

class MultiKeyTests(unittest.TestCase):
    def setUp(self):
        self.settings = {"gemini": {"key": "legacy-gemini-secret-123",
                                    "model": "gemini-3.5-flash-lite"}}
        self.patcher = mock.patch.object(teacher, "_settings", side_effect=lambda:self.settings)
        self.patcher.start()
        self.save = mock.patch.object(teacher, "_save_settings",
                                      side_effect=lambda s:self.settings.update(s))
        self.save.start()
        self.secret = mock.patch.object(teacher, "_secret_id", return_value="teacher-secret")
        self.secret.start()

    def tearDown(self):
        self.patcher.stop();self.save.stop();self.secret.stop()

    def test_existing_keys_and_auto_named_new_keys_are_listed_without_secrets(self):
        code, result=decode(keys.handle("teacher.connection.list", {}, keys.ADMIN_ID))
        self.assertEqual(code,200)
        self.assertEqual(result["connections"][0]["id"],"default-gemini")
        self.assertNotIn("legacy-gemini-secret-123",json.dumps(result))
        for i in range(3):
            code, result=decode(keys.handle("teacher.connection.add", {
                "provider": "gemini", "apiKey": "new-gemini-key-"+str(i)+"-secret"},
                keys.ADMIN_ID))
            self.assertEqual(code,200,result)
            self.assertEqual(result["connection"]["name"].split(" · ")[-1], "#"+str(i+1))
            self.assertEqual(result["connection"]["provider"],"gemini")
            self.assertNotIn("secret",json.dumps(result))
        self.assertEqual(len(keys.listing()),4)
        self.assertEqual(len(self.settings["extraConnections"]),3)
        self.assertNotIn("key",keys.listing()[1])
        duplicate=keys.handle("teacher.connection.add",{
            "provider":"gemini","apiKey":"new-gemini-key-0-secret"},keys.ADMIN_ID)
        self.assertEqual(duplicate["statusCode"],409)

    def test_owner_selects_any_valid_openrouter_model_without_price_tier_gate(self):
        for bad in ("bad model", "bad?model"):
            code,_=decode(keys.add({"provider":"openrouter","model":bad,
                                      "apiKey":"new-openrouter-key-123"}))
            self.assertEqual(code,400)
        code,paid=decode(keys.add({"provider":"openrouter",
                                   "model":"somevendor/explicit-model",
                                   "apiKey":"new-openrouter-key-paid-123"}))
        self.assertEqual(code,200,paid)
        self.assertEqual(paid["connection"]["model"],"somevendor/explicit-model")
        code,data=decode(keys.add({"provider":"openrouter",
                                   "model":"somevendor/example:free",
                                   "apiKey":"new-openrouter-key-free-123"}))
        self.assertEqual(code,200,data)
        self.assertEqual(data["connection"]["model"],"somevendor/example:free")
        self.settings["extraConnections"]["key-"+"b"*16] = {
            "provider":"gemini","model":"gemini-3.5-flash-lite",
            "name":"test","key":"x"*350}
        self.assertFalse(keys.resolve(self.settings,"gemini","key-"+"a"*16))
        self.assertFalse(keys.resolve(self.settings,"openrouter","default-gemini"))
        self.assertEqual(keys.resolve(self.settings,"gemini","default-gemini")["key"],
                         "legacy-gemini-secret-123")

    def test_chat_uses_exact_selected_key_and_never_exposes_secret(self):
        target="key-"+"a"*16
        self.settings["extraConnections"]={target:{
            "provider":"openrouter","model":"some/free:free",
            "key":"second-secret-openrouter-key-test","name":"other"}}
        teacher._REQUEST_TIMES.clear()
        with mock.patch.object(teacher,"_post_json",return_value={
            "choices":[{"message":{"content":'{"reply":"ใช้งานได้","ops":[]}'}}]}) as call:
            code,answer=decode(teacher._chat({
                "provider":"openrouter","connectionId":target,"message":"hello",
                "context":"","history":[]}))
        self.assertEqual(code,200,answer)
        self.assertEqual(call.call_args.args[1]["Authorization"],
                         "Bearer second-secret-openrouter-key-test")
        self.assertNotIn("second-secret",json.dumps(answer))
        other=teacher._chat({"provider":"gemini","connectionId":target,
                             "message":"hello","context":""})
        self.assertEqual(other["statusCode"],503)

    def test_remove_does_not_revoke_a_key_used_by_active_aws_jobs(self):
        id="key-"+"b"*16
        self.settings["extraConnections"]={id:{
            "provider":"gemini","model":"gemini-3.5-flash-lite",
            "key":"secondary-gemini-key","name":"Gemini2"}}
        with mock.patch.object(cloud_jobs,"_list_jobs",return_value=cloud_jobs._resp(
            200,{"jobs":[{"connectionId":id,"state":"running"}]})):
            code,_=decode(keys.remove({"connectionId":id,
                                       "confirmRemove":True},keys.ADMIN_ID))
            self.assertEqual(code,409)
        self.assertIn(id,self.settings["extraConnections"])
        with mock.patch.object(cloud_jobs,"_list_jobs",return_value=cloud_jobs._resp(
            200,{"jobs":[{"connectionId":id,"state":"completed"}]})):
            code,_=decode(keys.remove({"connectionId":id,
                                       "confirmRemove":True},keys.ADMIN_ID))
            self.assertEqual(code,200)
        self.assertNotIn(id,self.settings["extraConnections"])

    def test_each_job_is_pinned_to_one_connection_with_distinct_digest(self):
        table,_,scenes=fixture()
        selected="key-"+"c"*16
        self.settings["extraConnections"]={selected:{
            "provider":"gemini","model":"gemini-3.5-flash-lite",
            "key":"another-gemini-key-secret","name":"Gemini second"}}
        with mock.patch.object(cloud_jobs,"_table",return_value=table), \
             mock.patch.object(cloud_jobs,"_launch",return_value="exec"), \
             mock.patch.dict(os.environ,{
                 "TEACHER_FEEDBACK_TABLE":"test",
                 "TEACHER_JOB_STATE_MACHINE_ARN":"arn:aws:states:a:b:stateMachine:test"}):
            old=cloud_jobs._start({"projectId":"story123","provider":"gemini",
                                   "scenes":scenes},keys.ADMIN_ID)
            extra=cloud_jobs._start({"projectId":"story123","provider":"gemini",
                                     "connectionId":selected,"scenes":scenes},keys.ADMIN_ID)
        self.assertEqual(old["statusCode"],200)
        self.assertEqual(extra["statusCode"],200)
        legacy=json.loads(old["body"])["job"]
        more=json.loads(extra["body"])["job"]
        self.assertNotEqual(legacy["jobId"],more["jobId"])
        self.assertEqual(more["connectionId"],selected)
        self.assertEqual(legacy["connectionId"],"default-gemini")

    def test_same_provider_distinct_connections_do_not_block_each_other(self):
        table,_,_=fixture()
        now=1700000000
        a="key-"+"a"*16
        b="key-"+"b"*16
        self.assertTrue(cloud_jobs._try_provider_lock(table,a,"jobA",now))
        self.assertTrue(cloud_jobs._try_provider_lock(table,b,"jobB",now))
        self.assertFalse(cloud_jobs._try_provider_lock(table,a,"jobC",now))
        self.assertEqual(table.rows[(
            cloud_jobs.PROVIDER_LOCK_PREFIX+a,"lease")]["ownerJob"],"jobA")
        self.assertEqual(table.rows[(
            cloud_jobs.PROVIDER_LOCK_PREFIX+b,"lease")]["ownerJob"],"jobB")

if __name__=="__main__":
    unittest.main()
