"""AI Mother knowledge/chat contract: no cloud access, no secrets, no mutation."""
import json
import os
import sys
import unittest
from unittest import mock
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "autodub"))
import teacher
import teacher_advisor


def unpack(value):
    return value["statusCode"], json.loads(value["body"])


def narrative():
    return teacher._response(200, {
        "counts": {"rows": 104, "projects": 2, "minimumRows": 60,
                   "minimumProjects": 5, "minimumPerIssue": 8,
                   "labels": {"keep": 70, "continuity": 34}},
        "activeVersion": None, "readyForTraining": False,
        "models": [], "lastTraining": None})


def repetition():
    return teacher._response(200, {"active": {"version": "test-cpu-001"}})


class MotherAdvisorTests(unittest.TestCase):
    def test_status_uses_read_only_real_data_and_reports_missing_as_unknown(self):
        import story_auto_train, student_learning
        with mock.patch.object(teacher, "_status", return_value=teacher._response(
                200, {"providers": [{"id": "gemini", "ready": True,
                                     "model": "model-free", "key": "NEVER-SHARE"}]})), \
             mock.patch.object(story_auto_train, "status", return_value=narrative()), \
             mock.patch.object(student_learning, "_model", return_value=repetition()):
            code, data = unpack(teacher.handle("teacher.advisorStatus", {}))
        self.assertEqual(code, 200)
        snapshot = data["snapshot"]
        self.assertEqual(snapshot["narrativeChild"]["savedLessons"], 104)
        self.assertEqual(snapshot["narrativeChild"]["distinctProjects"], 2)
        self.assertFalse(snapshot["narrativeChild"]["trainedGenerativeLLM"])
        self.assertIsNone(snapshot["narrativeChild"]["activeVersion"])
        self.assertEqual(snapshot["repetitionChild"]["activeVersion"], "test-cpu-001")
        self.assertEqual(snapshot["providers"][0]["model"], "model-free")
        self.assertNotIn("NEVER-SHARE", json.dumps(data))
        self.assertEqual(snapshot["knowledgeType"],
                         "curated-backend-manifest-not-live-repository-scan")

        with mock.patch.object(story_auto_train, "status", side_effect=RuntimeError("AWS failure")):
            out = teacher_advisor._aws_snapshot()
        self.assertFalse(out["available"])
        self.assertNotIn("savedLessons", out)

    def test_free_status_does_not_call_external_model(self):
        with mock.patch.object(teacher, "_post_json", side_effect=AssertionError(
                "should not call provider")), \
             mock.patch.object(teacher_advisor, "_aws_snapshot", return_value={
                 "available": False, "source": "aws"}), \
             mock.patch.object(teacher_advisor, "_repetition_snapshot", return_value={
                 "available": False, "source": "aws"}):
            code, data = unpack(teacher.handle("teacher.advisorStatus", {}))
        self.assertEqual(code, 200)
        self.assertEqual(data["snapshot"]["features"][0]["name"], "Story Studio")

    def test_chat_is_explicitly_advisory_and_never_returns_edit_ops(self):
        snapshot = {
            "knowledgeVersion": teacher_advisor.KNOWLEDGE_VERSION,
            "features": teacher_advisor.FEATURES,
            "boundaries": teacher_advisor.BOUNDARIES,
            "providers": [{"id": "openrouter", "model": "openrouter/free", "ready": True}],
            "narrativeChild": {"source": "aws", "available": False},
            "repetitionChild": {"source": "aws", "available": True,
                                "activeVersion": None},
            "measuredAt": 1762135000
        }
        with mock.patch.object(teacher_advisor, "_snapshot", return_value=snapshot), \
             mock.patch.object(teacher_advisor, "_github_evidence", return_value={
                 "available": True, "source": "github-main-live-tree",
                 "treeSha": "abc123", "selectedFiles": ["autodub/teacher.py"]}), \
             mock.patch.object(teacher_advisor, "_cloudwatch_summary", return_value={
                 "requested": False}), \
             mock.patch.object(teacher, "_chat", return_value=teacher._response(200, {
                 "reply": "ยังตรวจข้อมูลลูกเขียนบทไม่ได้",
                 "ops": [{"op": "updateScene", "id": "a", "patch": {"duration": 2}}],
                 "provider": "openrouter", "model": "openrouter/free",
                 "trained": False, "applied": False})) as chat:
            code, result = unpack(teacher.handle("teacher.advisorChat", {
                "provider": "openrouter", "message": "AI ลูกเก่งแค่ไหน",
                "project": {"title": "Example", "sceneCount": 3,
                            "secret": "PRIVATE_JSON_FULL_TEXT"},
                "history": [{"role": "user", "content": "เคยถามแล้ว"}]}))
        self.assertEqual(code, 200)
        self.assertNotIn("ops", result)
        self.assertFalse(result["trained"])
        self.assertFalse(result["applied"])
        self.assertFalse(result["evidence"]["narrativeAWS"])
        self.assertTrue(result["evidence"]["githubLive"])
        self.assertEqual(result["evidence"]["githubFiles"], ["autodub/teacher.py"])
        sent = chat.call_args.args[0]
        self.assertTrue(chat.call_args.kwargs["advisor_mode"])
        self.assertIn("clientReportedProject", sent["context"])
        self.assertNotIn("PRIVATE_JSON_FULL_TEXT", sent["context"])
        self.assertIn("available", sent["context"])
        self.assertIn("knowledgeVersion", sent["context"])

    def test_advisor_provider_system_requires_source_grounding(self):
        with mock.patch.object(teacher, "_settings", return_value={
                "openrouter": {"key": "fake-test-key-without-cloud",
                               "model": "openrouter/free"}}), \
             mock.patch.object(teacher, "_post_json", return_value={
                "choices": [{"message": {"content":
                    '{"reply":"ไม่มีข้อมูล AWS ที่ยืนยันได้","ops":[]}'}}]
             }) as post:
            teacher._REQUEST_TIMES.clear()
            status, answer = unpack(teacher._chat({
                "provider": "openrouter", "message": "รู้จักเว็บไหม",
                "context": '{"source":"unavailable"}'}, advisor_mode=True))
        self.assertEqual(status, 200)
        self.assertIn("ไม่มีข้อมูล", answer["reply"])
        system = post.call_args.args[2]["messages"][0]["content"]
        self.assertIn("liveGitHub", system)
        self.assertIn("NEVER invent", system)
        self.assertIn("NOT trained", system)
        self.assertIn("ops (empty array)", system)

    def test_source_excerpts_are_immutable_bounded_and_redacted(self):
        import base64
        import teacher_advisor as advisor
        fake_tree = {"sha": "a" * 40, "tree": [
            {"path": "autodub/teacher.py", "sha": "b" * 40,
             "type": "blob", "size": 220},
            {"path": ".env", "sha": "c" * 40,
             "type": "blob", "size": 220},
            {"path": "autodub/github_oauth.py", "sha": "d" * 40,
             "type": "blob", "size": 320}]}
        public_code = ("def train():\n    return True\n"
                       "API_KEY = 'SENSITIVE_TEST_VALUE_DO_NOT_SHOW'\n")
        def mocked_api(url, size_limit=550000):
            if "/git/trees/main" in url:
                return fake_tree
            if "/git/blobs/" in url:
                return {"encoding": "base64",
                        "content": base64.b64encode(public_code.encode()).decode()}
            raise AssertionError("Unexpected URL " + url)
        advisor._SOURCE_CACHE.update({"time": 0, "tree": None})
        with mock.patch.object(advisor, "_github_read", side_effect=mocked_api):
            evidence = advisor._github_evidence("สอน AI ลูก ฝึกอะไร", include_code=True)
        self.assertTrue(evidence["available"])
        self.assertEqual(evidence["treeSha"], "a" * 40)
        self.assertEqual(evidence["selectedFiles"], ["autodub/teacher.py"])
        self.assertNotIn("SENSITIVE_TEST_VALUE_DO_NOT_SHOW",
                         json.dumps(evidence))
        self.assertNotIn(".env", json.dumps(evidence))
        self.assertIn("[credential-related source line redacted]",
                      evidence["sourceExcerpts"][0]["excerpt"])
        advisor._SOURCE_CACHE.update({"time": 0, "tree": None})

    def test_live_source_graceful_failure_and_cloudwatch_no_raw_logs(self):
        import teacher_advisor as advisor
        with mock.patch.object(advisor, "_github_tree",
                               side_effect=advisor._GitHubUnavailable("429")):
            result = advisor._github_evidence("deploy", include_code=True)
        self.assertFalse(result["available"])
        self.assertEqual(result["sourceExcerpts"], [])
        self.assertFalse(advisor._cloudwatch_summary("GitHub login")["requested"])
        self.assertFalse(advisor._cloudwatch_summary("AI ลูก")["requested"])
        code = advisor._context({"projectId": "project-001",
                                 "secret": "DO_NOT_COPY", "sceneCount": 293})
        self.assertEqual(code, {"projectId": "project-001", "sceneCount": 293})

    def test_owner_job_status_never_reads_another_account(self):
        import cloud_jobs
        with mock.patch.object(cloud_jobs, "enabled", return_value=True), \
             mock.patch.object(cloud_jobs, "_find",
                               return_value=teacher._response(200, {
                                   "job": {"jobId": "id", "completed": 82,
                                           "total": 293}})) as fetch:
            data = teacher_advisor._job_snapshot({"projectId": "project-001"},
                                                 225819900)
        self.assertTrue(data["available"])
        self.assertEqual(data["job"]["completed"], 82)
        self.assertEqual(fetch.call_args.args[1], "225819900")
        self.assertFalse(teacher_advisor._job_snapshot(
            {"projectId": "project-001"}, None)["available"])

    def test_repo_status_only_reads_github_not_the_model(self):
        with mock.patch.object(teacher_advisor, "_github_evidence", return_value={
                "available": True, "treeSha": "f" * 40}), \
             mock.patch.object(teacher, "_post_json", side_effect=AssertionError(
                 "provider must not be called")):
            code, data = unpack(teacher_advisor.handle(
                "teacher.advisorRepoStatus", {}, owner_id=225819900))
        self.assertEqual(code, 200)
        self.assertEqual(data["repository"]["treeSha"], "f" * 40)

    def test_input_is_bounded_before_model_call(self):
        with mock.patch.object(teacher_advisor, "_snapshot",
                               side_effect=AssertionError("too early")):
            code, _ = unpack(teacher_advisor.handle("teacher.advisorChat", {
                "provider": "gemini", "message": "x" * 2600}))
        self.assertEqual(code, 400)
        self.assertEqual(teacher_advisor._context({
            "title": "x" * 1000, "sceneCount": "not a number",
            "secret": "do not copy"}),
            {"title": "x" * 160})


if __name__ == "__main__":
    unittest.main()
