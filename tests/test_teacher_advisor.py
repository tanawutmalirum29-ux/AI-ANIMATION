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
        self.assertIn("NOT a live", system)
        self.assertIn("NEVER invent", system)
        self.assertIn("NOT trained", system)
        self.assertIn("ops (empty array)", system)

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
